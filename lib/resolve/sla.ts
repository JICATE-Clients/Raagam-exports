import { statusTone, type StatusToneOverrides } from "@/lib/ui/status-tone";
import type { ResolutionState, ResponseState } from "./desk-types";
import type { TicketStatus } from "./types";

/*
 * Pure SLA helpers — the words a due date is read in. Client-safe; `now` is
 * always passed in (the React Compiler refuses `Date.now()` in a render, and a
 * phone with a wrong clock must not paint the list red — the server's
 * `is_late` is the authority, this only words it).
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Statuses whose clock is running: Broken open / in progress, and a
 *  complaint not yet resolved (its `due_at` mirrors `response_due_at`). */
const CLOCK_RUNS: ReadonlySet<string> = new Set(["open", "in_progress", "assigned", "escalated"]);

/** Late = past due while work is owed. Blocked never runs late (its clock is
 *  paused, and unblock pushes `due_at` by the paused span — plan §5). */
export function isLate(status: TicketStatus, dueAt: string | null, nowMs: number): boolean {
  if (!dueAt || !CLOCK_RUNS.has(status)) return false;
  const due = new Date(dueAt).getTime();
  return Number.isFinite(due) && nowMs > due;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** A span in the largest unit that reads naturally: "45 min", "3 hours", "2 days". */
export function spanWords(ms: number): string {
  const a = Math.abs(ms);
  if (a < HOUR) return plural(Math.max(1, Math.round(a / 60_000)), "min");
  if (a < DAY) return plural(Math.round(a / HOUR), "hour");
  return plural(Math.round(a / DAY), "day");
}

/**
 * "Due in 3 hours" · "2 days late" · "Paused" · "" (nothing owed).
 * The status decides whether a due date still means anything.
 */
export function dueWords(status: TicketStatus, dueAt: string | null, nowMs: number): string {
  if (status === "blocked") return "Paused";
  if (!CLOCK_RUNS.has(status)) return "";
  if (!dueAt) return "No due date";
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return "No due date";
  const diff = due - nowMs;
  return diff >= 0 ? `Due in ${spanWords(diff)}` : `${spanWords(diff)} late`;
}

/** Whole days overdue (0 when not late) — the escalation ladder's unit. */
export function daysLate(status: TicketStatus, dueAt: string | null, nowMs: number): number {
  if (!isLate(status, dueAt, nowMs)) return 0;
  return Math.floor((nowMs - new Date(dueAt!).getTime()) / DAY);
}

/**
 * A ticket's CLOSED is its successful end — fixed, and verified or confirmed —
 * where the shared table's "closed" means retired (neutral). FIXED reads as
 * success through the shared table; only the closed word differs here.
 */
const TICKET_TONES: StatusToneOverrides = { closed: "success" };

export function ticketStatusTone(status: string | null | undefined) {
  return statusTone(status, TICKET_TONES);
}

/**
 * A requirement's OPEN reads "Pending" — it waits on Stores to approve or
 * reject, so it is the shared table's waiting tone (warning), not open's "no
 * claim yet". Approved / Fulfilled (Given) / Rejected / Withdrawn read through
 * the shared table unchanged.
 */
const REQUIREMENT_TONES: StatusToneOverrides = { open: "warning" };

export function requirementStatusTone(status: string | null | undefined) {
  return statusTone(status, REQUIREMENT_TONES);
}

/** A ticket's tone by its kind — the only kind with its own words is Buy. */
export function kindStatusTone(kind: string, status: string | null | undefined) {
  return kind === "requirement" ? requirementStatusTone(status) : ticketStatusTone(status);
}

// ---- Service Desk clocks (service-desk-plan §1.4, §3) ------------------------
//
// Two clocks in MINUTES, wall-clock 24×7: response (first technician action)
// and resolution. `rh_sd_queue` computes both states in SQL and is the
// authority on a list; these mirror it for the ticket page and My Reports,
// which read rows rather than the queue, and are what check:resolve pins.

/** Service statuses whose resolution clock has stopped for good. */
const SD_DONE: ReadonlySet<string> = new Set(["resolved", "closed", "cancelled", "withdrawn"]);

/** At risk = 80 % or more of the resolution window used (plan §3). */
export const SD_AT_RISK_SHARE = 0.8;

/** Met · pending · breached. A response after its due time is a breach that
 *  stays a breach — answering late does not turn it green. */
export function responseState(
  firstResponseAt: string | null | undefined,
  responseDueAt: string | null | undefined,
  nowMs: number,
  status?: string | null,
): ResponseState {
  const due = responseDueAt ? new Date(responseDueAt).getTime() : NaN;
  if (firstResponseAt) {
    const at = new Date(firstResponseAt).getTime();
    return Number.isFinite(due) && at > due ? "breached" : "met";
  }
  // Withdrawn or cancelled before anyone answered: nothing is owed any more —
  // the same answer rh__sd_clock (0750) gives, so page and queue agree.
  if (status === "cancelled" || status === "withdrawn") return "met";
  return Number.isFinite(due) && nowMs > due ? "breached" : "pending";
}

/**
 * On track · at risk · breached · paused · done. `due_at` already carries the
 * paused span (resume pushes it, plan §3), so "time left" is simply due − now
 * and the window is the priority's resolution minutes.
 */
export function resolutionState(
  status: string,
  dueAt: string | null | undefined,
  windowMinutes: number,
  nowMs: number,
): ResolutionState {
  if (SD_DONE.has(status)) return "done";
  if (status === "on_hold") return "paused";
  const due = dueAt ? new Date(dueAt).getTime() : NaN;
  if (!Number.isFinite(due)) return "on_track";
  const left = due - nowMs;
  if (left < 0) return "breached";
  // Rounded: 120 × 60 000 × (1 − 0.8) is 1 439 999.99… in floating point, which
  // put exactly-80 % on track while the SQL (0.2 × window) says at risk.
  return left <= Math.round(windowMinutes * 60_000 * (1 - SD_AT_RISK_SHARE)) ? "at_risk" : "on_track";
}

/** Whole minutes to the resolution deadline (negative = over); null when no
 *  clock is running. */
export function minutesLeft(status: string, dueAt: string | null | undefined, nowMs: number): number | null {
  if (SD_DONE.has(status) || status === "on_hold" || !dueAt) return null;
  const due = new Date(dueAt).getTime();
  return Number.isFinite(due) ? Math.floor((due - nowMs) / 60_000) : null;
}

/** "45 mins left" · "2 hours over" · "Paused" · "" (nothing owed). */
export function clockWords(state: ResolutionState, minutes: number | null): string {
  if (state === "paused") return "Paused";
  if (state === "done" || minutes === null) return "";
  const span = spanWords(Math.max(Math.abs(minutes), 1) * 60_000);
  return minutes >= 0 ? `${span} left` : `${span} over`;
}

/** Response "pending" is a clock still inside its window — no claim yet. */
const SLA_CLOCK_TONES: StatusToneOverrides = {
  met: "success",
  pending: "neutral",
  on_track: "info",
  at_risk: "warning",
  breached: "danger",
  paused: "neutral",
  done: "neutral",
};

export function slaClockTone(state: ResponseState | ResolutionState) {
  return statusTone(state, SLA_CLOCK_TONES);
}
