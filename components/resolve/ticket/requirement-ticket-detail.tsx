import { CircleCheck, Lock } from "lucide-react";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { StatusPill } from "@/components/ui/status-pill";
import { requirementStatusTone } from "@/lib/resolve/sla";
import {
  NEEDED_BY_LABEL,
  RQ_REASON_LABEL,
  RQ_STATUS_LABEL,
  type NeededBy,
  type RqReason,
} from "@/lib/resolve/assist-types";
import type { RequirementStatus, TicketDetail } from "@/lib/resolve/types";
import { LiveRefresh } from "@/components/resolve/live/live-badge";
import { Pair, Section } from "./ticket-detail";
import { RequirementTicketActions } from "./requirement-ticket-actions";
import { TicketTimeline } from "./ticket-timeline";

const dash = <span className="text-muted-foreground">—</span>;

/**
 * ONE BUY REQUEST (`kind = 'requirement'`, 0751), read top to bottom: what,
 * how many, by when and why; who asked and who decides; the decision; the
 * notes; the history — with the next-action panel beside it, which renders
 * exactly `detail.actions`.
 *
 * Server-rendered; only the action panel and the Live badge are client
 * islands. Broken / complaint / service tickets never come here.
 */
export function RequirementTicketView({ detail, receipt }: { detail: TicketDetail; receipt: boolean }) {
  const { ticket: t, activity, notes, actions, isStaff } = detail;
  const status = t.status as RequirementStatus;
  const visibleNotes = notes.filter((n) => isStaff || n.visibility === "reporter");
  const neededBy = t.rq_needed_by ? NEEDED_BY_LABEL[t.rq_needed_by as NeededBy] : null;
  const reason = t.rq_reason ? RQ_REASON_LABEL[t.rq_reason as RqReason] : null;
  const decidedBy = t.assignee_name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-foreground">{t.ref_no}</span>
        <StatusPill tone={requirementStatusTone(status)}>{RQ_STATUS_LABEL[status] ?? status}</StatusPill>
        {t.rq_needed_by === "today" && status === "open" ? <StatusPill tone="warning">Needed today</StatusPill> : null}
        {t.needs_sorting && isStaff ? <StatusPill tone="warning">Needs sorting</StatusPill> : null}
        <LiveRefresh filter={{ ticketId: t.id }} className="ml-auto" />
      </div>

      {receipt ? (
        <div role="status" className="rounded-lg border border-success/40 bg-success-soft/50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleCheck className="h-4 w-4 text-success" aria-hidden />
            Request sent — your reference is <span className="font-mono">{t.ref_no}</span>
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
            <Pair label="Sent to">{t.owner_name ?? "The unit's managers"}</Pair>
            <Pair label="Needed by">{neededBy ?? dash}</Pair>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            You will get an alert when it is approved or rejected, and again when it is given. You can withdraw it
            while it is pending.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <Pair label="Item">{t.title}</Pair>
            <Pair label="Qty">
              <span className="tabular-nums">{t.rq_qty != null ? fmtNumber(Number(t.rq_qty)) : dash}</span>
            </Pair>
            <Pair label="Needed by">
              {neededBy ?? dash}
              {t.due_at && status === "open" ? (
                <span className="block text-xs text-muted-foreground">By {fmtDate(t.due_at)}</span>
              ) : null}
            </Pair>
            <Pair label="Why">{reason ?? dash}</Pair>
            <Pair label="Asked">{fmtDateTime(t.created_at)}</Pair>
            {isStaff ? <Pair label="Asked by">{t.reporter_name ?? dash}</Pair> : null}
            <Pair label="Handler">
              {t.owner_name ?? dash}
              {t.owner_reason ? <span className="block text-xs text-muted-foreground">{t.owner_reason}</span> : null}
            </Pair>
            {decidedBy && status !== "open" && status !== "withdrawn" ? <Pair label="Decided by">{decidedBy}</Pair> : null}
          </dl>

          {t.description ? <p className="whitespace-pre-wrap text-sm text-foreground">{t.description}</p> : null}

          {t.rq_decided_note ? (
            <div
              className={
                status === "rejected"
                  ? "space-y-1 rounded-lg border border-danger/40 bg-danger-soft/40 p-3"
                  : "space-y-1 rounded-lg border border-success/40 bg-success-soft/30 p-3"
              }
            >
              <p className="text-xs font-medium text-muted-foreground">
                {status === "rejected" ? "Why it was rejected" : "Approval note"}
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{t.rq_decided_note}</p>
            </div>
          ) : null}
          {status === "fulfilled" ? (
            <p className="text-sm text-muted-foreground">
              Given{t.closed_at ? ` on ${fmtDateTime(t.closed_at)}` : ""}
              {t.resolution_message ? ` — ${t.resolution_message}` : ""}
            </p>
          ) : null}

          <Section title="Notes">
            {visibleNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {visibleNotes.map((n) => (
                  <li
                    key={n.id}
                    className={
                      n.visibility === "internal"
                        ? "rounded-lg border border-dashed border-warning/50 bg-warning-soft/30 p-3"
                        : "rounded-lg border border-border p-3"
                    }
                  >
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {n.visibility === "internal" ? (
                        <StatusPill tone="warning">
                          <Lock className="h-3 w-3" aria-hidden />
                          Internal
                        </StatusPill>
                      ) : null}
                      {n.author_name ?? "—"} · {fmtDateTime(n.created_at)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="History">
            <TicketTimeline rows={activity} statusLabels={RQ_STATUS_LABEL} createdVerb="Requested" />
          </Section>
        </div>

        <aside className="w-full space-y-2 lg:sticky lg:top-4 lg:w-80 lg:shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What next</h2>
          <RequirementTicketActions ticket={t} actions={actions} />
        </aside>
      </div>
    </div>
  );
}
