"use server";

/**
 * Sample Costing — server actions (0688 / 0689).
 *
 * NO TYPE RE-EXPORTS from this file: a `"use server"` module that re-exports a
 * type crashes at runtime with "X is not defined" while tsc passes it. Types
 * live in ./types.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import {
  costingDraftSchema,
  costingProblems,
  isDeletableStatus,
  isRevisableStatus,
  summaryOf,
  toCostingPayload,
  type CostingDraft,
  type CostingRecord,
  type CostingStatus,
  type RevisionRow,
} from "./types";
import { getQuoteExchangeRate, getSampleCostingRecord } from "./service";
import { revisionForCosting } from "@/lib/sales/sample-revisions/service";

type SaveResult = { ok: true; id: string; code: string | null; version: number } | { ok: false; error: string };
type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/sales/sample-costing";

/**
 * Save the sheet — or, with `parentId` and no `id`, save it as the next
 * revision of `parentId` (0688: same Costing No, version + 1, the parent
 * superseded in the same transaction).
 *
 * THE DRAFT IS CHECKED HERE AGAIN with the screen's own `costingProblems`, and
 * the summary snapshot is computed HERE — the client never supplies a figure.
 */
export async function saveSampleCosting(
  id: string | null,
  draft: CostingDraft,
  opts: { isDraft: boolean; parentId?: string | null },
): Promise<SaveResult> {
  if (!(await can("sales", id ? "edit" : "create")) && !(await can("sales", "edit"))) {
    return { ok: false, error: "Forbidden" };
  }
  const parsed = costingDraftSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const problem = costingProblems(parsed.data, { draft: opts.isDraft })[0];
  if (problem) return { ok: false, error: problem.message };

  /* A SAMPLE REVISION'S PROPOSED COSTING (0716) is frozen only while the
     revision is with the MD. Its old FIELD SCOPE (`costingRevisionProblem`,
     "does not open Fabric & Yarn Spec") is NO LONGER APPLIED (user 2026-10-14):
     the costing changes through its own Revise now (0725), and Sample Revision
     is for Sample Info — so a costing field is never refused by a module name.
     It refused every fabric edit on SMP-REV/26-27/0001, raised with the retired
     "Costing & Price" module, whose scope no longer opened fabrics at all. */
  if (id) {
    const rev = await revisionForCosting(id);
    if (rev && rev.status !== "draft") {
      return { ok: false, error: `Sample Revision ${rev.revision_code} is with the MD — nothing in it can change until it is decided.` };
    }
  }

  const payload = toCostingPayload(parsed.data, { isDraft: opts.isDraft, parentId: id ? null : (opts.parentId ?? null) });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_sample_costing", { p_id: id, p: payload });
  if (error) return { ok: false, error: error.message };
  const out = data as { id: string; code: string | null; version: number } | null;
  if (!out?.id) return { ok: false, error: "The costing was not saved." };
  // 0695: the Overheads / Price & quote "+ Add" rows ride beside the RPC, not inside it.
  const { error: extrasError } = await supabase.from("cost_sheets").update({ extra_charges: payload.extras }).eq("id", out.id);
  if (extrasError) return { ok: false, error: `The costing was saved but its extra charges were not: ${extrasError.message}` };

  await writeAudit({
    action: opts.parentId && !id ? "sample_costing.revised" : id ? "sample_costing.updated" : "sample_costing.created",
    entityType: "cost_sheet",
    entityId: out.id,
  });
  revalidatePath(LIST_PATH);
  return { ok: true, id: out.id, code: out.code, version: out.version };
}

export async function loadSampleCosting(
  id: string,
): Promise<{ ok: true; record: CostingRecord; revisions: RevisionRow[] } | { ok: false; error: string }> {
  if (!(await can("sales", "view"))) return { ok: false, error: "Forbidden" };
  try {
    const record = await getSampleCostingRecord(id);
    if (!record) return { ok: false, error: "This costing no longer exists." };
    let revisions: RevisionRow[] = [
      { id: record.id, version: record.version, status: record.status, target_fob: null, currency_code: record.draft.header.currency_code },
    ];
    if (record.code) {
      const s = await createClient();
      const { data, error } = await s
        .from("cost_sheets")
        .select("id, version, status, target_fob, currency_code")
        .eq("code", record.code)
        .order("version", { ascending: true });
      if (error) return { ok: false, error: error.message };
      revisions = ((data ?? []) as (Omit<RevisionRow, "target_fob"> & { target_fob: number | string | null })[]).map((r) => ({
        ...r,
        target_fob: r.target_fob == null ? null : Number(r.target_fob),
      }));
    }
    return { ok: true, record, revisions };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load the costing." };
  }
}

