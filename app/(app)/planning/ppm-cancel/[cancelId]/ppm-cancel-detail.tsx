"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addPpmCancelItem,
  updatePpmCancelItem,
  deletePpmCancelItem,
  submitPpmCancel,
  approvePpmCancel,
  deletePpmCancel,
} from "@/lib/planning/ppm-actions";
import type { getPpmCancel } from "@/lib/planning/ppm-service";
import type { PpmStatus } from "@/lib/planning/ppm-types";
import { CANCEL_TYPE_LABELS } from "@/lib/planning/ppm-types";
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

type CancelDetail = NonNullable<Awaited<ReturnType<typeof getPpmCancel>>>;

const PPM_STATUS_LABELS: Record<PpmStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function ppmStatusTone(status: PpmStatus): StatusTone {
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
  category_name: string;
  description: string;
  uom_id: string;
  cancel_qty: string;
  cancel_wt: string;
};

function emptyItem(): ItemFields {
  return {
    sno: "",
    item_class_name: "",
    category_name: "",
    description: "",
    uom_id: "",
    cancel_qty: "0",
    cancel_wt: "0",
  };
}

function itemToFields(r: CancelDetail["items"][number]): ItemFields {
  return {
    sno: String(r.sno),
    item_class_name: r.item_class_name ?? "",
    category_name: r.category_name ?? "",
    description: r.description ?? "",
    uom_id: r.uom_id ?? "",
    cancel_qty: String(r.cancel_qty),
    cancel_wt: String(r.cancel_wt),
  };
}

function fieldsToData(fields: ItemFields, cancelId: string, isAdd: boolean, snoFallback: number) {
  return {
    ppm_cancel_id: cancelId,
    sno: isAdd ? snoFallback : (parseInt(fields.sno, 10) || snoFallback),
    item_class_name: fields.item_class_name.trim() || null,
    category_name: fields.category_name.trim() || null,
    description: fields.description.trim() || null,
    uom_id: fields.uom_id.trim() || null,
    cancel_qty: parseFloat(fields.cancel_qty) || 0,
    cancel_wt: parseFloat(fields.cancel_wt) || 0,
  };
}

// ---------- Items tab ----------

function ItemsTab({
  cancel,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  cancel: CancelDetail;
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

  function openEdit(r: CancelDetail["items"][number]) {
    setForm(itemToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingItem =
    formMode && formMode !== "add"
      ? cancel.items.find((r) => r.id === formMode)
      : undefined;

  type ItemRow = CancelDetail["items"][number];
  const itemColumns: Column<ItemRow>[] = [
    { header: "S No",        cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Item Class",  cell: (r) => <span className="text-sm">{r.item_class_name ?? "--"}</span> },
    { header: "Category",    cell: (r) => <span className="text-sm">{r.category_name ?? "--"}</span> },
    { header: "Description", cell: (r) => <span className="max-w-xs truncate text-sm">{r.description ?? "--"}</span> },
    { header: "UOM",         cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span> },
    { header: "PPM Qty",    align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.ppm_qty)}</span> },
    { header: "PPM Wt",     align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.ppm_wt)}</span> },
    { header: "Cancel Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm font-medium">{fmtNumber(r.cancel_qty)}</span> },
    { header: "Cancel Wt",  align: "right", cell: (r) => <span className="tabular-nums text-sm font-medium">{fmtNumber(r.cancel_wt)}</span> },
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

  const isAdd = formMode === "add";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Items ({cancel.items.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add item
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={itemColumns}
          rows={cancel.items}
          getKey={(r) => r.id}
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {isAdd ? "Add item" : "Edit item"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>Item Class</Label>
                <Input
                  value={form.item_class_name}
                  onChange={(e) => setForm((f) => ({ ...f, item_class_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Category</Label>
                <Input
                  value={form.category_name}
                  onChange={(e) => setForm((f) => ({ ...f, category_name: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
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
                <Label>Cancel Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.cancel_qty}
                  onChange={(e) => setForm((f) => ({ ...f, cancel_qty: e.target.value }))}
                />
              </div>
              <div>
                <Label>Cancel Wt</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.cancel_wt}
                  onChange={(e) => setForm((f) => ({ ...f, cancel_wt: e.target.value }))}
                />
              </div>
              {/* PPM Qty / PPM Wt are read-only — sourced from the linked PPM */}
              {!isAdd && editingItem && (
                <>
                  <div>
                    <Label>PPM Qty (read-only)</Label>
                    <Input value={fmtNumber(editingItem.ppm_qty)} readOnly disabled />
                  </div>
                  <div>
                    <Label>PPM Wt (read-only)</Label>
                    <Input value={fmtNumber(editingItem.ppm_wt)} readOnly disabled />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const payload = fieldsToData(
                    form,
                    cancel.id,
                    isAdd,
                    isAdd ? cancel.items.length + 1 : (editingItem?.sno ?? 0),
                  );
                  if (isAdd) {
                    onAdd(payload);
                  } else if (editingItem) {
                    onUpdate(editingItem.id, payload);
                  }
                  closeForm();
                }}
              >
                {isPending ? "Saving..." : isAdd ? "Add" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- main component ----------

export function PpmCancelDetail({
  cancel,
  canEdit,
  canDelete,
  canApprove,
}: {
  cancel: CancelDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = cancel.status === "draft";
  const isSubmitted = cancel.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  function handleAddItem(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addPpmCancelItem(data);
      if (res.ok) success("Item added.");
      else toastError(res.error);
    });
  }

  function handleUpdateItem(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updatePpmCancelItem(itemId, cancel.id, data);
      if (res.ok) success("Item updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteItem(itemId: string) {
    startTransition(async () => {
      const res = await deletePpmCancelItem(itemId, cancel.id);
      if (res.ok) success("Item deleted.");
      else toastError(res.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitPpmCancel(cancel.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approvePpmCancel(cancel.id);
      if (res.ok) { success("PPM Cancel approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deletePpmCancel(cancel.id);
      if (res.ok) { success("Deleted."); router.push("/planning/ppm-cancel"); }
      else toastError(res.error);
    });
  }

  const itemsTab = (
    <ItemsTab
      cancel={cancel}
      canMutate={canMutate}
      isPending={isPending}
      onAdd={handleAddItem}
      onUpdate={handleUpdateItem}
      onDelete={handleDeleteItem}
    />
  );

  return (
    <div className="space-y-4">
      {/* Header summary card */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-medium">{cancel.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cancel Date</dt>
              <dd className="tabular-nums">{fmtDate(cancel.cancel_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cancel Type</dt>
              <dd className="font-medium">{CANCEL_TYPE_LABELS[cancel.cancel_type] ?? cancel.cancel_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{cancel.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">PPM Ref</dt>
              <dd>{cancel.ppm_id ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">PPM Date</dt>
              <dd className="tabular-nums">{cancel.ppm_date ? fmtDate(cancel.ppm_date) : "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group No</dt>
              <dd>{cancel.group_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group Description</dt>
              <dd>{cancel.group_description ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={ppmStatusTone(cancel.status)}>
                  {PPM_STATUS_LABELS[cancel.status]}
                </StatusPill>
              </dd>
            </div>
          </dl>

          {/* Action buttons */}
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
            {cancel.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{cancel.approved_at ? ` on ${fmtDate(cancel.approved_at)}` : ""}.
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

      {/* Items tab */}
      <Tabs
        defaultKey="items"
        items={[
          {
            key: "items",
            label: `Items (${cancel.items.length})`,
            content: itemsTab,
          },
        ]}
      />
    </div>
  );
}
