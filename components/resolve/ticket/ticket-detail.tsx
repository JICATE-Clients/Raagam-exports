import { CircleCheck, EyeOff, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { StatusPill } from "@/components/ui/status-pill";
import { dueWords, isLate, spanWords, ticketStatusTone } from "@/lib/resolve/sla";
import {
  STATUS_LABEL,
  type BrokenStatus,
  type TicketDetail,
  type TicketListRow,
  type TicketPhoto,
} from "@/lib/resolve/types";
import { TicketActions } from "./ticket-actions";
import { TicketTimeline } from "./ticket-timeline";

const CLOSURE: Record<string, string> = {
  auto_photo: "Closed on the fix photo",
  spot_checked: "Closed after a spot check",
  owner_confirmed: "Closed on the owner's confirmation",
};

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

const dash = <span className="text-muted-foreground">—</span>;

/** A complaint's clock is the RESPONSE deadline, and it stops once anyone answers. */
function responseWords(t: TicketListRow, nowMs: number): { text: string; late: boolean } | null {
  if (!t.response_due_at || !["open", "assigned", "escalated"].includes(t.status)) return null;
  const diff = new Date(t.response_due_at).getTime() - nowMs;
  return diff >= 0
    ? { text: `Response due in ${spanWords(diff)}`, late: false }
    : { text: `Response ${spanWords(diff)} late`, late: true };
}

/** The complaint half of the page — no place, trade, photos or GPS. */
function ComplaintFacts({ t, isStaff, nowMs }: { t: TicketListRow; isStaff: boolean; nowMs: number }) {
  const w = responseWords(t, nowMs);
  return (
    <>
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <Pair label="Category">{t.category_name ?? dash}</Pair>
        <Pair label="Sent">{fmtDateTime(t.created_at)}</Pair>
        {isStaff ? (
          <Pair label="From">
            {t.is_anonymous ? (
              <span className="inline-flex items-center gap-1.5">
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                Anonymous
              </span>
            ) : (
              (t.reporter_name ?? dash)
            )}
          </Pair>
        ) : null}
        <Pair label="Handler">{t.owner_name ?? dash}</Pair>
        <Pair label="Assigned to">{t.assignee_name ?? dash}</Pair>
        <Pair label="Response due">
          {t.response_due_at ? fmtDateTime(t.response_due_at) : dash}
          {w ? (
            <span className={w.late ? "block text-xs font-medium text-danger" : "block text-xs text-muted-foreground"}>
              {w.text}
            </span>
          ) : null}
        </Pair>
      </dl>
      {t.description ? <p className="whitespace-pre-wrap text-sm text-foreground">{t.description}</p> : null}
      {t.resolution_message ? (
        <div className="space-y-1 rounded-lg border border-success/40 bg-success-soft/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">Resolution — what the complainant sees</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{t.resolution_message}</p>
        </div>
      ) : null}
    </>
  );
}

export function Photos({ photos, label }: { photos: TicketPhoto[]; label: string }) {
  if (photos.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) =>
          p.url ? (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL from a private bucket. */}
              <img
                src={p.url}
                alt={`${label} photo`}
                className="h-36 w-36 rounded-lg border border-border object-cover"
              />
            </a>
          ) : (
            <div
              key={p.id}
              className="flex h-36 w-36 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground"
            >
              Photo unavailable
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * ONE BROKEN REPORT, read top to bottom: what, where, who has it, by when,
 * the photos, the conversation, the history — and the next-action panel,
 * which renders exactly `detail.actions`.
 *
 * Server-rendered; only the action panel is a client island. The reporter's
 * name and internal notes appear only for `isStaff` (the service's own answer
 * from `rh_ticket_actions`, never re-derived here).
 */
export function TicketDetailView({
  detail,
  nowIso,
  receipt,
  trades,
  people,
}: {
  detail: TicketDetail;
  /** The server's clock, read once per request — SLA words are against it. */
  nowIso: string;
  receipt: boolean;
  trades: { id: string; name: string }[];
  people: { id: string; name: string }[];
}) {
  const { ticket: t, photos, activity, notes, actions, isStaff, myRating } = detail;
  const nowMs = new Date(nowIso).getTime();
  const complaint = t.kind === "complaint";
  const bStatus = t.status as BrokenStatus;
  const late = !complaint && (t.is_late || isLate(bStatus, t.due_at, nowMs));
  const sla = complaint ? "" : dueWords(bStatus, t.due_at, nowMs);
  const visibleNotes = notes.filter((n) => isStaff || n.visibility === "reporter");
  const before = photos.filter((p) => p.kind === "report");
  const rounds = [...new Set(photos.filter((p) => p.kind === "fix").map((p) => p.fix_round))].sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      {/* Header band: ref · status · dangerous, then the title. */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">{t.ref_no}</span>
          <StatusPill tone={ticketStatusTone(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</StatusPill>
          {t.is_dangerous ? (
            <StatusPill tone="danger">
              <TriangleAlert className="h-3 w-3" aria-hidden />
              Dangerous
            </StatusPill>
          ) : null}
          {t.spot_check_pending ? <StatusPill tone="warning">Waiting for spot check</StatusPill> : null}
          {complaint && t.is_sensitive ? (
            <StatusPill tone="info">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Sensitive
            </StatusPill>
          ) : null}
          {complaint && t.about_superior && isStaff ? <StatusPill tone="info">About a superior</StatusPill> : null}
          {t.needs_sorting && isStaff ? <StatusPill tone="warning">Needs sorting</StatusPill> : null}
        </div>
        <h1 className="text-lg font-semibold text-foreground">{t.title}</h1>
      </div>

      {receipt && complaint ? (
        <div role="status" className="rounded-lg border border-success/40 bg-success-soft/50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleCheck className="h-4 w-4 text-success" aria-hidden />
            Complaint sent — your reference is <span className="font-mono">{t.ref_no}</span>
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
            <Pair label="Handled by">{t.owner_name ?? "An independent handler"}</Pair>
            <Pair label="Response due">{t.response_due_at ? fmtDateTime(t.response_due_at) : dash}</Pair>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            The handler must respond by then, or it is escalated. You will get an alert when it is
            resolved, and you can follow it under My Complaints. You can withdraw it while it is open.
          </p>
        </div>
      ) : receipt ? (
        <div role="status" className="rounded-lg border border-success/40 bg-success-soft/50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleCheck className="h-4 w-4 text-success" aria-hidden />
            Report sent — your reference is <span className="font-mono">{t.ref_no}</span>
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
            <Pair label="Sent to">
              {t.owner_name ?? "The unit's triage team"}
              {t.owner_reason ? <span className="block text-xs text-muted-foreground">{t.owner_reason}</span> : null}
            </Pair>
            <Pair label="Due">{t.due_at ? fmtDateTime(t.due_at) : dash}</Pair>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            {t.owner_name
              ? `${t.owner_name} has been told and will start on it or pass it to their team. `
              : "Nobody owns this kind of problem here yet, so a manager will sort it and pick someone. "}
            You will get an alert when it is fixed. If the fix does not hold, you can mark it Not
            fixed within a week of it closing.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {complaint ? <ComplaintFacts t={t} isStaff={isStaff} nowMs={nowMs} /> : null}
          {complaint ? null : (
            <>
              <dl className="flex flex-wrap gap-x-8 gap-y-3">
                <Pair label="Place">{t.place_name ?? dash}</Pair>
                <Pair label="Trade">{t.trade_name ?? (t.needs_sorting ? "Not sure" : dash)}</Pair>
                <Pair label="Reported">{fmtDateTime(t.created_at)}</Pair>
                {isStaff ? <Pair label="Reported by">{t.reporter_name ?? dash}</Pair> : null}
                <Pair label="Owner">{t.owner_name ?? dash}</Pair>
                <Pair label="Assigned to">{t.assignee_name ?? (t.team_name ? `${t.team_name} team` : dash)}</Pair>
                <Pair label="Due">
                  {t.due_at ? fmtDate(t.due_at) : dash}
                  {sla ? (
                    <span className={late ? "block text-xs font-medium text-danger" : "block text-xs text-muted-foreground"}>
                      {t.status === "blocked" ? "Paused while blocked" : sla}
                    </span>
                  ) : null}
                </Pair>
                {t.joiners > 0 ? <Pair label="Also affected">{t.joiners} joined</Pair> : null}
                {isStaff ? (
                  <Pair label="Severity · Priority">
                    {t.severity} · {t.priority}
                    {t.is_routine ? " · routine" : ""}
                  </Pair>
                ) : null}
              </dl>

              {t.description ? (
                <p className="whitespace-pre-wrap text-sm text-foreground">{t.description}</p>
              ) : null}

              {t.status === "blocked" && t.blocked_reason ? (
                <p className="rounded-lg bg-danger-soft/50 p-3 text-sm text-foreground">
                  <span className="font-medium">Blocked: </span>
                  {t.blocked_reason}
                </p>
              ) : null}
              {t.status === "cancelled" && t.cancel_reason ? (
                <p className="rounded-lg bg-surface-muted p-3 text-sm text-foreground">
                  <span className="font-medium">Cancelled: </span>
                  {t.cancel_reason}
                </p>
              ) : null}
              {t.status === "closed" && t.closure_kind ? (
                <p className="text-sm text-muted-foreground">
                  {CLOSURE[t.closure_kind]}
                  {t.closed_at ? ` · ${fmtDateTime(t.closed_at)}` : ""}
                </p>
              ) : null}
              {isStaff && t.gps_lat != null && t.gps_lng != null ? (
                <p className="text-sm">
                  <a
                    className="text-primary underline-offset-2 hover:underline"
                    href={`https://www.google.com/maps?q=${t.gps_lat},${t.gps_lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the reporter&apos;s location on a map
                  </a>
                </p>
              ) : null}

            </>
          )}

          {photos.length > 0 ? (
            <Section title="Photos">
              <Photos photos={before} label="Before" />
              {rounds.map((r) => (
                <Photos
                  key={r}
                  photos={photos.filter((p) => p.kind === "fix" && p.fix_round === r)}
                  label={rounds.length > 1 ? `After (fix ${r})` : "After"}
                />
              ))}
            </Section>
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
            <TicketTimeline rows={activity} />
          </Section>
        </div>

        <aside className="w-full space-y-2 lg:sticky lg:top-4 lg:w-80 lg:shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What next</h2>
          <TicketActions ticket={t} actions={actions} trades={trades} people={people} myRating={myRating} />
        </aside>
      </div>
    </div>
  );
}
