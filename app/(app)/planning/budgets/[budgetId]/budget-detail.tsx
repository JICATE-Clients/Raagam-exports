"use client";

import { useState, useTransition } from "react";
import {
  submitBudget,
  approveBudget,
  rejectBudget,
  addBudgetPurchase,
  updateBudgetPurchase,
  deleteBudgetPurchase,
  addBudgetProcess,
  updateBudgetProcess,
  deleteBudgetProcess,
  addBudgetProcessItem,
  updateBudgetProcessItem,
  deleteBudgetProcessItem,
  addBudgetCmt,
  updateBudgetCmt,
  deleteBudgetCmt,
  addBudgetCmtOperation,
  updateBudgetCmtOperation,
  deleteBudgetCmtOperation,
  addBudgetOtherEntry,
  updateBudgetOtherEntry,
  deleteBudgetOtherEntry,
} from "@/lib/planning/budget-actions";
import type {
  BudgetPurchase,
  BudgetProcess,
  BudgetProcessItem,
  BudgetCmt,
  BudgetCmtOperation,
  BudgetOtherEntry,
  BudgetHead,
  BudgetStyle,
  BudgetStatus,
  PurchaseType,
  BudgetProcessType,
  OtherEntryType,
} from "@/lib/planning/budget-types";
import {
  BUDGET_TYPE_LABELS,
  BUDGET_ENTRY_TYPE_LABELS,
  PURCHASE_TYPE_LABELS,
  PROCESS_TYPE_LABELS,
} from "@/lib/planning/budget-types";
import type { BudgetDetail as BudgetDetailType } from "@/lib/planning/budget-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

// ---------- status helpers ----------

const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function budgetStatusTone(status: BudgetStatus): StatusTone {
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

// ============================================================================
// Purchase Rates Section (Tab 1 — sub-sections by purchase_type)
// ============================================================================

function PurchaseSection({
  title,
  purchaseType,
  rows,
  budgetId,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  title: string;
  purchaseType: PurchaseType;
  rows: BudgetPurchase[];
  budgetId: string;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (itemId: string, data: Record<string, unknown>) => void;
  onDelete: (itemId: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState({
    item_name: "",
    gsm: "",
    stage: "",
    item_color: "",
    print_name: "",
    vendor_name: "",
    specifications: "",
    reqd_qty: "0",
    is_foc: false,
    is_import: false,
    currency_code: "INR",
    rate: "0",
    exchange_rate: "1",
    moq: "",
  });

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm({
      item_name: "",
      gsm: "",
      stage: "",
      item_color: "",
      print_name: "",
      vendor_name: "",
      specifications: "",
      reqd_qty: "0",
      is_foc: false,
      is_import: false,
      currency_code: "INR",
      rate: "0",
      exchange_rate: "1",
      moq: "",
    });
    setFormMode("add");
  }

  function openEdit(p: BudgetPurchase) {
    setForm({
      item_name: p.item_name ?? "",
      gsm: p.gsm != null ? String(p.gsm) : "",
      stage: p.stage ?? "",
      item_color: p.item_color ?? "",
      print_name: p.print_name ?? "",
      vendor_name: p.vendor_name ?? "",
      specifications: p.specifications ?? "",
      reqd_qty: String(p.reqd_qty),
      is_foc: p.is_foc,
      is_import: p.is_import,
      currency_code: p.currency_code ?? "INR",
      rate: String(p.rate),
      exchange_rate: String(p.exchange_rate),
      moq: p.moq != null ? String(p.moq) : "",
    });
    setFormMode(p.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingItem =
    formMode && formMode !== "add" ? rows.find((r) => r.id === formMode) : undefined;

  const showGsm = purchaseType === "fabric";
  const showPrintName = purchaseType === "fabric";

  const columns: Column<BudgetPurchase>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Item Name",
      cell: (r) => <span className="text-sm">{r.item_name ?? "--"}</span>,
    },
    ...(showGsm
      ? [
          {
            header: "GSM",
            align: "right" as const,
            cell: (r: BudgetPurchase) => (
              <span className="tabular-nums text-sm">{r.gsm != null ? fmtNumber(r.gsm) : "--"}</span>
            ),
          },
        ]
      : []),
    {
      header: "Stage",
      cell: (r) => <span className="text-sm">{r.stage ?? "--"}</span>,
    },
    {
      header: "Color",
      cell: (r) => <span className="text-sm">{r.item_color ?? "--"}</span>,
    },
    ...(showPrintName
      ? [
          {
            header: "Print Name",
            cell: (r: BudgetPurchase) => <span className="text-sm">{r.print_name ?? "--"}</span>,
          },
        ]
      : []),
    {
      header: "Vendor",
      cell: (r) => <span className="text-sm">{r.vendor_name ?? "--"}</span>,
    },
    {
      header: "Specs",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {r.specifications ?? "--"}
        </span>
      ),
    },
    {
      header: "Reqd Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.reqd_qty)}</span>,
    },
    {
      header: "FOC",
      cell: (r) => <span className="text-sm">{r.is_foc ? "Yes" : "--"}</span>,
    },
    {
      header: "Import",
      cell: (r) => <span className="text-sm">{r.is_import ? "Yes" : "--"}</span>,
    },
    {
      header: "Currency",
      cell: (r) => <span className="text-sm">{r.currency_code ?? "--"}</span>,
    },
    {
      header: "Rate",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span>,
    },
    {
      header: "Ex. Rate",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.exchange_rate)}</span>,
    },
    {
      header: "INR Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm font-semibold">{fmtMoney(r.inr_rate)}</span>
      ),
    },
    {
      header: "MOQ",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{r.moq != null ? fmtNumber(r.moq) : "--"}</span>
      ),
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: BudgetPurchase) => (
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
        <CardTitle>
          {title} ({rows.length})
        </CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty={`No ${title.toLowerCase()} yet.`} />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? `Add ${title.toLowerCase()}` : `Edit ${title.toLowerCase()}`}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>Item Name</Label>
                <Input value={form.item_name} onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))} />
              </div>
              {showGsm && (
                <div>
                  <Label>GSM</Label>
                  <Input type="number" min="0" step="0.01" value={form.gsm} onChange={(e) => setForm((f) => ({ ...f, gsm: e.target.value }))} />
                </div>
              )}
              <div>
                <Label>Stage</Label>
                <Input value={form.stage} onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))} />
              </div>
              <div>
                <Label>Color</Label>
                <Input value={form.item_color} onChange={(e) => setForm((f) => ({ ...f, item_color: e.target.value }))} />
              </div>
              {showPrintName && (
                <div>
                  <Label>Print Name</Label>
                  <Input value={form.print_name} onChange={(e) => setForm((f) => ({ ...f, print_name: e.target.value }))} />
                </div>
              )}
              <div>
                <Label>Vendor</Label>
                <Input value={form.vendor_name} onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))} />
              </div>
              <div>
                <Label>Reqd Qty</Label>
                <Input type="number" min="0" step="0.001" value={form.reqd_qty} onChange={(e) => setForm((f) => ({ ...f, reqd_qty: e.target.value }))} />
              </div>
              <div>
                <Label>Rate</Label>
                <Input type="number" min="0" step="0.01" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
              </div>
              <div>
                <Label>Currency</Label>
                <Input value={form.currency_code} onChange={(e) => setForm((f) => ({ ...f, currency_code: e.target.value }))} />
              </div>
              <div>
                <Label>Exchange Rate</Label>
                <Input type="number" min="0" step="0.0001" value={form.exchange_rate} onChange={(e) => setForm((f) => ({ ...f, exchange_rate: e.target.value }))} />
              </div>
              <div>
                <Label>MOQ</Label>
                <Input type="number" min="0" step="0.001" value={form.moq} onChange={(e) => setForm((f) => ({ ...f, moq: e.target.value }))} />
              </div>
              <div className="sm:col-span-2 md:col-span-4">
                <Label>Specifications</Label>
                <Input value={form.specifications} onChange={(e) => setForm((f) => ({ ...f, specifications: e.target.value }))} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const rate = parseFloat(form.rate) || 0;
                  const exRate = parseFloat(form.exchange_rate) || 1;
                  const payload = {
                    budget_id: budgetId,
                    purchase_type: purchaseType,
                    sno: formMode === "add" ? rows.length + 1 : editingItem?.sno ?? 0,
                    item_name: form.item_name.trim() || null,
                    gsm: form.gsm ? parseFloat(form.gsm) : null,
                    stage: form.stage.trim() || null,
                    item_color: form.item_color.trim() || null,
                    print_name: form.print_name.trim() || null,
                    vendor_name: form.vendor_name.trim() || null,
                    specifications: form.specifications.trim() || null,
                    reqd_qty: parseFloat(form.reqd_qty) || 0,
                    is_foc: form.is_foc,
                    is_import: form.is_import,
                    currency_code: form.currency_code || "INR",
                    rate,
                    exchange_rate: exRate,
                    inr_rate: rate * exRate,
                    moq: form.moq ? parseFloat(form.moq) : null,
                    sort_order: formMode === "add" ? rows.length : (editingItem?.sort_order ?? 0),
                  };
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

