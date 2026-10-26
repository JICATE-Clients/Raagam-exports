import Link from "next/link";
import { BookOpen, CircleCheck, CirclePause, Zap } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { StatusPill } from "@/components/ui/status-pill";
import { ticketStatusTone } from "@/lib/resolve/sla";
import {
  OVERRIDE_LABEL,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  TICKET_TYPE_LABEL,
  type OpenServiceCategory,
  type ServiceTicketExtras,
} from "@/lib/resolve/desk-types";
import { SERVICE_STATUS_LABEL, type ServiceSource, type ServiceStatus, type TicketDetail } from "@/lib/resolve/types";
import { LiveRefresh } from "@/components/resolve/live/live-badge";
import { ResolutionClock, ResponseClock } from "@/components/resolve/service/service-clock";
import { Pair, Photos, Section } from "./ticket-detail";
import { ServiceConversation } from "./service-conversation";
import { ServiceTicketActions } from "./service-ticket-actions";
import { TicketTimeline } from "./ticket-timeline";

const dash = <span className="text-muted-foreground">—</span>;

const CLOSURE: Record<string, string> = {
  requester_confirmed: "Closed on the requester's confirmation",
  auto_timeout: "Closed automatically — nobody confirmed or reopened it",
};

/** Urgent is the override's word, and the only priority drawn in red. */
const PRIORITY_TONE = { urgent: "danger", high: "warning", medium: "info", low: "neutral" } as const;

/**
 * ONE IT REQUEST (`kind = 'service'`, service-desk-plan §6), read top to
 * bottom: what and how urgent, the two SLA clocks, who has it, the
 * conversation with the requester, the staff-only notes, how it was fixed, and
 * the history — with the next-action panel beside it, which renders exactly
 * `detail.actions`.
 *
 * Server-rendered; the conversation, the action panel and the Live badge are
 * client islands. The clocks' STATES come from `extras` (the server's clock),
 * never `Date.now()` in a render. Live: the ticket row is watched, and a note
 * bumps `last_activity_at`, so a reply from the other side lands here unasked.
 */
