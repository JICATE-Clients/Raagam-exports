/**
 * THE SCHEDULED JOBS — declared once (doc/admin/notification-management-plan.md
 * Phase 3). Read by the Scheduled Jobs screen (labels, "late" threshold), by
 * `runJob` (the key it records), and by `npm run check:jobs`, which holds this
 * list, `vercel.json`'s crons and the `app/api/cron/<key>/route.ts` files to
 * one another — a job missing from any of the three fails the build.
 *
 * `schedule` is the CRON EXPRESSION IN UTC, exactly as `vercel.json` writes it;
 * `when` is the same moment in the business's time (IST, UTC+5:30), which is
 * what an administrator reads.
 *
 * Client-safe and pure.
 */

export type JobDef = {
  label: string;
  /** What it does, in the operator's words. */
  does: string;
  schedule: string;
  when: string;
  /** Minutes between runs — a job is LATE past 3× this (one miss is noise). */
  everyMinutes: number;
  /**
   * Said in the "Run now" confirmation. Every job is safe to repeat (each one
   * claims its rows once), but some do something the admin should expect.
   */
  runNowNote: string;
  /** "Run now" needs the Delete permission on Administration instead of Edit — it deletes. */
  deletes?: boolean;
};

export const JOBS = {
  "approval-sla": {
    label: "Approval deadlines",
    does: "Finds approvals past their agreed response time, reminds or escalates them, and tells the people involved.",
    schedule: "*/5 * * * *",
    when: "Every 5 minutes",
    everyMinutes: 5,
    runNowNote:
      "Anything already past its deadline is escalated or reminded now, exactly as the 5-minute run would. Nothing is sent twice.",
  },
  "work-flow": {
    label: "Pre-production milestones",
    does: "Alerts each overdue milestone's owner, and sends the Managing Director a summary of milestones long overdue.",
    schedule: "0 * * * *",
    when: "Every hour",
    everyMinutes: 60,
    runNowNote: "Overdue milestones not yet alerted are alerted now. Each milestone is only ever alerted once.",
  },
  "order-risk": {
    label: "Order delivery risk",
    does: "Checks every open order's progress against its delivery date and alerts the merchandiser and the MD when it slips.",
    schedule: "30 3 * * *",
    when: "Daily at 9:00 am",
    everyMinutes: 1440,
    runNowNote: "An order only alerts again if its risk got worse since the last alert.",
  },
  "approval-links": {
    label: "Buyer approval links",
    does: "Expires buyer approval links past their deadline, and reminds buyers who have not answered in three days.",
    schedule: "0 4 * * *",
    when: "Daily at 9:30 am",
    everyMinutes: 1440,
    runNowNote: "Buyers due a reminder get their reminder email now. Each link is reminded once.",
  },
  housekeeping: {
    label: "Clean up old alerts",
    does: "Deletes alerts, alert-log rows and job-run rows older than the times set on Notifications ▸ Settings.",
    schedule: "30 21 * * *",
    when: "Daily at 3:00 am",
    everyMinutes: 1440,
    runNowNote: "Old alerts and log rows are deleted now, by the retention set on Notifications ▸ Settings. This cannot be undone.",
    deletes: true,
  },
} as const satisfies Record<string, JobDef>;

export type JobKey = keyof typeof JOBS;

export const JOB_KEYS = Object.keys(JOBS) as JobKey[];

export function jobDef(key: string): JobDef | null {
  return (JOBS as Record<string, JobDef>)[key] ?? null;
}

export type JobHealth = "on_time" | "late" | "failed" | "never";

/** On time · late (past 3× its interval) · failed (last run errored) · never run. */
export function jobHealth(
  def: Pick<JobDef, "everyMinutes">,
  last: { started_at: string; ok: boolean | null } | null,
  nowMs: number,
): JobHealth {
  if (!last) return "never";
  if (last.ok === false) return "failed";
  const age = nowMs - new Date(last.started_at).getTime();
  return age > def.everyMinutes * 3 * 60_000 ? "late" : "on_time";
}
