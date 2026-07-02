import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import {
  getPpmIssue,
  getPpmLines,
  getItems,
  getUoms,
} from "@/lib/planning/extras-service";
import { PPM_STATUS_LABELS, type PpmStatus } from "@/lib/planning/types";
import { PpmDetail } from "./ppm-detail";

function tone(s: PpmStatus): StatusTone {
  switch (s) {
    case "draft":
      return "neutral";
    case "issued":
      return "warning";
    case "received":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export default async function PpmDetailPage({
  params,
}: {
  params: Promise<{ ppmId: string }>;
}) {
  await requirePermission("planning", "view");
  const { ppmId } = await params;
  const [issue, lines, items, uoms, canEdit, canDelete] = await Promise.all([
    getPpmIssue(ppmId),
    getPpmLines(ppmId),
    getItems(),
    getUoms(),
    can("planning", "edit"),
    can("planning", "delete"),
  ]);
  if (!issue) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={issue.code ?? "PPM Issue"}
        description={issue.description ?? "Production planning material issue"}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(issue.status)}>{PPM_STATUS_LABELS[issue.status]}</StatusPill>
            <Link href="/planning/ppm" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Issue date</dt>
              <dd className="mt-0.5 tabular-nums">{fmtDate(issue.issue_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-0.5">{PPM_STATUS_LABELS[issue.status]}</dd>
            </div>
            {issue.notes && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 text-muted-foreground">{issue.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>
      <PpmDetail
        ppmId={ppmId}
        status={issue.status}
        lines={lines}
        items={items}
        uoms={uoms}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
