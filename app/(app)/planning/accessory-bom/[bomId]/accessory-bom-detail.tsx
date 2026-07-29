"use client";

import { useState, useTransition } from "react";
import {
  submitAccessoryBom,
  approveAccessoryBom,
  addAccessoryBomItem,
  updateAccessoryBomItem,
  deleteAccessoryBomItem,
  addAccessoryBomConsumption,
  deleteAccessoryBomConsumption,
  addAccessoryBomConsumptionSize,
  deleteAccessoryBomConsumptionSize,
  addAccessoryBomProcess,
  deleteAccessoryBomProcess,
  addAccessoryBomProcessStage,
  updateAccessoryBomProcessStage,
  deleteAccessoryBomProcessStage,
} from "@/lib/planning/bom-detail-actions";
import type { BomStatus, BomForType, SupplyType } from "@/lib/planning/bom-types";
import {
  BOM_FOR_TYPES,
  BOM_FOR_TYPE_LABELS,
  SUPPLY_TYPES,
  SUPPLY_TYPE_LABELS,
} from "@/lib/planning/bom-types";
import type { AccessoryBomDetail as BomDetail } from "@/lib/planning/bom-detail-service";
import type {
  AccessoryBomItem,
  AccessoryBomConsumption,
  AccessoryBomConsumptionSize,
  AccessoryBomProcess,
  AccessoryBomProcessStage,
} from "@/lib/planning/bom-detail-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

// ---------- helpers ----------

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

const PROCESS_STAGE_OPTIONS = ["grey", "dyed", "print", "wash"] as const;

// ============================================================================
// Tab 1: Items
// ============================================================================

