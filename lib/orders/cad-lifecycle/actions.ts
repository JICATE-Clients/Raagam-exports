"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  allocationInput,
  CAD_BUCKET,
  decisionInput,
  dispatchInput,
  istLocalToIso,
  patternWorkInput,
  mergePatternLines,
  patternSheetInput,
  type PatternSheetInput,
  type PatternWorkInput,
  type AllocationInput,
  type CadStyleRow,
  type DecisionInput,
  type DispatchInput,
  type PatternMakerRow,
} from "./types";
import { getCadLifecycleFormData, listCadStyles } from "./service";
import { notifyPatternReady } from "./notify";

/**
 * Orders ▸ CAD ▸ CAD Lifecycle — the writes (0628).
 *
 * THIN ON PURPOSE. Every rule the spec states — sequential versions, the
 * Pattern Maker's designation, no future dates, dispatch proof, a mandatory
 * .DXF/.PDS/.PLT attachment, rework comments, the layout check — is enforced
 * by the DATABASE (0628's trigger and RPCs, widened by 0632), because `lib/data-io`, a second
 * tab and a stale screen all reach the table without this file. The raised
 * messages are operator sentences, so they are handed straight back.
 *
 * The screen checks the same rules first (`allocationProblem` …) so an operator
 * reads the sentence before the round trip; this file never re-implements them.
 */

type Result = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

/**
 * NOT `/orders/garment-orders` (2026-09-25, "saving and approving are slow").
 * Revalidating the page the operator is ON makes Next re-run its whole loader
 * and re-render it inside the action's response — for Order Entry that is the
 * 12-query `loadGarmentOrderProps` and the 19,000-line screen, paid on every
 * Assign / Send / Approval from the order's CAD tab. Nothing that page loads
 * is CAD data: the tab reads its own (`/api/orders/[id]/cad`) and refetches
 * after each step. The other paths here are not the current page, so marking
 * them stale costs nothing.
 */
function rev(): void {
  revalidatePath("/orders/cad-lifecycle");
  revalidatePath("/orders/fabric-bom");
  revalidatePath("/reports/cad-completion");
}

/**
 * The version's pattern details (0632). Fit Wash = No sends NULL percentages —
 * 0632's CHECK refuses a figure left behind from a Yes that was switched off.
 */
function patternDetails(d: {
  fit_wash: boolean;
  length_shrink_pct: number | null;
  width_shrink_pct: number | null;
  cut_type: string | null;
  component_cuts: {
    component_id: string;
    component_name: string;
    coordinate_id?: string | null;
    coordinate_name?: string | null;
    method: string | null;
    notes?: string | null;
  }[];
}) {
  return {
    fit_wash: d.fit_wash,
    length_shrink_pct: d.fit_wash ? d.length_shrink_pct : null,
    width_shrink_pct: d.fit_wash ? d.width_shrink_pct : null,
    cut_type: d.cut_type,
    component_cuts: d.component_cuts,
  };
}

/**
 * Was this version ALREADY Ready? The merchandiser is told on the move INTO
 * Ready only (user 2026-09-25) — re-saving a Ready sheet must not re-notify.
 */
async function isReady(s: Awaited<ReturnType<typeof createClient>>, id: string): Promise<boolean> {
  const { data } = await s.from("order_cad_allocations").select("pattern_status").eq("id", id).maybeSingle();
  return (data as { pattern_status?: string } | null)?.pattern_status === "ready";
}

const zodMessage = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Invalid input";

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

/** A new version: v1 for a style with none, v(n+1) after a Rework (the trigger decides which). */
export async function allocateCad(data: AllocationInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to allocate a CAD.");
  const p = allocationInput.safeParse(data);
  if (!p.success) return fail(zodMessage(p.error));
  const s = await createClient();
  const { data: row, error } = await s
    .from("order_cad_allocations")
    .insert({
      garment_order_id: p.data.garment_order_id,
      style_ref_no: p.data.style_ref_no,
      pattern_maker_id: p.data.pattern_maker_id,
      cad_type: p.data.cad_type,
      target_date: p.data.target_date,
      remarks: p.data.remarks,
      ...patternDetails(p.data),
    })
    .select("id, version_no")
    .single();
  if (error) return fail(error.message);
  await writeAudit({
    action: "order_cad_allocation.created",
    entityType: "order_cad_allocation",
    entityId: row.id,
    metadata: { style_ref_no: p.data.style_ref_no, version_no: row.version_no },
  });
  rev();
  return { ok: true, id: row.id };
}

