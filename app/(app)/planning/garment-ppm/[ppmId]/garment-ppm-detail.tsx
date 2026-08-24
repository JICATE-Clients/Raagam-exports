"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addGarmentPpmPack,
  updateGarmentPpmPack,
  deleteGarmentPpmPack,
  addGarmentPpmFabric,
  updateGarmentPpmFabric,
  deleteGarmentPpmFabric,
  addGarmentPpmProcess,
  updateGarmentPpmProcess,
  deleteGarmentPpmProcess,
  addGarmentPpmAccessory,
  updateGarmentPpmAccessory,
  deleteGarmentPpmAccessory,
  submitGarmentPpm,
  approveGarmentPpm,
  deleteGarmentPpm,
} from "@/lib/planning/ppm-actions";
import type { getGarmentPpm } from "@/lib/planning/ppm-service";
import type { PpmStatus } from "@/lib/planning/ppm-types";
import {
  ASSORTMENT_TYPES,
  STAGES,
  RATE_FOR_OPTIONS,
  RATE_FOR_LABELS,
  ORDER_FOR_LABELS,
  SOURCING_TYPE_LABELS,
} from "@/lib/planning/ppm-types";
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
import { fmtDate, fmtNumber, fmtMoney } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

// ---------- types ----------

type PpmDetail = NonNullable<Awaited<ReturnType<typeof getGarmentPpm>>>;
type PackRow = PpmDetail["packs"][number];
type QtyRow = PpmDetail["quantities"][number];
type FabricRow = PpmDetail["fabrics"][number];
type ProcessRow = PpmDetail["processes"][number];
type AccessoryRow = PpmDetail["accessories"][number];

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

// ============================================================================
// PACKS TAB
// ============================================================================

type PackFields = {
  sno: string;
  sc_no: string;
  order_no: string;
  pack: string;
  assortment_type: string;
  ppm_qty: string;
  delivery_date: string;
};

function emptyPack(): PackFields {
  return {
    sno: "",
    sc_no: "",
    order_no: "",
    pack: "",
    assortment_type: "",
    ppm_qty: "0",
    delivery_date: "",
  };
}

function packToFields(r: PackRow): PackFields {
  return {
    sno: String(r.sno),
    sc_no: r.sc_no ?? "",
    order_no: r.order_no ?? "",
    pack: r.pack ?? "",
    assortment_type: r.assortment_type ?? "",
    ppm_qty: String(r.ppm_qty),
    delivery_date: r.delivery_date ?? "",
  };
}

function packFieldsToData(f: PackFields, ppmId: string): Record<string, unknown> {
  return {
    garment_ppm_id: ppmId,
    sno: parseInt(f.sno) || 0,
    sc_no: f.sc_no.trim() || null,
    order_no: f.order_no.trim() || null,
    pack: f.pack.trim() || null,
    assortment_type: f.assortment_type || null,
    ppm_qty: parseFloat(f.ppm_qty) || 0,
    delivery_date: f.delivery_date || null,
  };
}