// ============================================================================
// Process Rates Section (Tab 2 — sub-sections by process_type)
// ============================================================================

type ProcessWithItems = BudgetProcess & { items: BudgetProcessItem[] };

function ProcessSection({
  title,
  processType,
  rows,
  budgetId,
  canMutate,
  isPending,
  onAddProcess,
  onDeleteProcess,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
}: {
  title: string;
  processType: BudgetProcessType;
  rows: ProcessWithItems[];
  budgetId: string;
  canMutate: boolean;
  isPending: boolean;
  onAddProcess: (data: Record<string, unknown>) => void;
  onDeleteProcess: (itemId: string) => void;
  onAddItem: (processId: string, data: Record<string, unknown>) => void;
  onUpdateItem: (itemId: string, data: Record<string, unknown>) => void;
  onDeleteItem: (itemId: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [addItemFor, setAddItemFor] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState({
    description: "",
    reqd_qty: "0",
    is_foc: false,
    charges: "0",
    design_charges: "0",
  });

  useUnsavedGuard(addItemFor !== null || editItemId !== null);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAddItem(processId: string) {
    setItemForm({ description: "", reqd_qty: "0", is_foc: false, charges: "0", design_charges: "0" });
    setAddItemFor(processId);
    setEditItemId(null);
  }

  function openEditItem(it: BudgetProcessItem) {
    setItemForm({
      description: it.description ?? "",
      reqd_qty: String(it.reqd_qty),
      is_foc: it.is_foc,
      charges: String(it.charges),
      design_charges: String(it.design_charges),
    });
    setEditItemId(it.id);
    setAddItemFor(null);
  }

  function closeItemForm() {
    setAddItemFor(null);
    setEditItemId(null);
  }

  const parentColumns: Column<ProcessWithItems>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Process Name",
      cell: (r) => <span className="text-sm">{r.process_name ?? "--"}</span>,
    },
    {
      header: "Rate For",
      cell: (r) => <span className="text-sm">{r.rate_for ?? "--"}</span>,
    },
    {
      header: "Reqd Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.reqd_qty)}</span>,
    },
    {
      header: "FOC",
      cell: (r) => <span className="text-sm">{r.is_foc ? "Yes" : "--"}</span>,
    },
    {
      header: "Rate Type",
      cell: (r) => <span className="text-sm">{r.rate_type ?? "--"}</span>,
    },
    {
      header: "Charges",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.charges)}</span>,
    },
    {
      header: "Design Charges",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.design_charges)}</span>,
    },
    {
      header: "Items",
      cell: (r) => <span className="tabular-nums text-sm">{r.items.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => toggleExpand(r.id)}>
            {expandedIds.has(r.id) ? "Hide" : "Details"}
          </Button>
          {canMutate && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={isPending}
              onClick={() => onDeleteProcess(r.id)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const itemColumns: Column<BudgetProcessItem>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Description",
      cell: (r) => <span className="text-sm">{r.description ?? "--"}</span>,
    },
    {
      header: "Reqd Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.reqd_qty)}</span>,
    },
    {
      header: "FOC",
      cell: (r) => <span className="text-sm">{r.is_foc ? "Yes" : "--"}</span>,
    },
    {
      header: "Charges",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.charges)}</span>,
    },
    {
      header: "Design Charges",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.design_charges)}</span>,
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: BudgetProcessItem) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => (editItemId === r.id ? closeItemForm() : openEditItem(r))}
                >
                  {editItemId === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  disabled={isPending}
                  onClick={() => onDeleteItem(r.id)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const itemFormUI = (processId: string, proc: ProcessWithItems, isAdd: boolean) => (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {isAdd ? "Add item" : "Edit item"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <div className="sm:col-span-2">
          <Label>Description</Label>
          <Input value={itemForm.description} onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div>
          <Label>Reqd Qty</Label>
          <Input type="number" min="0" step="0.001" value={itemForm.reqd_qty} onChange={(e) => setItemForm((f) => ({ ...f, reqd_qty: e.target.value }))} />
        </div>
        <div>
          <Label>Charges</Label>
          <Input type="number" min="0" step="0.01" value={itemForm.charges} onChange={(e) => setItemForm((f) => ({ ...f, charges: e.target.value }))} />
        </div>
        <div>
          <Label>Design Charges</Label>
          <Input type="number" min="0" step="0.01" value={itemForm.design_charges} onChange={(e) => setItemForm((f) => ({ ...f, design_charges: e.target.value }))} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={closeItemForm}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            const payload = {
              process_id: processId,
              sno: isAdd ? proc.items.length + 1 : 0,
              description: itemForm.description.trim() || null,
              reqd_qty: parseFloat(itemForm.reqd_qty) || 0,
              is_foc: itemForm.is_foc,
              charges: parseFloat(itemForm.charges) || 0,
              design_charges: parseFloat(itemForm.design_charges) || 0,
              sort_order: isAdd ? proc.items.length : 0,
            };
            if (isAdd) {
              onAddItem(processId, payload);
            } else if (editItemId) {
              onUpdateItem(editItemId, payload);
            }
            closeItemForm();
          }}
        >
          {isPending ? "Saving..." : isAdd ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} ({rows.length})
        </CardTitle>
        {canMutate && (
          <Button
            size="sm"
            onClick={() =>
              onAddProcess({
                budget_id: budgetId,
                process_type: processType,
                sno: rows.length + 1,
                sort_order: rows.length,
              })
            }
          >
            + Add process
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable columns={parentColumns} rows={rows} getKey={(r) => r.id} empty={`No ${title.toLowerCase()} yet.`} />

        {rows
          .filter((r) => expandedIds.has(r.id))
          .map((proc) => (
            <div key={`child-${proc.id}`} className="ml-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  Items for: {proc.process_name ?? `Process ${proc.sno}`}
                </p>
                {canMutate && addItemFor !== proc.id && (
                  <Button size="sm" variant="outline" onClick={() => openAddItem(proc.id)}>
                    + Add item
                  </Button>
                )}
              </div>
              <DataTable columns={itemColumns} rows={proc.items} getKey={(r) => r.id} />
              {editItemId && proc.items.some((it) => it.id === editItemId) && itemFormUI(proc.id, proc, false)}
              {addItemFor === proc.id && itemFormUI(proc.id, proc, true)}
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// CMT Section (Tab 3 — parent CMTs → child Operations)
// ============================================================================

type CmtWithOps = BudgetCmt & { operations: BudgetCmtOperation[] };

function CmtSection({
  cmts,
  budgetId,
  canMutate,
  isPending,
  onAddCmt,
  onUpdateCmt,
  onDeleteCmt,
  onAddOp,
  onUpdateOp,
  onDeleteOp,
}: {
  cmts: CmtWithOps[];
  budgetId: string;
  canMutate: boolean;
  isPending: boolean;
  onAddCmt: (data: Record<string, unknown>) => void;
  onUpdateCmt: (itemId: string, data: Record<string, unknown>) => void;
  onDeleteCmt: (itemId: string) => void;
  onAddOp: (cmtId: string, data: Record<string, unknown>) => void;
  onUpdateOp: (opId: string, data: Record<string, unknown>) => void;
  onDeleteOp: (opId: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [cmtFormMode, setCmtFormMode] = useState<"add" | string | null>(null);
  const [cmtForm, setCmtForm] = useState({
    style_ref_no: "",
    style_no: "",
    article_no: "",
    oc_no: "",
    order_no: "",
    coordinate_name: "",
    order_qty: "0",
    sq_qty: "0",
    rate: "0",
  });
  const [addOpFor, setAddOpFor] = useState<string | null>(null);
  const [editOpId, setEditOpId] = useState<string | null>(null);
  const [opForm, setOpForm] = useState({
    operation_name: "",
    smvs: "0",
    rate: "0",
  });

  useUnsavedGuard(cmtFormMode !== null || addOpFor !== null || editOpId !== null);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // CMT form helpers
  function openAddCmt() {
    setCmtForm({ style_ref_no: "", style_no: "", article_no: "", oc_no: "", order_no: "", coordinate_name: "", order_qty: "0", sq_qty: "0", rate: "0" });
    setCmtFormMode("add");
  }

  function openEditCmt(c: BudgetCmt) {
    setCmtForm({
      style_ref_no: c.style_ref_no ?? "",
      style_no: c.style_no ?? "",
      article_no: c.article_no ?? "",
      oc_no: c.oc_no ?? "",
      order_no: c.order_no ?? "",
      coordinate_name: c.coordinate_name ?? "",
      order_qty: String(c.order_qty),
      sq_qty: String(c.sq_qty),
      rate: String(c.rate),
    });
    setCmtFormMode(c.id);
  }

  function closeCmtForm() {
    setCmtFormMode(null);
  }

  // Op form helpers
  function openAddOp(cmtId: string) {
    setOpForm({ operation_name: "", smvs: "0", rate: "0" });
    setAddOpFor(cmtId);
    setEditOpId(null);
  }

  function openEditOp(op: BudgetCmtOperation) {
    setOpForm({
      operation_name: op.operation_name ?? "",
      smvs: String(op.smvs),
      rate: String(op.rate),
    });
    setEditOpId(op.id);
    setAddOpFor(null);
  }

  function closeOpForm() {
    setAddOpFor(null);
    setEditOpId(null);
  }

  const editingCmt =
    cmtFormMode && cmtFormMode !== "add" ? cmts.find((c) => c.id === cmtFormMode) : undefined;

  const cmtColumns: Column<CmtWithOps>[] = [
    { header: "S No", cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Style Ref", cell: (r) => <span className="text-sm">{r.style_ref_no ?? "--"}</span> },
    { header: "Style No", cell: (r) => <span className="text-sm">{r.style_no ?? "--"}</span> },
    { header: "Article No", cell: (r) => <span className="text-sm">{r.article_no ?? "--"}</span> },
    { header: "OC No", cell: (r) => <span className="text-sm">{r.oc_no ?? "--"}</span> },
    { header: "Order No", cell: (r) => <span className="text-sm">{r.order_no ?? "--"}</span> },
    { header: "Coordinate", cell: (r) => <span className="text-sm">{r.coordinate_name ?? "--"}</span> },
    { header: "Order Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.order_qty)}</span> },
    { header: "SQ Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.sq_qty)}</span> },
    { header: "Rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span> },
    { header: "Ops", cell: (r) => <span className="tabular-nums text-sm">{r.operations.length}</span> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => toggleExpand(r.id)}>
            {expandedIds.has(r.id) ? "Hide" : "Details"}
          </Button>
          {canMutate && (
            <>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => (cmtFormMode === r.id ? closeCmtForm() : openEditCmt(r))}>
                {cmtFormMode === r.id ? "Cancel" : "Edit"}
              </Button>
              <Button size="sm" variant="ghost" className="text-danger hover:text-danger" disabled={isPending} onClick={() => onDeleteCmt(r.id)}>
                Delete
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const opColumns: Column<BudgetCmtOperation>[] = [
    { header: "S No", cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Operation", cell: (r) => <span className="text-sm">{r.operation_name ?? "--"}</span> },
    { header: "SMVs", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.smvs)}</span> },
    { header: "Rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: BudgetCmtOperation) => (
              <div className="flex items-center justify-end gap-1">
                <Button size="sm" variant="ghost" disabled={isPending} onClick={() => (editOpId === r.id ? closeOpForm() : openEditOp(r))}>
                  {editOpId === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button size="sm" variant="ghost" className="text-danger hover:text-danger" disabled={isPending} onClick={() => onDeleteOp(r.id)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const opFormUI = (cmtId: string, cmt: CmtWithOps, isAdd: boolean) => (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {isAdd ? "Add operation" : "Edit operation"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label>Operation Name</Label>
          <Input value={opForm.operation_name} onChange={(e) => setOpForm((f) => ({ ...f, operation_name: e.target.value }))} />
        </div>
        <div>
          <Label>SMVs</Label>
          <Input type="number" min="0" step="0.0001" value={opForm.smvs} onChange={(e) => setOpForm((f) => ({ ...f, smvs: e.target.value }))} />
        </div>
        <div>
          <Label>Rate</Label>
          <Input type="number" min="0" step="0.01" value={opForm.rate} onChange={(e) => setOpForm((f) => ({ ...f, rate: e.target.value }))} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={closeOpForm}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            const payload = {
              cmt_id: cmtId,
              sno: isAdd ? cmt.operations.length + 1 : 0,
              operation_name: opForm.operation_name.trim() || null,
              smvs: parseFloat(opForm.smvs) || 0,
              rate: parseFloat(opForm.rate) || 0,
              sort_order: isAdd ? cmt.operations.length : 0,
            };
            if (isAdd) onAddOp(cmtId, payload);
            else if (editOpId) onUpdateOp(editOpId, payload);
            closeOpForm();
          }}
        >
          {isPending ? "Saving..." : isAdd ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>CMTs ({cmts.length})</CardTitle>
        {canMutate && cmtFormMode !== "add" && (
          <Button size="sm" onClick={openAddCmt}>
            + Add CMT
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable columns={cmtColumns} rows={cmts} getKey={(r) => r.id} empty="No CMTs yet." />

        {/* CMT add/edit form */}
        {cmtFormMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">
              {cmtFormMode === "add" ? "Add CMT" : "Edit CMT"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>Style Ref</Label>
                <Input value={cmtForm.style_ref_no} onChange={(e) => setCmtForm((f) => ({ ...f, style_ref_no: e.target.value }))} />
              </div>
              <div>
                <Label>Style No</Label>
                <Input value={cmtForm.style_no} onChange={(e) => setCmtForm((f) => ({ ...f, style_no: e.target.value }))} />
              </div>
              <div>
                <Label>Article No</Label>
                <Input value={cmtForm.article_no} onChange={(e) => setCmtForm((f) => ({ ...f, article_no: e.target.value }))} />
              </div>
              <div>
                <Label>OC No</Label>
                <Input value={cmtForm.oc_no} onChange={(e) => setCmtForm((f) => ({ ...f, oc_no: e.target.value }))} />
              </div>
              <div>
                <Label>Order No</Label>
                <Input value={cmtForm.order_no} onChange={(e) => setCmtForm((f) => ({ ...f, order_no: e.target.value }))} />
              </div>
              <div>
                <Label>Coordinate</Label>
                <Input value={cmtForm.coordinate_name} onChange={(e) => setCmtForm((f) => ({ ...f, coordinate_name: e.target.value }))} />
              </div>
              <div>
                <Label>Order Qty</Label>
                <Input type="number" min="0" step="0.001" value={cmtForm.order_qty} onChange={(e) => setCmtForm((f) => ({ ...f, order_qty: e.target.value }))} />
              </div>
              <div>
                <Label>SQ Qty</Label>
                <Input type="number" min="0" step="0.001" value={cmtForm.sq_qty} onChange={(e) => setCmtForm((f) => ({ ...f, sq_qty: e.target.value }))} />
              </div>
              <div>
                <Label>Rate</Label>
                <Input type="number" min="0" step="0.01" value={cmtForm.rate} onChange={(e) => setCmtForm((f) => ({ ...f, rate: e.target.value }))} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeCmtForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const payload = {
                    budget_id: budgetId,
                    sno: cmtFormMode === "add" ? cmts.length + 1 : editingCmt?.sno ?? 0,
                    style_ref_no: cmtForm.style_ref_no.trim() || null,
                    style_no: cmtForm.style_no.trim() || null,
                    article_no: cmtForm.article_no.trim() || null,
                    oc_no: cmtForm.oc_no.trim() || null,
                    order_no: cmtForm.order_no.trim() || null,
                    coordinate_name: cmtForm.coordinate_name.trim() || null,
                    order_qty: parseFloat(cmtForm.order_qty) || 0,
                    sq_qty: parseFloat(cmtForm.sq_qty) || 0,
                    rate: parseFloat(cmtForm.rate) || 0,
                    sort_order: cmtFormMode === "add" ? cmts.length : (editingCmt?.sort_order ?? 0),
                  };
                  if (cmtFormMode === "add") onAddCmt(payload);
                  else if (editingCmt) onUpdateCmt(editingCmt.id, payload);
                  closeCmtForm();
                }}
              >
                {isPending ? "Saving..." : cmtFormMode === "add" ? "Add" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {/* Expanded child operations */}
        {cmts
          .filter((c) => expandedIds.has(c.id))
          .map((cmt) => (
            <div key={`ops-${cmt.id}`} className="ml-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  Operations for: {cmt.style_ref_no ?? `CMT ${cmt.sno}`}
                </p>
                {canMutate && addOpFor !== cmt.id && (
                  <Button size="sm" variant="outline" onClick={() => openAddOp(cmt.id)}>
                    + Add operation
                  </Button>
                )}
              </div>
              <DataTable columns={opColumns} rows={cmt.operations} getKey={(r) => r.id} />
              {editOpId && cmt.operations.some((op) => op.id === editOpId) && opFormUI(cmt.id, cmt, false)}
              {addOpFor === cmt.id && opFormUI(cmt.id, cmt, true)}
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// Other Entries Section (Tab 4 & 5 — Expenses / Incomes)
// ============================================================================

function OtherEntriesSection({
  title,
  entryType,
  rows,
  budgetId,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  title: string;
  entryType: OtherEntryType;
  rows: BudgetOtherEntry[];
  budgetId: string;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (itemId: string, data: Record<string, unknown>) => void;
  onDelete: (itemId: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState({
    cost_description: "",
    description: "",
    type_for: "",
    rate_type: "",
    qty: "0",
    rate: "0",
  });

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm({ cost_description: "", description: "", type_for: "", rate_type: "", qty: "0", rate: "0" });
    setFormMode("add");
  }

  function openEdit(e: BudgetOtherEntry) {
    setForm({
      cost_description: e.cost_description ?? "",
      description: e.description ?? "",
      type_for: e.type_for ?? "",
      rate_type: e.rate_type ?? "",
      qty: String(e.qty),
      rate: String(e.rate),
    });
    setFormMode(e.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingItem = formMode && formMode !== "add" ? rows.find((r) => r.id === formMode) : undefined;

  const columns: Column<BudgetOtherEntry>[] = [
    { header: "S No", cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Cost Description", cell: (r) => <span className="text-sm">{r.cost_description ?? "--"}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description ?? "--"}</span> },
    { header: "Type For", cell: (r) => <span className="text-sm">{r.type_for ?? "--"}</span> },
    { header: "Rate Type", cell: (r) => <span className="text-sm">{r.rate_type ?? "--"}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span> },
    { header: "Rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span> },
    { header: "Cost", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtMoney(r.cost)}</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: BudgetOtherEntry) => (
              <div className="flex items-center justify-end gap-1">
                <Button size="sm" variant="ghost" disabled={isPending} onClick={() => (formMode === r.id ? closeForm() : openEdit(r))}>
                  {formMode === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button size="sm" variant="ghost" className="text-danger hover:text-danger" disabled={isPending} onClick={() => onDelete(r.id)}>
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
        <CardTitle>
          {title} ({rows.length})
        </CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty={`No ${title.toLowerCase()} yet.`} />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? `Add ${title.toLowerCase()}` : `Edit ${title.toLowerCase()}`}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>Cost Description</Label>
                <Input value={form.cost_description} onChange={(e) => setForm((f) => ({ ...f, cost_description: e.target.value }))} />
              </div>
              <div>
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <Label>Type For</Label>
                <Input value={form.type_for} onChange={(e) => setForm((f) => ({ ...f, type_for: e.target.value }))} />
              </div>
              <div>
                <Label>Rate Type</Label>
                <Input value={form.rate_type} onChange={(e) => setForm((f) => ({ ...f, rate_type: e.target.value }))} />
              </div>
              <div>
                <Label>Qty</Label>
                <Input type="number" min="0" step="0.001" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} />
              </div>
              <div>
                <Label>Rate</Label>
                <Input type="number" min="0" step="0.01" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const qty = parseFloat(form.qty) || 0;
                  const rate = parseFloat(form.rate) || 0;
                  const payload = {
                    budget_id: budgetId,
                    entry_type: entryType,
                    sno: formMode === "add" ? rows.length + 1 : editingItem?.sno ?? 0,
                    cost_description: form.cost_description.trim() || null,
                    description: form.description.trim() || null,
                    type_for: form.type_for.trim() || null,
                    rate_type: form.rate_type.trim() || null,
                    qty,
                    rate,
                    cost: qty * rate,
                    sort_order: formMode === "add" ? rows.length : (editingItem?.sort_order ?? 0),
                  };
                  if (formMode === "add") onAdd(payload);
                  else if (editingItem) onUpdate(editingItem.id, payload);
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

// ============================================================================
// General Tab (Tab 6 — Heads + Styles read-only)
// ============================================================================

function GeneralTab({
  heads,
  styles,
}: {
  heads: BudgetHead[];
  styles: BudgetStyle[];
}) {
  const headColumns: Column<BudgetHead>[] = [
    { header: "S No", cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Cost Description", cell: (r) => <span className="text-sm">{r.cost_description ?? "--"}</span> },
    { header: "Cost", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtMoney(r.cost)}</span> },
    { header: "Contribution %", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.contribution_pct)}%</span> },
    { header: "Cost/Garment", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.cost_per_garment)}</span> },
  ];

  const styleColumns: Column<BudgetStyle>[] = [
    { header: "S No", cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Style Ref", cell: (r) => <span className="text-sm">{r.style_ref_no ?? "--"}</span> },
    { header: "Style No", cell: (r) => <span className="text-sm">{r.style_no ?? "--"}</span> },
    { header: "Article No", cell: (r) => <span className="text-sm">{r.article_no ?? "--"}</span> },
    { header: "Order Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.order_qty)}</span> },
    { header: "Revenue", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.revenue)}</span> },
    { header: "Expenses", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.expenses_total)}</span> },
    { header: "P/L", align: "right", cell: (r) => <span className={`tabular-nums text-sm font-semibold ${r.profit_loss < 0 ? "text-danger" : "text-success"}`}>{fmtMoney(r.profit_loss)}</span> },
    { header: "P/L %", align: "right", cell: (r) => <span className={`tabular-nums text-sm ${r.profit_loss_pct < 0 ? "text-danger" : "text-success"}`}>{fmtNumber(r.profit_loss_pct)}%</span> },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cost Heads ({heads.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable columns={headColumns} rows={heads} getKey={(r) => r.id} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Styles P&L ({styles.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable columns={styleColumns} rows={styles} getKey={(r) => r.id} />
        </CardBody>
      </Card>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function BudgetDetail({
  budget,
  canEdit,
  canDelete,
  canApprove,
}: {
  budget: BudgetDetailType;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = budget.status === "draft";
  const isSubmitted = budget.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  // ---------- Workflow handlers ----------

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitBudget(budget.id);
      if (result.ok) success("Submitted for approval.");
      else toastError(result.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveBudget(budget.id);
      if (result.ok) success("Budget approved.");
      else toastError(result.error);
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectBudget(budget.id);
      if (result.ok) success("Budget rejected.");
      else toastError(result.error);
    });
  }

  // ---------- Purchase handlers ----------

  function handleAddPurchase(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addBudgetPurchase(data as never);
      if (result.ok) success("Purchase added.");
      else toastError(result.error);
    });
  }

  function handleUpdatePurchase(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateBudgetPurchase(itemId, budget.id, data as never);
      if (result.ok) success("Purchase updated.");
      else toastError(result.error);
    });
  }

  function handleDeletePurchase(itemId: string) {
    startTransition(async () => {
      const result = await deleteBudgetPurchase(itemId, budget.id);
      if (result.ok) success("Purchase deleted.");
      else toastError(result.error);
    });
  }

  // ---------- Process handlers ----------

  function handleAddProcess(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addBudgetProcess(data as never);
      if (result.ok) success("Process added.");
      else toastError(result.error);
    });
  }

  function handleDeleteProcess(itemId: string) {
    startTransition(async () => {
      const result = await deleteBudgetProcess(itemId, budget.id);
      if (result.ok) success("Process deleted.");
      else toastError(result.error);
    });
  }

  function handleAddProcessItem(processId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addBudgetProcessItem(data as never, budget.id);
      if (result.ok) success("Process item added.");
      else toastError(result.error);
    });
  }

  function handleUpdateProcessItem(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateBudgetProcessItem(itemId, budget.id, data as never);
      if (result.ok) success("Process item updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteProcessItem(itemId: string) {
    startTransition(async () => {
      const result = await deleteBudgetProcessItem(itemId, budget.id);
      if (result.ok) success("Process item deleted.");
      else toastError(result.error);
    });
  }

  // ---------- CMT handlers ----------

  function handleAddCmt(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addBudgetCmt(data as never);
      if (result.ok) success("CMT added.");
      else toastError(result.error);
    });
  }

  function handleUpdateCmt(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateBudgetCmt(itemId, budget.id, data as never);
      if (result.ok) success("CMT updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteCmt(itemId: string) {
    startTransition(async () => {
      const result = await deleteBudgetCmt(itemId, budget.id);
      if (result.ok) success("CMT deleted.");
      else toastError(result.error);
    });
  }

  function handleAddCmtOp(cmtId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addBudgetCmtOperation(data as never, budget.id);
      if (result.ok) success("Operation added.");
      else toastError(result.error);
    });
  }

  function handleUpdateCmtOp(opId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateBudgetCmtOperation(opId, budget.id, data as never);
      if (result.ok) success("Operation updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteCmtOp(opId: string) {
    startTransition(async () => {
      const result = await deleteBudgetCmtOperation(opId, budget.id);
      if (result.ok) success("Operation deleted.");
      else toastError(result.error);
    });
  }

  // ---------- Other entries handlers ----------

  function handleAddOtherEntry(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addBudgetOtherEntry(data as never);
      if (result.ok) success("Entry added.");
      else toastError(result.error);
    });
  }

  function handleUpdateOtherEntry(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateBudgetOtherEntry(itemId, budget.id, data as never);
      if (result.ok) success("Entry updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteOtherEntry(itemId: string) {
    startTransition(async () => {
      const result = await deleteBudgetOtherEntry(itemId, budget.id);
      if (result.ok) success("Entry deleted.");
      else toastError(result.error);
    });
  }

  // ---------- Tab 1: Purchase Rates ----------

  const purchaseRatesTab = (
    <div className="space-y-6">
      <PurchaseSection
        title="Yarn"
        purchaseType="yarn"
        rows={budget.purchases_yarn}
        budgetId={budget.id}
        canMutate={canMutate}
        isPending={isPending}
        onAdd={handleAddPurchase}
        onUpdate={handleUpdatePurchase}
        onDelete={handleDeletePurchase}
      />
      <PurchaseSection
        title="Fabric"
        purchaseType="fabric"
        rows={budget.purchases_fabric}
        budgetId={budget.id}
        canMutate={canMutate}
        isPending={isPending}
        onAdd={handleAddPurchase}
        onUpdate={handleUpdatePurchase}
        onDelete={handleDeletePurchase}
      />
      <PurchaseSection
        title="Accessories"
        purchaseType="accessories"
        rows={budget.purchases_accessories}
        budgetId={budget.id}
        canMutate={canMutate}
        isPending={isPending}
        onAdd={handleAddPurchase}
        onUpdate={handleUpdatePurchase}
        onDelete={handleDeletePurchase}
      />
    </div>
  );

  // ---------- Tab 2: Process Rates ----------

  const processRatesTab = (
    <div className="space-y-6">
      <ProcessSection
        title="Yarn"
        processType="yarn"
        rows={budget.processes_yarn}
        budgetId={budget.id}
        canMutate={canMutate}
        isPending={isPending}
        onAddProcess={handleAddProcess}
        onDeleteProcess={handleDeleteProcess}
        onAddItem={handleAddProcessItem}
        onUpdateItem={handleUpdateProcessItem}
        onDeleteItem={handleDeleteProcessItem}
      />
      <ProcessSection
        title="Fabric"
        processType="fabric"
        rows={budget.processes_fabric}
        budgetId={budget.id}
        canMutate={canMutate}
        isPending={isPending}
        onAddProcess={handleAddProcess}
        onDeleteProcess={handleDeleteProcess}
        onAddItem={handleAddProcessItem}
        onUpdateItem={handleUpdateProcessItem}
        onDeleteItem={handleDeleteProcessItem}
      />
      <ProcessSection
        title="Accessories"
        processType="accessories"
        rows={budget.processes_accessories}
        budgetId={budget.id}
        canMutate={canMutate}
        isPending={isPending}
        onAddProcess={handleAddProcess}
        onDeleteProcess={handleDeleteProcess}
        onAddItem={handleAddProcessItem}
        onUpdateItem={handleUpdateProcessItem}
        onDeleteItem={handleDeleteProcessItem}
      />
      <ProcessSection
        title="Garment"
        processType="garment"
        rows={budget.processes_garment}
        budgetId={budget.id}
        canMutate={canMutate}
        isPending={isPending}
        onAddProcess={handleAddProcess}
        onDeleteProcess={handleDeleteProcess}
        onAddItem={handleAddProcessItem}
        onUpdateItem={handleUpdateProcessItem}
        onDeleteItem={handleDeleteProcessItem}
      />
    </div>
  );

  // ---------- Tab 3: CMTs ----------

  const cmtsTab = (
    <CmtSection
      cmts={budget.cmts}
      budgetId={budget.id}
      canMutate={canMutate}
      isPending={isPending}
      onAddCmt={handleAddCmt}
      onUpdateCmt={handleUpdateCmt}
      onDeleteCmt={handleDeleteCmt}
      onAddOp={handleAddCmtOp}
      onUpdateOp={handleUpdateCmtOp}
      onDeleteOp={handleDeleteCmtOp}
    />
  );

  // ---------- Tab 4: Other Expenses ----------

  const otherExpensesTab = (
    <OtherEntriesSection
      title="Other Expenses"
      entryType="expense"
      rows={budget.other_expenses}
      budgetId={budget.id}
      canMutate={canMutate}
      isPending={isPending}
      onAdd={handleAddOtherEntry}
      onUpdate={handleUpdateOtherEntry}
      onDelete={handleDeleteOtherEntry}
    />
  );

  // ---------- Tab 5: Other Incomes ----------

  const otherIncomesTab = (
    <OtherEntriesSection
      title="Other Incomes"
      entryType="income"
      rows={budget.other_incomes}
      budgetId={budget.id}
      canMutate={canMutate}
      isPending={isPending}
      onAdd={handleAddOtherEntry}
      onUpdate={handleUpdateOtherEntry}
      onDelete={handleDeleteOtherEntry}
    />
  );

  // ---------- Tab 6: General ----------

  const generalTab = (
    <GeneralTab heads={budget.heads} styles={budget.styles} />
  );

  // ---------- render ----------

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Entry No</dt>
              <dd className="font-medium">{budget.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Type</dt>
              <dd>{BUDGET_TYPE_LABELS[budget.budget_type] ?? budget.budget_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Entry Type</dt>
              <dd>{BUDGET_ENTRY_TYPE_LABELS[budget.entry_type] ?? budget.entry_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group No</dt>
              <dd>{budget.group_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{budget.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group Description</dt>
              <dd>{budget.group_description ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">SQ Qty</dt>
              <dd className="tabular-nums">{fmtNumber(budget.sq_qty)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Currency</dt>
              <dd>{budget.currency_code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Exchange Rate</dt>
              <dd className="tabular-nums">{fmtNumber(budget.exchange_rate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">SMV Rate</dt>
              <dd className="tabular-nums">{fmtMoney(budget.smv_rate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sales Value</dt>
              <dd className="tabular-nums font-semibold">{fmtMoney(budget.sales_value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total Expense</dt>
              <dd className="tabular-nums">{fmtMoney(budget.total_expense)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Profit/Loss</dt>
              <dd className={`tabular-nums font-semibold ${budget.profit_loss_value < 0 ? "text-danger" : "text-success"}`}>
                {fmtMoney(budget.profit_loss_value)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">P/L %</dt>
              <dd className={`tabular-nums ${budget.profit_loss_pct < 0 ? "text-danger" : "text-success"}`}>
                {fmtNumber(budget.profit_loss_pct)}%
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={budgetStatusTone(budget.status)}>
                  {BUDGET_STATUS_LABELS[budget.status]}
                </StatusPill>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd>{fmtDate(budget.created_at)}</dd>
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
              <>
                <Button disabled={isPending} onClick={handleApprove}>
                  {isPending ? "Approving..." : "Approve"}
                </Button>
                <Button variant="outline" disabled={isPending} onClick={handleReject}>
                  {isPending ? "Rejecting..." : "Reject"}
                </Button>
              </>
            )}

            {isSubmitted && !canApprove && (
              <p className="text-sm text-muted-foreground">
                Awaiting approval by an authorised reviewer.
              </p>
            )}

            {budget.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{budget.approved_at ? ` on ${fmtDate(budget.approved_at)}` : ""}.
              </p>
            )}

            {budget.status === "rejected" && (
              <p className="text-sm text-danger">Budget was rejected.</p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Tabs — 6 tabs matching FrmSQBudget */}
      <Tabs
        items={[
          { key: "purchase_rates", label: "Purchase Rates", content: purchaseRatesTab },
          { key: "process_rates", label: "Process Rates", content: processRatesTab },
          { key: "cmts", label: "CMTs", content: cmtsTab },
          { key: "other_expenses", label: "Other Expenses", content: otherExpensesTab },
          { key: "other_incomes", label: "Other Incomes", content: otherIncomesTab },
          { key: "general", label: "General", content: generalTab },
        ]}
      />
    </div>
  );
}