function ItemsTab({
  bom,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  bom: BomDetail;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState({
    bom_for: "",
    supply_type: "",
    moq: "0",
    is_approval_required: false,
    specifications: "",
  });

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm({ bom_for: "", supply_type: "", moq: "0", is_approval_required: false, specifications: "" });
    setFormMode("add");
  }

  function openEdit(item: AccessoryBomItem) {
    setForm({
      bom_for: item.bom_for ?? "",
      supply_type: item.supply_type ?? "",
      moq: String(item.moq ?? 0),
      is_approval_required: item.is_approval_required,
      specifications: item.specifications ?? "",
    });
    setFormMode(item.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const columns: Column<AccessoryBomItem>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Category",
      cell: (r) => <span className="text-sm">{r.category_id ? r.category_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "Item",
      cell: (r) => <span className="text-sm">{r.item_id ? r.item_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "BOM For",
      cell: (r) => (
        <span className="text-sm">
          {r.bom_for ? (BOM_FOR_TYPE_LABELS[r.bom_for as BomForType] ?? r.bom_for) : "--"}
        </span>
      ),
    },
    {
      header: "Supply Type",
      cell: (r) => (
        <span className="text-sm">
          {r.supply_type ? (SUPPLY_TYPE_LABELS[r.supply_type as SupplyType] ?? r.supply_type) : "--"}
        </span>
      ),
    },
    {
      header: "Vendor",
      cell: (r) => <span className="text-sm">{r.vendor_id ? r.vendor_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "UOM",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span>,
    },
    {
      header: "MOQ",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.moq != null ? fmtNumber(r.moq) : "--"}</span>,
    },
    {
      header: "Approval",
      cell: (r) => <span className="text-sm">{r.is_approval_required ? "Yes" : "No"}</span>,
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: AccessoryBomItem) => (
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
        <CardTitle>Items ({bom.items.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add item
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={bom.items}
          getKey={(r) => r.id}
          empty="No items yet. Add one to get started."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? "Add item" : "Edit item"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>BOM For</Label>
                <Select
                  value={form.bom_for}
                  onChange={(e) => setForm((f) => ({ ...f, bom_for: e.target.value }))}
                >
                  <option value="">-- Select --</option>
                  {BOM_FOR_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {BOM_FOR_TYPE_LABELS[v]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Supply Type</Label>
                <Select
                  value={form.supply_type}
                  onChange={(e) => setForm((f) => ({ ...f, supply_type: e.target.value }))}
                >
                  <option value="">-- Select --</option>
                  {SUPPLY_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {SUPPLY_TYPE_LABELS[v]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>MOQ</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.moq}
                  onChange={(e) => setForm((f) => ({ ...f, moq: e.target.value }))}
                />
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_approval_required}
                    onChange={(e) => setForm((f) => ({ ...f, is_approval_required: e.target.checked }))}
                  />
                  Approval Required
                </label>
              </div>
              <div className="sm:col-span-2 md:col-span-4">
                <Label>Specifications</Label>
                <Input
                  value={form.specifications}
                  onChange={(e) => setForm((f) => ({ ...f, specifications: e.target.value }))}
                />
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
                  const editingItem = formMode !== "add" ? bom.items.find((i) => i.id === formMode) : undefined;
                  const payload = {
                    bom_for: form.bom_for || null,
                    supply_type: form.supply_type || null,
                    moq: parseFloat(form.moq) || null,
                    is_approval_required: form.is_approval_required,
                    specifications: form.specifications.trim() || null,
                  };
                  if (formMode === "add") {
                    onAdd({
                      sno: bom.items.length + 1,
                      ...payload,
                      sort_order: bom.items.length,
                    });
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
// Tab 2: Consumptions (parent) with Sizes (child)
// ============================================================================

function ConsumptionsTab({
  bom,
  canMutate,
  isPending,
  onAddConsumption,
  onDeleteConsumption,
  onAddSize,
  onDeleteSize,
}: {
  bom: BomDetail;
  canMutate: boolean;
  isPending: boolean;
  onAddConsumption: (itemId: string, data: Record<string, unknown>) => void;
  onDeleteConsumption: (consumptionId: string) => void;
  onAddSize: (consumptionId: string, data: Record<string, unknown>) => void;
  onDeleteSize: (sizeId: string) => void;
}) {
  const [expandedCons, setExpandedCons] = useState<Set<string>>(new Set());
  const [addSizeFor, setAddSizeFor] = useState<string | null>(null);
  const [addConsFor, setAddConsFor] = useState<string | null>(null);

  const [consForm, setConsForm] = useState({
    nos_per_pcs: "1",
    pcs_per_nos: "1",
    waste_pct: "0",
    allowance_qty: "0",
    style_ref_no: "",
    is_sizewise: false,
  });

  const [sizeForm, setSizeForm] = useState({
    garment_size: "",
    nos_per_pcs: "1",
    pcs_per_nos: "1",
    allowance_pct: "0",
    allowance_qty: "0",
  });

  useUnsavedGuard(addSizeFor !== null || addConsFor !== null);

  function toggleCons(id: string) {
    setExpandedCons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const consColumns: Column<AccessoryBomConsumption>[] = [
    {
      header: "UOM",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span>,
    },
    {
      header: "Nos/Pcs",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.nos_per_pcs)}</span>,
    },
    {
      header: "Pcs/Nos",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.pcs_per_nos)}</span>,
    },
    {
      header: "Waste %",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.waste_pct)}</span>,
    },
    {
      header: "Allowance Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.allowance_qty)}</span>,
    },
    {
      header: "Style Ref",
      cell: (r) => <span className="text-sm">{r.style_ref_no ?? "--"}</span>,
    },
    {
      header: "Sizewise",
      cell: (r) => <span className="text-sm">{r.is_sizewise ? "Yes" : "No"}</span>,
    },
    {
      header: "Sizes",
      cell: (r) => <span className="tabular-nums text-sm">{r.sizes.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => toggleCons(r.id)}>
            {expandedCons.has(r.id) ? "Hide" : "Sizes"}
          </Button>
          {canMutate && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={isPending}
              onClick={() => onDeleteConsumption(r.id)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const sizeColumns: Column<AccessoryBomConsumptionSize>[] = [
    {
      header: "Garment Size",
      cell: (r) => <span className="text-sm">{r.garment_size ?? "--"}</span>,
    },
    {
      header: "Nos/Pcs",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.nos_per_pcs)}</span>,
    },
    {
      header: "Pcs/Nos",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.pcs_per_nos)}</span>,
    },
    {
      header: "Allowance %",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.allowance_pct)}</span>,
    },
    {
      header: "Allowance Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.allowance_qty)}</span>,
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: AccessoryBomConsumptionSize) => (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={isPending}
                onClick={() => onDeleteSize(r.id)}
              >
                Delete
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consumptions ({bom.consumptions.length})</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Add consumption per item */}
        {canMutate && bom.items.length > 0 && addConsFor === null && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Add consumption for item:</span>
            {bom.items.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant="outline"
                onClick={() => {
                  setConsForm({ nos_per_pcs: "1", pcs_per_nos: "1", waste_pct: "0", allowance_qty: "0", style_ref_no: "", is_sizewise: false });
                  setAddConsFor(item.id);
                }}
              >
                Item {item.sno}
              </Button>
            ))}
          </div>
        )}

        {addConsFor !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">Add consumption</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <div>
                <Label>Nos/Pcs</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={consForm.nos_per_pcs}
                  onChange={(e) => setConsForm((f) => ({ ...f, nos_per_pcs: e.target.value }))}
                />
              </div>
              <div>
                <Label>Pcs/Nos</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={consForm.pcs_per_nos}
                  onChange={(e) => setConsForm((f) => ({ ...f, pcs_per_nos: e.target.value }))}
                />
              </div>
              <div>
                <Label>Waste %</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={consForm.waste_pct}
                  onChange={(e) => setConsForm((f) => ({ ...f, waste_pct: e.target.value }))}
                />
              </div>
              <div>
                <Label>Allowance Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={consForm.allowance_qty}
                  onChange={(e) => setConsForm((f) => ({ ...f, allowance_qty: e.target.value }))}
                />
              </div>
              <div>
                <Label>Style Ref</Label>
                <Input
                  value={consForm.style_ref_no}
                  onChange={(e) => setConsForm((f) => ({ ...f, style_ref_no: e.target.value }))}
                />
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={consForm.is_sizewise}
                    onChange={(e) => setConsForm((f) => ({ ...f, is_sizewise: e.target.checked }))}
                  />
                  Sizewise
                </label>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setAddConsFor(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  onAddConsumption(addConsFor, {
                    sno: bom.consumptions.filter((c) => c.item_id === addConsFor).length + 1,
                    nos_per_pcs: parseFloat(consForm.nos_per_pcs) || 1,
                    pcs_per_nos: parseFloat(consForm.pcs_per_nos) || 1,
                    waste_pct: parseFloat(consForm.waste_pct) || 0,
                    allowance_qty: parseFloat(consForm.allowance_qty) || 0,
                    style_ref_no: consForm.style_ref_no.trim() || null,
                    is_sizewise: consForm.is_sizewise,
                    sort_order: bom.consumptions.length,
                  });
                  setAddConsFor(null);
                }}
              >
                {isPending ? "Saving..." : "Add"}
              </Button>
            </div>
          </div>
        )}

        <DataTable
          columns={consColumns}
          rows={bom.consumptions}
          getKey={(r) => r.id}
          empty="No consumptions yet."
        />

        {/* Expanded sizes */}
        {bom.consumptions
          .filter((c) => expandedCons.has(c.id))
          .map((cons) => (
            <div key={`child-${cons.id}`} className="ml-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  Sizes for: Consumption {cons.sno}
                </p>
                {canMutate && addSizeFor !== cons.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSizeForm({ garment_size: "", nos_per_pcs: "1", pcs_per_nos: "1", allowance_pct: "0", allowance_qty: "0" });
                      setAddSizeFor(cons.id);
                    }}
                  >
                    + Add size
                  </Button>
                )}
              </div>

              <DataTable
                columns={sizeColumns}
                rows={cons.sizes}
                getKey={(r) => r.id}
                empty="No sizes."
              />

              {addSizeFor === cons.id && (
                <div className="rounded-md border border-border bg-surface-muted p-4">
                  <p className="mb-3 text-xs font-semibold text-muted-foreground">Add size</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                    <div>
                      <Label>Garment Size</Label>
                      <Input
                        value={sizeForm.garment_size}
                        onChange={(e) => setSizeForm((f) => ({ ...f, garment_size: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Nos/Pcs</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={sizeForm.nos_per_pcs}
                        onChange={(e) => setSizeForm((f) => ({ ...f, nos_per_pcs: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Pcs/Nos</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={sizeForm.pcs_per_nos}
                        onChange={(e) => setSizeForm((f) => ({ ...f, pcs_per_nos: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Allowance %</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={sizeForm.allowance_pct}
                        onChange={(e) => setSizeForm((f) => ({ ...f, allowance_pct: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Allowance Qty</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={sizeForm.allowance_qty}
                        onChange={(e) => setSizeForm((f) => ({ ...f, allowance_qty: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAddSizeFor(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => {
                        onAddSize(cons.id, {
                          sno: cons.sizes.length + 1,
                          garment_size: sizeForm.garment_size.trim() || null,
                          nos_per_pcs: parseFloat(sizeForm.nos_per_pcs) || 1,
                          pcs_per_nos: parseFloat(sizeForm.pcs_per_nos) || 1,
                          allowance_pct: parseFloat(sizeForm.allowance_pct) || 0,
                          allowance_qty: parseFloat(sizeForm.allowance_qty) || 0,
                          sort_order: cons.sizes.length,
                        });
                        setAddSizeFor(null);
                      }}
                    >
                      {isPending ? "Saving..." : "Add"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// Tab 3: Processes (parent) with Stages (child)
// ============================================================================

function ProcessesTab({
  bom,
  canMutate,
  isPending,
  onAddProcess,
  onDeleteProcess,
  onAddStage,
  onUpdateStage,
  onDeleteStage,
}: {
  bom: BomDetail;
  canMutate: boolean;
  isPending: boolean;
  onAddProcess: (data: Record<string, unknown>) => void;
  onDeleteProcess: (id: string) => void;
  onAddStage: (processId: string, data: Record<string, unknown>) => void;
  onUpdateStage: (stageId: string, data: Record<string, unknown>) => void;
  onDeleteStage: (stageId: string) => void;
}) {
  const [expandedProcs, setExpandedProcs] = useState<Set<string>>(new Set());
  const [addStageFor, setAddStageFor] = useState<string | null>(null);
  const [editStageId, setEditStageId] = useState<string | null>(null);
  const [stageForm, setStageForm] = useState({
    stage: "",
    process_name: "",
    loss_for: "",
    loss_pct: "0",
    description: "",
  });

  useUnsavedGuard(addStageFor !== null || editStageId !== null);

  function toggleProc(id: string) {
    setExpandedProcs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAddStage(procId: string) {
    setStageForm({ stage: "", process_name: "", loss_for: "", loss_pct: "0", description: "" });
    setAddStageFor(procId);
    setEditStageId(null);
  }

  function openEditStage(s: AccessoryBomProcessStage) {
    setStageForm({
      stage: s.stage ?? "",
      process_name: s.process_name ?? "",
      loss_for: s.loss_for ?? "",
      loss_pct: String(s.loss_pct),
      description: s.description ?? "",
    });
    setEditStageId(s.id);
    setAddStageFor(null);
  }

  function closeStageForm() {
    setAddStageFor(null);
    setEditStageId(null);
  }

  const procColumns: Column<AccessoryBomProcess>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Item",
      cell: (r) => <span className="text-sm">{r.item_id ? r.item_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "Stages",
      cell: (r) => <span className="tabular-nums text-sm">{r.stages.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => toggleProc(r.id)}>
            {expandedProcs.has(r.id) ? "Hide" : "Details"}
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

  const stageColumns: Column<AccessoryBomProcessStage>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Stage",
      cell: (r) => <span className="text-sm uppercase">{r.stage ?? "--"}</span>,
    },
    {
      header: "Process",
      cell: (r) => <span className="text-sm">{r.process_name ?? "--"}</span>,
    },
    {
      header: "Loss For",
      cell: (r) => <span className="text-sm">{r.loss_for ?? "--"}</span>,
    },
    {
      header: "Loss %",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.loss_pct)}</span>,
    },
    {
      header: "Description",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {r.description ?? "--"}
        </span>
      ),
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: AccessoryBomProcessStage) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => (editStageId === r.id ? closeStageForm() : openEditStage(r))}
                >
                  {editStageId === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  disabled={isPending}
                  onClick={() => onDeleteStage(r.id)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const stageFormUI = (procId: string, proc: AccessoryBomProcess, isAdd: boolean) => (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {isAdd ? "Add stage" : "Edit stage"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <Label>Stage</Label>
          <Select
            value={stageForm.stage}
            onChange={(e) => setStageForm((f) => ({ ...f, stage: e.target.value }))}
          >
            <option value="">-- Select --</option>
            {PROCESS_STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase()}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Process</Label>
          <Input
            value={stageForm.process_name}
            onChange={(e) => setStageForm((f) => ({ ...f, process_name: e.target.value }))}
          />
        </div>
        <div>
          <Label>Loss For</Label>
          <Input
            value={stageForm.loss_for}
            onChange={(e) => setStageForm((f) => ({ ...f, loss_for: e.target.value }))}
          />
        </div>
        <div>
          <Label>Loss %</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={stageForm.loss_pct}
            onChange={(e) => setStageForm((f) => ({ ...f, loss_pct: e.target.value }))}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Description</Label>
          <Input
            value={stageForm.description}
            onChange={(e) => setStageForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={closeStageForm}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            const payload = {
              stage: stageForm.stage || null,
              process_name: stageForm.process_name.trim() || null,
              loss_for: stageForm.loss_for.trim() || null,
              loss_pct: parseFloat(stageForm.loss_pct) || 0,
              description: stageForm.description.trim() || null,
            };
            if (isAdd) {
              onAddStage(procId, {
                sno: proc.stages.length + 1,
                ...payload,
                sort_order: proc.stages.length,
              });
            } else if (editStageId) {
              onUpdateStage(editStageId, payload);
            }
            closeStageForm();
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
        <CardTitle>Processes ({bom.processes.length})</CardTitle>
        {canMutate && (
          <Button
            size="sm"
            onClick={() =>
              onAddProcess({
                sno: bom.processes.length + 1,
                sort_order: bom.processes.length,
              })
            }
          >
            + Add process
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={procColumns}
          rows={bom.processes}
          getKey={(r) => r.id}
          empty="No processes yet."
        />

        {bom.processes
          .filter((p) => expandedProcs.has(p.id))
          .map((proc) => (
            <div key={`child-${proc.id}`} className="ml-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  Stages for: Process {proc.sno}
                </p>
                {canMutate && addStageFor !== proc.id && (
                  <Button size="sm" variant="outline" onClick={() => openAddStage(proc.id)}>
                    + Add stage
                  </Button>
                )}
              </div>

              <DataTable
                columns={stageColumns}
                rows={proc.stages}
                getKey={(r) => r.id}
                empty="No stages."
              />

              {editStageId &&
                proc.stages.some((s) => s.id === editStageId) &&
                stageFormUI(proc.id, proc, false)}

              {addStageFor === proc.id && stageFormUI(proc.id, proc, true)}
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function AccessoryBomDetail({
  bom,
  canEdit,
  canDelete,
  canApprove,
}: {
  bom: BomDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = bom.status === "draft";
  const isSubmitted = bom.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  // --- Workflow ---
  function handleSubmit() {
    startTransition(async () => {
      const result = await submitAccessoryBom(bom.id);
      if (result.ok) success("Submitted for approval.");
      else toastError(result.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveAccessoryBom(bom.id);
      if (result.ok) success("Accessory BOM approved.");
      else toastError(result.error);
    });
  }

  // --- Items ---
  function handleAddItem(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addAccessoryBomItem(bom.id, data as never);
      if (result.ok) success("Item added.");
      else toastError(result.error);
    });
  }

  function handleUpdateItem(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateAccessoryBomItem(id, bom.id, data as never);
      if (result.ok) success("Item updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteItem(id: string) {
    startTransition(async () => {
      const result = await deleteAccessoryBomItem(id, bom.id);
      if (result.ok) success("Item deleted.");
      else toastError(result.error);
    });
  }

  // --- Consumptions ---
  function handleAddConsumption(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addAccessoryBomConsumption(itemId, bom.id, data as never);
      if (result.ok) success("Consumption added.");
      else toastError(result.error);
    });
  }

  function handleDeleteConsumption(consumptionId: string) {
    startTransition(async () => {
      const result = await deleteAccessoryBomConsumption(consumptionId, bom.id);
      if (result.ok) success("Consumption deleted.");
      else toastError(result.error);
    });
  }

  // --- Consumption Sizes ---
  function handleAddSize(consumptionId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addAccessoryBomConsumptionSize(consumptionId, bom.id, data as never);
      if (result.ok) success("Size added.");
      else toastError(result.error);
    });
  }

  function handleDeleteSize(sizeId: string) {
    startTransition(async () => {
      const result = await deleteAccessoryBomConsumptionSize(sizeId, bom.id);
      if (result.ok) success("Size deleted.");
      else toastError(result.error);
    });
  }

  // --- Processes ---
  function handleAddProcess(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addAccessoryBomProcess(bom.id, data as never);
      if (result.ok) success("Process added.");
      else toastError(result.error);
    });
  }

  function handleDeleteProcess(id: string) {
    startTransition(async () => {
      const result = await deleteAccessoryBomProcess(id, bom.id);
      if (result.ok) success("Process deleted.");
      else toastError(result.error);
    });
  }

  // --- Process Stages ---
  function handleAddStage(processId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addAccessoryBomProcessStage(processId, bom.id, data as never);
      if (result.ok) success("Stage added.");
      else toastError(result.error);
    });
  }

  function handleUpdateStage(stageId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateAccessoryBomProcessStage(stageId, bom.id, data as never);
      if (result.ok) success("Stage updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteStage(stageId: string) {
    startTransition(async () => {
      const result = await deleteAccessoryBomProcessStage(stageId, bom.id);
      if (result.ok) success("Stage deleted.");
      else toastError(result.error);
    });
  }

  // ---------- render ----------

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Entry No</dt>
              <dd className="font-medium">{bom.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd>{fmtDate(bom.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Type</dt>
              <dd className="font-medium">
                {bom.bom_type === "in_factory" ? "In-Factory" : "Purchased"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Style</dt>
              <dd className="font-medium">{bom.style_code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{bom.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order No</dt>
              <dd>{bom.order_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amendment</dt>
              <dd>{bom.amendment_no}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={bomStatusTone(bom.status)}>
                  {BOM_STATUS_LABELS[bom.status]}
                </StatusPill>
              </dd>
            </div>
          </dl>

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
            {bom.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{bom.approved_at ? ` on ${fmtDate(bom.approved_at)}` : ""}.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      <Tabs
        items={[
          {
            key: "items",
            label: "Items",
            content: (
              <ItemsTab
                bom={bom}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddItem}
                onUpdate={handleUpdateItem}
                onDelete={handleDeleteItem}
              />
            ),
          },
          {
            key: "consumptions",
            label: "Consumptions",
            content: (
              <ConsumptionsTab
                bom={bom}
                canMutate={canMutate}
                isPending={isPending}
                onAddConsumption={handleAddConsumption}
                onDeleteConsumption={handleDeleteConsumption}
                onAddSize={handleAddSize}
                onDeleteSize={handleDeleteSize}
              />
            ),
          },
          {
            key: "processes",
            label: "Processes",
            content: (
              <ProcessesTab
                bom={bom}
                canMutate={canMutate}
                isPending={isPending}
                onAddProcess={handleAddProcess}
                onDeleteProcess={handleDeleteProcess}
                onAddStage={handleAddStage}
                onUpdateStage={handleUpdateStage}
                onDeleteStage={handleDeleteStage}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
