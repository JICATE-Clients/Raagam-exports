import type { QuickWord } from "@/components/orders/bom-queue";
import type { SampleCardState } from "@/components/sales/sample-queue";
import type { PdQueueRow, PdRequestRow } from "@/lib/sales/pd-requests/types";

/**
 * A PD REQUEST'S PLACE IN THE QUEUE — read by both PD screens, so the
 * merchandiser's register and the department's queue sort one request into
 * the same pile. With the department = Pending; answered either way =
 * Updated; a withdrawn one (its enquiry's run cancelled) shows only under
 * no filter. STATED AS A MAP: a fifth status is a type error here rather
 * than a row that silently belongs to no pile.
 */
const WORD: Record<PdRequestRow["status"], QuickWord | null> = {
  requested: "pending",
  acknowledged: "updated",
  not_acknowledged: "updated",
  cancelled: null,
};
export const pdWord = (r: PdRequestRow): QuickWord | null => WORD[r.status];

const STATE: Record<PdRequestRow["status"], SampleCardState> = {
  requested: "pending",
  acknowledged: "updated",
  not_acknowledged: "neutral",
  cancelled: "neutral",
};
export const pdState = (r: PdRequestRow): SampleCardState => STATE[r.status];

/**
 * AN SMP'S PLACE ON THE PD REQUEST SCREEN (0724) — Pending until the
 * department ACKNOWLEDGES it: none sent, with the department, Not
 * Acknowledged, or withdrawn are all still owed something. The 0723 SWO
 * request has no SMP to be owed anything, so it follows its request's word.
 */
export const queueWord = (q: PdQueueRow): QuickWord | null =>
  q.smp ? (q.request?.status === "acknowledged" ? "updated" : "pending") : q.request ? pdWord(q.request) : null;
export const queueState = (q: PdQueueRow): SampleCardState => (q.request ? pdState(q.request) : "pending");
