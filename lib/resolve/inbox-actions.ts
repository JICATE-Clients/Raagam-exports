"use server";

import { getAppUser } from "@/lib/auth/server";
import { fail, ok, type Result } from "./result";
import { getTicketDetail, listPeople } from "./service";
import type { TicketDetail } from "./types";

/*
 * The Inbox's two reads that happen AFTER the page loaded: opening a ticket in
 * the right-hand pane, and the people a ticket can be handed to. Every STEP the
 * pane offers is an existing action (claimTicket, fixTicket, holdServiceTicket
 * …), so each one is still authorised by its own RPC through `rh_require` — the
 * pane only decides which buttons to draw, from the same `rh_ticket_actions`
 * list the database checks.
 */

/** One ticket for the pane. A ticket RLS hides reads as "not found", never
 *  "forbidden" — the same rule as the ticket page. */
export async function openInboxTicket(id: string): Promise<Result<TicketDetail>> {
  if (!(await getAppUser())) return fail("Sign in to continue");
  try {
    const detail = await getTicketDetail(id);
    return detail ? ok(detail) : fail("This ticket is gone, or you can no longer see it.");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The ticket could not be opened.");
  }
}

/** Who a ticket can be handed to. `rh_people` answers only a viewer with
 *  work / triage / admin, so anyone else gets an empty list, not an error —
 *  the pane then offers no Reassign at all. */
export async function inboxPeople(): Promise<Result<{ id: string; name: string }[]>> {
  if (!(await getAppUser())) return fail("Sign in to continue");
  try {
    return ok(await listPeople());
  } catch {
    return ok([]);
  }
}
