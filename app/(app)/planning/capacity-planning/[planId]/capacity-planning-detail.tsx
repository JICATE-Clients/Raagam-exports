"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCapacityPlanOrder,
  updateCapacityPlanOrder,
  deleteCapacityPlanOrder,
  submitCapacityPlan,
  approveCapacityPlan,
  deleteCapacityPlan,
} from "@/lib/planning/production-planning-actions";
import type { getCapacityPlan } from "@/lib/planning/production-planning-service";
import type { CapacityPlanOrder, PpStatus } from "@/lib/planning/production-planning-types";
import { DATE_TYPE_LABELS } from "@/lib/planning/production-planning-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type PlanDetail = NonNullable<Awaited<ReturnType<typeof getCapacityPlan>>>;

const PP_STATUS_LABELS: Record<PpStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function ppStatusTone(status: PpStatus): StatusTone {
  switch (status) {
    case "draft":     return "neutral";
    case "submitted": return "warning";
    case "approved":  return "success";
    case "rejected":  return "danger";
  }
}

// ---------- Order form fields ----------

type OrderFields = {
  plan_date: string;
  sc_no: string;
  order_no: string;
  customer_name: string;
  style_ref_no: string;
  style_no: string;
  order_qty: string;
  delivery_date: string;
  with_learning_curve: boolean;
  is_split: boolean;
  sam: string;
  target_efficiency: string;
  location_name: string;
  team_name: string;
  plan_qty: string;
  period_from: string;
  period_to: string;
};

function emptyOrder(): OrderFields {
  return {
    plan_date: "",
    sc_no: "",
    order_no: "",
    customer_name: "",
    style_ref_no: "",
    style_no: "",
    order_qty: "0",
    delivery_date: "",
    with_learning_curve: false,
    is_split: false,
    sam: "0",
    target_efficiency: "0",
    location_name: "",
    team_name: "",
    plan_qty: "0",
    period_from: "",
    period_to: "",
  };
}

function rowToFields(r: CapacityPlanOrder): OrderFields {
  return {
    plan_date: r.plan_date ?? "",
    sc_no: r.sc_no ?? "",
    order_no: r.order_no ?? "",
    customer_name: r.customer_name ?? "",
    style_ref_no: r.style_ref_no ?? "",
    style_no: r.style_no ?? "",
    order_qty: String(r.order_qty),
    delivery_date: r.delivery_date ?? "",
    with_learning_curve: r.with_learning_curve,
    is_split: r.is_split,
    sam: String(r.sam),
    target_efficiency: String(r.target_efficiency),
    location_name: r.location_name ?? "",
    team_name: r.team_name ?? "",
    plan_qty: String(r.plan_qty),
    period_from: r.period_from ?? "",
    period_to: r.period_to ?? "",
  };
}

function fieldsToData(
  f: OrderFields,
  planId: string,
  fallbackSno: number,
): Record<string, unknown> {
  return {
    capacity_plan_id: planId,
    sno: fallbackSno,
    plan_no: fallbackSno,
    plan_date: f.plan_date || null,
    sc_no: f.sc_no.trim() || null,
    order_no: f.order_no.trim() || null,
    customer_name: f.customer_name.trim() || null,
    style_ref_no: f.style_ref_no.trim() || null,
    style_no: f.style_no.trim() || null,
    order_qty: parseInt(f.order_qty) || 0,
    delivery_date: f.delivery_date || null,
    with_learning_curve: f.with_learning_curve,
    is_split: f.is_split,
    sam: parseFloat(f.sam) || 0,
    m_os: 0,
    qty_100_pct: 0,
    target_qty: 0,
    target_efficiency: parseFloat(f.target_efficiency) || 0,
    location_name: f.location_name.trim() || null,
    team_name: f.team_name.trim() || null,
    plan_qty: parseInt(f.plan_qty) || 0,
    days_required: 0,
    period_from: f.period_from || null,
    period_to: f.period_to || null,
  };
}

// ---------- Orders tab ----------

type OrderRow = PlanDetail["orders"][number];

