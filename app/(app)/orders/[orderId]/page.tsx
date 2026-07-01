import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getOrder,
  getOrderLines,
  getAmendments,
  getRevisions,
  getTaPlan,
  getTaMilestones,
  getTemplates,
} from "@/lib/orders/service";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { OrderTabs } from "@/app/(app)/orders/order-tabs";
import type { OrderStatus } from "@/lib/orders/types";
import type { StatusTone } from "@/components/ui/status-pill";

function orderStatusTone(status: OrderStatus): StatusTone {
  switch (status) {
    case "confirmed":
      return "info";
    case "in_production":
      return "warning";
    case "shipped":
      return "success";
    case "closed":
      return "neutral";
    case "cancelled":
      return "danger";
  }
}

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  confirmed: "Confirmed",
  in_production: "In Production",
  shipped: "Shipped",
  closed: "Closed",
  cancelled: "Cancelled",
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("orders", "view");
  const { orderId } = await params;

  const [order, lines, amendments, revisions, taPlan, milestones, templates, canApprove] =
    await Promise.all([
      getOrder(orderId),
      getOrderLines(orderId),
      getAmendments(orderId),
      getRevisions(orderId),
      getTaPlan(orderId),
      getTaMilestones(orderId),
      getTemplates(),
      can("orders", "approve"),
    ]);

  if (!order) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.order_number ?? "Order"}
        description={order.buyers?.name ?? undefined}
        actions={
          <StatusPill tone={orderStatusTone(order.status)}>
            {ORDER_STATUS_LABELS[order.status]}
          </StatusPill>
        }
      />

      {/* Order summary strip */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Buyer</dt>
              <dd className="font-medium">{order.buyers?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order qty</dt>
              <dd className="tabular-nums font-medium">
                {fmtNumber(order.order_qty)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">FOB price</dt>
              <dd className="tabular-nums font-medium">
                {fmtMoney(order.fob_price, order.currency_code)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total value</dt>
              <dd className="tabular-nums font-medium">
                {fmtMoney(order.total_value, order.currency_code)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ship date</dt>
              <dd className="tabular-nums font-medium">
                {fmtDate(order.ship_date)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Currency</dt>
              <dd className="font-medium">{order.currency_code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Version</dt>
              <dd className="font-medium">v{order.current_version}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="tabular-nums font-medium">
                {fmtDate(order.created_at)}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      {/* Tabbed detail sections */}
      <OrderTabs
        order={order}
        lines={lines}
        amendments={amendments}
        revisions={revisions}
        taPlan={taPlan}
        milestones={milestones}
        templates={templates}
        canApprove={canApprove}
      />
    </div>
  );
}
