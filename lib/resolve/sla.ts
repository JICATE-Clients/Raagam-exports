import { statusTone, type StatusToneOverrides } from "@/lib/ui/status-tone";
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
