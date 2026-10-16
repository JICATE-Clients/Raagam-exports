import type { QuickWord } from "@/components/orders/bom-queue";
import type { SampleCardState } from "@/components/sales/sample-queue";
import type { PdQueueRow, PdRequestRow } from "@/lib/sales/pd-requests/types";

/**
 * A PD REQUEST'S PLACE IN THE DEPARTMENT'S QUEUE (PD Acknowledge) — THE
 * FOUR-WORD BOX (user 2026-10-15: "untouched entry pending, worked order under
 * progress, approved … approved tab", the sweep Plan Approval took the same
 * day). With the department = Pending (untouched by them); Not Acknowledged =
 * Under Progress (back with the merchandiser to rework — Plan Approval's
 * "Rework Requested"); Acknowledged = Approved. No Draft word: a request has
 * no draft state. A withdrawn one (its enquiry's run cancelled) shows only
 * under no filter. STATED AS A MAP: a fifth status is a type error here.
 */
const WORD: Record<PdRequestRow["status"], QuickWord | null> = {
  requested: "pending",
  acknowledged: "approved",
  not_acknowledged: "progress",
  cancelled: null,
};
/** Both PD screens draw these words, in this order — no Draft. */
export const PD_WORDS: readonly QuickWord[] = ["pending", "progress", "approved"];
export const pdWord = (r: PdRequestRow): QuickWord | null => WORD[r.status];

/* NOT ACKNOWLEDGED IS THE DANGER TONE, EVERYWHERE (2026-10-15) — the red
   pill and stripe, as `PD_STATUS_TONE` colours it in the sheet. It was
   neutral grey here, so the same answer read alarming in the sheet and
   unremarkable on its card. On PD Request such an SMP is still owed a
   request, so it sits in Pending with the pending stripe. */
const STATE: Record<PdRequestRow["status"], SampleCardState> = {
  requested: "pending",
  acknowledged: "updated",
  not_acknowledged: "pending",
  cancelled: "neutral",
};
export const pdState = (r: PdRequestRow): SampleCardState => STATE[r.status];

/**
 * AN SMP'S PLACE ON THE PD REQUEST SCREEN (0724), the merchandiser's view of
 * the same four words: never sent (or withdrawn) = Pending — untouched; with
 * the department, or Not Acknowledged and owed a fixed resend = Under
 * Progress; Acknowledged = Approved. The 0723 SWO request has no SMP, so it
 * follows its request's word.
 */
export const queueWord = (q: PdQueueRow): QuickWord | null => {
  if (!q.smp) return q.request ? pdWord(q.request) : null;
  const st = q.request?.status;
  if (st === "acknowledged") return "approved";
  if (st === "requested" || st === "not_acknowledged") return "progress";
  return "pending";
};
export const queueState = (q: PdQueueRow): SampleCardState => (q.request ? pdState(q.request) : "pending");