export function ServiceTicketView({
  detail,
  extras,
  receipt,
  people,
  categories,
  current,
}: {
  detail: TicketDetail;
  extras: ServiceTicketExtras;
  receipt: boolean;
  people: { id: string; name: string }[];
  categories: OpenServiceCategory[];
  current: { id: string; ref_no: string; title: string }[];
}) {
  const { ticket: t, photos, activity, notes, actions, isStaff, myRating } = detail;
  const status = t.status as ServiceStatus;
  const before = photos.filter((p) => p.kind === "report");
  const resolvedish = status === "resolved" || status === "closed";
  // The conversation carries every reply; the history need not repeat them.
  const history = activity.filter((a) => a.action !== "replied");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">{t.ref_no}</span>
          <StatusPill tone={ticketStatusTone(status)}>{SERVICE_STATUS_LABEL[status] ?? status}</StatusPill>
          {t.ticket_type ? <StatusPill tone="neutral">{TICKET_TYPE_LABEL[t.ticket_type]}</StatusPill> : null}
          <StatusPill tone={PRIORITY_TONE[t.priority]}>
            {t.priority === "urgent" ? <Zap className="h-3 w-3" aria-hidden /> : null}
            {PRIORITY_LABEL[t.priority]}
          </StatusPill>
          {t.needs_sorting && isStaff ? <StatusPill tone="warning">Needs sorting</StatusPill> : null}
          <LiveRefresh filter={{ ticketId: t.id }} className="ml-auto" />
        </div>
      </div>

      {receipt ? (
        <div role="status" className="rounded-lg border border-success/40 bg-success-soft/50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleCheck className="h-4 w-4 text-success" aria-hidden />
            Request sent — your reference is <span className="font-mono">{t.ref_no}</span>
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
            <Pair label="Sent to">{t.team_name ?? t.owner_name ?? "The IT desk"}</Pair>
            <Pair label="First response by">{t.response_due_at ? fmtDateTime(t.response_due_at) : dash}</Pair>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            You will get an alert when the desk replies and when it is resolved. Reply here if you have more to add.
          </p>
        </div>
      ) : null}

      {t.override_kind ? (
        <div role="note" className="flex gap-2.5 rounded-lg border border-danger/40 bg-danger-soft/40 p-3">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 text-sm text-foreground">
            <p className="font-medium">Urgent — {OVERRIDE_LABEL[t.override_kind]}</p>
            {t.override_note ? <p className="whitespace-pre-wrap">{t.override_note}</p> : null}
            <p className="text-xs text-muted-foreground">
              {[extras.overridden_by_name, t.overridden_at ? fmtDateTime(t.overridden_at) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      ) : null}

      {status === "on_hold" ? (
        <div role="note" className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning-soft/40 p-3">
          <CirclePause className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 text-sm text-foreground">
            <span className="font-medium">On hold</span>
            {extras.preempted_by && isStaff ? (
              <>
                {" "}— paused for the urgent{" "}
                <Link href={`/resolve/tickets/${extras.preempted_by.id}`} className="font-mono text-primary hover:underline">
                  {extras.preempted_by.ref_no}
                </Link>
                .
              </>
            ) : t.blocked_reason ? (
              <>: {t.blocked_reason}</>
            ) : null}{" "}
            <span className="text-muted-foreground">The resolution clock is paused.</span>
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <Pair label="Category">{extras.category?.name ?? dash}</Pair>
            <Pair label="Raised">
              {fmtDateTime(t.created_at)}
              {t.source !== "form" ? (
                <span className="block text-xs text-muted-foreground">
                  By {SOURCE_LABEL[t.source as ServiceSource] ?? t.source}
                </span>
              ) : null}
            </Pair>
            {isStaff ? <Pair label="Requester">{t.reporter_name ?? dash}</Pair> : null}
            <Pair label="Team">{t.team_name ?? dash}</Pair>
            <Pair label="Technician">{t.assignee_name ?? (t.owner_name ? `${t.owner_name} (owner)` : dash)}</Pair>
            <Pair label="First response">
              {t.first_response_at ? fmtDateTime(t.first_response_at) : t.response_due_at ? `Due ${fmtDateTime(t.response_due_at)}` : dash}
              <span className="mt-1 block">
                <ResponseClock state={extras.response_state} />
              </span>
            </Pair>
            <Pair label="Resolution">
              {t.resolved_at ? fmtDateTime(t.resolved_at) : t.due_at ? `Due ${fmtDateTime(t.due_at)}` : dash}
              <span className="mt-1 block">
                <ResolutionClock state={extras.resolution_state} minutesLeft={extras.minutes_left} />
              </span>
            </Pair>
          </dl>

          {t.description ? <p className="whitespace-pre-wrap text-sm text-foreground">{t.description}</p> : null}

          {status === "cancelled" && t.cancel_reason ? (
            <p className="rounded-lg bg-surface-muted p-3 text-sm text-foreground">
              <span className="font-medium">Cancelled: </span>
              {t.cancel_reason}
            </p>
          ) : null}

          {before.length > 0 ? (
            <Section title="Screenshot">
              <Photos photos={before} label="Screenshot" />
            </Section>
          ) : null}

          {resolvedish || t.root_cause || t.resolution_message ? (
            <Section title="How it was fixed">
              <div className="space-y-3 rounded-lg border border-success/40 bg-success-soft/30 p-3">
                {t.root_cause ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Root cause</p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{t.root_cause}</p>
                  </div>
                ) : null}
                {t.resolution_message ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Resolution</p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{t.resolution_message}</p>
                  </div>
                ) : null}
                {extras.kb_article ? (
                  <p className="flex items-center gap-1.5 text-sm">
                    <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-muted-foreground">Knowledge base:</span>
                    <Link href={`/resolve/kb/${extras.kb_article.id}`} className="text-primary hover:underline">
                      <span className="font-mono text-xs">{extras.kb_article.code}</span> {extras.kb_article.title}
                    </Link>
                  </p>
                ) : null}
                {status === "closed" && t.closure_kind && CLOSURE[t.closure_kind] ? (
                  <p className="text-xs text-muted-foreground">
                    {CLOSURE[t.closure_kind]}
                    {t.closed_at ? ` · ${fmtDateTime(t.closed_at)}` : ""}
                  </p>
                ) : null}
              </div>
            </Section>
          ) : null}

          {isStaff && extras.kb_suggestions.length > 0 ? (
            <Section title="Might already be answered">
              <ul className="space-y-1">
                {extras.kb_suggestions.map((h) => (
                  <li key={h.id} className="text-sm">
                    <Link href={`/resolve/kb/${h.id}`} className="text-primary hover:underline">
                      <span className="font-mono text-xs">{h.code}</span> {h.title}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Pick the one you used when you resolve, so it is counted.</p>
            </Section>
          ) : null}

          <Section title="Conversation">
            <ServiceConversation
              ticketId={t.id}
              notes={notes}
              reporterId={t.reporter_id}
              canReply={actions.includes("note_reporter")}
              canInternal={actions.includes("note_internal")}
              isStaff={isStaff}
            />
          </Section>

          <Section title="History">
            <TicketTimeline rows={history} statusLabels={SERVICE_STATUS_LABEL} />
          </Section>
        </div>

        <aside className="w-full space-y-2 lg:sticky lg:top-4 lg:w-80 lg:shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What next</h2>
          <ServiceTicketActions
            ticket={t}
            actions={actions}
            extras={extras}
            people={people}
            categories={categories}
            current={current}
            myRating={myRating}
          />
        </aside>
      </div>
    </div>
  );
}
