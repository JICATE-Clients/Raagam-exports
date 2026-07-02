"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import {
  upsertPlanOrder,
  removePlanOrder,
  confirmShipmentPlan,
  cancelShipmentPlan,
  deleteShipmentPlan,
} from "@/lib/planning/shipment-plan-actions";
import type { ShipmentPlanStatus } from "@/lib/planning/types";
import type {
  PlanOrderRow,
  OrderForPicker,
} from "@/lib/planning/shipment-plan-service";

interface Props {
  planId: string;
  status: ShipmentPlanStatus;
  planOrders: PlanOrderRow[];
  orders: OrderForPicker[];
  canEdit: boolean;
  canDelete: boolean;
}

export function PlanDetail({
  planId,
  status,
  planOrders,
  orders,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [addOrderId, setAddOrderId] = useState("");
  const [plannedQty, setPlannedQty] = useState("");

  const isDraft = status === "draft";
  const usedIds = new Set(planOrders.map((p) => p.sales_order_id));
  const available = orders.filter((o) => !usedIds.has(o.id));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        success(ok);
        router.refresh();
      } else {
        toastError(result.error ?? "Action failed");
      }
    });
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addOrderId) {
      toastError("Select an order");
      return;
    }
    startTransition(async () => {
      const result = await upsertPlanOrder(planId, {
        sales_order_id: addOrderId,
        planned_qty: parseFloat(plannedQty) || 0,
      });
      if (result.ok) {
        success("Order added to plan");
        setAddOrderId("");
        setPlannedQty("");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<PlanOrderRow>[] = [
    {
      header: "Order",
      cell: (r) => (
        <Link
          href={`/orders/${r.sales_order_id}`}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {r.order_number ?? r.sales_order_id.slice(0, 8)}
        </Link>
      ),
    },
    {
      header: "Buyer",
      cell: (r) => <span className="text-sm">{r.buyer_name ?? "—"}</span>,
    },
    {
      header: "Order qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.order_qty)}</span>,
    },
    {
      header: "Planned qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.planned_qty)}</span>,
    },
    ...(canEdit && isDraft
      ? [
          {
            header: "",
            cell: (r: PlanOrderRow) => (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending}
                onClick={() => run(() => removePlanOrder(planId, r.sales_order_id), "Order removed")}
              >
                Remove
              </Button>
            ),
          } satisfies Column<PlanOrderRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Covered orders ({planOrders.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {canEdit && isDraft && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <Label htmlFor="po-order">Add order</Label>
                <Select id="po-order" value={addOrderId} onChange={(e) => setAddOrderId(e.target.value)}>
                  <option value="">— select order —</option>
                  {available.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number ?? o.id.slice(0, 8)}
                      {o.buyer_name ? ` — ${o.buyer_name}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-36">
                <Label htmlFor="po-qty">Planned qty</Label>
                <Input
                  id="po-qty"
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="0"
                  value={plannedQty}
                  onChange={(e) => setPlannedQty(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={isPending || available.length === 0}>
                Add
              </Button>
            </form>
          )}

          <DataTable
            columns={columns}
            rows={planOrders}
            getKey={(r) => r.sales_order_id}
            empty="No orders in this plan yet."
          />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {status === "draft" && (
            <>
              <Button
                disabled={isPending || planOrders.length === 0}
                onClick={() => run(() => confirmShipmentPlan(planId), "Plan confirmed")}
              >
                Confirm plan
              </Button>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => run(() => cancelShipmentPlan(planId), "Plan cancelled")}
              >
                Cancel plan
              </Button>
            </>
          )}
          {status === "confirmed" && (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => cancelShipmentPlan(planId), "Plan cancelled")}
            >
              Cancel plan
            </Button>
          )}
          {canDelete && (status === "draft" || status === "cancelled") && (
            <Button
              variant="outline"
              className="text-danger hover:border-danger"
              disabled={isPending}
              onClick={() =>
                run(async () => {
                  const r = await deleteShipmentPlan(planId);
                  if (r.ok) router.push("/planning/shipment-plans");
                  return r;
                }, "Plan deleted")
              }
            >
              Delete plan
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
