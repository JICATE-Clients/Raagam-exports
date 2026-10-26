"use client";

import type { TicketListRow } from "@/lib/resolve/types";

/*
 * What a Fix ticket says on its one muted line in Triage and All Jobs —
 * place · trade · who has it. One declaration so the two queues read a ticket
 * the same way. (These were DataTable columns until the mobile redesign of
 * 2026-10-26 turned both queues into the Inbox's row list.)
 *
 * "nobody" rather than "Unassigned": the row is read at a glance on a phone,
 * and the word the floor uses is the shorter one (mockup, approved).
 */
export function ticketLine(r: TicketListRow): (string | null)[] {
  return [
    r.place_name,
    r.trade_name ?? (r.needs_sorting ? "To sort" : null),
    r.assignee_name ?? "nobody",
  ];
}

/** Everything the search box looks in. */
export function ticketHaystack(r: TicketListRow): (string | null)[] {
  return [r.ref_no, r.title, r.place_name, r.trade_name, r.assignee_name, r.owner_name];
}
