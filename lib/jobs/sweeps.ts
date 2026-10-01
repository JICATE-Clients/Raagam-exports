import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { sweepSla } from "@/lib/approvals/sla";
import { sweepWorkFlow } from "@/lib/orders/work-flow/sweep";
import { sweepOrderRisk } from "@/lib/orders/progress/sweep";
import { sweepApprovalLinks } from "@/lib/ta/approval-links-sweep";
import type { JobKey } from "./registry";

/**
 * The cleanup behind the `housekeeping` job: deletes by the retention set on
 * Notifications ▸ Settings (0677 `notification_purge`). Runs as the service
 * role, which the function accepts in place of Administration ▸ Delete.
 */
export async function purgeOldNotifications(): Promise<{
  readDeleted: number;
  unreadDeleted: number;
  logDeleted: number;
  jobRunsDeleted: number;
  error?: string;
}> {
  const { data, error } = await createAdminClient().rpc("notification_purge", { p_dry_run: false });
  const r = (Array.isArray(data) ? data[0] : data) as
    | { read_rows: number; unread_rows: number; dispatch_rows: number; job_run_rows: number }
    | null;
  return {
    readDeleted: r?.read_rows ?? 0,
    unreadDeleted: r?.unread_rows ?? 0,
    logDeleted: r?.dispatch_rows ?? 0,
    jobRunsDeleted: r?.job_run_rows ?? 0,
    ...(error ? { error: error.message } : {}),
  };
}

/** Each job's sweep — what "Run now" runs. The cron routes call the same functions. */
export const JOB_SWEEPS: Record<JobKey, () => Promise<{ error?: string } & Record<string, unknown>>> = {
  "approval-sla": () => sweepSla(),
  "work-flow": sweepWorkFlow,
  "order-risk": sweepOrderRisk,
  "approval-links": sweepApprovalLinks,
  housekeeping: purgeOldNotifications,
};