/** What a new Costing No would be — a PREDICTION for the read-only box. */
export async function previewCostingNo(on: string | null): Promise<string | null> {
  if (!(await can("sales", "create"))) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("peek_sample_number", { p_series: "CST", p_on: on && on.trim() ? on : null });
  return typeof data === "string" ? data : null;
}

/**
 * SEND TO BUYER — Draft → Under Progress (0725, spec v8 §8.1; user 2026-10-14:
 * "the costing is created and handled directly by the MD, an internal MD
 * Approval Pending state is unnecessary"). NO APPROVAL RUN: the decision that
 * makes a costing Approved is the buyer's, recorded by `recordCustomerDecision`.
 *
 * REVERSES the same morning's "every costing → MD" (client: "each costing need
 * an approval"), which itself replaced 0688's ≥ 20 % auto-approve. Restoring an
 * internal gate needs a new client decision. The margin floor survives as the
 * red warning on the sheet, and the lowest margin is still stamped here,
 * recomputed from the STORED sheet, never taken from the screen.
 */
export async function submitSampleCosting(
  id: string,
): Promise<{ ok: true; outcome: "under_progress"; lowest: number | null } | { ok: false; error: string }> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };
  const record = await getSampleCostingRecord(id).catch(() => null);
  if (!record) return { ok: false, error: "This costing no longer exists." };
  if (record.status !== "draft") {
    return { ok: false, error: record.status === "submitted" ? "This costing is already with the buyer (Under Progress)." : `This costing is ${record.status}.` };
  }
  if (record.is_draft) return { ok: false, error: "Save the costing (not as a draft) before sending it to the buyer." };
  // A SAMPLE REVISION'S PROPOSED COSTING GOES TO THE MD WITH ITS REVISION. The
  // editor hid Submit for it; since 2026-10-14 the list sends too, so the rule
  // lives here, where every door meets it.
  const rev = await revisionForCosting(id).catch(() => null);
  if (rev) return { ok: false, error: `This costing belongs to Sample Revision ${rev.revision_code} — send it to the MD from that revision.` };
  const problem = costingProblems(record.draft)[0];
  if (problem) return { ok: false, error: problem.message };

  const summary = summaryOf(record.draft);
  const me = (await getAppUser())?.id ?? null;
  const now = new Date().toISOString();
  const s = await createClient();

  const { data: moved, error: upErr } = await s
    .from("cost_sheets")
    .update({ status: "submitted", submitted_at: now, submitted_by: me, profit_loss_pct: summary.lowestMarginPct })
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (upErr) return { ok: false, error: upErr.message };
  if (!moved?.length) return { ok: false, error: "This costing changed while you were looking at it — reopen it and try again." };

  await writeAudit({ action: "sample_costing.sent_to_buyer", entityType: "cost_sheet", entityId: id });
  revalidatePath(LIST_PATH);
  return { ok: true, outcome: "under_progress", lowest: summary.lowestMarginPct };
}

/**
 * REVISE — the costing's own button again (0725, spec v8 §1 / §8.1: "Revise"
 * for the quotation, "Revision" only for plans and Sample Info). Copies the
 * STORED sheet into version + 1 under the same Costing No; the database
 * supersedes the parent and starts the new one Under Progress (from Under
 * Progress or Approved — the negotiation continues) or Draft (from Rejected —
 * "Re-open as New Draft"). The superseded parent is the V0 the buyer saw.
 */
export async function reviseSampleCosting(id: string): Promise<SaveResult> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };
  const record = await getSampleCostingRecord(id).catch(() => null);
  if (!record) return { ok: false, error: "This costing no longer exists." };
  if (!isRevisableStatus(record.status)) {
    return { ok: false, error: `A ${record.status} costing is not revised — ${record.status === "draft" ? "edit it directly" : "open the latest revision"}.` };
  }
  return saveSampleCosting(null, record.draft, { isDraft: false, parentId: id });
}

