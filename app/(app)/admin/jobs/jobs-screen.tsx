"use client";

import { useState, useTransition } from "react";
import { Play } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { RowIconAction } from "@/components/ui/row-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { JOB_KEYS, JOBS, jobDef, type JobHealth, type JobKey } from "@/lib/jobs/registry";
import { runJobNow } from "@/lib/jobs/actions";
import { summaryText, TRIGGER_LABEL, type JobRun } from "@/lib/jobs/types";

const HEALTH: Record<JobHealth, { tone: StatusTone; label: string }> = {
  on_time: { tone: "success", label: "On time" },
  late: { tone: "danger", label: "Late" },
  failed: { tone: "danger", label: "Last run failed" },
  never: { tone: "neutral", label: "No run recorded" },
};

type Row = { key: JobKey; last: JobRun | null; health: JobHealth };

/**
 * Scheduled Jobs. One row per job — the declared list (lib/jobs/registry.ts),
 * so a job that has NEVER run still has a row saying so, rather than being
 * absent from a list of runs. Below it, the latest runs across all jobs.
 */
export function JobsScreen({
  runs,
  canEdit,
  canDelete,
}: {
  runs: { last: Record<string, JobRun | null>; health: Record<string, JobHealth>; recent: JobRun[] };
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [confirming, setConfirming] = useState<JobKey | null>(null);

  const rows: Row[] = JOB_KEYS.map((key) => ({ key, last: runs.last[key], health: runs.health[key] }));
  const late = rows.filter((r) => r.health === "late" || r.health === "failed");

  const run = () => {
    const key = confirming;
    if (!key) return;
    start(async () => {
      const res = await runJobNow(key);
      setConfirming(null);
      if (!res.ok) error(res.error);
      else if (res.failed) error(`${JOBS[key].label} ran and failed: ${res.error}`);
      else success(`${JOBS[key].label} — done${summaryText(res.summary) ? `: ${summaryText(res.summary)}` : ""}`);
    });
  };

  const jobColumns: Column<Row>[] = [
    {
      header: "Job",
      cell: (r) => (
        <div className="max-w-[24rem] whitespace-normal">
          <div className="font-medium text-foreground">{JOBS[r.key].label}</div>
          <div className="text-xs text-muted-foreground">{JOBS[r.key].does}</div>
        </div>
      ),
    },
    { header: "Runs", cell: (r) => <span className="whitespace-nowrap">{JOBS[r.key].when}</span> },
    {
      header: "Last run",
      cell: (r) =>
        r.last ? (
          <div>
            <div className="whitespace-nowrap">{fmtDateTime(r.last.started_at)}</div>
            <div className="text-xs text-muted-foreground">{TRIGGER_LABEL[r.last.trigger]}</div>
          </div>
        ) : (
          "—"
        ),
    },
    {
      header: "Result",
      cell: (r) =>
        !r.last ? (
          "—"
        ) : r.last.ok === false ? (
          <span className="text-xs text-danger">{r.last.error}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{summaryText(r.last.summary) || "Nothing to do"}</span>
        ),
    },
    {
      header: "State",
      cell: (r) => (
        <StatusPill tone={HEALTH[r.health].tone} className="whitespace-nowrap">
          {HEALTH[r.health].label}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => {
        const def = JOBS[r.key];
        const allowed = "deletes" in def && def.deletes ? canDelete : canEdit;
        return (
          <RowIconAction
            label="Run now"
            name={def.label}
            icon={Play}
            onClick={() => setConfirming(r.key)}
            disabledReason={
              allowed ? null : `Running this needs the ${"deletes" in def && def.deletes ? "Delete" : "Edit"} permission on Administration`
            }
          />
        );
      },
    },
  ];

  const runColumns: Column<JobRun>[] = [
    { header: "When", cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.started_at)}</span> },
    { header: "Job", cell: (r) => jobDef(r.job)?.label ?? r.job },
    { header: "Started by", cell: (r) => <span className="text-xs text-muted-foreground">{TRIGGER_LABEL[r.trigger]}</span> },
    {
      header: "Result",
      cell: (r) =>
        r.ok === false ? (
          <StatusPill tone="danger" className="whitespace-nowrap">Failed</StatusPill>
        ) : (
          <StatusPill tone="success" className="whitespace-nowrap">Done</StatusPill>
        ),
    },
    {
      header: "Details",
      cell: (r) => (
        <span className={r.error ? "text-xs text-danger" : "text-xs text-muted-foreground"}>
          {r.error ?? (summaryText(r.summary) || "Nothing to do")}
        </span>
      ),
    },
  ];

  const def = confirming ? JOBS[confirming] : null;

  return (
    <div className="space-y-4">
      {late.length > 0 && (
        <Card className="border-danger/40">
          <div className="space-y-1 p-4 text-sm">
            <p className="font-semibold text-danger">
              {late.length === 1 ? "A job has stopped or failed" : `${late.length} jobs have stopped or failed`}
            </p>
            <p className="text-muted-foreground">
              A late job is one that has not run for three of its intervals. The usual cause is the scheduler: check
              that CRON_SECRET is set in Vercel (Notifications ▸ Overview shows it) and that the deployment is live.
              Run now does the job once, but does not restart the schedule.
            </p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        {/* A fixed list of five, not records: no created_at, so this adds nothing — it is here so the rule is applied. */}
        <DataTable bare paginate={false} rows={rows} getKey={(r) => r.key} columns={withCreatedColumns(jobColumns, rows)} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest runs</CardTitle>
        </CardHeader>
        <DataTable
          bare
          rows={runs.recent}
          getKey={(r) => r.id}
          columns={runColumns}
          empty="No run recorded yet. Runs are recorded from 1 October 2026."
        />
      </Card>

      <ConfirmDialog
        open={!!confirming}
        title={`Run "${def?.label ?? ""}" now?`}
        body={def?.runNowNote}
        confirmLabel="Run now"
        tone={def && "deletes" in def && def.deletes ? "danger" : "primary"}
        isPending={isPending}
        onConfirm={run}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
