import { notFound } from "next/navigation";
import { getAppUser, requireUser } from "@/lib/auth/server";
import { getTicketDetail, listPeople, listTrades } from "@/lib/resolve/service";
import { getServiceTicketExtras, listDeskQueue, listOpenServiceCategories } from "@/lib/resolve/desk-service";
import { TicketPage } from "@/components/resolve/inbox/ticket-page";
import type { TicketAction } from "@/lib/resolve/types";

/**
 * ONE TICKET — `/resolve/tickets/<id>`, and the receipt at `?receipt=1`.
 *
 * Every kind (Fix, IT, Buy, Concern) and both sides (the person who raised it,
 * the people who work it) draw the SAME pane the Inbox draws (mobile redesign,
 * 2026-10-26); `TicketPage` adds the facts and the rarer steps beside it.
 *
 * `requireUser`, not a permission redirect: who may see a ticket is a ROW
 * question (`rh_can_see`), answered by RLS. A ticket the viewer cannot see
 * reads exactly like one that does not exist — a 404, never "forbidden".
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ receipt?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, { receipt }] = await Promise.all([params, searchParams]);
  const detail = await getTicketDetail(id);
  if (!detail) notFound();

  const has = (a: TicketAction) => detail.actions.includes(a);
  const service = detail.ticket.kind === "service";
  // Each extra read only when a panel that needs it can open — listPeople
  // RAISES for a viewer without work / triage (rh_people), so it is never
  // asked for a reporter.
  const [extras, people, categories, current, trades] = await Promise.all([
    service ? getServiceTicketExtras(id) : Promise.resolve(null),
    has("sd_assign") || has("assign") || has("c_assign") ? listPeople() : Promise.resolve([]),
    service && (has("sd_reclassify") || has("kb_draft")) ? listOpenServiceCategories() : Promise.resolve([]),
    service && has("sd_start") ? myOtherInProgress(id) : Promise.resolve([]),
    has("reclassify") ? listTrades() : Promise.resolve([]),
  ]);
  if (service && !extras) notFound();

  return (
    <TicketPage
      detail={detail}
      meId={user.id}
      receipt={receipt === "1"}
      extras={extras}
      people={people}
      categories={categories}
      current={current}
      trades={trades.map((t) => ({ id: t.id, name: t.name }))}
    />
  );
}

async function myOtherInProgress(ticketId: string): Promise<{ id: string; ref_no: string; title: string }[]> {
  const me = (await getAppUser())?.id;
  if (!me) return [];
  try {
    return (await listDeskQueue("mine"))
      .filter((r) => r.status === "in_progress" && r.assignee_id === me && r.id !== ticketId)
      .map((r) => ({ id: r.id, ref_no: r.ref_no, title: r.title }));
  } catch {
    return [];
  }
}
