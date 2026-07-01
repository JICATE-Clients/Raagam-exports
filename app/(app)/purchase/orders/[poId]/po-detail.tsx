"use client";

import { useState, useTransition } from "react";
import {
  addPoLine,
  updatePoLine,
  deletePoLine,
  submitPo,
  approvePo,
  rejectPo,
} from "@/lib/purchase/po-actions";
import type { PoLineInput } from "@/lib/purchase/types";
import {
  PO_STATUS_LABELS,
  poLineOpenBalance,
  lineAmount,
} from "@/lib/purchase/types";
import type { PoWithDetails } from "@/lib/purchase/po-service";
import type { Item, Uom } from "@/lib/masters/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import type { PoLineItem, PoStatus } from "@/lib/purchase/types";

function poStatusTone(status: PoStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "pending_approval":
      return "warning";
    case "approved":
      return "info";
    case "partially_received":
      return "warning";
    case "received":
      return "success";
    case "closed":
      return "neutral";
    case "cancelled":
      return "danger";
  }
}

// ---------- line form ----------

type LineFields = {
  description: string;
  quantity: string;
  unit_price: string;
  item_id: string;
  uom_id: string;
};

function emptyLine(): LineFields {
  return {
    description: "",
    quantity: "1",
    unit_price: "0",
    item_id: "",
    uom_id: "",
  };
}

function lineToFields(l: PoLineItem): LineFields {
  return {
    description: l.description,
    quantity: String(l.quantity),
    unit_price: String(l.unit_price),
    item_id: l.item_id ?? "",
    uom_id: l.uom_id ?? "",
  };
}

function fieldsToInput(f: LineFields, sortOrder: number): PoLineInput {
  return {
    description: f.description.trim(),
    quantity: parseFloat(f.quantity) || 0,
    unit_price: parseFloat(f.unit_price) || 0,
    item_id: f.item_id || null,
    uom_id: f.uom_id || null,
    sort_order: sortOrder,
  };
}

