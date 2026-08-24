"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addPurchasePpmItem,
  updatePurchasePpmItem,
  deletePurchasePpmItem,
  submitPurchasePpm,
  approvePurchasePpm,
  deletePurchasePpm,
} from "@/lib/planning/ppm-actions";
import type { getPurchasePpm } from "@/lib/planning/ppm-service";
import type { PurchasePpmItem, PpmStatus } from "@/lib/planning/ppm-types";
import { ACK_STATUS_LABELS } from "@/lib/planning/ppm-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtDate, fmtNumber, fmtMoney } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type PpmDetail = NonNullable<Awaited<ReturnType<typeof getPurchasePpm>>>;

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

function ackStatusTone(ack: string): StatusTone {
  switch (ack) {
    case "A": return "success";
    case "R": return "danger";
    case "V": return "warning";
    default:  return "neutral";
  }
}

// ---------- Item form fields ----------

type ItemFields = {
  sno: string;
  item_class_name: string;
  category_name: string;
  description: string;
  uom_id: string;
  is_approval_required: boolean;
  qty: string;
  wt: string;
  rate: string;
};

function emptyItem(): ItemFields {
  return {
    sno: "",
    item_class_name: "",
    category_name: "",
    description: "",
    uom_id: "",
    is_approval_required: false,
    qty: "0",
    wt: "0",
    rate: "0",
  };
}

function rowToFields(r: PurchasePpmItem): ItemFields {
  return {
    sno: String(r.sno),
    item_class_name: r.item_class_name ?? "",
    category_name: r.category_name ?? "",
    description: r.description ?? "",
    uom_id: r.uom_id ?? "",
    is_approval_required: r.is_approval_required,
    qty: String(r.qty),
    wt: String(r.wt),
    rate: String(r.rate),
  };
}

function fieldsToData(
  f: ItemFields,
  ppmId: string,
  fallbackSno: number,
): Record<string, unknown> {
  const qty = parseFloat(f.qty) || 0;
  const rate = parseFloat(f.rate) || 0;
  const wt = parseFloat(f.wt) || 0;
  return {
    purchase_ppm_id: ppmId,
    sno: parseInt(f.sno) || fallbackSno,
    item_class_name: f.item_class_name.trim() || null,
    category_name: f.category_name.trim() || null,
    description: f.description.trim() || null,
    uom_id: f.uom_id.trim() || null,
    is_approval_required: f.is_approval_required,
    qty,
    wt,
    rate,
    po_value: qty * rate,
  };
}

// ---------- Items tab ----------

