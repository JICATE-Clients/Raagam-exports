import { Check, X, RotateCcw, Clock, Ban, UserCog, TriangleAlert, ArrowUpRight } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import type { EventAction, TimelineRow } from "@/lib/approvals/types";

/**
 * WHO HAS SIGNED, WHO IS SIGNING, AND WHO IS STILL TO COME — one run, top to
 * bottom.
 *
 * A server component: it renders, it does not decide. Every judgement in it was
 * made by `approval_timeline`, which reads the run's FROZEN `steps_snapshot`
 * rather than the flow. That distinction is the reason this screen can be
 * trusted: a flow edited last week does not rewrite what a request approved a
 * month ago, so the timeline shows the chain the request actually travelled
 * rather than the chain that exists today.
 *
 * ## THE FUTURE STEPS ARE SHOWN, NOT JUST THE PAST ONES
 *
 * A history-only list answers "what happened" and leaves the requester asking
 * the only question they actually have: how much longer. Every step of the
 * snapshot appears, and an un-acted one carries its approver hint — the role,
 * the resolver, or "named approver(s)" — so it is clear who is being waited for
 * before they have done anything.
 */

const ICONS: Record<EventAction, typeof Check> = {
  submit: Clock,
  approve: Check,
  reject: X,
  return: RotateCcw,
  cancel: Ban,
  delegate: UserCog,
  sla_breach: TriangleAlert,
  forward: ArrowUpRight,
};

/* The action's own word. `approve` on a step reads "Approved" as a fact about
   the past, which is what every acted row is. */
const VERB: Record<EventAction, string> = {
  submit: "Submitted",
  approve: "Approved",
  reject: "Rejected",
  return: "Returned for changes",
  cancel: "Cancelled",
  delegate: "Delegated",
  sla_breach: "Overdue",
  forward: "Sent on",
};

/* A step routed by a resolver carries the resolver's KEY as its hint; say it
   in words (0807's three HR stages, 0629's either-role). A role hint is
   already its own name and passes through. */
const HINT_WORDS: Record<string, string> = {
  hr_department_head: "the department's HOD",
  hr_manager: "the HR Manager",
  hr_executive_director: "the ED",
  md_or_hr_manager: "the Managing Director or an HR Manager",
};

const TONE: Record<EventAction, "success" | "danger" | "warning" | "neutral"> = {
  submit: "neutral",
  approve: "success",
  reject: "danger",
  return: "warning",
  cancel: "neutral",
  delegate: "neutral",
  sla_breach: "warning",
  forward: "neutral",
};

export function ApprovalTimeline({
  rows,
  /**
   * uuid → display name. The engine stores actor ids and nothing else, which is
   * right — a name copied onto an audit row goes stale the day somebody marries.
   * Resolve them where the names live; `creator_names()` is the SECURITY DEFINER
   * RPC that can, because `profiles_read_own` lets a user read only their own
   * profile row.
   *
   * WITHOUT A RESOLVER THE ROW SAYS NOTHING RATHER THAN A UUID. A 36-character
   * id printed at an operator is the exact failure `creatorName()` exists to
   * refuse, and an audit line reading "Approved by 8f3c…" is worse than one that
   * only says "Approved".
   */
  resolveUserName,
  closed = false,
  waitingOn,
}: {
  rows: TimelineRow[];
  resolveUserName?: (id: string) => string | null | undefined;
  /**
   * The run has ENDED — rejected, withdrawn or approved. A step it never
   * reached then reads "not reached", not as a step still to come (user
   * 2026-11-05: a request closed in between the three stages stops there).
   */
  closed?: boolean;
  /** Names of the people the current step waits for, where the caller knows them. */
  waitingOn?: string[];
}) {
  if (rows.length === 0) return null;

  const nameOf = (id: string | null) => {
    if (!id || !resolveUserName) return null;
    const n = resolveUserName(id);
    return n && n.trim() ? n : null;
  };

  return (
    <ol className="space-y-0">
      {rows.map((r, i) => {
        const Icon = r.action ? ICONS[r.action] : Clock;
        const actor = nameOf(r.actor_id);
        /* A stage "Send to …" jumped over (0821) — a later stage has acted or holds it. */
        const skipped = !r.action && !r.is_current && rows.slice(i + 1).some((x) => x.action || x.is_current);

        return (
          <li
            key={`${r.step_order}-${i}`}
            /* THE SAME BOUNDARY EVERY OTHER LIST OF RECORDS IN THIS APP DRAWS
               (operator rule 4a): `border-t-2 border-border-strong` between
               records and `py-3` around them, never a box each. A step is a
               record here, and a timeline of boxes is the "stack of boxes" the
               client rejected on 2026-08-19. */
            className={[
              "flex gap-3 py-3",
              i > 0 ? "border-t-2 border-border-strong" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className={[
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                r.is_current
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : r.action
                    ? "border-border bg-surface-muted text-muted-foreground"
                    : "border-dashed border-border text-muted-foreground",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-foreground">
                  <span className="text-muted-foreground">{r.step_order}. </span>
                  <Truncated>{r.step_label}</Truncated>
                </span>

                {r.action && (
                  <StatusPill tone={TONE[r.action]}>{VERB[r.action]}</StatusPill>
                )}

                {/* HERE, NOW — the one row a reader is looking for. Only ever on
                    a step that has NOT acted: a decided step is history and
                    cannot also be where the request is sitting. */}
                {r.is_current && !r.action && (
                  <StatusPill tone="warning">Waiting</StatusPill>
                )}

                {/* AN OVERRIDE IS NAMED IN THE TRAIL FOR EVER. That is the whole
                    point of recording it — a super admin who stepped into a
                    chain they were not routed to is a fact about this approval,
                    not about that person's permissions. */}
                {r.is_override && (
                  <span className="text-xs font-medium text-warning">override</span>
                )}

                {r.acted_at && (
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {fmtDateTime(r.acted_at)}
                  </span>
                )}
              </div>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {/* ACTED: who did it. NOT ACTED: who is being waited for. The two
                    are different sentences and collapsing them into "Approver:
                    X" makes a pending step read as a decided one. */}
                {r.action
                  ? actor
                    ? `by ${actor}`
                    : "by the system"
                  : r.is_current && waitingOn?.length
                    ? `waiting for ${waitingOn.join(", ")}`
                    : skipped
                      ? "skipped — sent past this stage"
                      : closed
                      ? "not needed — closed before this step"
                      : (HINT_WORDS[r.approver_hint] ?? r.approver_hint)}
              </p>

              {r.comment && (
                /* THE COMMENT IS THE POINT OF A REJECTION OR A RETURN. It is the
                   only thing on the screen that tells the requester what to
                   change, so it is never truncated — it gets its own line and
                   wraps. */
                <p className="mt-1 whitespace-pre-wrap rounded-md bg-surface-muted px-2 py-1.5 text-xs text-foreground">
                  {r.comment}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
