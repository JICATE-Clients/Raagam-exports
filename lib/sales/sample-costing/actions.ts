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
import { startApproval, getApprovalPanel } from "@/lib/approvals/actions";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import { MARGIN_FLOOR_PCT } from "./calc";
import {
  costingDraftSchema,
  costingProblems,
  isEditableStatus,
  summaryOf,
  toCostingPayload,
  type CostingDraft,
  type CostingRecord,
  type CostingStatus,
  type RevisionRow,
} from "./types";
import { getQuoteExchangeRate, getSampleCostingRecord } from "./service";

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
 * SUBMIT — spec §5.2. Every quote that earns at least the floor: the sheet is
 * APPROVED on the spot (no MD needed, and the record says so). Any quote under
 * it: the sheet goes to the MD through the approval engine (`sample_costing`).
 *
 * The margin is recomputed HERE from the stored sheet, never taken from the
 * screen. And THE STATUS AND THE RUN ARE ONE STEP: a failed `startApproval`
 * puts the sheet back to draft, because a submitted sheet in nobody's queue is
 * the stranded document the engine exists to prevent (IWO Budget's rule).
 */
export async function submitSampleCosting(
  id: string,
): Promise<{ ok: true; outcome: "approved" | "with_md"; lowest: number | null } | { ok: false; error: string }> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };
  const record = await getSampleCostingRecord(id).catch(() => null);
  if (!record) return { ok: false, error: "This costing no longer exists." };
  if (!isEditableStatus(record.status)) {
    return { ok: false, error: record.status === "submitted" ? "This costing is already with the MD." : `This costing is ${record.status}.` };
  }
  if (record.is_draft) return { ok: false, error: "Save the costing (not as a draft) before submitting it." };
  const problem = costingProblems(record.draft)[0];
  if (problem) return { ok: false, error: problem.message };

  const summary = summaryOf(record.draft);
  const me = (await getAppUser())?.id ?? null;
  const now = new Date().toISOString();
  const s = await createClient();

  if (!summary.belowFloor) {
    const { error } = await s
      .from("cost_sheets")
      .update({
        status: "approved",
        submitted_at: now,
        submitted_by: me,
        approved_at: now,
        approved_by: null,
        decided_at: now,
        decided_by: null,
        decision_remark: `Cleared on submit — every quote earns at least ${MARGIN_FLOOR_PCT}%.`,
        profit_loss_pct: summary.lowestMarginPct,
      })
      .eq("id", id)
      .in("status", ["draft", "rejected"]);
    if (error) return { ok: false, error: error.message };
    await writeAudit({ action: "sample_costing.approved_on_submit", entityType: "cost_sheet", entityId: id });
    revalidatePath(LIST_PATH);
    return { ok: true, outcome: "approved", lowest: summary.lowestMarginPct };
  }

  const { error: upErr } = await s
    .from("cost_sheets")
    .update({ status: "submitted", submitted_at: now, submitted_by: me, profit_loss_pct: summary.lowestMarginPct })
    .eq("id", id)
    .in("status", ["draft", "rejected"]);
  if (upErr) return { ok: false, error: upErr.message };

  const started = await startApproval({
    workflowKey: WORKFLOWS.sample_costing.key,
    subjectTable: WORKFLOWS.sample_costing.subjectTable,
    subjectId: id,
    // Every key a flow might test; a missing key falls to the catch-all.
    context: {
      lowest_margin_pct: summary.lowestMarginPct,
      margin_floor_pct: MARGIN_FLOOR_PCT,
      costing_no: record.code,
      currency: record.draft.header.currency_code,
      quoted_price: summary.groups[0]?.total.quoted ?? null,
    },
  });
  if (!started.ok) {
    await s.from("cost_sheets").update({ status: "draft", submitted_at: null, submitted_by: null }).eq("id", id);
    return { ok: false, error: `No approval could be started — ${started.error}` };
  }
  await writeAudit({ action: "sample_costing.submitted", entityType: "cost_sheet", entityId: id });
  revalidatePath(LIST_PATH);
  return { ok: true, outcome: "with_md", lowest: summary.lowestMarginPct };
}

/** The MD's Approve / Request Rework bar, for the editor. */
export async function getCostingApproval(id: string) {
  if (!(await can("sales", "view"))) return { run: null, verdict: null, timeline: [], names: {} };
  return getApprovalPanel(WORKFLOWS.sample_costing.subjectTable, id);
}

export async function deleteSampleCosting(id: string): Promise<ActionResult> {
  if (!(await can("sales", "delete"))) return { ok: false, error: "Forbidden" };
  const supabase = await createClient();
  const { data: row } = await supabase.from("cost_sheets").select("status").eq("id", id).maybeSingle();
  if (row && !isEditableStatus(row.status as CostingStatus)) {
    return { ok: false, error: `This costing is ${row.status} and cannot be deleted.` };
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
