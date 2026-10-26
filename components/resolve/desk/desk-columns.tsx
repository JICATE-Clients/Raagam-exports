"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { Truncated } from "@/components/ui/truncated";
import { fmtDateTime } from "@/lib/format";
import { statusTone, type StatusToneOverrides } from "@/lib/ui/status-tone";
import {
  OVERRIDE_LABEL,
  PRIORITY_LABEL,
  TICKET_TYPE_LABEL,
  type DeskQueueRow,
  type ResolutionState,
  type ResponseState,
} from "@/lib/resolve/desk-types";
import { SERVICE_STATUS_LABEL, type Priority } from "@/lib/resolve/types";

/*
 * The cells the Service Desk listings share (Desk Queue, the dashboard's
 * lists). One declaration so a ticket reads the same everywhere: the ref opens
 * the ticket page (where every action lives), an Urgent OVERRIDE is flagged on
 * the priority — the spec's "jumps the line" has to be visible as the reason
 * the row is on top — and both SLA clocks come from the SERVER's states
 * (`rh_sd_queue`), never from a browser clock (lib/resolve/sla.ts says why).
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

export function deskRefColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Ref No",
    cell: (r) => (
      <Link href={deskTicketHref(r.id)} className="whitespace-nowrap font-mono text-xs font-medium text-primary hover:underline">
        {r.ref_no}
      </Link>
    ),
  };
}

export function deskTypeColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Type",
    cell: (r) => <span className="whitespace-nowrap text-sm">{TICKET_TYPE_LABEL[r.ticket_type] ?? r.ticket_type}</span>,
  };
}

export function deskTitleColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Request",
    cell: (r) => (
      <span className="block min-w-0">
        <Truncated text={r.title} className="block max-w-[18rem] text-sm" />
        {r.category_name && <Truncated text={r.category_name} className="block max-w-[18rem] text-xs text-muted-foreground" />}
      </span>
    ),
  };
}

export function deskPriorityColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Priority",
    cell: (r) => (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <StatusPill tone={priorityTone(r.priority)}>{PRIORITY_LABEL[r.priority] ?? r.priority}</StatusPill>
        {r.overridden && (
          <Tooltip label={`Urgent override — ${r.override_kind ? OVERRIDE_LABEL[r.override_kind] : "jumps the queue"}`}>
            <Zap className="h-4 w-4 shrink-0 text-danger" aria-label="Urgent override" />
          </Tooltip>
        )}
      </span>
    ),
  };
}

export function deskRequesterColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Requester",
    cell: (r) => <Truncated text={r.reporter_name ?? "—"} className="block max-w-[11rem] text-sm" />,
  };
}

export function deskAssigneeColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Assignee",
    cell: (r) =>
      r.assignee_name ? (
        <Truncated text={r.assignee_name} className="block max-w-[11rem] text-sm" />
      ) : (
        <span className="text-sm text-muted-foreground">Unassigned</span>
      ),
  };
}

const RESPONSE_WORD: Record<ResponseState, string> = { met: "Met", pending: "Due", breached: "Breached" };

export function deskResponseColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Response",
    cell: (r) => (
      <span className="flex flex-col gap-0.5 whitespace-nowrap">
        <StatusPill tone={slaTone(r.response_state)}>{RESPONSE_WORD[r.response_state] ?? r.response_state}</StatusPill>
        <span className="text-xs tabular-nums text-muted-foreground">
          {r.response_state === "met" ? fmtDateTime(r.first_response_at) : fmtDateTime(r.response_due_at)}
        </span>
      </span>
    ),
  };
}

function resolutionWords(r: DeskQueueRow): string {
  switch (r.resolution_state) {
    case "paused":
      return "Paused";
    case "breached":
      return r.minutes_left == null ? "Breached" : `${minutesWords(r.minutes_left)} over`;
    case "at_risk":
    case "on_track":
      return r.minutes_left == null ? "On track" : `${minutesWords(r.minutes_left)} left`;
    default:
      return "Done";
  }
}

export function deskResolutionColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Resolution",
    cell: (r) => (
      <span className="flex flex-col gap-0.5 whitespace-nowrap">
        <StatusPill tone={slaTone(r.resolution_state)}>{resolutionWords(r)}</StatusPill>
        {r.resolution_state !== "done" && (
          <span className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(r.due_at)}</span>
        )}
      </span>
    ),
  };
}

export function deskStaleColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Idle",
    align: "right",
    cell: (r) =>
      r.stale_days > 0 ? (
        <Tooltip label={`No one has touched it for ${r.stale_days} day${r.stale_days === 1 ? "" : "s"}`}>
          <span className="tabular-nums text-sm font-semibold text-warning">{r.stale_days} d</span>
        </Tooltip>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  };
}

export function deskStatusColumn<T extends DeskQueueRow>(): Column<T> {
  return {
    header: "Status",
    cell: (r) => <StatusPill tone={statusTone(r.status)}>{SERVICE_STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
  };
}
