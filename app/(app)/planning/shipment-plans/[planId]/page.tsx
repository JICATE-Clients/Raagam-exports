import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import {
  getShipmentPlan,
  getPlanOrders,
  getOrdersForPicker,
} from "@/lib/planning/shipment-plan-service";
import {
  SHIPMENT_PLAN_STATUS_LABELS,
  type ShipmentPlanStatus,
} from "@/lib/planning/types";
import { PlanDetail } from "./plan-detail";

function statusTone(status: ShipmentPlanStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "confirmed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export default async function ShipmentPlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  await requirePermission("planning", "view");
  const { planId } = await params;

  const [plan, planOrders, orders, canEdit, canDelete] = await Promise.all([
    getShipmentPlan(planId),
    getPlanOrders(planId),
    getOrdersForPicker(),
    can("planning", "edit"),
    can("planning", "delete"),
  ]);

  if (!plan) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={plan.code ?? "Shipment Plan"}
        description={plan.name}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={statusTone(plan.status)}>
              {SHIPMENT_PLAN_STATUS_LABELS[plan.status]}
            </StatusPill>
            <Link
              href="/planning/shipment-plans"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to list
            </Link>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Plan details</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="mt-0.5 font-medium">{plan.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Planned ship date</dt>
              <dd className="mt-0.5 tabular-nums">{fmtDate(plan.planned_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-0.5">{SHIPMENT_PLAN_STATUS_LABELS[plan.status]}</dd>
            </div>
            {plan.notes && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 text-muted-foreground">{plan.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      <PlanDetail
        planId={planId}
        status={plan.status}
        planOrders={planOrders}
        orders={orders}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
