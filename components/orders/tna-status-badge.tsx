/**
 * T&A LADDER ▸ the status chip.
 *
 * A THIN MAP OVER `StatusPill`, NOT A SECOND PILL. The app has one status chip
 * and one tone vocabulary (`lib/ui/tone.ts` → `components/ui/status-pill.tsx`);
 * a badge that hand-rolled `bg-green-100 text-green-700` would be a fourth
 * spelling of "success" that no theme token reaches, and it would invert wrongly
 * in dark mode — `--danger` is a LIGHT red there, which is the trap the pill's
 * own comment records. All this file decides is which of the five tones each T&A
 * state earns, and what the operator reads.
 *
 * `state` is a `TnaDisplayState` and not a stored status, so the badge cannot be
 * handed a rung and forget to ask whether it is late — `tnaDisplayState()` is
 * the only way to produce the value this takes.
 */

import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type { TnaDisplayState } from "@/lib/orders/ta/tna-types";

/**
 * TONE, AND EACH ONE IS A CLAIM ABOUT WHAT THE OPERATOR MUST DO.
 *
 * `lib/ui/tone.ts`: "`neutral` is the default and means 'no claim'... Reserve
 * `danger` for a state the operator must act on, not merely one they may
 * dislike." A rung nobody has started is not a problem — it is most of the
 * ladder on the day an order is raised, and colouring it amber would leave the
 * tab permanently yellow and teach the operator to stop reading it. A MISSED
 * TARGET is the one state here that is somebody's job today, so `delayed` is the
 * only `danger`.
 */
const TONES: Record<TnaDisplayState, StatusTone> = {
  pending: "neutral",
  in_progress: "info",
  done: "success",
  delayed: "danger",
};

/**
 * THE LABEL IS NOT THE VALUE, and this is the one place they differ on purpose.
 *
 * The database stores `done` (0481's CHECK constraint); the floor says
 * "Completed". Reading `done` back as "Completed" costs nothing and keeps the
 * stored word out of the UI — what must never happen is the reverse, a value
 * invented to match a label. See `TnaStatus`.
 */
const LABELS: Record<TnaDisplayState, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Completed",
  delayed: "Delayed",
};

export function TnaStatusBadge({
  state,
  /**
   * "3d late", appended for a delayed rung. Advisory: the tab passes it in the
   * grid, where the number is the difference between a slip nobody has noticed
   * and one that has been sitting for a fortnight. Null on every other state —
   * `tnaDaysLate` answers null unless the rung is actually late, so a caller
   * cannot accidentally print "0d late" on a rung due today.
   */
  daysLate = null,
}: {
  state: TnaDisplayState;
  daysLate?: number | null;
}) {
  return (
    <StatusPill tone={TONES[state]}>
      {LABELS[state]}
      {daysLate != null && daysLate > 0 && (
        // `tabular-nums` so a column of these does not jitter between 3 and 14.
        <span className="tabular-nums font-normal opacity-80">· {daysLate}d late</span>
      )}
    </StatusPill>
  );
}

/** The same label, for somewhere a pill does not fit — a filter facet, a tooltip. */
export function tnaStateLabel(state: TnaDisplayState): string {
  return LABELS[state];
}