function ItemsTab({
  ppm,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  ppm: PpmDetail;
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

  function openEdit(r: PurchasePpmItem) {
    setForm(rowToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingItem =
    formMode && formMode !== "add"
      ? ppm.items.find((r) => r.id === formMode)
      : undefined;

  type ItemRow = PpmDetail["items"][number];
  const itemColumns: Column<ItemRow>[] = [
    { header: "S No",          cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Item Class",    cell: (r) => <span className="text-sm">{r.item_class_name ?? "--"}</span> },
    { header: "Category",      cell: (r) => <span className="text-sm">{r.category_name ?? "--"}</span> },
    { header: "Description",   cell: (r) => <span className="max-w-xs truncate text-sm">{r.description ?? "--"}</span> },
    { header: "UOM",           cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span> },
    { header: "Approval Reqd", cell: (r) => <span className="text-sm">{r.is_approval_required ? "Yes" : "No"}</span> },
    { header: "Qty",   align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span> },
    { header: "Wt",    align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.wt)}</span> },
    { header: "Rate",  align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span> },
    { header: "Value", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.po_value)}</span> },
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
        <CardTitle>Items ({ppm.items.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add item
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={itemColumns}
          rows={ppm.items}
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
                <Label>Category</Label>
                <Input
                  value={form.category_name}
                  onChange={(e) => setForm((f) => ({ ...f, category_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>UOM</Label>
                <Input
                  value={form.uom_id}
                  onChange={(e) => setForm((f) => ({ ...f, uom_id: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-2 self-end pb-1">
                <input
                  id="is_approval_required"
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={form.is_approval_required}
                  onChange={(e) => setForm((f) => ({ ...f, is_approval_required: e.target.checked }))}
                />
                <Label htmlFor="is_approval_required">Approval Required</Label>
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
              <div>
                <Label>Wt</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.wt}
                  onChange={(e) => setForm((f) => ({ ...f, wt: e.target.value }))}
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
              <div>
                <Label>Value (calc)</Label>
                <Input
                  readOnly
                  value={fmtMoney((parseFloat(form.qty) || 0) * (parseFloat(form.rate) || 0))}
                  className="bg-surface-muted text-muted-foreground"
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
                  const fallbackSno = formMode === "add" ? ppm.items.length + 1 : (editingItem?.sno ?? 0);
                  const payload = fieldsToData(form, ppm.id, fallbackSno);
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

export function PurchasePpmDetail({
  ppm,
  canEdit,
  canDelete,
  canApprove,
}: {
  ppm: PpmDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [formMode, setFormMode] = useState<"add" | string | null>(null);

  const isDraft = ppm.status === "draft";
  const isSubmitted = ppm.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(formMode !== null || isPending);

  // ---------- Item handlers ----------

  function handleAddItem(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addPurchasePpmItem(data);
      if (res.ok) success("Item added.");
      else toastError(res.error);
    });
  }

  function handleUpdateItem(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updatePurchasePpmItem(itemId, ppm.id, data);
      if (res.ok) success("Item updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteItem(itemId: string) {
    startTransition(async () => {
      const res = await deletePurchasePpmItem(itemId, ppm.id);
      if (res.ok) success("Item deleted.");
      else toastError(res.error);
    });
  }

  // ---------- Workflow handlers ----------

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitPurchasePpm(ppm.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approvePurchasePpm(ppm.id);
      if (res.ok) { success("Purchase PPM approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deletePurchasePpm(ppm.id);
      if (res.ok) { success("Deleted."); router.push("/planning/purchase-ppm"); }
      else toastError(res.error);
    });
  }

  // ---------- Tab content ----------

  const itemsTab = (
    <ItemsTab
      ppm={ppm}
      canMutate={canMutate}
      isPending={isPending}
      onAdd={handleAddItem}
      onUpdate={handleUpdateItem}
      onDelete={handleDeleteItem}
    />
  );

  // ---------- render ----------

  return (
    <div className="space-y-4">
      {/* Header summary card */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-medium">{ppm.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="tabular-nums">{fmtDate(ppm.ppm_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{ppm.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order / Group No</dt>
              <dd>{ppm.group_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amendment No</dt>
              <dd className="tabular-nums">{ppm.amendment_no}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">To Department</dt>
              <dd>{ppm.to_department_id ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">OH%</dt>
              <dd className="tabular-nums">{fmtNumber(ppm.overhead_pct)}%</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ack Status</dt>
              <dd>
                <StatusPill tone={ackStatusTone(ppm.ack_status)}>
                  {ACK_STATUS_LABELS[ppm.ack_status] ?? ppm.ack_status}
                </StatusPill>
              </dd>
            </div>
            {ppm.remarks && (
              <div className="col-span-2 md:col-span-4">
                <dt className="text-xs text-muted-foreground">Remarks</dt>
                <dd className="text-muted-foreground">{ppm.remarks}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={ppmStatusTone(ppm.status)}>
                  {PPM_STATUS_LABELS[ppm.status]}
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
            {ppm.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{ppm.approved_at ? ` on ${fmtDate(ppm.approved_at)}` : ""}.
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
            label: `Items (${ppm.items.length})`,
            content: itemsTab,
          },
        ]}
      />

      {/* Footer value summary */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Gross Value</dt>
              <dd className="tabular-nums font-medium">{fmtMoney(ppm.gross_value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">OH%</dt>
              <dd className="tabular-nums">{fmtNumber(ppm.overhead_pct)}%</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">OH Value</dt>
              <dd className="tabular-nums font-medium">{fmtMoney(ppm.overhead_value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Net Value</dt>
              <dd className="tabular-nums text-base font-semibold">{fmtMoney(ppm.net_value)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
