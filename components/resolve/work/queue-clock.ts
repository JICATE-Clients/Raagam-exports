import type { ClockTone } from "@/lib/resolve/inbox-types";
import type { DeskQueueRow } from "@/lib/resolve/desk-types";
import { SERVICE_STATUS_LABEL, STATUS_LABEL, type TicketListRow } from "@/lib/resolve/types";

/*
 * THE ONE CLOCK A QUEUE ROW SHOWS (Resolve mobile redesign, 2026-10-26) — the
 * deadline that matters NOW, in the Inbox's words ("42 min left", "25 min
 * late", "Paused"), so Triage, Desk Queue and All Jobs read a ticket the way
 * the Inbox does.
 *
 * No directive: the PAGE (a server component) reads the request time through
 * `requestNow()` and hands it down as a prop, and the screens compute from that
 * prop — a render never reads a clock of its own (AGENTS "Overdue is answered
 * in SQL / on the server"; the React Compiler refuses an impure render). A live
 * refresh re-runs the page, so the words move with it.
 */

export type QueueClock = { text: string; tone: ClockTone };

/** The request's own time, read once on the server per render of the page. */
export function requestNow(): number {
  return Date.now();
}

/** "42 min", "1 h 20 m", "2 d" — unsigned, the Inbox's spacing. */
export function spanWords(min: number): string {
  const m = Math.abs(Math.round(min));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} m` : `${h} h`;
  }
  return `${Math.floor(m / 1440)} d`;
}

function minutesUntil(iso: string, nowMs: number): number | null {
  const at = new Date(iso).getTime();
  return Number.isFinite(at) ? Math.round((at - nowMs) / 60_000) : null;
}

const FINISHED = new Set(["closed", "cancelled", "withdrawn", "resolved", "rejected", "fulfilled"]);

/** A Fix (broken) ticket's clock. LATE is the server's `is_late`, never a
 *  re-derivation — the minutes only word how late. */
export function ticketClock(r: TicketListRow, nowMs: number): QueueClock {
  if (FINISHED.has(r.status) || r.status === "fixed") {
    return { text: STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status, tone: "idle" };
  }
  if (r.status === "blocked") return { text: "Paused", tone: "idle" };
  if (!r.due_at) return { text: "No deadline", tone: "idle" };
  const min = minutesUntil(r.due_at, nowMs);
  if (r.is_late) return { text: min != null && min < 0 ? `${spanWords(-min)} late` : "Late", tone: "bad" };
  if (min == null) return { text: "No deadline", tone: "idle" };
  return { text: `${spanWords(Math.max(min, 0))} left`, tone: min < 60 ? "warn" : "ok" };
}

/** A Desk (service) ticket's clock: the RESPONSE promise until somebody has
 *  answered, then the resolution one — the same rule the Inbox applies. The
 *  states come from `rh_sd_queue`; only the reply minutes use the request time. */
export function deskClock(r: DeskQueueRow, nowMs: number): QueueClock {
  if (r.resolution_state === "done") return { text: SERVICE_STATUS_LABEL[r.status] ?? r.status, tone: "idle" };
  if (r.resolution_state === "paused") return { text: "Paused", tone: "idle" };
  if (!r.first_response_at && r.response_due_at) {
    const min = minutesUntil(r.response_due_at, nowMs);
    if (min != null) {
      if (min < 0) return { text: `Reply ${spanWords(-min)} late`, tone: "bad" };
      return { text: `Reply in ${spanWords(min)}`, tone: min < 30 ? "warn" : "ok" };
    }
  }
  if (r.minutes_left == null) return { text: "No deadline", tone: "idle" };
  if (r.minutes_left < 0 || r.resolution_state === "breached") {
    return { text: `${spanWords(r.minutes_left)} late`, tone: "bad" };
  }
  return { text: `${spanWords(r.minutes_left)} left`, tone: r.resolution_state === "at_risk" ? "warn" : "ok" };
}
