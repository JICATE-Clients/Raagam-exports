import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { getJobOrder, getJobOrderComponents } from "@/lib/production/extras-service";
import { JOB_ORDER_STATUS_LABELS, type JobOrderStatus } from "@/lib/production/extras-types";
import { JobOrderDetail } from "./job-order-detail";

function tone(s: JobOrderStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "open" ? "info" : s === "completed" ? "success" : "danger";
}

export default async function JobOrderDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  await requirePermission("production", "view");
  const { jobId } = await params;
  const [doc, components, canEdit, canDelete] = await Promise.all([
    getJobOrder(jobId),
    getJobOrderComponents(jobId),
    can("production", "edit"),
    can("production", "delete"),
  ]);
  if (!doc) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={doc.code ?? "Job Order"}
        description={doc.description ?? "Production job order"}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(doc.status)}>{JOB_ORDER_STATUS_LABELS[doc.status]}</StatusPill>
            <Link href="/production/job-orders" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Stage</dt>
              <dd className="mt-0.5">{[doc.stage_from, doc.stage_to].filter(Boolean).join(" → ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Style</dt>
              <dd className="mt-0.5">{doc.style_ref ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-0.5">{JOB_ORDER_STATUS_LABELS[doc.status]}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
      <JobOrderDetail
        jobId={jobId}
        status={doc.status}
        components={components}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
