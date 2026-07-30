"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addExcessOrderItem,
  updateExcessOrderItem,
  deleteExcessOrderItem,
  submitExcessOrder,
  approveExcessOrder,
  deleteExcessOrder,
} from "@/lib/planning/material-planning-actions";
import type { getExcessOrder } from "@/lib/planning/material-planning-service";
import type { ExcessOrderItem, MpStatus } from "@/lib/planning/material-planning-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type OrderDetail = NonNullable<Awaited<ReturnType<typeof getExcessOrder>>>;

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

// ---------- Item form fields ----------

type ItemFields = {
  sno: string;
  item_class_name: string;
  description: string;
  uom_id: string;
  qty: string;
};

function emptyItem(): ItemFields {
  return { sno: "", item_class_name: "", description: "", uom_id: "", qty: "0" };
}

function rowToFields(r: ExcessOrderItem): ItemFields {
  return {
    sno: String(r.sno),
    item_class_name: r.item_class_name ?? "",
    description: r.description ?? "",
    uom_id: r.uom_id ?? "",
    qty: String(r.qty),
  };
}

function fieldsToData(
  f: ItemFields,
  orderId: string,
  fallbackSno: number,
): Record<string, unknown> {
  return {
    excess_order_id: orderId,
    sno: parseInt(f.sno) || fallbackSno,
    item_class_name: f.item_class_name.trim() || null,
    description: f.description.trim() || null,
    uom_id: f.uom_id.trim() || null,
    qty: parseFloat(f.qty) || 0,
    is_size_wise: false,
  };
}

// ---------- Items tab ----------

function ItemsTab({
  order,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  order: OrderDetail;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (itemId: string, data: Record<string, unknown>) => void;
  onDelete: (itemId: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<ItemFields>(emptyItem());

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm(emptyItem());
    setFormMode("add");
  }

  function openEdit(r: ExcessOrderItem) {
    setForm(rowToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingItem =
    formMode && formMode !== "add"
      ? order.items.find((r) => r.id === formMode)
      : undefined;

  type ItemRow = OrderDetail["items"][number];
  const columns: Column<ItemRow>[] = [
    { header: "S No",        cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Item Class",  cell: (r) => <span className="text-sm">{r.item_class_name ?? "--"}</span> },
    { header: "Description", cell: (r) => <span className="max-w-xs truncate text-sm">{r.description ?? "--"}</span> },
    { header: "UOM",         cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span> },
    { header: "Qty",         align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: ItemRow) => (
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
        <CardTitle>Items ({order.items.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add item
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={order.items}
          getKey={(r) => r.id}
          empty="No items yet. Add one to get started."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? "Add item" : "Edit item"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>S No</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={form.sno}
                  onChange={(e) => setForm((f) => ({ ...f, sno: e.target.value }))}
                />
              </div>
              <div>
                <Label>Item Class</Label>
                <Input
                  value={form.item_class_name}
                  onChange={(e) => setForm((f) => ({ ...f, item_class_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>UOM</Label>
                <Input
                  value={form.uom_id}
                  onChange={(e) => setForm((f) => ({ ...f, uom_id: e.target.value }))}
                />
              </div>
              <div>
                <Label>Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.qty}
                  onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2 md:col-span-4">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
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
                  const fallbackSno = formMode === "add" ? order.items.length + 1 : (editingItem?.sno ?? 0);
                  const payload = fieldsToData(form, order.id, fallbackSno);
                  if (formMode === "add") {
                    onAdd(payload);
                  } else if (editingItem) {
                    onUpdate(editingItem.id, payload);
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

export function ExcessOrderDetail({
  order,
  canEdit,
  canDelete,
  canApprove,
}: {
  order: OrderDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = order.status === "draft";
  const isSubmitted = order.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  function handleAddItem(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addExcessOrderItem(data);
      if (res.ok) success("Item added.");
      else toastError(res.error);
    });
  }

  function handleUpdateItem(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateExcessOrderItem(itemId, order.id, data);
      if (res.ok) success("Item updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteItem(itemId: string) {
    startTransition(async () => {
      const res = await deleteExcessOrderItem(itemId, order.id);
      if (res.ok) success("Item deleted.");
      else toastError(res.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitExcessOrder(order.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approveExcessOrder(order.id);
      if (res.ok) { success("Excess Order approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteExcessOrder(order.id);
      if (res.ok) { success("Deleted."); router.push("/planning/excess-order"); }
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
              <dd className="font-medium">{order.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="tabular-nums">{fmtDate(order.req_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">PPM Code</dt>
              <dd>{order.ppm_code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{order.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">SQ No</dt>
              <dd>{order.sq_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={statusTone(order.status)}>
                  {STATUS_LABELS[order.status]}
                </StatusPill>
              </dd>
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
            {order.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{order.approved_at ? ` on ${fmtDate(order.approved_at)}` : ""}.
              </p>
            )}
            {isDraft && canDelete && (
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
        defaultKey="items"
        items={[
          {
            key: "items",
            label: `Items (${order.items.length})`,
            content: (
              <ItemsTab
                order={order}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddItem}
                onUpdate={handleUpdateItem}
                onDelete={handleDeleteItem}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
