"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addMaterialRateItem,
  updateMaterialRateItem,
  deleteMaterialRateItem,
  submitMaterialRate,
  approveMaterialRate,
  deleteMaterialRate,
} from "@/lib/planning/material-planning-actions";
import type { getMaterialRate } from "@/lib/planning/material-planning-service";
import type { MaterialRateItem, MpStatus } from "@/lib/planning/material-planning-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type RateDetail = NonNullable<Awaited<ReturnType<typeof getMaterialRate>>>;

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
  description: string;
  rate_uom_id: string;
  rate: string;
};

function emptyItem(): ItemFields {
  return { sno: "", description: "", rate_uom_id: "", rate: "0" };
}

function rowToFields(r: MaterialRateItem): ItemFields {
  return {
    sno: String(r.sno),
    description: r.description ?? "",
    rate_uom_id: r.rate_uom_id ?? "",
    rate: String(r.rate),
  };
}

function fieldsToData(
  f: ItemFields,
  rateId: string,
  fallbackSno: number,
): Record<string, unknown> {
  return {
    material_rate_id: rateId,
    sno: parseInt(f.sno) || fallbackSno,
    description: f.description.trim() || null,
    rate_uom_id: f.rate_uom_id.trim() || null,
    rate: parseFloat(f.rate) || 0,
  };
}

// ---------- Items tab ----------

function ItemsTab({
  rate,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  rate: RateDetail;
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

  function openEdit(r: MaterialRateItem) {
    setForm(rowToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingItem =
    formMode && formMode !== "add"
      ? rate.items.find((r) => r.id === formMode)
      : undefined;

  type ItemRow = RateDetail["items"][number];
  const columns: Column<ItemRow>[] = [
    { header: "S No",        cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Description", cell: (r) => <span className="max-w-xs truncate text-sm">{r.description ?? "--"}</span> },
    { header: "Rate UOM",    cell: (r) => <span className="text-xs text-muted-foreground">{r.rate_uom_id ?? "--"}</span> },
    { header: "Rate",        align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span> },
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
        <CardTitle>Items ({rate.items.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add item
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={rate.items}
          getKey={(r) => r.id}
          empty="No items yet. Add one to get started."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-bold text-muted-foreground">
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
                <Label>Rate UOM</Label>
                <Input
                  value={form.rate_uom_id}
                  onChange={(e) => setForm((f) => ({ ...f, rate_uom_id: e.target.value }))}
                />
              </div>
              <div>
                <Label>Rate</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
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
                  const fallbackSno = formMode === "add" ? rate.items.length + 1 : (editingItem?.sno ?? 0);
                  const payload = fieldsToData(form, rate.id, fallbackSno);
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

export function MaterialRateDetail({
  rate,
  canEdit,
  canDelete,
  canApprove,
}: {
  rate: RateDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = rate.status === "draft";
  const isSubmitted = rate.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  function handleAddItem(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addMaterialRateItem(data);
      if (res.ok) success("Item added.");
      else toastError(res.error);
    });
  }

  function handleUpdateItem(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateMaterialRateItem(itemId, rate.id, data);
      if (res.ok) success("Item updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteItem(itemId: string) {
    startTransition(async () => {
      const res = await deleteMaterialRateItem(itemId, rate.id);
      if (res.ok) success("Item deleted.");
      else toastError(res.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitMaterialRate(rate.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approveMaterialRate(rate.id);
      if (res.ok) { success("Material Rate approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteMaterialRate(rate.id);
      if (res.ok) { success("Deleted."); router.push("/planning/material-rate"); }
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
              <dd className="font-medium">{rate.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="tabular-nums">{fmtDate(rate.entry_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{rate.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group No</dt>
              <dd>{rate.group_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group Description</dt>
              <dd>{rate.group_description ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={statusTone(rate.status)}>
                  {STATUS_LABELS[rate.status]}
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
            {rate.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{rate.approved_at ? ` on ${fmtDate(rate.approved_at)}` : ""}.
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
        defaultKey="items"
        items={[
          {
            key: "items",
            label: `Items (${rate.items.length})`,
            content: (
              <ItemsTab
                rate={rate}
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
