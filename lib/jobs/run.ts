import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import type { JobKey } from "./registry";

type SweepResult = { error?: string } & Record<string, unknown>;

/**
 * Run a scheduled job and leave a `job_runs` row saying when, how it was
 * started, and what it did (0677). Every `/api/cron/*` route calls its sweep
 * through this, so "when did this last run?" has an answer inside the app.
 *
 * NEVER THROWS, and never changes what the sweep returns: the row is written
 * around the job, best-effort. A job that could not be logged still ran.
 *
 * `recordIfQuiet` — the /approvals net (`sweepSlaOpportunistically`) can run
 * once a minute per instance; logging every empty pass would bury the cron's
 * own rows, so it passes a test and only a run that DID something, or failed,
 * is kept.
 */
export async function runJob<R extends SweepResult>(
  job: JobKey,
  trigger: "cron" | "manual" | "opportunistic",
  sweep: () => Promise<R>,
  opts: { actorId?: string; recordIfQuiet?: (r: R) => boolean } = {},
): Promise<R> {
  const startedAt = new Date().toISOString();
  let result: R;
  try {
    result = await sweep();
  } catch (e) {
    result = { error: e instanceof Error ? e.message : String(e) } as R;
  }
  try {
    const quiet = opts.recordIfQuiet && !result.error && !opts.recordIfQuiet(result);
    if (!quiet) {
      const { error: _drop, ...summary } = result;
      await createAdminClient()
        .from("job_runs")
        .insert({
          job,
          trigger,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          ok: !result.error,
          summary,
          error: result.error ?? null,
          actor_id: opts.actorId ?? null,
        });
    }
  } catch {
    // the job ran; failing to log it must not turn into a failed job
  }
  return result;
}
