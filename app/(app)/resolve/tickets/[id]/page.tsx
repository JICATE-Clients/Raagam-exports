import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getTicketDetail, listPeople, listTrades } from "@/lib/resolve/service";
import { PageHeader } from "@/components/ui/page-header";
import { TicketDetailView } from "@/components/resolve/ticket/ticket-detail";

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
        back={
          detail.isStaff
            ? true
            : detail.ticket.kind === "complaint"
              ? { href: "/resolve/my-complaints", label: "My Complaints" }
              : { href: "/resolve/my-reports", label: "My Reports" }
        }
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
