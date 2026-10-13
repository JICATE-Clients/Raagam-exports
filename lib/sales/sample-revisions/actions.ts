"use server";

/**
 * Sample ▸ Revision — every write (0716). NO TYPE RE-EXPORTS from this file
 * (a "use server" module re-exporting a type crashes at runtime).
 *
 * The database is the lock (triggers on opportunities / styles / cost_sheets)
 * and the only writer of `sample_revisions` (its functions). These actions
 * gather what the database cannot — the entry's V0 payload, the next costing
 * revision through the costing's own save path, the cost heads for the MD —
 * and start the approval run.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { startApproval } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { getSampleEntryRecord } from "@/lib/sales/sample-entry/service";
import { sampleEntryInput, toSampleEntryPayload } from "@/lib/sales/sample-entry/types";
import { getSampleCostingRecord } from "@/lib/sales/sample-costing/service";
import { saveSampleCosting } from "@/lib/sales/sample-costing/actions";
import { costingKpisOf, getSampleRevision, revisionForCosting } from "./service";
import { REVISION_KINDS, REVISION_ORIGINS, opensCosting, type CostingKpis, type CostingPair, type RaiseSampleRevisionInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };
const PATH = "/sales/sample-revision";

const raiseInput = z.object({
  opportunity_id: z.string().uuid("Pick the sample (SMP No)."),
  kinds: z.array(z.enum(REVISION_KINDS)).min(1, "Tick at least one module to revise."),
  origin: z.enum(REVISION_ORIGINS),
  remarks: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, "Enter the remarks — why the sample is being revised."),
});

/**
 * RAISE — the revision, its V0, and (for a costing module) the next costing
 * revision of every approved costing of the sample, made through the costing's
 * own save so it is exactly the sheet the editor would have made.
 */
export async function raiseSampleRevision(input: RaiseSampleRevisionInput): Promise<{ ok: true; id: string; code: string } | { ok: false; error: string }> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to raise a sample revision." };
  const parsed = raiseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the revision." };
  const p = parsed.data;
  const s = await createClient();

  // V0 of the entry: the payload `save_sample_entry` takes, so the restore is
  // one call of the same writer.
  let snapshot: unknown = null;
  if (p.kinds.includes("sample_info")) {
    const record = await getSampleEntryRecord(p.opportunity_id);
    if (!record) return { ok: false, error: "This sample no longer exists." };
    const payload = sampleEntryInput.safeParse(toSampleEntryPayload(record.header, record.styles, false));
    if (!payload.success) {
      return { ok: false, error: `The sample entry as approved does not read back cleanly: ${payload.error.issues[0]?.message ?? "invalid"}.` };
    }
    snapshot = payload.data;
  }

  const { data, error } = await s.rpc("raise_sample_revision", {
    p_opp: p.opportunity_id,
    p_origin: p.origin,
    p_kinds: p.kinds,
    p_remarks: p.remarks,
    p_snapshot: snapshot,
  });
  if (error) return { ok: false, error: error.message };
  const out = data as { id: string; code: string };

  if (opensCosting(p.kinds)) {
    const made = await makeCostingRevisions(out.id, p.opportunity_id);
    if (!made.ok) {
      revalidatePath(PATH);
      return { ok: false, error: `${out.code} is raised, but its costing revision was not made: ${made.error} Open it and press "Make costing revision".` };
    }
  }
  await writeAudit({ action: "sample_revision.raised", entityType: "sample_revision", entityId: out.id });
  revalidatePath(PATH);
  return { ok: true, id: out.id, code: out.code };
}

async function makeCostingRevisions(revisionId: string, opportunityId: string): Promise<Result> {
  const s = await createClient();
  const { data: sheets, error } = await s
    .from("cost_sheets")
    .select("id")
    .eq("opportunity_id", opportunityId)
    .eq("costing_type", "sample")
    .eq("status", "approved");
  if (error) return { ok: false, error: error.message };
  const pairs: CostingPair[] = [];
  for (const sheet of sheets ?? []) {
    const record = await getSampleCostingRecord(sheet.id as string);
    if (!record) continue;
    const saved = await saveSampleCosting(null, record.draft, { isDraft: false, parentId: record.id });
    if (!saved.ok) return { ok: false, error: saved.error };
    pairs.push({ parent_id: record.id, proposed_id: saved.id });
  }
  const { error: setError } = await s.rpc("set_sample_revision_costings", { p_id: revisionId, p_pairs: pairs });
  return setError ? { ok: false, error: setError.message } : { ok: true };
}

