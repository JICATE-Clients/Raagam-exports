"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { fmtDateTime } from "@/lib/format";
import { RequirementTicketActions } from "@/components/resolve/ticket/requirement-ticket-actions";
import { ServiceTicketActions } from "@/components/resolve/ticket/service-ticket-actions";
import { TicketActions } from "@/components/resolve/ticket/ticket-actions";
import type { OpenServiceCategory, ServiceTicketExtras } from "@/lib/resolve/desk-types";
import type { TicketAction, TicketDetail } from "@/lib/resolve/types";
import { RaiserPane, ResolverPane } from "./inbox-ticket";

/*
 * ONE TICKET, ONE DESIGN (mobile redesign, "okay go" 2026-10-26). The ticket
 * page is the Inbox's pane at full width — same header, step chain, action
 * bar, conversation and composer — so a ticket looks the same wherever it is
 * opened. What the pane does not carry is here, in a details column on a
 * desktop and a sheet on a phone (the ⓘ in the header):
 *
 *   - the facts (status, priority, place, team, who, dates), and
 *   - the RARER steps — make urgent, reclassify, write a KB article, edit the
 *     report, join, withdraw — drawn by the existing action panels, handed
 *     ONLY those actions, so nothing the pane already offers appears twice.
 */

/** Steps the pane does not draw itself; the old panels keep their forms. */
const RARE: ReadonlySet<TicketAction> = new Set<TicketAction>([
  "reclassify",
  "edit_report",
  "join",
  "withdraw",
  "sd_override",
  "sd_reclassify",
  "kb_draft",
  "sd_withdraw",
  "c_withdraw",
  "rq_withdraw",
]);
/** On the raiser's side the pane already offers withdraw. */
const RAISER_RARE: ReadonlySet<TicketAction> = new Set<TicketAction>(["edit_report", "join"]);

export function TicketPage({
  detail,
  meId,
  receipt,
  extras,
  people,
  categories,
  current,
  trades,
}: {
  detail: TicketDetail;
  meId: string;
  receipt: boolean;
  extras: ServiceTicketExtras | null;
  people: { id: string; name: string }[];
  categories: OpenServiceCategory[];
  current: { id: string; ref_no: string; title: string }[];
  trades: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [details, setDetails] = useState(false);
  const t = detail.ticket;
  const rare = detail.actions.filter((a) => (detail.isStaff ? RARE : RAISER_RARE).has(a));
  const backHref = detail.isStaff ? "/resolve/inbox" : "/resolve/my-reports";

  const otherActions =
    rare.length === 0 ? null : t.kind === "requirement" ? (
      <RequirementTicketActions ticket={t} actions={rare} />
    ) : t.kind === "service" && extras ? (
      <ServiceTicketActions
        ticket={t}
        actions={rare}
        extras={extras}
        people={people}
        categories={categories}
        current={current}
        myRating={detail.myRating}
      />
    ) : (
      <TicketActions ticket={t} actions={rare} trades={trades} people={people} myRating={detail.myRating} />
    );

  const facts: [string, ReactNode][] = [
    ["Priority", t.priority],
    ["Place", t.place_name],
    [t.kind === "service" ? "Category" : t.kind === "complaint" ? "Category" : "Trade", extras?.category?.name ?? t.category_name ?? t.trade_name],
    ["Team", t.team_name],
    ["With", t.assignee_name ?? t.owner_name],
    ["Raised", fmtDateTime(t.created_at)],
    ["First reply by", t.response_due_at ? fmtDateTime(t.response_due_at) : null],
    ["Due by", t.due_at ? fmtDateTime(t.due_at) : null],
  ];
  const side = (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words font-medium capitalize">{v}</dd>
            </div>
          ))}
      </dl>
      {extras?.kb_article && (
        <p className="text-xs text-muted-foreground">
          Solved with <span className="font-medium text-foreground">{extras.kb_article.title}</span>
        </p>
      )}
      {otherActions && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Other actions</p>
          {otherActions}
        </div>
      )}
    </div>
  );

  const paneProps = {
    detail,
    meId,
    onBack: () => router.push(backHref),
    onChanged: () => router.refresh(),
    onMore: () => setDetails(true),
  };

  return (
    <div className="flex flex-col gap-3">
      {receipt && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-success/40 bg-success-soft px-3 py-2 text-sm">
          <Check className="size-4 text-success" aria-hidden="true" />
          Sent — <span className="font-mono">{t.ref_no}</span>. You will be told as it moves.
        </p>
      )}
      <div className="grid h-[calc(100dvh-8.5rem)] min-h-[34rem] overflow-hidden rounded-xl border border-border bg-surface md:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-label="Ticket" className="flex min-h-0 min-w-0 flex-col">
          {detail.isStaff ? <ResolverPane {...paneProps} /> : <RaiserPane {...paneProps} />}
        </section>
        <aside aria-label="Details" className="hidden min-h-0 overflow-y-auto border-l border-border bg-surface-muted p-3.5 md:block">
          {side}
        </aside>
      </div>
      <Sheet open={details} onClose={() => setDetails(false)} title={`${t.ref_no} — details`} size="sm">
        {side}
      </Sheet>
    </div>
  );
}
