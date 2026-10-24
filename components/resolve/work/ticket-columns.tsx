"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { Tooltip } from "@/components/ui/tooltip";
import { fmtDateTime } from "@/lib/format";
import { ticketStatusTone } from "@/lib/resolve/sla";
import { STATUS_LABEL, type TicketListRow } from "@/lib/resolve/types";

/*
 * The cells every Resolve Hub work listing shares — My Work, Triage, All Jobs.
 * One declaration so the three lists read a ticket the same way: the ref opens
 * the ticket (where Fix and its photo live), a dangerous job carries the
 * warning glyph, and LATE comes from the server's `is_late`, never from a
 * browser clock (lib/resolve/sla.ts says why).
 */

export function ticketHref(id: string): string {
  return `/resolve/tickets/${id}`;
}

export function refColumn<T extends TicketListRow>(): Column<T> {
  return {
    header: "Ref No",
    cell: (r) => (
      <Link href={ticketHref(r.id)} className="font-mono text-xs font-medium text-primary hover:underline">
        {r.ref_no}
      </Link>
    ),
  };
}

export function titleColumn<T extends TicketListRow>(): Column<T> {
  return {
    header: "Problem",
    cell: (r) => (
      <span className="flex items-center gap-1.5">
        {r.is_dangerous && (
          <Tooltip label="Dangerous — reported as unsafe">
            <TriangleAlert className="h-4 w-4 shrink-0 text-danger" aria-label="Dangerous" />
          </Tooltip>
        )}
        <Truncated text={r.title} className="block max-w-[18rem] text-sm" />
      </span>
    ),
  };
}

export function placeColumn<T extends TicketListRow>(): Column<T> {
  return {
    header: "Place",
    cell: (r) => <Truncated text={r.place_name ?? "—"} className="block max-w-[12rem] text-sm" />,
  };
}

export function tradeColumn<T extends TicketListRow>(): Column<T> {
  return {
    header: "Trade",
    cell: (r) => <span className="text-sm">{r.trade_name ?? (r.needs_sorting ? "To sort" : "—")}</span>,
  };
}

export function assigneeColumn<T extends TicketListRow>(): Column<T> {
  return {
    header: "Assignee",
    cell: (r) => (
      <span className="text-sm">{r.assignee_name ?? <span className="text-muted-foreground">Unassigned</span>}</span>
    ),
  };
}

export function dueColumn<T extends TicketListRow>(): Column<T> {
  return {
    header: "Due",
    cell: (r) => (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="tabular-nums text-xs text-muted-foreground">{fmtDateTime(r.due_at)}</span>
        {r.is_late && <StatusPill tone="danger">Late</StatusPill>}
        {r.status === "blocked" && <StatusPill tone="neutral">Paused</StatusPill>}
      </span>
    ),
  };
}

export function statusColumn<T extends TicketListRow>(): Column<T> {
  return {
    header: "Status",
    cell: (r) => <StatusPill tone={ticketStatusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
  };
}

/** One line for a mobile card: place · trade · due. */
export function ticketMeta(r: TicketListRow): string {
  return [r.place_name, r.trade_name, r.due_at ? `Due ${fmtDateTime(r.due_at)}` : null].filter(Boolean).join(" · ");
}