/** Who / what / by when — only while the version has not been dispatched. */
export async function updateCadAllocation(id: string, data: AllocationInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to change a CAD allocation.");
  const p = allocationInput.safeParse(data);
  if (!p.success) return fail(zodMessage(p.error));
  const s = await createClient();
  const { error } = await s
    .from("order_cad_allocations")
    .update({
      pattern_maker_id: p.data.pattern_maker_id,
      cad_type: p.data.cad_type,
      target_date: p.data.target_date,
      remarks: p.data.remarks,
      ...patternDetails(p.data),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  await writeAudit({ action: "order_cad_allocation.updated", entityType: "order_cad_allocation", entityId: id });
  rev();
  return { ok: true, id };
}

/**
 * The Pattern Master's step (0638): Pattern Status, and the Order Sheet grid's
 * cut methods and notes. Only while the version has not been sent — the
 * trigger freezes both at dispatch, and cad_dispatch requires Ready.
 */
export async function updatePatternWork(id: string, data: PatternWorkInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to update the pattern.");
  const p = patternWorkInput.safeParse(data);
  if (!p.success) return fail(zodMessage(p.error));
  const s = await createClient();
  const wasReady = await isReady(s, id);
  const { error } = await s
    .from("order_cad_allocations")
    .update({ pattern_status: p.data.pattern_status, component_cuts: p.data.component_cuts })
    .eq("id", id);
  if (error) return fail(error.message);
  if (!wasReady && p.data.pattern_status === "ready") await notifyPatternReady(id);
  await writeAudit({
    action: "order_cad_allocation.pattern_work",
    entityType: "order_cad_allocation",
    entityId: id,
    metadata: { pattern_status: p.data.pattern_status },
  });
  rev();
  return { ok: true, id };
}

/**
 * The Pattern Maker's sheet (0640): status, date and every line, in ONE
 * transaction (`cad_save_pattern_sheet`). Refused by the database once the
 * version is sent. A line the operator typed nothing into is dropped here —
 * the seeded part / fabric / GSM are the order's own values, not evidence the
 * line was filled (AGENTS.md "THE SEEDED ROW IS SAVED UNLESS THE SAVE SIDE
 * DROPS IT").
 */
export async function savePatternSheet(allocationId: string, data: PatternSheetInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to update the pattern sheet.");
  const p = patternSheetInput.safeParse(data);
  if (!p.success) return fail(zodMessage(p.error));
  // Lines that differ only in their parts become one line (0643, Task 2) —
  // here, so a stale form or a replayed request is merged the same way.
  const typed = mergePatternLines(
    p.data.lines.filter(
      (l) => l.colours.length || l.size_ids.length || l.table_dia != null || l.width_form || l.avg_pcs_weight_g != null || l.remark,
    ),
  );
  const s = await createClient();
  const wasReady = await isReady(s, allocationId);
  const { error } = await s.rpc("cad_save_pattern_sheet", {
    p_allocation: allocationId,
    p_status: p.data.pattern_status,
    p_date: p.data.pattern_date,
    p_lines: typed,
  });
  if (error) return fail(error.message);
  if (!wasReady && p.data.pattern_status === "ready") await notifyPatternReady(allocationId);
  await writeAudit({
    action: "order_cad_allocation.pattern_sheet",
    entityType: "order_cad_allocation",
    entityId: allocationId,
    metadata: { pattern_status: p.data.pattern_status, lines: typed.length },
  });
  rev();
  return { ok: true, id: allocationId };
}

export async function deleteCadAllocation(id: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to delete a CAD allocation.");
  const s = await createClient();
  const { error, count } = await s.from("order_cad_allocations").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(error.message);
  if (!count) return fail("That CAD allocation no longer exists.");
  await writeAudit({ action: "order_cad_allocation.deleted", entityType: "order_cad_allocation", entityId: id });
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dispatch — the files are already in storage (uploaded by the sheet under the
// version's folder); this records the dispatch, the files and a Pending
// decision in ONE transaction (`cad_dispatch`).
// ---------------------------------------------------------------------------

export async function dispatchCad(data: DispatchInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to dispatch a CAD.");
  const p = dispatchInput.safeParse(data);
  if (!p.success) return fail(zodMessage(p.error));
  const s = await createClient();
  const { data: id, error } = await s.rpc("cad_dispatch", {
    p_allocation: p.data.allocation_id,
    p_date: p.data.dispatch_date,
    p_courier: p.data.courier_tracking_no,
    p_email_at: istLocalToIso(p.data.email_sent_at),
    p_layout: p.data.layout_type,
    p_remarks: p.data.remarks,
    p_files: [
      ...p.data.files.map((f) => ({ ...f, kind: "pattern" as const })),
      ...p.data.proof_files.map((f) => ({ ...f, kind: "proof" as const })),
    ].map((f) => ({
      kind: f.kind,
      file_name: f.file_name,
      storage_path: f.storage_path,
      mime_type: f.mime_type ?? null,
      size_bytes: f.size_bytes ?? null,
    })),
  });
  if (error) return fail(error.message);
  await writeAudit({
    action: "order_cad.dispatched",
    entityType: "order_cad_allocation",
    entityId: p.data.allocation_id,
    metadata: { files: p.data.files.length, proof_files: p.data.proof_files.length },
  });
  rev();
  return { ok: true, id: id as string };
}

/**
 * Undo a dispatch recorded by mistake — only while the buyer has not answered.
 * The files go with it: the RPC returns their storage paths and they are
 * removed from the bucket (best-effort — an orphaned object is harmless, a
 * dispatch row pointing at nothing is not).
 */
export async function undoCadDispatch(dispatchId: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to undo a CAD dispatch.");
  const s = await createClient();
  const { data, error } = await s.rpc("cad_undo_dispatch", { p_dispatch: dispatchId });
  if (error) return fail(error.message);
  const paths = ((data ?? []) as unknown[]).filter((p): p is string => typeof p === "string");
  if (paths.length > 0) await s.storage.from(CAD_BUCKET).remove(paths);
  await writeAudit({ action: "order_cad.dispatch_undone", entityType: "order_cad_dispatch", entityId: dispatchId });
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The buyer's decision
// ---------------------------------------------------------------------------

export async function decideCad(data: DecisionInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to record a CAD decision.");
  const p = decisionInput.safeParse(data);
  if (!p.success) return fail(zodMessage(p.error));
  const s = await createClient();
  const { error } = await s.rpc("cad_decide", {
    p_dispatch: p.data.dispatch_id,
    p_status: p.data.status,
    p_decided_on: p.data.decided_on,
    p_comments: p.data.buyer_comments,
  });
  if (error) return fail(error.message);
  await writeAudit({
    action: p.data.status === "approved" ? "order_cad.approved" : "order_cad.rework",
    entityType: "order_cad_dispatch",
    entityId: p.data.dispatch_id,
  });
  rev();
  return { ok: true };
}

/** Back to Pending — only while no later version exists. */
export async function reopenCadDecision(dispatchId: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You do not have permission to reopen a CAD decision.");
  const s = await createClient();
  const { error } = await s.rpc("cad_reopen_decision", { p_dispatch: dispatchId });
  if (error) return fail(error.message);
  await writeAudit({ action: "order_cad.decision_reopened", entityType: "order_cad_dispatch", entityId: dispatchId });
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// A dispatch sheet cancelled after its files were uploaded leaves objects no
// row points at. The sheet calls this on Cancel so they do not accumulate.
// Only paths under cad/ are accepted, so this cannot reach another module's
// files.
// ---------------------------------------------------------------------------
export async function discardCadUploads(paths: string[]): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const safe = paths.filter((p) => typeof p === "string" && p.startsWith("cad/") && !p.includes(".."));
  if (safe.length === 0) return { ok: true };
  const s = await createClient();
  // Never remove a file a recorded dispatch already points at.
  const { data: used } = await s.from("order_cad_dispatch_files").select("storage_path").in("storage_path", safe);
  const keep = new Set(((used ?? []) as { storage_path: string }[]).map((u) => u.storage_path));
  const gone = safe.filter((p) => !keep.has(p));
  if (gone.length > 0) await s.storage.from(CAD_BUCKET).remove(gone);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Order Entry ▸ CAD reads ONE order's styles itself (the screen is a client
// editor that must not grow a hook below its early return — the tab is its own
// component and asks through this).
// ---------------------------------------------------------------------------
export type OrderCadData =
  | { ok: true; rows: CadStyleRow[]; employees: PatternMakerRow[]; canEdit: boolean }
  | { ok: false; error: string };

export async function getOrderCad(garmentOrderId: string): Promise<OrderCadData> {
  try {
    // One round, not two: the view check rides beside the (RLS-scoped) reads
    // and a refusal discards them (2026-09-25, "CAD tab shows Loading").
    const [canView, rows, form, canEdit] = await Promise.all([
      can("orders", "view"),
      listCadStyles([garmentOrderId]),
      getCadLifecycleFormData(),
      can("orders", "edit"),
    ]);
    if (!canView) return { ok: false, error: "Forbidden" };
    return { ok: true, rows, employees: form.employees, canEdit };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the CAD for this order." };
  }
}
