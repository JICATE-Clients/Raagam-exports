import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getFabricOrder } from "@/lib/planning/material-planning-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { MpStatus } from "@/lib/planning/material-planning-types";
import { FabricOrderDetail } from "./fabric-order-detail";

const STATUS_LABELS: Record<MpStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function statusTone(status: MpStatus): StatusTone {
  switch (status) {
    case "draft":     return "neutral";
    case "submitted": return "warning";
    case "approved":  return "success";
    case "rejected":  return "danger";
  }
}

export default async function FabricOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("planning", "view");
  const { orderId } = await params;

  const [order, canEdit, canDelete, canApprove] = await Promise.all([
    getFabricOrder(orderId),
    can("planning", "edit"),
    can("planning", "delete"),
    can("planning", "approve"),
  ]);

  if (!order) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.code ?? "Fabric Order"}
        description={`Customer: ${order.customer_name ?? "\u2014"} \u00b7 Order: ${order.order_no ?? "\u2014"} \u00b7 ${fmtDate(order.oc_date)}`}
        actions={
          <StatusPill tone={statusTone(order.status)}>
            {STATUS_LABELS[order.status]}
          </StatusPill>
        }
      />
      <FabricOrderDetail
        order={order}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