/** Retry for a raise whose costing revision did not get made. */
export async function makeSampleRevisionCosting(id: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to change a sample revision." };
  const rev = await getSampleRevision(id);
  if (!rev) return { ok: false, error: "This revision no longer exists." };
  if (rev.status !== "draft") return { ok: false, error: "This revision is not open for changes." };
  if (!opensCosting(rev.kinds) || rev.costing_pairs.length) return { ok: true };
  const made = await makeCostingRevisions(id, rev.opportunity_id);
  revalidatePath(PATH);
  return made;
}

/**
 * SEND TO MD — the cost heads V0 and proposed frozen with it, the revision and
 * its costing revisions moved to 'pending' / 'submitted', then the one approval
 * run. A run that does not start puts everything back to draft.
 */
export async function submitSampleRevision(id: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to send a sample revision." };
  const rev = await getSampleRevision(id);
  if (!rev) return { ok: false, error: "This revision no longer exists." };
  if (rev.status !== "draft") return { ok: false, error: "This revision is already with the MD or closed." };
  if (opensCosting(rev.kinds) && !rev.costing_pairs.length) {
    return { ok: false, error: 'Its costing revision has not been made yet — press "Make costing revision" first.' };
  }

  const v0: CostingKpis[] = [];
  const proposed: CostingKpis[] = [];
  for (const p of rev.costing_pairs) {
    const [a, b] = await Promise.all([costingKpisOf(p.parent_id), costingKpisOf(p.proposed_id)]);
    if (a) v0.push(a);
    if (b) proposed.push(b);
  }

  const s = await createClient();
  const { error } = await s.rpc("submit_sample_revision", { p_id: id, p_v0: v0, p_proposed: proposed });
  if (error) return { ok: false, error: error.message };

  const first = proposed[0] ?? null;
  const base = v0[0] ?? null;
  const started = await startApproval({
    workflowKey: WORKFLOWS.sample_revision.key,
    subjectTable: WORKFLOWS.sample_revision.subjectTable,
    subjectId: id,
    // Every key a flow might test; a missing key falls to the catch-all.
    context: {
      revision_code: rev.revision_code,
      smp_no: rev.smp_no,
      kinds: rev.kinds,
      origin: rev.origin,
      currency: first?.currency ?? base?.currency ?? null,
      v0_cost: base?.gross_cost ?? null,
      proposed_cost: first?.gross_cost ?? null,
      v0_margin_pct: base?.margin_pct ?? null,
      proposed_margin_pct: first?.margin_pct ?? null,
    },
  });
  if (!started.ok) {
    await s.rpc("withdraw_sample_revision", { p_id: id });
    return { ok: false, error: started.error };
  }
  await writeAudit({ action: "sample_revision.submitted", entityType: "sample_revision", entityId: id });
  revalidatePath(PATH);
  return { ok: true };
}

/** ABANDON — V0 back, the proposed costing removed; remarks required. */
export async function abandonSampleRevision(id: string, remark: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to abandon a sample revision." };
  if (!remark.trim()) return { ok: false, error: "Enter why the revision is being abandoned." };
  const s = await createClient();
  const { error } = await s.rpc("abandon_sample_revision", { p_id: id, p_remark: remark.trim() });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "sample_revision.abandoned", entityType: "sample_revision", entityId: id });
  revalidatePath(PATH);
  return { ok: true };
}

/** Why this sample's ENTRY cannot be saved right now, or null — the same
 *  sentence the database refuses with (`sample_entry_refusal`). */
export async function sampleEntryLock(opportunityId: string): Promise<string | null> {
  const s = await createClient();
  const { data } = await s.rpc("sample_entry_refusal", { p_opp: opportunityId });
  return typeof data === "string" ? data : null;
}

/** The open revision this costing sheet belongs to, for the costing editor's
 *  strip — or null for an ordinary sheet. */
export async function costingRevisionOf(costSheetId: string) {
  if (!(await can("sales", "view"))) return null;
  try {
    return await revisionForCosting(costSheetId);
  } catch {
    return null;
  }
}
