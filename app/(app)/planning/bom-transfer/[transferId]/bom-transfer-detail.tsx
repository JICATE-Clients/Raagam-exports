"use client";

import { useState, useTransition } from "react";
import {
  addBomTransferItem,
  deleteBomTransferItem,
  submitBomTransfer,
  approveBomTransfer,
} from "@/lib/planning/bom-actions";
import type {
  BomTransferItem,
  TransferStage,
} from "@/lib/planning/bom-types";
import {
  TRANSFER_STAGES,
} from "@/lib/planning/bom-types";
import type { getBomTransfer } from "@/lib/planning/bom-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

// ---------- types ----------

type TransferDetail = NonNullable<Awaited<ReturnType<typeof getBomTransfer>>>;

type TransferStatus = "draft" | "submitted" | "approved";

const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
};

function transferStatusTone(status: TransferStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
  }
}

const STAGE_LABELS: Record<TransferStage, string> = {
  grey: "Grey",
  dyed: "Dyed",
  print: "Print",
  wash: "Wash",
  finished: "Finished",
};

// ---------- Item line form ----------

type ItemFields = {
  item_class: string;
  stage: string;
  description: string;
  process_name: string;
  reqd_qty: string;
  reqd_wt: string;
  xfr_qty: string;
  xfr_wt: string;
  xfr_qty_with_loss: string;
  xfr_wt_with_loss: string;
};

function emptyItem(): ItemFields {
  return {
    item_class: "",
    stage: "",
    description: "",
    process_name: "",
    reqd_qty: "0",
    reqd_wt: "0",
    xfr_qty: "0",
    xfr_wt: "0",
    xfr_qty_with_loss: "0",
    xfr_wt_with_loss: "0",
  };
}

function TransferItemForm({
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
        <div>
          <Label>Stage</Label>
          <Select
            value={form.stage}
            onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
          >
            <option value=""></option>
            {TRANSFER_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
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
          <Label>Process</Label>
          <Input
            value={form.process_name}
            maxLength={100}
            onChange={(e) => setForm((f) => ({ ...f, process_name: e.target.value }))}
          />
        </div>
        <div>
          <Label>Reqd Qty</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.reqd_qty}
            onChange={(e) => setForm((f) => ({ ...f, reqd_qty: e.target.value }))}
          />
        </div>
        <div>
          <Label>Reqd Wt</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.reqd_wt}
            onChange={(e) => setForm((f) => ({ ...f, reqd_wt: e.target.value }))}
          />
        </div>
        <div>
          <Label>Xfr Qty</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.xfr_qty}
            onChange={(e) => setForm((f) => ({ ...f, xfr_qty: e.target.value }))}
          />
        </div>
        <div>
          <Label>Xfr Wt</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.xfr_wt}
            onChange={(e) => setForm((f) => ({ ...f, xfr_wt: e.target.value }))}
          />
        </div>
        <div>
          <Label>Xfr Qty (w/Loss)</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.xfr_qty_with_loss}
            onChange={(e) => setForm((f) => ({ ...f, xfr_qty_with_loss: e.target.value }))}
          />
        </div>
        <div>
          <Label>Xfr Wt (w/Loss)</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.xfr_wt_with_loss}
            onChange={(e) => setForm((f) => ({ ...f, xfr_wt_with_loss: e.target.value }))}
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

export function BomTransferDetail({
  transfer,
  canEdit,
  canDelete,
  canApprove,
}: {
  transfer: TransferDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<ItemFields>(emptyItem());

  const isDraft = transfer.status === "draft";
  const isSubmitted = transfer.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending || showAddForm);

  // ---------- Item handlers ----------

  function handleAddItem() {
    const payload = {
      transfer_id: transfer.id,
      sno: transfer.items.length + 1,
      item_class: form.item_class.trim() || null,
      stage: (form.stage as TransferStage) || null,
      description: form.description.trim() || null,
      process_name: form.process_name.trim() || null,
      reqd_qty: parseFloat(form.reqd_qty) || 0,
      reqd_wt: parseFloat(form.reqd_wt) || 0,
      xfr_qty: parseFloat(form.xfr_qty) || 0,
      xfr_wt: parseFloat(form.xfr_wt) || 0,
      xfr_qty_with_loss: parseFloat(form.xfr_qty_with_loss) || 0,
      xfr_wt_with_loss: parseFloat(form.xfr_wt_with_loss) || 0,
      sort_order: transfer.items.length,
    };
    startTransition(async () => {
      const result = await addBomTransferItem(payload);
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
      const result = await deleteBomTransferItem(itemId, transfer.id);
      if (result.ok) success("Item deleted.");
      else toastError(result.error);
    });
  }

  // ---------- Workflow handlers ----------

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitBomTransfer(transfer.id);
      if (result.ok) success("Submitted for approval.");
      else toastError(result.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveBomTransfer(transfer.id);
      if (result.ok) success("BOM Transfer approved.");
      else toastError(result.error);
    });
  }

  // ---------- Items grid ----------

  type ItemRow = TransferDetail["items"][number];

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
      header: "Stage",
      cell: (r) => (
        <span className="text-sm">
          {r.stage ? STAGE_LABELS[r.stage] : "--"}
        </span>
      ),
    },
    {
      header: "Description",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm">{r.description ?? "--"}</span>
      ),
    },
    {
      header: "Process",
      cell: (r) => <span className="text-sm">{r.process_name ?? "--"}</span>,
    },
    {
      header: "UOM",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span>
      ),
    },
    {
      header: "Reqd Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.reqd_qty)}</span>,
    },
    {
      header: "Reqd Wt",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.reqd_wt)}</span>,
    },
    {
      header: "Xfr Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.xfr_qty)}</span>,
    },
    {
      header: "Xfr Wt",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.xfr_wt)}</span>,
    },
    {
      header: "Xfr Qty (w/Loss)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.xfr_qty_with_loss)}</span>
      ),
    },
    {
      header: "Xfr Wt (w/Loss)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.xfr_wt_with_loss)}</span>
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

  type SizeRow = {
    id: string;
    item_size: string | null;
    qty: number;
    wt: number;
    xfr_qty: number;
    xfr_wt: number;
    xfr_qty_with_loss: number;
    xfr_wt_with_loss: number;
  };

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
    {
      header: "Xfr Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.xfr_qty)}</span>,
    },
    {
      header: "Xfr Wt",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.xfr_wt)}</span>,
    },
    {
      header: "Xfr Qty (w/Loss)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.xfr_qty_with_loss)}</span>
      ),
    },
    {
      header: "Xfr Wt (w/Loss)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.xfr_wt_with_loss)}</span>
      ),
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
              <dd className="font-medium">{transfer.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{transfer.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group No</dt>
              <dd>{transfer.group_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Transfer From</dt>
              <dd>{transfer.transfer_from ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Transfer To</dt>
              <dd>{transfer.transfer_to ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="tabular-nums">{fmtDate(transfer.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={transferStatusTone(transfer.status)}>
                  {TRANSFER_STATUS_LABELS[transfer.status]}
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

            {transfer.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Items grid */}
      <Card>
        <CardHeader>
          <CardTitle>Items ({transfer.items.length})</CardTitle>
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
            rows={transfer.items}
            getKey={(r) => r.id}
            empty="No items yet. Add one to get started."
          />

          {/* Expanded size child grids */}
          {transfer.items
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
                  empty="No sizes."
                />
              </div>
            ))}

          {showAddForm && (
            <TransferItemForm
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