/**
 * CUSTOMER APPROVED / CUSTOMER REJECTED — the buyer's answer to an Under
 * Progress quote, recorded by the merchandiser (0725, spec v8 §8.1: "Status
 * changes to Approved ONLY when customer confirms acceptance via email").
 *
 * Approved stamps `approved_at` — the fact 0725's `sample_is_approved` reads, so
 * the SMP locks and STAYS locked while a later Revise re-negotiates the price.
 * Rejected needs the buyer's reason (§9.2 "View Rejection Reason"), kept in
 * `decision_remark`. Neither is reversible here: Revise opens the next version.
 */
export async function recordCustomerDecision(
  id: string,
  decision: "approved" | "rejected",
  remark: string,
): Promise<ActionResult> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };
  const note = remark.trim();
  if (decision === "rejected" && !note) return { ok: false, error: "Say why the buyer declined — it is shown on the Rejected tab." };
  const record = await getSampleCostingRecord(id).catch(() => null);
  if (!record) return { ok: false, error: "This costing no longer exists." };
  if (record.status !== "submitted") {
    return { ok: false, error: `Only an Under Progress costing takes the buyer's answer (this one is ${record.status}).` };
  }
  const me = (await getAppUser())?.id ?? null;
  const now = new Date().toISOString();
  const s = await createClient();
  const patch =
    decision === "approved"
      ? { status: "approved", approved_at: now, approved_by: me, decided_at: now, decided_by: me, decision_remark: note || null }
      : { status: "rejected", decided_at: now, decided_by: me, decision_remark: note };
  const { data: moved, error } = await s.from("cost_sheets").update(patch).eq("id", id).eq("status", "submitted").select("id");
  if (error) return { ok: false, error: error.message };
  if (!moved?.length) return { ok: false, error: "This costing changed while you were looking at it — reopen it and try again." };
  await writeAudit({ action: `sample_costing.customer_${decision}`, entityType: "cost_sheet", entityId: id });
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/** The MD's Approve / Request Rework bar, for the editor.
 *  `mine` = this user sent the run; the editor then offers no decision — a
 *  Super Admin's override would otherwise approve their own costing from the
 *  sheet they just submitted (client 2026-10-14, the Fabric Plan's twin).
 *  The decision is made from the Approvals queue. */
export async function getCostingApproval(id: string) {
  if (!(await can("sales", "view"))) return { run: null, verdict: null, timeline: [], names: {}, mine: false };
  const [panel, me] = await Promise.all([getApprovalPanel(WORKFLOWS.sample_costing.subjectTable, id), getAppUser()]);
  return { ...panel, mine: !!panel.run && !!me && panel.run.requested_by === me.id };
}

export async function deleteSampleCosting(id: string): Promise<ActionResult> {
  if (!(await can("sales", "delete"))) return { ok: false, error: "Forbidden" };
  const supabase = await createClient();
  const { data: row } = await supabase.from("cost_sheets").select("status").eq("id", id).maybeSingle();
  if (row && !isDeletableStatus(row.status as CostingStatus)) {
    return { ok: false, error: `Only a Draft costing can be deleted — this one was sent to the buyer (${row.status}).` };
  }
  const { error, count } = await supabase.from("cost_sheets").delete({ count: "exact" }).eq("id", id);
  if (error?.code === "23503") {
    return { ok: false, error: "A quote or a later revision points at this costing, so it cannot be deleted." };
  }
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "This costing was not deleted — it may already be gone." };
  await writeAudit({ action: "sample_costing.deleted", entityType: "cost_sheet", entityId: id });
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/** "Fetch rate" — the Quotes & Orders register's rate for this currency on the costing date. */
export async function fetchQuoteRate(
  currency: string,
  onDate: string | null,
): Promise<{ ok: true; rate: number; effectiveFrom: string | null } | { ok: false; error: string }> {
  if (!(await can("sales", "view"))) return { ok: false, error: "Forbidden" };
  if (currency === "INR") return { ok: true, rate: 1, effectiveFrom: null };
  try {
    const hit = await getQuoteExchangeRate(currency, onDate);
    if (!hit) {
      return {
        ok: false,
        error: `No ${currency} rate in Master Data ▸ Currencies ▸ Exchange rate (Quotes / Orders) on or before that date — type the rate, or add it there.`,
      };
    }
    return { ok: true, rate: hit.rate, effectiveFrom: hit.effectiveFrom };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the exchange rate." };
  }
}
