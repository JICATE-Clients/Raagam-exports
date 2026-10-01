/** A row of `job_runs` (0677). Client-safe. */
export type JobRun = {
  id: string;
  job: string;
  trigger: "cron" | "manual" | "opportunistic";
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  summary: Record<string, unknown> | null;
  error: string | null;
};

export const TRIGGER_LABEL: Record<JobRun["trigger"], string> = {
  cron: "On schedule",
  manual: "Run now",
  opportunistic: "When someone opened Approvals",
};

/** "breached 2 · escalated 1" from a sweep's counts — the numbers it returned, as returned. */
export function summaryText(summary: Record<string, unknown> | null): string {
  if (!summary) return "";
  const words = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return Object.entries(summary)
    .filter(([, v]) => typeof v === "number" || typeof v === "boolean")
    .map(([k, v]) => `${words(k)} ${v}`)
    .join(" · ");
}
