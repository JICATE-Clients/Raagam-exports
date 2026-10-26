"use client";

import type { Stripe } from "@/components/resolve/work/queue-rows";
import { statusTone, type StatusToneOverrides } from "@/lib/ui/status-tone";
import {
  OVERRIDE_LABEL,
  PRIORITY_LABEL,
  type DeskQueueRow,
  type ResolutionState,
  type ResponseState,
} from "@/lib/resolve/desk-types";
import type { Priority } from "@/lib/resolve/types";

/*
 * What the Service Desk listings share (Desk Queue, the dashboard's lists,
 * Log a Call, the SLA admin). One declaration so a ticket reads the same
 * everywhere: an Urgent OVERRIDE is flagged (⚡) — the spec's "jumps the line"
 * has to be visible as the reason the row is on top — and the SLA clocks come
 * from the SERVER's states (`rh_sd_queue`), never from a browser clock
 * (lib/resolve/sla.ts says why). The Desk Queue's thirteen columns became one
 * row in the mobile redesign (2026-10-26); priority is its left stripe.
 */

/** A priority is not a status, so it is a NAMED override on the shared table. */
const PRIORITY_TONES: StatusToneOverrides = { urgent: "danger", high: "warning", medium: "info", low: "neutral" };
/** The two SLA clocks' states — likewise a named override, not a status. */
const SLA_CLOCK_TONES: StatusToneOverrides = {
  met: "success",
  pending: "neutral",
  breached: "danger",
  on_track: "info",
  at_risk: "warning",
  paused: "neutral",
  done: "success",
};

export function priorityTone(p: Priority) {
  return statusTone(p, PRIORITY_TONES);
}
export function slaTone(s: ResponseState | ResolutionState) {
  return statusTone(s, SLA_CLOCK_TONES);
}

/** "42 min", "3 h 05 min", "2 d 4 h" — a span, unsigned. */
export function minutesWords(min: number): string {
  const m = Math.abs(Math.round(min));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

export function deskTicketHref(id: string): string {
  return `/resolve/tickets/${id}`;
}

/** Priority as the row's left stripe — the same four tones as its pill. */
export function priorityStripe(p: Priority): Stripe {
  const tone = priorityTone(p);
  return tone === "danger" || tone === "warning" || tone === "info" ? tone : "neutral";
}

/** The override's reason, worded for the ⚡'s tooltip. */
export function overrideWords(r: DeskQueueRow): string {
  return `Urgent override — ${r.override_kind ? OVERRIDE_LABEL[r.override_kind] : "jumps the queue"}`;
}

/** The row's one muted line: requester · priority · who has it · idle days. */
export function deskLine(r: DeskQueueRow): (string | null)[] {
  return [
    r.reporter_name,
    PRIORITY_LABEL[r.priority] ?? r.priority,
    r.assignee_name ?? "nobody",
    r.stale_days > 0 ? `idle ${r.stale_days} d` : null,
  ];
}

/** Everything the search box looks in. */
export function deskHaystack(r: DeskQueueRow): (string | null)[] {
  return [r.ref_no, r.title, r.category_name, r.team_name, r.reporter_name, r.assignee_name];
}