function PacksTab({
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
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<PackFields>(emptyPack());

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm({ ...emptyPack(), sno: String(ppm.packs.length + 1) });
    setFormMode("add");
  }

  function openEdit(r: PackRow) {
    setForm(packToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingRow = formMode && formMode !== "add"
    ? ppm.packs.find((r) => r.id === formMode)
    : undefined;

  const columns: Column<PackRow>[] = [
    { header: "S No",            cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "RE No",           cell: (r) => <span className="text-sm">{r.sc_no ?? "--"}</span> },
    { header: "Order No",        cell: (r) => <span className="text-sm">{r.order_no ?? "--"}</span> },
    { header: "Pack",            cell: (r) => <span className="text-sm">{r.pack ?? "--"}</span> },
    { header: "Assortment Type", cell: (r) => <span className="text-sm">{r.assortment_type ?? "--"}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.ppm_qty)}</span> },
    { header: "Delivery Date",   cell: (r) => <span className="tabular-nums text-sm">{r.delivery_date ? fmtDate(r.delivery_date) : "--"}</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: PackRow) => (
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
        <CardTitle>Packs ({ppm.packs.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>+ Add pack</Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={ppm.packs}
          getKey={(r) => r.id}
          empty="No packs recorded. Add one to get started."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? "Add pack" : "Edit pack"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>S No</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.sno}
                  onChange={(e) => setForm((f) => ({ ...f, sno: e.target.value }))}
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
                <Label>Pack</Label>
                <Input
                  value={form.pack}
                  onChange={(e) => setForm((f) => ({ ...f, pack: e.target.value }))}
                />
              </div>
              <div>
                <Label>Assortment Type</Label>
                <Select
                  value={form.assortment_type}
                  onChange={(e) => setForm((f) => ({ ...f, assortment_type: e.target.value }))}
                >
                  <option value=""></option>
                  {ASSORTMENT_TYPES.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>PPM Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.ppm_qty}
                  onChange={(e) => setForm((f) => ({ ...f, ppm_qty: e.target.value }))}
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
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const data = packFieldsToData(form, ppm.id);
                  if (formMode === "add") {
                    onAdd(data);
                  } else if (editingRow) {
                    onUpdate(editingRow.id, data);
                  }
                  closeForm();
                }}
              >
                {formMode === "add" ? "Add" : "Update"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// QUANTITIES TAB — read-only
//
// Quantities is a 4-level hierarchy (Quantity → Coordinates → Combos → Sizes).
// Inline editing is deferred: in VB.NET this tab auto-fills from the SQ
// selection and the hierarchy is too deep for a simple inline form.
// ============================================================================

function QuantitiesTab({ ppm }: { ppm: PpmDetail }) {
  const qtyColumns: Column<QtyRow>[] = [
    { header: "S No",       cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Style Ref",  cell: (r) => <span className="text-sm">{r.style_ref_no ?? "--"}</span> },
    { header: "Style",      cell: (r) => <span className="text-sm">{r.style_no ?? "--"}</span> },
    { header: "Article",    cell: (r) => <span className="text-sm">{r.article_no ?? "--"}</span> },
    { header: "UOM",        cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span> },
    { header: "Order Qty",    align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.order_qty)}</span> },
    { header: "Approval Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.approval_qty)}</span> },
    { header: "PPM Qty",      align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.ppm_qty)}</span> },
    { header: "Rate",         align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span> },
    { header: "Value",        align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.po_value)}</span> },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quantities ({ppm.quantities.length})</CardTitle>
      </CardHeader>
      <CardBody>
        <DataTable
          columns={qtyColumns}
          rows={ppm.quantities}
          getKey={(r) => r.id}
        />
      </CardBody>
    </Card>
  );
}

// ============================================================================
// FABRICS TAB
// ============================================================================

type FabricFields = {
  sno: string;
  item_name: string;
  gsm: string;
  vendor_name: string;
  stage: string;
  item_type: string;
  item_color: string;
  uom_id: string;
  process_name: string;
  qty: string;
  wt: string;
  rate: string;
};

function emptyFabric(): FabricFields {
  return {
    sno: "",
    item_name: "",
    gsm: "",
    vendor_name: "",
    stage: "",
    item_type: "",
    item_color: "",
    uom_id: "",
    process_name: "",
    qty: "0",
    wt: "0",
    rate: "0",
  };
}

function fabricToFields(r: FabricRow): FabricFields {
  return {
    sno: String(r.sno),
    item_name: r.item_name ?? "",
    gsm: r.gsm != null ? String(r.gsm) : "",
    vendor_name: r.vendor_name ?? "",
    stage: r.stage ?? "",
    item_type: r.item_type ?? "",
    item_color: r.item_color ?? "",
    uom_id: r.uom_id ?? "",
    process_name: r.process_name ?? "",
    qty: String(r.qty),
    wt: String(r.wt),
    rate: String(r.rate),
  };
}

