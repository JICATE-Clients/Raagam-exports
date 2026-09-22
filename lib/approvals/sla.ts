import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { notifyCurrentApprovers } from "./notify";
import { WORKFLOWS, workflowLabel, type WorkflowKey } from "./workflows";

/**
 * THE SLA SWEEP — the TypeScript half of 0601.
 *
 * `doc/order/newfeature.md` §3: a budget approval that sits idle past its SLA
 * escalates to the next authority. The SQL half (`approval_sweep_sla`) does the
 * deciding — it marks the breach, logs the event and advances the run — and
 * this half does the telling.
 *
 * ## WHY THE TELLING IS NOT IN SQL, WHERE THE SKILL PUTS IT
 *
 * `dynamic-approval-flow`'s Tier 2B says "to notify rather than just record: add
 * your notification insert inside the loop". That works where a notification is
 * a row. Here it is a row AND a web push, signed with VAPID keys through the
 * `web-push` npm package (`lib/notifications/notify.ts`) — and an escalation the
 * MD only sees when they next open the app is not an escalation, it is a note.
 * The whole point of a 30-minute SLA is that somebody's phone buzzes. So the
 * sweeper returns the runs it touched and this file tells the people.
 *
 * ## WHO IS TOLD IS THE ENGINE'S ANSWER, NEVER RE-DERIVED
 *
 * `notifyCurrentApprovers` resolves through `approval_step_approvers` — the same
 * predicate `approval_can_act` and the inbox are built from. Resolving the
 * escalated-to role here would be a second answer to "who approves this", and
 * the day the two disagree somebody is paged for a request that then refuses
 * them. That is the drift `lib/approvals/notify.ts` already warns about.
 *
 * ## IT RUNS UNDER THE SERVICE ROLE, AND ONLY EVER FROM TWO PLACES
 *
 * `approval_sweep_sla` advances a run past an approver who has not acted, which
 * is the one power no signed-in user may hold — 0601 grants it to `service_role`
 * alone. Its callers are the cron route and the opportunistic sweep on
 * /approvals, both in this file's orbit and both server-side.
 *
 * ## IT NEVER THROWS
 *
 * Modelled on `writeAudit` and `notify`: a sweep that fails must not 500 the
 * page that happened to trigger it, and a cron that fails should report its
 * failure in the response rather than by crashing. Everything is caught and the
 * counts come back zeroed.
 */

/** One run the sweep touched, as `approval_sweep_sla` reports it. */
export type SweptRun = {
  run_id: string;
  workflow_key: string;
  subject_id: string;
  /** What its step declared: 'none' | 'notify' | 'escalate'. */
  on_breach: string;
  /** True only when the run actually MOVED — see the void guard in 0601. */
  escalated: boolean;
  /**
   * THE PEOPLE WHO LOST THE ITEM (0603). Empty unless the breached step ticked
   * `notify_missed_approver` AND the run actually escalated.
   *
   * RESOLVED IN SQL, and it has to be: by the time this result is read,
   * `current_step` has already advanced, so asking the engine "who approves
   * this run?" now returns the people it escalated TO. The sweeper resolves the
   * breached step through `approval_step_approvers` inside its own loop — the
   * same predicate `approval_can_act` and the inbox use, never a second answer.
   */
  missed_approvers?: string[];
  /** The step that breached (1-based), i.e. the one that was left undone. */
  step_order: number;
  step_label: string | null;
  due_at: string | null;
  requested_by: string;
};

export type SweepResult = {
  breached: number;
  escalated: number;
  /** Runs whose approvers were told. Never larger than `breached`. */
  notified: number;
  error?: string;
};

/**
 * Sweep every overdue approval, then tell the people it affects.
 *
 * @param limit  Runs per sweep. The default matches the RPC's own.
 */
export async function sweepSla(limit = 500): Promise<SweepResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("approval_sweep_sla", { p_limit: limit });
    if (error) {
      console.error("[approval-sla] sweep:", error.message);
      return { breached: 0, escalated: 0, notified: 0, error: error.message };
    }

    const res = (data ?? {}) as {
      breached?: number;
      escalated?: number;
      runs?: SweptRun[];
    };
    const runs = Array.isArray(res.runs) ? res.runs : [];

    let notified = 0;
    for (const run of runs) {
      /* PER RUN, AND ONE FAILURE NEVER STOPS THE REST. A push service refusing
         one endpoint must not leave the other nine escalations silent. */
      try {
        if (await announce(run)) notified += 1;
      } catch (e) {
        console.error("[approval-sla] notifying", run.run_id, e instanceof Error ? e.message : e);
      }
    }

    return {
      breached: res.breached ?? 0,
      escalated: res.escalated ?? 0,
      notified,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[approval-sla]", msg);
    return { breached: 0, escalated: 0, notified: 0, error: msg };
  }
}

/**
 * THE NET UNDER THE CRON — sweep on the way into the inbox, at most once a
 * minute per server instance.
 *
 * ## WHY BOTH, WHEN THE CRON IS THE REAL MECHANISM
 *
 * The cron is one line of `vercel.json` and one environment variable away from
 * doing nothing, and it fails SILENTLY: an unset `CRON_SECRET` answers 503, a
 * Hobby plan quietly downgrades the five-minute schedule to once a day, and a
 * preview deployment has no schedule at all. In each case the escalation matrix
 * is off and the screen looks identical — the same "empty is a real answer" trap
 * AGENTS.md records about reports and about the ambiguous-embed failure.
 *
 * With this, the worst case degrades to "escalates when someone opens the app"
 * instead of "never". An approver opening their inbox is exactly the moment a
 * stale queue matters, so the sweep costs one RPC on a page that was already
 * doing several.
 *
 * ## THE THROTTLE IS PER INSTANCE, AND THAT IS ENOUGH
 *
 * A module-level timestamp resets when the lambda does, so under load several
 * instances may each sweep within the same minute. That is harmless:
 * `approval_sweep_sla` is idempotent through `sla_breached_at` and takes
 * `FOR UPDATE SKIP LOCKED`, so a concurrent second sweep finds nothing and
 * returns zeros. The throttle exists to keep the common case cheap, not to
 * guarantee exclusivity — a lock would be the wrong tool for a best-effort net.
 */
