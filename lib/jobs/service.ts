import "server-only";
import { createClient } from "@/lib/supabase/server";
import { JOB_KEYS, JOBS, jobHealth, type JobHealth } from "./registry";
import type { JobRun } from "./types";

const RUN_COLS = "id, job, trigger, started_at, finished_at, ok, summary, error";

/**
 * The last run of every job, and the most recent runs across all of them —
 * Administration ▸ System ▸ Scheduled Jobs. Read under 0677's
 * `system_admin:view` policy. A failed read is an error, never "never run":
 * on this screen "never run" is the alarm, so a broken query must not raise it.
 *
 * created-by: exempt -- a run is started by the scheduler, a "Run now" or the
 * /approvals net; `trigger` is the column that says which.
 */
export async function listJobRuns(): Promise<{
  last: Record<string, JobRun | null>;
  health: Record<string, JobHealth>;
  recent: JobRun[];
}> {
  const s = await createClient();
  const [recent, ...lasts] = await Promise.all([
    s.from("job_runs").select(RUN_COLS).order("started_at", { ascending: false }).limit(50),
    // One indexed (job, started_at desc) lookup per job, in parallel: a job that
    // runs every 5 minutes would push a daily job out of any shared top-N.
    ...JOB_KEYS.map((job) =>
      s.from("job_runs").select(RUN_COLS).eq("job", job).order("started_at", { ascending: false }).limit(1),
    ),
  ]);
  if (recent.error) throw new Error(recent.error.message);
  const last: Record<string, JobRun | null> = {};
  JOB_KEYS.forEach((job, i) => {
    const r = lasts[i];
    if (r.error) throw new Error(r.error.message);
    last[job] = ((r.data ?? [])[0] as JobRun | undefined) ?? null;
  });
  /* "Late" needs the clock, so it is decided HERE, once, on the server — never
     with Date.now() inside a render (AGENTS.md, Approval SLA: the React
     Compiler refuses the impure call). */
  const now = Date.now();
  const health: Record<string, JobHealth> = {};
  for (const job of JOB_KEYS) health[job] = jobHealth(JOBS[job], last[job], now);
  return { last, health, recent: (recent.data ?? []) as JobRun[] };
}
