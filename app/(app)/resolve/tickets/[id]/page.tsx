import { notFound } from "next/navigation";
import { getAppUser, requireUser } from "@/lib/auth/server";
import { getTicketDetail, listPeople, listTrades } from "@/lib/resolve/service";
import { getServiceTicketExtras, listDeskQueue, listOpenServiceCategories } from "@/lib/resolve/desk-service";
import { PageHeader } from "@/components/ui/page-header";
import { TicketDetailView } from "@/components/resolve/ticket/ticket-detail";
import { ServiceTicketView } from "@/components/resolve/ticket/service-ticket-detail";
import { RequirementTicketView } from "@/components/resolve/ticket/requirement-ticket-detail";

/**
 * ONE TICKET — `/resolve/tickets/<id>`, and the receipt at `?receipt=1`.
 *
 * `requireUser`, not a permission redirect: who may see a ticket is a ROW
 * question (`rh_can_see` — the reporter and joiners from any unit, staff in
 * theirs), answered by RLS. A ticket the viewer cannot see reads exactly like
 * one that does not exist — a 404, never "forbidden", which would confirm it.
 */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ receipt?: string }>;
}) {
  await requireUser();
  const [{ id }, { receipt }] = await Promise.all([params, searchParams]);
  const detail = await getTicketDetail(id);
  if (!detail) notFound();

  const back = detail.isStaff
    ? true
    : detail.ticket.kind === "complaint"
      ? { href: "/resolve/my-complaints", label: "My Complaints" }
      : { href: "/resolve/my-reports", label: "My Reports" };

  // A Buy request (0751) — its own view, and the Requirements queue is the
  // staff's way back to the list.
  if (detail.ticket.kind === "requirement") {
    const rqBack = detail.isStaff ? { href: "/resolve/requirements", label: "Requirements" } : back;
    return (
      <div className="space-y-4">
        <PageHeader title={`${detail.ticket.ref_no} — ${detail.ticket.title}`} back={rqBack} />
        <RequirementTicketView detail={detail} receipt={receipt === "1"} />
      </div>
    );
  }

  // An IT request (service-desk-plan §6) — its own view; Broken and complaints
  // below are unchanged.
  if (detail.ticket.kind === "service") {
    const has = (a: string) => detail.actions.includes(a as (typeof detail.actions)[number]);
    const [extras, people, categories, current] = await Promise.all([
      getServiceTicketExtras(id),
      has("sd_assign") ? listPeople() : Promise.resolve([]),
      has("sd_reclassify") || has("kb_draft") ? listOpenServiceCategories() : Promise.resolve([]),
      // What Start may pause: MY other requests in progress. The queue RPC
      // needs desk access, which anyone offered Start holds; a refusal just
      // means nothing to offer.
      has("sd_start") ? myOtherInProgress(id) : Promise.resolve([]),
    ]);
    if (!extras) notFound();
    return (
      <div className="space-y-4">
        <PageHeader title={`${detail.ticket.ref_no} — ${detail.ticket.title}`} back={back} />
        <ServiceTicketView
          detail={detail}
          extras={extras}
          receipt={receipt === "1"}
          people={people}
          categories={categories}
          current={current}
        />
      </div>
    );
  }

  // Only fetched when a dialog that needs them can open.
  const needTrades = detail.actions.includes("reclassify");
  // listPeople RAISES for a reporter (rh_people needs work/triage), so it is
  // called only when an assign dialog can actually open.
  const needPeople = detail.actions.includes("assign") || detail.actions.includes("c_assign");
  const [trades, people] = await Promise.all([
    needTrades ? listTrades() : Promise.resolve([]),
    needPeople ? listPeople() : Promise.resolve([]),
  ]);
  // The server's clock, read once — SLA words are measured against it.
  const nowIso = new Date().toISOString();

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${detail.ticket.ref_no} — ${detail.ticket.title}`}
        back={back}
      />
      <TicketDetailView
        detail={detail}
        nowIso={nowIso}
        receipt={receipt === "1"}
        trades={trades.map((t) => ({ id: t.id, name: t.name }))}
        people={people}
      />
    </div>
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