let lastOpportunisticSweep = 0;
const OPPORTUNISTIC_GAP_MS = 60_000;

export async function sweepSlaOpportunistically(): Promise<void> {
  const now = Date.now();
  if (now - lastOpportunisticSweep < OPPORTUNISTIC_GAP_MS) return;
  lastOpportunisticSweep = now;
  await sweepSla(50);
}

/**
 * Tell whoever this breach concerns. Returns whether anything was sent.
 *
 * TWO DIFFERENT EVENTS WEARING ONE NAME, and they need different words:
 *
 *  - **escalated** — the run MOVED. The people who now hold it have never seen
 *    it before and are the ones who must act, so they get the ordinary "needs
 *    your approval" notice through the engine's own resolver, with a line
 *    saying why it arrived.
 *  - **notify** (or an escalation the void guard declined) — the run did NOT
 *    move. The same approvers still hold it; this is a reminder, and it is
 *    `warning` rather than `info` because a deadline has actually passed.
 *
 * `none` is told to nobody, on purpose: it is the setting an admin chooses when
 * they want the deadline recorded and no one chased.
 */
async function announce(run: SweptRun): Promise<boolean> {
  if (run.on_breach === "none") return false;

  const decl = WORKFLOWS[run.workflow_key as WorkflowKey];
  const href = decl?.href.replace(":id", run.subject_id) ?? "/approvals";
  const label = workflowLabel(run.workflow_key);
  const missed = run.step_label ?? `Step ${run.step_order}`;

  if (run.escalated) {
    /* The NEW step's approvers, resolved by the engine. `notifyCurrentApprovers`
       re-reads the run, so it sees the step the sweeper just advanced to. */
    await notifyCurrentApprovers(run.run_id, {
      payload: {
        title: `Escalated to you — ${label}`,
        body: `${missed} did not act within the agreed time, so this has come up to you.`,
        href,
        type: "warning",
      },
    });
    await tellTheRequester(run, label, href);
    await tellTheMissedApprover(run, label, href, missed);
    return true;
  }

  // Not moved: the same approvers are being reminded.
  await notifyCurrentApprovers(run.run_id, {
    payload: {
      title: `Overdue — ${label} is waiting on you`,
      body: `${missed} passed its agreed response time.`,
      href,
      type: "warning",
    },
  });
  return true;
}

/**
 * THE REQUESTER HEARS ABOUT AN ESCALATION, ALWAYS.
 *
 * They are waiting on the answer and the route it took just changed. This one
 * is not configurable and should not be: it is information about their own
 * document, not a judgement about anybody.
 */
async function tellTheRequester(run: SweptRun, label: string, href: string): Promise<void> {
  await notify(
    { userId: run.requested_by },
    {
      title: `Your ${label.toLowerCase()} was escalated`,
      body: `${run.step_label ?? "The approver"} did not respond in time, so it has gone to the next approver.`,
      href,
      type: "info",
    },
  );
}

/**
 * THE APPROVER WHO MISSED IT — OFF BY DEFAULT, AND A DECISION PER STEP (0603).
 *
 * ## THE POLICY, AND WHOSE IT IS
 *
 * The user reviewed this and chose: default OFF, configurable. Their reasoning,
 * which is the part worth keeping:
 *
 *   "If managers feel penalized or nagged by SLA breach notifications, they tend
 *    to blindly hit Approve just to clear the notification clock — defeating the
 *    purpose of budget oversight. … However, we can toggle 'Notify Missed
 *    Approver' ON if you prefer strict SLA visibility for your team."
 *
 * So the quiet default is not an oversight to be tidied up later. It is the
 * choice, and the escalation already solves the thing that matters — the
 * factory is unblocked, and the Level 1 approver's own queue updates itself, so
 * they cannot act on a budget that has moved on.
 *
 * ## IT LIVES ON THE STEP, NOT IN AN APP SETTING
 *
 * `notify_missed_approver` is a property of the flow step, beside `sla_minutes`
 * and `on_sla_breach`, and 0603's header argues it at length. The short version:
 * a run FREEZES its steps, so a policy on the step travels with the request — a
 * global setting read at sweep time would change the rules under every request
 * already in flight, which is the exact failure `steps_snapshot` exists to
 * prevent.
 *
 * ## THE WORDS ARE ABOUT THE DOCUMENT, NOT ABOUT THE PERSON
 *
 * Even switched ON this says what happened to the budget, not what the approver
 * failed to do. "No longer waiting on you" is the fact; "you missed your SLA" is
 * a reprimand, and a reprimand is the thing that produces the rubber-stamping
 * the default exists to avoid. Turning the notice on should not turn it nasty.
 */
async function tellTheMissedApprover(
  run: SweptRun,
  label: string,
  href: string,
  step: string,
): Promise<void> {
  const userIds = run.missed_approvers ?? [];
  if (userIds.length === 0) return; // the step did not ask, or nothing moved
  await notify(
    { userIds },
    {
      title: `No longer waiting on you — ${label}`,
      body: `${step} passed its agreed response time, so this has gone to the next approver.`,
      href,
      type: "info",
    },
  );
}
