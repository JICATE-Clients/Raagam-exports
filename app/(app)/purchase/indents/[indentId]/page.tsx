import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import {
  getPurchaseIndent,
  getIndentLines,
  getItems,
  getUoms,
} from "@/lib/purchase/extras-service";
import { INDENT_STATUS_LABELS, type IndentStatus } from "@/lib/purchase/extras-types";
import { IndentDetail } from "./indent-detail";

function tone(s: IndentStatus): StatusTone {
  switch (s) {
    case "open":
      return "warning";
    case "acknowledged":
      return "info";
    case "converted":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export default async function IndentDetailPage({
  params,
}: {
  params: Promise<{ indentId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { indentId } = await params;
  const [indent, lines, items, uoms, canEdit, canDelete] = await Promise.all([
    getPurchaseIndent(indentId),
    getIndentLines(indentId),
    getItems(),
    getUoms(),
    can("materials_purchase", "edit"),
    can("materials_purchase", "delete"),
  ]);
  if (!indent) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={indent.code ?? "Indent"}
        description={`${indent.department} department indent`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(indent.status)}>{INDENT_STATUS_LABELS[indent.status]}</StatusPill>
            <Link href="/purchase/indents" className="text-sm text-muted-foreground hover:text-foreground">
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
              <dt className="text-xs text-muted-foreground">Department</dt>
              <dd className="mt-0.5 font-medium">{indent.department}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Required date</dt>
              <dd className="mt-0.5 tabular-nums">{fmtDate(indent.required_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-0.5">{INDENT_STATUS_LABELS[indent.status]}</dd>
            </div>
            {indent.notes && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 text-muted-foreground">{indent.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>
      <IndentDetail
        indentId={indentId}
        status={indent.status}
        lines={lines}
        items={items}
        uoms={uoms}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