function OrdersTab({
  plan,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  plan: PlanDetail;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (orderId: string, data: Record<string, unknown>) => void;
  onDelete: (orderId: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<OrderFields>(emptyOrder());

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm(emptyOrder());
    setFormMode("add");
  }

  function openEdit(r: CapacityPlanOrder) {
    setForm(rowToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingOrder =
    formMode && formMode !== "add"
      ? plan.orders.find((r) => r.id === formMode)
      : undefined;

  const columns: Column<OrderRow>[] = [
    { header: "S No",      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Plan No",   cell: (r) => <span className="tabular-nums text-sm">{r.plan_no}</span> },
    { header: "RE No",     cell: (r) => <span className="text-sm">{r.sc_no ?? "--"}</span> },
    { header: "Customer",  cell: (r) => <span className="text-sm">{r.customer_name ?? "--"}</span> },
    { header: "Style",     cell: (r) => <span className="text-sm">{r.style_ref_no ?? "--"}</span> },
    { header: "Order Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.order_qty}</span> },
    { header: "Location",  cell: (r) => <span className="text-sm">{r.location_name ?? "--"}</span> },
    { header: "Team",      cell: (r) => <span className="text-sm">{r.team_name ?? "--"}</span> },
    { header: "Plan Qty",  align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.plan_qty}</span> },
    { header: "Days Reqd", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.days_required}</span> },
    { header: "Start",     cell: (r) => <span className="tabular-nums text-sm">{r.period_from ? fmtDate(r.period_from) : "--"}</span> },
    { header: "Complete",  cell: (r) => <span className="tabular-nums text-sm">{r.period_to ? fmtDate(r.period_to) : "--"}</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: OrderRow) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => (formMode === r.id ? closeForm() : openEdit(r))}
                >
                  {formMode === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  disabled={isPending}
                  onClick={() => onDelete(r.id)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders ({plan.orders.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add Order
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={plan.orders}
          getKey={(r) => r.id}
          empty="No orders yet. Add one to get started."
        />

        {/* Nested split details (read-only) */}
        {plan.orders.filter((o) => o.is_split && o.details.length > 0).map((o) => (
          <div key={o.id} className="rounded-md border border-border bg-surface-muted p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              Split details — Order {o.plan_no} ({o.customer_name ?? o.sc_no ?? o.id})
            </p>
            <DataTable
              columns={[
                { header: "S No",      cell: (d) => <span className="tabular-nums text-sm">{d.sno}</span> },
                { header: "Location",  cell: (d) => <span className="text-sm">{d.location_name ?? "--"}</span> },
                { header: "Team",      cell: (d) => <span className="text-sm">{d.team_name ?? "--"}</span> },
                { header: "Plan Qty",  align: "right", cell: (d) => <span className="tabular-nums text-sm">{d.plan_qty}</span> },
                { header: "Days Reqd", align: "right", cell: (d) => <span className="tabular-nums text-sm">{d.days_required}</span> },
                { header: "From",      cell: (d) => <span className="tabular-nums text-sm">{d.period_from ? fmtDate(d.period_from) : "--"}</span> },
                { header: "To",        cell: (d) => <span className="tabular-nums text-sm">{d.period_to ? fmtDate(d.period_to) : "--"}</span> },
              ]}
              rows={o.details}
              getKey={(d) => d.id}
            />
          </div>
        ))}

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? "Add order" : "Edit order"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>Plan Date</Label>
                <Input
                  type="date"
                  value={form.plan_date}
                  onChange={(e) => setForm((f) => ({ ...f, plan_date: e.target.value }))}
                />
              </div>
              <div>
                <Label>RE No</Label>
                <Input
                  value={form.sc_no}
                  onChange={(e) => setForm((f) => ({ ...f, sc_no: e.target.value }))}
                />
              </div>
              <div>
                <Label>Order No</Label>
                <Input
                  value={form.order_no}
                  onChange={(e) => setForm((f) => ({ ...f, order_no: e.target.value }))}
                />
              </div>
              <div>
                <Label>Customer Name</Label>
                <Input
                  value={form.customer_name}
                  onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Style Ref No</Label>
                <Input
                  value={form.style_ref_no}
                  onChange={(e) => setForm((f) => ({ ...f, style_ref_no: e.target.value }))}
                />
              </div>
              <div>
                <Label>Style No</Label>
                <Input
                  value={form.style_no}
                  onChange={(e) => setForm((f) => ({ ...f, style_no: e.target.value }))}
                />
              </div>
              <div>
                <Label>Order Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.order_qty}
                  onChange={(e) => setForm((f) => ({ ...f, order_qty: e.target.value }))}
                />
              </div>
              <div>
                <Label>Delivery Date</Label>
                <Input
                  type="date"
                  value={form.delivery_date}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_date: e.target.value }))}
                />
              </div>
              <div>
                <Label>SAM</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.sam}
                  onChange={(e) => setForm((f) => ({ ...f, sam: e.target.value }))}
                />
              </div>
              <div>
                <Label>Target Efficiency (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.target_efficiency}
                  onChange={(e) => setForm((f) => ({ ...f, target_efficiency: e.target.value }))}
                />
              </div>
              <div>
                <Label>Location</Label>
                <Input
                  value={form.location_name}
                  onChange={(e) => setForm((f) => ({ ...f, location_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Team</Label>
                <Input
                  value={form.team_name}
                  onChange={(e) => setForm((f) => ({ ...f, team_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Plan Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.plan_qty}
                  onChange={(e) => setForm((f) => ({ ...f, plan_qty: e.target.value }))}
                />
              </div>
              <div>
                <Label>Period From</Label>
                <Input
                  type="date"
                  value={form.period_from}
                  onChange={(e) => setForm((f) => ({ ...f, period_from: e.target.value }))}
                />
              </div>
              <div>
                <Label>Period To</Label>
                <Input
                  type="date"
                  value={form.period_to}
                  onChange={(e) => setForm((f) => ({ ...f, period_to: e.target.value }))}
                />
              </div>
              <div className="flex items-end gap-4 pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.with_learning_curve}
                    onChange={(e) => setForm((f) => ({ ...f, with_learning_curve: e.target.checked }))}
                    className="h-4 w-4 rounded border-border"
                  />
                  With Learning Curve
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_split}
                    onChange={(e) => setForm((f) => ({ ...f, is_split: e.target.checked }))}
                    className="h-4 w-4 rounded border-border"
                  />
                  Is Split
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const fallbackSno = formMode === "add"
                    ? plan.orders.length + 1
                    : (editingOrder?.sno ?? 0);
                  const payload = fieldsToData(form, plan.id, fallbackSno);
                  if (formMode === "add") {
                    onAdd(payload);
                  } else if (editingOrder) {
                    onUpdate(editingOrder.id, payload);
                  }
                  closeForm();
                }}
              >
                {isPending ? "Saving..." : formMode === "add" ? "Add" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Main component ----------

export function CapacityPlanningDetail({
  plan,
  canEdit,
  canDelete,
  canApprove,
}: {
  plan: PlanDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = plan.status === "draft";
  const isSubmitted = plan.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  function handleAddOrder(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addCapacityPlanOrder(data);
      if (res.ok) success("Order added.");
      else toastError(res.error);
    });
  }

  function handleUpdateOrder(orderId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateCapacityPlanOrder(orderId, plan.id, data);
      if (res.ok) success("Order updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteOrder(orderId: string) {
    startTransition(async () => {
      const res = await deleteCapacityPlanOrder(orderId, plan.id);
      if (res.ok) success("Order deleted.");
      else toastError(res.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitCapacityPlan(plan.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approveCapacityPlan(plan.id);
      if (res.ok) { success("Capacity Plan approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteCapacityPlan(plan.id);
      if (res.ok) { success("Deleted."); router.push("/planning/capacity-planning"); }
      else toastError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-mono font-medium">{plan.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Plan Date</dt>
              <dd className="tabular-nums">{fmtDate(plan.plan_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date Type</dt>
              <dd>{DATE_TYPE_LABELS[plan.date_type ?? "E"] ?? plan.date_type ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={ppStatusTone(plan.status)}>
                  {PP_STATUS_LABELS[plan.status]}
                </StatusPill>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">From</dt>
              <dd className="tabular-nums">{plan.from_date ? fmtDate(plan.from_date) : "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">To</dt>
              <dd className="tabular-nums">{plan.to_date ? fmtDate(plan.to_date) : "--"}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isDraft && canEdit && (
              <Button variant="outline" disabled={isPending} onClick={handleSubmit}>
                {isPending ? "Submitting..." : "Submit for Approval"}
              </Button>
            )}
            {isSubmitted && canApprove && (
              <Button disabled={isPending} onClick={handleApprove}>
                {isPending ? "Approving..." : "Approve"}
              </Button>
            )}
            {isSubmitted && !canApprove && (
              <p className="text-sm text-muted-foreground">Awaiting approval by an authorised reviewer.</p>
            )}
            {plan.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{plan.approved_at ? ` on ${fmtDate(plan.approved_at)}` : ""}.
              </p>
            )}
            {isDraft && canDelete && (
              <Button
                variant="danger"
                disabled={isPending}
                onClick={handleDelete}
              >
                {isPending ? "Deleting..." : "Delete"}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Tabs
        defaultKey="orders"
        items={[
          {
            key: "orders",
            label: `Orders (${plan.orders.length})`,
            content: (
              <OrdersTab
                plan={plan}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddOrder}
                onUpdate={handleUpdateOrder}
                onDelete={handleDeleteOrder}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
