"use client";

import { useState, useTransition } from "react";
import {
  addBomShortageItem,
  deleteBomShortageItem,
  submitBomShortage,
  approveBomShortage,
} from "@/lib/planning/bom-actions";
import type {
  BomShortageItem,
  BomStatus,
  DueTo,
} from "@/lib/planning/bom-types";
import {
  DUE_TO_TYPES,
  DUE_TO_LABELS,
} from "@/lib/planning/bom-types";
import type { getBomShortage } from "@/lib/planning/bom-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber, fmtMoney } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

// ---------- types ----------

type ShortageDetail = NonNullable<Awaited<ReturnType<typeof getBomShortage>>>;

const BOM_STATUS_LABELS: Record<BomStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function bomStatusTone(status: BomStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

// ---------- Item line form ----------

type ItemFields = {
  item_class: string;
  description: string;
  qty: string;
  mtr: string;
  wt: string;
  rate: string;
  reason: string;
  due_to: string;
  debit_required: boolean;
  remarks: string;
};

function emptyItem(): ItemFields {
  return {
    item_class: "",
    description: "",
    qty: "0",
    mtr: "0",
    wt: "0",
    rate: "0",
    reason: "",
    due_to: "",
    debit_required: false,
    remarks: "",
  };
}

function ShortageItemForm({
  form,
  setForm,
  isPending,
  onSave,
  onCancel,
}: {
  form: ItemFields;
  setForm: React.Dispatch<React.SetStateAction<ItemFields>>;
  isPending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        Add item
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <Label>Item Class</Label>
          <Input
            value={form.item_class}
            onChange={(e) => setForm((f) => ({ ...f, item_class: e.target.value }))}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Description</Label>
          <Input
            value={form.description}
            maxLength={250}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
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
        <div>
          <Label>Mtr</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.mtr}
            onChange={(e) => setForm((f) => ({ ...f, mtr: e.target.value }))}
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
          <Label>Reason</Label>
          <Input
            value={form.reason}
            maxLength={250}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
        </div>
        <div>
          <Label>Due To</Label>
          <Select
            value={form.due_to}
            onChange={(e) => setForm((f) => ({ ...f, due_to: e.target.value }))}
          >
            <option value=""></option>
            {DUE_TO_TYPES.map((v) => (
              <option key={v} value={v}>
                {DUE_TO_LABELS[v]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.debit_required}
              onChange={(e) => setForm((f) => ({ ...f, debit_required: e.target.checked }))}
            />
            Debit Required
          </label>
        </div>
        <div className="sm:col-span-2">
          <Label>Remarks</Label>
          <Input
            value={form.remarks}
            maxLength={500}
            onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={isPending} onClick={onSave}>
          {isPending ? "Saving..." : "Add"}
        </Button>
      </div>
    </div>
  );
}

// ---------- main component ----------

export function BomShortageDetail({
  shortage,
  canEdit,
  canDelete,
  canApprove,
}: {
  shortage: ShortageDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<ItemFields>(emptyItem());

  const isDraft = shortage.status === "draft";
  const isSubmitted = shortage.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending || showAddForm);

  // ---------- Item handlers ----------

  function handleAddItem() {
    const payload = {
      shortage_id: shortage.id,
      sno: shortage.items.length + 1,
      item_class: form.item_class.trim() || null,
      description: form.description.trim() || null,
      qty: parseFloat(form.qty) || 0,
      mtr: parseFloat(form.mtr) || 0,
      wt: parseFloat(form.wt) || 0,
      rate: parseFloat(form.rate) || 0,
      reason: form.reason.trim() || null,
      due_to: (form.due_to as DueTo) || null,
      debit_required: form.debit_required,
      remarks: form.remarks.trim() || null,
      sort_order: shortage.items.length,
    };
    startTransition(async () => {
      const result = await addBomShortageItem(payload);
      if (result.ok) {
        success("Item added.");
        setShowAddForm(false);
        setForm(emptyItem());
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDeleteItem(itemId: string) {
    startTransition(async () => {
      const result = await deleteBomShortageItem(itemId, shortage.id);
      if (result.ok) success("Item deleted.");
      else toastError(result.error);
    });
  }

  // ---------- Workflow handlers ----------

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitBomShortage(shortage.id);
      if (result.ok) success("Submitted for approval.");
      else toastError(result.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveBomShortage(shortage.id);
      if (result.ok) success("BOM Shortage approved.");
      else toastError(result.error);
    });
  }

  // ---------- Items grid ----------

  type ItemRow = ShortageDetail["items"][number];

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  function toggleItemExpand(id: string) {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const itemColumns: Column<ItemRow>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm">{r.item_class ?? "--"}</span>,
    },
    {
      header: "Description",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm">{r.description ?? "--"}</span>
      ),
    },
    {
      header: "UOM",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span>,
    },
    {
      header: "Mtr",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.mtr)}</span>,
    },
    {
      header: "Wt",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.wt)}</span>,
    },
    {
      header: "Rate",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span>,
    },
    {
      header: "Reason",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {r.reason ?? "--"}
        </span>
      ),
    },
    {
      header: "Due To",
      cell: (r) => (
        <span className="text-sm">
          {r.due_to ? DUE_TO_LABELS[r.due_to] : "--"}
        </span>
      ),
    },
    {
      header: "Debit",
      cell: (r) => (
        <span className="text-sm">{r.debit_required ? "Y" : "N"}</span>
      ),
    },
    {
      header: "Remarks",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {r.remarks ?? "--"}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.sizes.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toggleItemExpand(r.id)}
            >
              {expandedItems.has(r.id) ? "Hide" : "Sizes"}
            </Button>
          )}
          {canMutate && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={isPending}
              onClick={() => handleDeleteItem(r.id)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  // ---------- Size child grid ----------

  type SizeRow = { id: string; item_size: string | null; qty: number; wt: number };

  const sizeColumns: Column<SizeRow>[] = [
    {
      header: "Item Size",
      cell: (r) => <span className="text-sm">{r.item_size ?? "--"}</span>,
    },
    {
      header: "Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span>,
    },
    {
      header: "Wt",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.wt)}</span>,
    },
  ];

  // ---------- render ----------

  return (
    <div className="space-y-4">
      {/* Header summary card */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-medium">{shortage.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{shortage.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">RE No</dt>
              <dd>{shortage.order_code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order No</dt>
              <dd>{shortage.order_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Req No</dt>
              <dd>{shortage.req_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Req Date</dt>
              <dd className="tabular-nums">{fmtDate(shortage.req_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Required Date</dt>
              <dd className="tabular-nums">
                {shortage.required_date ? fmtDate(shortage.required_date) : "--"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Department</dt>
              <dd>{shortage.department_id ? shortage.department_id.slice(0, 8) : "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Employee</dt>
              <dd>{shortage.employee_id ? shortage.employee_id.slice(0, 8) : "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">PPM Ref</dt>
              <dd>{shortage.ppm_ref ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Against PPM</dt>
              <dd>{shortage.against_ppm ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Division</dt>
              <dd>{shortage.division_id ? shortage.division_id.slice(0, 8) : "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Location</dt>
              <dd>{shortage.location_id ? shortage.location_id.slice(0, 8) : "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={bomStatusTone(shortage.status)}>
                  {BOM_STATUS_LABELS[shortage.status]}
                </StatusPill>
              </dd>
            </div>
          </dl>

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isDraft && canEdit && (
              <Button variant="outline" disabled={isPending} onClick={handleSubmit}>
                {isPending ? "Submitting..." : "Submit for approval"}
              </Button>
            )}

            {isSubmitted && canApprove && (
              <Button disabled={isPending} onClick={handleApprove}>
                {isPending ? "Approving..." : "Approve"}
              </Button>
            )}

            {isSubmitted && !canApprove && (
              <p className="text-sm text-muted-foreground">
                Awaiting approval by an authorised reviewer.
              </p>
            )}

            {shortage.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{shortage.approved_at ? ` on ${fmtDate(shortage.approved_at)}` : ""}.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Items grid */}
      <Card>
        <CardHeader>
          <CardTitle>Items ({shortage.items.length})</CardTitle>
          {canMutate && !showAddForm && (
            <Button
              size="sm"
              onClick={() => {
                setForm(emptyItem());
                setShowAddForm(true);
              }}
            >
              + Add item
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          <DataTable
            columns={itemColumns}
            rows={shortage.items}
            getKey={(r) => r.id}
            empty="No items yet. Add one to get started."
          />

          {/* Expanded size child grids */}
          {shortage.items
            .filter((it) => expandedItems.has(it.id) && it.sizes.length > 0)
            .map((it) => (
              <div key={`sizes-${it.id}`} className="ml-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Sizes for item #{it.sno}
                </p>
                <DataTable
                  columns={sizeColumns}
                  rows={it.sizes as SizeRow[]}
                  getKey={(r) => r.id}
                />
              </div>
            ))}

          {showAddForm && (
            <ShortageItemForm
              form={form}
              setForm={setForm}
              isPending={isPending}
              onSave={handleAddItem}
              onCancel={() => setShowAddForm(false)}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