function LineForm({
  form,
  setForm,
  items,
  uoms,
  currencyCode,
  isAdd,
  isPending,
  onSave,
  onCancel,
}: {
  form: LineFields;
  setForm: React.Dispatch<React.SetStateAction<LineFields>>;
  items: Item[];
  uoms: Uom[];
  currencyCode: string | null;
  isAdd: boolean;
  isPending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const preview = lineAmount(
    parseFloat(form.quantity) || 0,
    parseFloat(form.unit_price) || 0,
  );

  return (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {isAdd ? "Add line" : "Edit line"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <div className="sm:col-span-2">
          <Label>Description *</Label>
          <Input
            placeholder="e.g. 30/1 Compact yarn"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        {items.length > 0 && (
          <div>
            <Label>Item (optional)</Label>
            <Select
              value={form.item_id}
              onChange={(e) => setForm((f) => ({ ...f, item_id: e.target.value }))}
            >
              <option value="">— None —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div>
          <Label>Quantity</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            placeholder="0"
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
          />
        </div>

        {uoms.length > 0 && (
          <div>
            <Label>Unit of measure</Label>
            <Select
              value={form.uom_id}
              onChange={(e) => setForm((f) => ({ ...f, uom_id: e.target.value }))}
            >
              <option value="">— None —</option>
              {uoms.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </Select>
          </div>
        )}

        <div>
          <Label>
            Unit price{currencyCode ? ` (${currencyCode})` : ""}
          </Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.unit_price}
            onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))}
          />
        </div>

        <div className="flex items-end pb-0.5">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Amount preview
            </p>
            <p className="tabular-nums text-sm font-semibold">
              {fmtMoney(preview, currencyCode)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={isPending || !form.description.trim()}
          onClick={onSave}
        >
          {isPending ? "Saving…" : isAdd ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ---------- main component ----------

export function PoDetail({
  po,
  items,
  uoms,
  canEdit,
  canDelete,
  canApprove,
}: {
  po: PoWithDetails;
  items: Item[];
  uoms: Uom[];
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // null = closed, "add" = new line, string = line id being edited
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<LineFields>(emptyLine());
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const isDraft = po.status === "draft";
  const isPendingApproval = po.status === "pending_approval";
  const canMutateLines = isDraft && canEdit;

  function openAdd() {
    setForm(emptyLine());
    setFormMode("add");
  }

  function openEdit(line: PoLineItem) {
    setForm(lineToFields(line));
    setFormMode(line.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  // ---------- action handlers ----------

  function handleAdd() {
    const data = fieldsToInput(form, po.lines.length);
    startTransition(async () => {
      const result = await addPoLine(po.id, data);
      if (result.ok) {
        success("Line added.");
        closeForm();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleUpdate(lineId: string, sortOrder: number) {
    const data = fieldsToInput(form, sortOrder);
    startTransition(async () => {
      const result = await updatePoLine(lineId, po.id, data);
      if (result.ok) {
        success("Line updated.");
        closeForm();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(lineId: string) {
    startTransition(async () => {
      const result = await deletePoLine(lineId, po.id);
      if (result.ok) {
        success("Line deleted.");
      } else {
        toastError(result.error);
      }
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitPo(po.id);
      if (result.ok) {
        success("Submitted for approval.");
      } else {
        toastError(result.error);
      }
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approvePo(po.id);
      if (result.ok) {
        success("Purchase order approved.");
      } else {
        toastError(result.error);
      }
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectPo(po.id, rejectNote.trim() || undefined);
      if (result.ok) {
        success("Purchase order returned to draft.");
        setShowRejectForm(false);
        setRejectNote("");
      } else {
        toastError(result.error);
      }
    });
  }

  // ---------- line columns ----------

  const editingLine =
    formMode && formMode !== "add"
      ? po.lines.find((l) => l.id === formMode)
      : undefined;

  const uomMap = Object.fromEntries(uoms.map((u) => [u.id, u.code]));

  const lineColumns: Column<PoLineItem>[] = [
    {
      header: "Description",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm">{r.description}</span>
      ),
    },
    {
      header: "UOM",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.uom_id ? (uomMap[r.uom_id] ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.quantity)}</span>
      ),
    },
    {
      header: "Unit price",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {fmtMoney(r.unit_price, po.currency_code)}
        </span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm font-semibold">
          {fmtMoney(r.amount, po.currency_code)}
        </span>
      ),
    },
    {
      header: "Received",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span>
      ),
    },
    {
      header: "Open balance",
      align: "right",
      cell: (r) => {
        const bal = poLineOpenBalance(r);
        return (
          <span
            className={
              bal > 0
                ? "tabular-nums text-sm text-warning"
                : "tabular-nums text-sm text-success"
            }
          >
            {fmtNumber(bal)}
          </span>
        );
      },
    },
    ...(canMutateLines || (isDraft && canDelete)
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: PoLineItem) => (
              <div className="flex items-center justify-end gap-1">
                {canMutateLines && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      formMode === r.id ? closeForm() : openEdit(r)
                    }
                  >
                    {formMode === r.id ? "Cancel" : "Edit"}
                  </Button>
                )}
                {isDraft && canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    disabled={isPending}
                    onClick={() => handleDelete(r.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Vendor</dt>
              <dd className="font-medium">{po.vendor_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={poStatusTone(po.status)}>
                  {PO_STATUS_LABELS[po.status]}
                </StatusPill>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order date</dt>
              <dd>{fmtDate(po.order_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expected</dt>
              <dd>{fmtDate(po.expected_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="tabular-nums font-semibold">
                {fmtMoney(po.total_amount, po.currency_code)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Currency</dt>
              <dd>{po.currency_code ?? "—"}</dd>
            </div>
            {po.approved_at && (
              <div>
                <dt className="text-xs text-muted-foreground">Approved</dt>
                <dd>{fmtDate(po.approved_at)}</dd>
              </div>
            )}
            {po.notes && (
              <div className="col-span-2 md:col-span-4">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-wrap text-sm">{po.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle>Line items ({po.lines.length})</CardTitle>
          {canMutateLines && formMode !== "add" && (
            <Button size="sm" onClick={openAdd}>
              + Add line
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          <DataTable
            columns={lineColumns}
            rows={po.lines}
            getKey={(r) => r.id}
            empty="No lines yet. Add one to get started."
          />

          {formMode !== null && (
            <LineForm
              form={form}
              setForm={setForm}
              items={items}
              uoms={uoms}
              currencyCode={po.currency_code}
              isAdd={formMode === "add"}
              isPending={isPending}
              onSave={() => {
                if (formMode === "add") {
                  handleAdd();
                } else if (editingLine) {
                  handleUpdate(editingLine.id, editingLine.sort_order);
                }
              }}
              onCancel={closeForm}
            />
          )}
        </CardBody>
      </Card>

      {/* Approval workflow */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            {isDraft && canEdit && (
              <Button
                variant="outline"
                disabled={isPending}
                onClick={handleSubmit}
              >
                Submit for approval
              </Button>
            )}

            {isPendingApproval && canApprove && (
              <>
                <Button disabled={isPending} onClick={handleApprove}>
                  Approve
                </Button>
                {!showRejectForm && (
                  <Button
                    variant="danger"
                    disabled={isPending}
                    onClick={() => setShowRejectForm(true)}
                  >
                    Reject
                  </Button>
                )}
              </>
            )}

            {isPendingApproval && !canApprove && (
              <p className="text-sm text-muted-foreground">
                Awaiting approval by an authorised reviewer.
              </p>
            )}

            {po.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{po.approved_at ? ` on ${fmtDate(po.approved_at)}` : ""}.
              </p>
            )}

            {["received", "closed", "cancelled"].includes(po.status) && (
              <p className="text-sm text-muted-foreground">
                This order is {PO_STATUS_LABELS[po.status].toLowerCase()}.
              </p>
            )}
          </div>

          {showRejectForm && isPendingApproval && canApprove && (
            <div className="mt-3 max-w-md space-y-2">
              <Label>Rejection note (optional)</Label>
              <Textarea
                rows={2}
                placeholder="Reason for rejection…"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectNote("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={isPending}
                  onClick={handleReject}
                >
                  {isPending ? "Rejecting…" : "Confirm reject"}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