function fabricFieldsToData(f: FabricFields, ppmId: string): Record<string, unknown> {
  return {
    garment_ppm_id: ppmId,
    sno: parseInt(f.sno) || 0,
    item_name: f.item_name.trim() || null,
    gsm: f.gsm !== "" ? parseFloat(f.gsm) : null,
    vendor_name: f.vendor_name.trim() || null,
    stage: f.stage || null,
    item_type: f.item_type.trim() || null,
    item_color: f.item_color.trim() || null,
    uom_id: f.uom_id.trim() || null,
    process_name: f.process_name.trim() || null,
    qty: parseFloat(f.qty) || 0,
    wt: parseFloat(f.wt) || 0,
    rate: parseFloat(f.rate) || 0,
    po_value: (parseFloat(f.qty) || 0) * (parseFloat(f.rate) || 0),
  };
}

function FabricsTab({
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
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<FabricFields>(emptyFabric());

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm({ ...emptyFabric(), sno: String(ppm.fabrics.length + 1) });
    setFormMode("add");
  }

  function openEdit(r: FabricRow) {
    setForm(fabricToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingRow = formMode && formMode !== "add"
    ? ppm.fabrics.find((r) => r.id === formMode)
    : undefined;

  const columns: Column<FabricRow>[] = [
    { header: "S No",    cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Item",    cell: (r) => <span className="text-sm">{r.item_name ?? "--"}</span> },
    { header: "GSM",     align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.gsm != null ? fmtNumber(r.gsm) : "--"}</span> },
    { header: "Vendor",  cell: (r) => <span className="text-sm">{r.vendor_name ?? "--"}</span> },
    { header: "Stage",   cell: (r) => <span className="text-sm">{r.stage ?? "--"}</span> },
    { header: "Type",    cell: (r) => <span className="text-sm">{r.item_type ?? "--"}</span> },
    { header: "Color",   cell: (r) => <span className="text-sm">{r.item_color ?? "--"}</span> },
    { header: "UOM",     cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span> },
    { header: "Process", cell: (r) => <span className="text-sm">{r.process_name ?? "--"}</span> },
    { header: "Qty",   align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span> },
    { header: "Wt",    align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.wt)}</span> },
    { header: "Rate",  align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span> },
    { header: "Value", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.po_value)}</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: FabricRow) => (
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
        <CardTitle>Fabrics ({ppm.fabrics.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>+ Add fabric</Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={ppm.fabrics}
          getKey={(r) => r.id}
          empty="No fabrics recorded. Add one to get started."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? "Add fabric" : "Edit fabric"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>S No</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.sno}
                  onChange={(e) => setForm((f) => ({ ...f, sno: e.target.value }))}
                />
              </div>
              <div>
                <Label>Item Name</Label>
                <Input
                  value={form.item_name}
                  onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>GSM</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.gsm}
                  onChange={(e) => setForm((f) => ({ ...f, gsm: e.target.value }))}
                />
              </div>
              <div>
                <Label>Vendor</Label>
                <Input
                  value={form.vendor_name}
                  onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Stage</Label>
                <Select
                  value={form.stage}
                  onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
                >
                  <option value=""></option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Item Type</Label>
                <Input
                  value={form.item_type}
                  onChange={(e) => setForm((f) => ({ ...f, item_type: e.target.value }))}
                />
              </div>
              <div>
                <Label>Color</Label>
                <Input
                  value={form.item_color}
                  onChange={(e) => setForm((f) => ({ ...f, item_color: e.target.value }))}
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
                <Label>Process</Label>
                <Input
                  value={form.process_name}
                  onChange={(e) => setForm((f) => ({ ...f, process_name: e.target.value }))}
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
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const data = fabricFieldsToData(form, ppm.id);
                  if (formMode === "add") {
                    onAdd(data);
                  } else if (editingRow) {
                    onUpdate(editingRow.id, data);
                  }
                  closeForm();
                }}
              >
                {formMode === "add" ? "Add" : "Update"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// GARMENT PROCESSING TAB
// ============================================================================

type ProcessFields = {
  sno: string;
  process_name: string;
  rate_for: string;
  qty: string;
  rate: string;
};

function emptyProcess(): ProcessFields {
  return {
    sno: "",
    process_name: "",
    rate_for: "PRO",
    qty: "0",
    rate: "0",
  };
}

function processToFields(r: ProcessRow): ProcessFields {
  return {
    sno: String(r.sno),
    process_name: r.process_name ?? "",
    rate_for: r.rate_for ?? "PRO",
    qty: String(r.qty),
    rate: String(r.rate),
  };
}

function processFieldsToData(f: ProcessFields, ppmId: string): Record<string, unknown> {
  const qty = parseFloat(f.qty) || 0;
  const rate = parseFloat(f.rate) || 0;
  return {
    garment_ppm_id: ppmId,
    sno: parseInt(f.sno) || 0,
    process_name: f.process_name.trim() || null,
    rate_for: f.rate_for || "PRO",
    qty,
    rate,
    po_value: qty * rate,
  };
}

function ProcessingTab({
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
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<ProcessFields>(emptyProcess());

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm({ ...emptyProcess(), sno: String(ppm.processes.length + 1) });
    setFormMode("add");
  }

  function openEdit(r: ProcessRow) {
    setForm(processToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingRow = formMode && formMode !== "add"
    ? ppm.processes.find((r) => r.id === formMode)
    : undefined;

  const poValuePreview = (parseFloat(form.qty) || 0) * (parseFloat(form.rate) || 0);

  const columns: Column<ProcessRow>[] = [
    { header: "S No",     cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Process",  cell: (r) => <span className="text-sm">{r.process_name ?? "--"}</span> },
    { header: "Rate For", cell: (r) => <span className="text-sm">{RATE_FOR_LABELS[r.rate_for] ?? r.rate_for}</span> },
    { header: "UOM",      cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span> },
    { header: "Qty",   align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span> },
    { header: "Rate",  align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span> },
    { header: "Value", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.po_value)}</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: ProcessRow) => (
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
        <CardTitle>Garment Processing ({ppm.processes.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>+ Add process</Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={ppm.processes}
          getKey={(r) => r.id}
          empty="No garment processes recorded. Add one to get started."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? "Add process" : "Edit process"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>S No</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.sno}
                  onChange={(e) => setForm((f) => ({ ...f, sno: e.target.value }))}
                />
              </div>
              <div>
                <Label>Process Name</Label>
                <Input
                  value={form.process_name}
                  onChange={(e) => setForm((f) => ({ ...f, process_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Rate For</Label>
                <Select
                  value={form.rate_for}
                  onChange={(e) => setForm((f) => ({ ...f, rate_for: e.target.value }))}
                >
                  {RATE_FOR_OPTIONS.map((v) => (
                    <option key={v} value={v}>{RATE_FOR_LABELS[v]}</option>
                  ))}
                </Select>
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
                <Label>PO Value (calculated)</Label>
                <Input
                  readOnly
                  value={fmtMoney(poValuePreview)}
                  className="bg-surface-muted text-muted-foreground"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const data = processFieldsToData(form, ppm.id);
                  if (formMode === "add") {
                    onAdd(data);
                  } else if (editingRow) {
                    onUpdate(editingRow.id, data);
                  }
                  closeForm();
                }}
              >
                {formMode === "add" ? "Add" : "Update"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// ACCESSORIES TAB
// ============================================================================

type AccessoryFields = {
  sno: string;
  item_name: string;
  vendor_name: string;
  item_color: string;
  uom_id: string;
  process_name: string;
  qty: string;
  wt: string;
  rate: string;
};

function emptyAccessory(): AccessoryFields {
  return {
    sno: "",
    item_name: "",
    vendor_name: "",
    item_color: "",
    uom_id: "",
    process_name: "",
    qty: "0",
    wt: "0",
    rate: "0",
  };
}

function accessoryToFields(r: AccessoryRow): AccessoryFields {
  return {
    sno: String(r.sno),
    item_name: r.item_name ?? "",
    vendor_name: r.vendor_name ?? "",
    item_color: r.item_color ?? "",
    uom_id: r.uom_id ?? "",
    process_name: r.process_name ?? "",
    qty: String(r.qty),
    wt: String(r.wt),
    rate: String(r.rate),
  };
}

function accessoryFieldsToData(f: AccessoryFields, ppmId: string): Record<string, unknown> {
  const qty = parseFloat(f.qty) || 0;
  const rate = parseFloat(f.rate) || 0;
  return {
    garment_ppm_id: ppmId,
    sno: parseInt(f.sno) || 0,
    item_name: f.item_name.trim() || null,
    vendor_name: f.vendor_name.trim() || null,
    item_color: f.item_color.trim() || null,
    uom_id: f.uom_id.trim() || null,
    process_name: f.process_name.trim() || null,
    qty,
    wt: parseFloat(f.wt) || 0,
    rate,
    po_value: qty * rate,
  };
}

function AccessoriesTab({
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
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<AccessoryFields>(emptyAccessory());

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm({ ...emptyAccessory(), sno: String(ppm.accessories.length + 1) });
    setFormMode("add");
  }

  function openEdit(r: AccessoryRow) {
    setForm(accessoryToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingRow = formMode && formMode !== "add"
    ? ppm.accessories.find((r) => r.id === formMode)
    : undefined;

  const columns: Column<AccessoryRow>[] = [
    { header: "S No",    cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Item",    cell: (r) => <span className="text-sm">{r.item_name ?? "--"}</span> },
    { header: "Vendor",  cell: (r) => <span className="text-sm">{r.vendor_name ?? "--"}</span> },
    { header: "Color",   cell: (r) => <span className="text-sm">{r.item_color ?? "--"}</span> },
    { header: "UOM",     cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span> },
    { header: "Process", cell: (r) => <span className="text-sm">{r.process_name ?? "--"}</span> },
    { header: "Qty",   align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span> },
    { header: "Wt",    align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.wt)}</span> },
    { header: "Rate",  align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span> },
    { header: "Value", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.po_value)}</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: AccessoryRow) => (
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
        <CardTitle>Accessories ({ppm.accessories.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>+ Add accessory</Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={ppm.accessories}
          getKey={(r) => r.id}
          empty="No accessories recorded. Add one to get started."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? "Add accessory" : "Edit accessory"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>S No</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.sno}
                  onChange={(e) => setForm((f) => ({ ...f, sno: e.target.value }))}
                />
              </div>
              <div>
                <Label>Item Name</Label>
                <Input
                  value={form.item_name}
                  onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Vendor</Label>
                <Input
                  value={form.vendor_name}
                  onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Color</Label>
                <Input
                  value={form.item_color}
                  onChange={(e) => setForm((f) => ({ ...f, item_color: e.target.value }))}
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
                <Label>Process</Label>
                <Input
                  value={form.process_name}
                  onChange={(e) => setForm((f) => ({ ...f, process_name: e.target.value }))}
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
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const data = accessoryFieldsToData(form, ppm.id);
                  if (formMode === "add") {
                    onAdd(data);
                  } else if (editingRow) {
                    onUpdate(editingRow.id, data);
                  }
                  closeForm();
                }}
              >
                {formMode === "add" ? "Add" : "Update"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function GarmentPpmDetail({
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

  const isDraft = ppm.status === "draft";
  const isSubmitted = ppm.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  // ---------- Workflow handlers ----------

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitGarmentPpm(ppm.id);
      if (res.ok) {
        success("Submitted for approval.");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approveGarmentPpm(ppm.id);
      if (res.ok) {
        success("Garment PPM approved.");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteGarmentPpm(ppm.id);
      if (res.ok) {
        success("Deleted.");
        router.push("/planning/garment-ppm");
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------- Pack handlers ----------

  function handleAddPack(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addGarmentPpmPack(data);
      if (res.ok) success("Pack added.");
      else toastError(res.error);
    });
  }

  function handleUpdatePack(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateGarmentPpmPack(id, ppm.id, data);
      if (res.ok) success("Pack updated.");
      else toastError(res.error);
    });
  }

  function handleDeletePack(id: string) {
    startTransition(async () => {
      const res = await deleteGarmentPpmPack(id, ppm.id);
      if (res.ok) success("Pack deleted.");
      else toastError(res.error);
    });
  }

  // ---------- Fabric handlers ----------

  function handleAddFabric(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addGarmentPpmFabric(data);
      if (res.ok) success("Fabric added.");
      else toastError(res.error);
    });
  }

  function handleUpdateFabric(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateGarmentPpmFabric(id, ppm.id, data);
      if (res.ok) success("Fabric updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteFabric(id: string) {
    startTransition(async () => {
      const res = await deleteGarmentPpmFabric(id, ppm.id);
      if (res.ok) success("Fabric deleted.");
      else toastError(res.error);
    });
  }

  // ---------- Process handlers ----------

  function handleAddProcess(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addGarmentPpmProcess(data);
      if (res.ok) success("Process added.");
      else toastError(res.error);
    });
  }

  function handleUpdateProcess(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateGarmentPpmProcess(id, ppm.id, data);
      if (res.ok) success("Process updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteProcess(id: string) {
    startTransition(async () => {
      const res = await deleteGarmentPpmProcess(id, ppm.id);
      if (res.ok) success("Process deleted.");
      else toastError(res.error);
    });
  }

  // ---------- Accessory handlers ----------

  function handleAddAccessory(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addGarmentPpmAccessory(data);
      if (res.ok) success("Accessory added.");
      else toastError(res.error);
    });
  }

  function handleUpdateAccessory(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateGarmentPpmAccessory(id, ppm.id, data);
      if (res.ok) success("Accessory updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteAccessory(id: string) {
    startTransition(async () => {
      const res = await deleteGarmentPpmAccessory(id, ppm.id);
      if (res.ok) success("Accessory deleted.");
      else toastError(res.error);
    });
  }

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
              <dt className="text-xs text-muted-foreground">RE No</dt>
              <dd>{ppm.sc_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order For</dt>
              <dd>{ORDER_FOR_LABELS[ppm.order_for] ?? ppm.order_for}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sourcing</dt>
              <dd>{SOURCING_TYPE_LABELS[ppm.sourcing_type] ?? ppm.sourcing_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Delivery Date</dt>
              <dd className="tabular-nums">{ppm.delivery_date ? fmtDate(ppm.delivery_date) : "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group No</dt>
              <dd>{ppm.group_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Description</dt>
              <dd className="col-span-2">{ppm.description ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Stage From</dt>
              <dd>{ppm.stage_from ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Stage To</dt>
              <dd>{ppm.stage_to ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">OH%</dt>
              <dd className="tabular-nums">{fmtNumber(ppm.overhead_pct)}%</dd>
            </div>
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

      {/* Tabs */}
      <Tabs
        defaultKey="packs"
        items={[
          {
            key: "packs",
            label: `Packs (${ppm.packs.length})`,
            content: (
              <PacksTab
                ppm={ppm}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddPack}
                onUpdate={handleUpdatePack}
                onDelete={handleDeletePack}
              />
            ),
          },
          {
            key: "quantities",
            label: `Quantities (${ppm.quantities.length})`,
            content: <QuantitiesTab ppm={ppm} />,
          },
          {
            key: "fabrics",
            label: `Fabrics (${ppm.fabrics.length})`,
            content: (
              <FabricsTab
                ppm={ppm}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddFabric}
                onUpdate={handleUpdateFabric}
                onDelete={handleDeleteFabric}
              />
            ),
          },
          {
            key: "processing",
            label: `Garment Processing (${ppm.processes.length})`,
            content: (
              <ProcessingTab
                ppm={ppm}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddProcess}
                onUpdate={handleUpdateProcess}
                onDelete={handleDeleteProcess}
              />
            ),
          },
          {
            key: "accessories",
            label: `Accessories (${ppm.accessories.length})`,
            content: (
              <AccessoriesTab
                ppm={ppm}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddAccessory}
                onUpdate={handleUpdateAccessory}
                onDelete={handleDeleteAccessory}
              />
            ),
          },
        ]}
      />

      {/* Footer value summary card */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">CMT Value</dt>
              <dd className="tabular-nums font-medium">{fmtMoney(ppm.cmt_value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Fabric Value</dt>
              <dd className="tabular-nums font-medium">{fmtMoney(ppm.fabric_issued_value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Garment Process Value</dt>
              <dd className="tabular-nums font-medium">{fmtMoney(ppm.garment_process_value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Accessories Value</dt>
              <dd className="tabular-nums font-medium">{fmtMoney(ppm.accessories_value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Gross</dt>
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
              <dt className="text-xs text-muted-foreground">Net</dt>
              <dd className="tabular-nums text-base font-semibold">{fmtMoney(ppm.net_value)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
