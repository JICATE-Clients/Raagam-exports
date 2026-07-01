import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getJob, getJobReceipts } from "@/lib/process/service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber } from "@/lib/format";
import { PROCESS_TYPE_LABELS, type ProcessJobStatus } from "@/lib/process/types";
import { JobActions } from "./_components/job-actions";
import type { StatusTone } from "@/components/ui/status-pill";

function jobStatusTone(status: ProcessJobStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "issued":
      return "info";
    case "in_process":
      return "warning";
    case "received":
      return "success";
    case "closed":
      return "neutral";
  }
}

const JOB_STATUS_LABELS: Record<ProcessJobStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  in_process: "In Process",
  received: "Received",
  closed: "Closed",
};

export default async function ProcessJobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  await requirePermission("process_planning", "view");
  const { jobId } = await params;

  const [job, receipts, canEdit] = await Promise.all([
    getJob(jobId),
    getJobReceipts(jobId),
    can("process_planning", "edit"),
  ]);

  if (!job) notFound();

  const totalReceived = receipts.reduce((sum, r) => sum + (r.received_qty ?? 0), 0);

  const isDraft = job.status === "draft";
  const incompleteDraft =
    isDraft && (!job.processor_id || !job.sent_qty || job.sent_qty <= 0);
  const canRecordReceipt =
    canEdit && (job.status === "issued" || job.status === "in_process");
  const canClose = canEdit && job.status === "received";
  const canIssue = canEdit && isDraft;

  return (
    <div className="space-y-4">
      <PageHeader
        title={job.code ?? "Process Job"}
        description="Process job order detail"
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={jobStatusTone(job.status)}>
              {JOB_STATUS_LABELS[job.status]}
            </StatusPill>
            <Link
              href="/process"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to list
            </Link>
          </div>
        }
      />

      {/* Incomplete draft warning */}
      {incompleteDraft && (
        <div className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          This draft is incomplete — processor and/or sent quantity is missing. Assign
          them before issuing.
        </div>
      )}

      {/* Job header card */}
      <Card>
        <CardHeader>
          <CardTitle>Job details</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="mt-0.5 font-mono font-medium">{job.code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Process type</dt>
              <dd className="mt-0.5">{PROCESS_TYPE_LABELS[job.process_type]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Processor</dt>
              <dd className="mt-0.5">{job.vendors?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sent qty</dt>
              <dd className="mt-0.5 tabular-nums">{fmtNumber(job.sent_qty)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Planned loss %</dt>
              <dd className="mt-0.5 tabular-nums">
                {job.planned_loss_pct != null ? `${job.planned_loss_pct}%` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expected return</dt>
              <dd className="mt-0.5 tabular-nums">{fmtDate(job.expected_return_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total received</dt>
              <dd className="mt-0.5 tabular-nums">{fmtNumber(totalReceived)}</dd>
            </div>
            {job.description && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Description</dt>
                <dd className="mt-0.5 text-muted-foreground">{job.description}</dd>
              </div>
            )}
            {job.notes && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 text-muted-foreground">{job.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Receipts table + Issue / Record receipt / Close actions (client) */}
      <JobActions
        jobId={jobId}
        sentQty={job.sent_qty}
        plannedLossPct={job.planned_loss_pct}
        receipts={receipts}
        canIssue={canIssue}
        canRecordReceipt={canRecordReceipt}
        canClose={canClose}
      />
    </div>
  );
}
