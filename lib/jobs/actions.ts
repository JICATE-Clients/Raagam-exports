"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { allow } from "@/lib/rate-limit";
import { jobDef, JOBS } from "./registry";
import { runJob } from "./run";
import { JOB_SWEEPS } from "./sweeps";

/**
 * Scheduled Jobs ▸ Run now, and Notifications ▸ Settings (retention + clean
 * up now). Types are NOT re-exported from this file: a `"use server"` module
 * that re-exports a type crashes at runtime.
 */

type Fail = { ok: false; error: string };

/**
 * Run a job now, under the administrator's name. The SAME sweep the scheduler
 * calls — server-side, so `CRON_SECRET` never reaches a browser. A job that
 * deletes (housekeeping) needs the Delete permission on Administration; the rest need Edit.
 */
export async function runJobNow(
  key: string,
): Promise<{ ok: true; failed: boolean; error: string | null; summary: Record<string, unknown> } | Fail> {
  const def = jobDef(key);
  if (!def) return { ok: false, error: "Unknown job" };
  const me = await requirePermission("system_admin", def.deletes ? "delete" : "edit");
  if (!allow(`job-run:${key}`, 3, 60_000)) {
    return { ok: false, error: "That job was just run — give it a minute." };
  }
  const k = key as keyof typeof JOBS;
  const res = await runJob(k, "manual", JOB_SWEEPS[k], { actorId: me.id });
  revalidatePath("/admin/jobs");
  const { error, ...summary } = res;
  return { ok: true, failed: !!error, error: error ?? null, summary };
}

// ─── Retention ──────────────────────────────────────────────────────────────

const retentionInput = z
  .object({
    readDays: z.number().int().min(7, "Read alerts: at least 7 days").max(3650),
    unreadDays: z.number().int().min(30, "Unread alerts: at least 30 days").max(3650),
    logDays: z.number().int().min(30, "Alert log: at least 30 days").max(3650),
    jobRunDays: z.number().int().min(7, "Job runs: at least 7 days").max(3650),
  })
  .refine((v) => v.unreadDays >= v.readDays, "Keep unread alerts at least as long as read ones");

export async function saveRetention(input: z.input<typeof retentionInput>): Promise<{ ok: true } | Fail> {
  const me = await requirePermission("system_admin", "edit");
  const parsed = retentionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values" };
  const v = parsed.data;
  const s = await createClient();
  const { error } = await s
    .from("notification_settings")
    .update({
      read_retention_days: v.readDays,
      unread_retention_days: v.unreadDays,
      dispatch_retention_days: v.logDays,
      job_run_retention_days: v.jobRunDays,
      updated_by: me.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/notifications");
  return { ok: true };
}

type PurgeCounts = { read: number; unread: number; log: number; jobRuns: number };

/** What "Clean up now" would delete, by the SAVED retention — counted, not deleted. */
export async function previewCleanup(): Promise<({ ok: true } & PurgeCounts) | Fail> {
  await requirePermission("system_admin", "delete");
  return purge(true);
}

/** Delete it now — the housekeeping job's work, run on demand and logged as a run. */
export async function cleanupNow(): Promise<({ ok: true } & PurgeCounts) | Fail> {
  const me = await requirePermission("system_admin", "delete");
  const res = await runJob("housekeeping", "manual", async () => {
    const r = await purge(false);
    return r.ok
      ? { readDeleted: r.read, unreadDeleted: r.unread, logDeleted: r.log, jobRunsDeleted: r.jobRuns }
      : { error: r.error };
  }, { actorId: me.id });
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/jobs");
  if (res.error) return { ok: false, error: res.error };
  return {
    ok: true,
    read: Number(res.readDeleted ?? 0),
    unread: Number(res.unreadDeleted ?? 0),
    log: Number(res.logDeleted ?? 0),
    jobRuns: Number(res.jobRunsDeleted ?? 0),
  };
}

/** Through the CALLER'S session, so `notification_purge` checks their Delete right itself. */
async function purge(dryRun: boolean): Promise<({ ok: true } & PurgeCounts) | Fail> {
  const s = await createClient();
  const { data, error } = await s.rpc("notification_purge", { p_dry_run: dryRun });
  if (error) return { ok: false, error: error.message };
  const r = (Array.isArray(data) ? data[0] : data) as
    | { read_rows: number; unread_rows: number; dispatch_rows: number; job_run_rows: number }
    | null;
  return {
    ok: true,
    read: r?.read_rows ?? 0,
    unread: r?.unread_rows ?? 0,
    log: r?.dispatch_rows ?? 0,
    jobRuns: r?.job_run_rows ?? 0,
  };
}
