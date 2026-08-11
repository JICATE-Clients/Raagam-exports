"use client";

import { useState, useTransition } from "react";
import {
  addPoLine,
  updatePoLine,
  deletePoLine,
  submitPo,
  approvePo,
  rejectPo,
  updatePoCommercial,
  updatePoGeneral,
  addPoItemGroup,
  deletePoItemGroup,
  savePoCharges,
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
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import type { PoLineItem, PoStatus } from "@/lib/purchase/types";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { PoDeliveryEditor } from "./po-delivery-editor";

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
              <option value="">-- None --</option>
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
              <option value="">-- None --</option>
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
          {isPending ? "Saving..." : isAdd ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ---------- Additional Charges Grid ----------

function AdditionalChargesGrid({
  charges,
  canEdit,
  isPending,
  onSave,
}: {
  charges: { id: string; charge_type: string; label: string; rate_type: string | null; rate: number; inr_amount: number; fgn_amount: number; sort_order: number }[];
  canEdit: boolean;
  isPending: boolean;
  onSave: (charges: { charge_type: "add" | "less"; label: string; rate_type?: string | null; rate?: number; inr_amount: number; fgn_amount: number; sort_order?: number }[]) => void;
}) {
  type ChargeRow = { charge_type: "add" | "less"; label: string; inr_amount: string; fgn_amount: string };
  const initial: ChargeRow[] = charges.length > 0
    ? charges.map((c) => ({ charge_type: c.charge_type as "add" | "less", label: c.label, inr_amount: String(c.inr_amount), fgn_amount: String(c.fgn_amount) }))
    : [];

  const [rows, setRows] = useState<ChargeRow[]>(initial);
  const [dirty, setDirty] = useState(false);

  function addRow(type: "add" | "less") {
    setDirty(true);
    setRows((p) => [...p, { charge_type: type, label: "", inr_amount: "0", fgn_amount: "0" }]);
  }

  function updateRow(idx: number, key: keyof ChargeRow, val: string) {
    setDirty(true);
    setRows((p) => p.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  }

  function removeRow(idx: number) {
    setDirty(true);
    setRows((p) => p.filter((_, i) => i !== idx));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Additional Charges</CardTitle>
        {canEdit && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => addRow("add")}>+ Add Charge</Button>
            <Button size="sm" variant="outline" onClick={() => addRow("less")}>+ Less Charge</Button>
          </div>
        )}
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No additional charges.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded border border-border p-2">
                <span className={`w-12 text-xs font-semibold ${row.charge_type === "add" ? "text-success" : "text-danger"}`}>
                  {row.charge_type === "add" ? "ADD" : "LESS"}
                </span>
                <Input className="flex-1" placeholder="Description" value={row.label} onChange={(e) => updateRow(idx, "label", e.target.value)} disabled={!canEdit} />
                <Input className="w-32" type="number" step="0.01" placeholder="INR" value={row.inr_amount} onChange={(e) => updateRow(idx, "inr_amount", e.target.value)} disabled={!canEdit} />
                <Input className="w-32" type="number" step="0.01" placeholder="FGN" value={row.fgn_amount} onChange={(e) => updateRow(idx, "fgn_amount", e.target.value)} disabled={!canEdit} />
                {canEdit && (
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => removeRow(idx)}>X</Button>
                )}
              </div>
            ))}
          </div>
        )}
        {canEdit && dirty && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" disabled={isPending} onClick={() => {
              onSave(rows.filter((r) => r.label.trim()).map((r, i) => ({
                charge_type: r.charge_type,
                label: r.label.trim(),
                inr_amount: parseFloat(r.inr_amount) || 0,
                fgn_amount: parseFloat(r.fgn_amount) || 0,
                sort_order: i,
              })));
              setDirty(false);
            }}>
              {isPending ? "Saving..." : "Save Charges"}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Commercial Tab ----------

function CommercialTab({
  po,
  canEdit,
  isPending,
  onSave,
  onSaveCharges,
}: {
  po: PoWithDetails;
  canEdit: boolean;
  isPending: boolean;
  onSave: (fields: Record<string, unknown>) => void;
  onSaveCharges: (charges: { charge_type: "add" | "less"; label: string; rate_type?: string | null; rate?: number; inr_amount: number; fgn_amount: number; sort_order?: number }[]) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [fields, setFields] = useState({
    po_type: po.po_type ?? "local",
    exchange_rate: String(po.exchange_rate ?? ""),
    foreign_currency_code: po.foreign_currency_code ?? "",
    payment_terms: po.payment_terms ?? "",
    ship_mode: po.ship_mode ?? "",
    ship_type: po.ship_type ?? "",
    pay_mode: po.pay_mode ?? "",
    place_of_delivery: po.place_of_delivery ?? "",
    invoice_send_to: po.invoice_send_to ?? "",
    vat_against: po.vat_against ?? "",
    duty_against: po.duty_against ?? "",
    freight_type: po.freight_type ?? "",
  });

  useUnsavedGuard(dirty || isPending);

  function set(key: string, val: string) {
    setDirty(true);
    setFields((f) => ({ ...f, [key]: val }));
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <Label>PO Type</Label>
          <Select value={fields.po_type} onChange={(e) => set("po_type", e.target.value)} disabled={!canEdit}>
            <option value="local">Local</option>
            <option value="import">Import</option>
          </Select>
        </div>
        {fields.po_type === "import" && (
          <>
            <div>
              <Label>Foreign Currency</Label>
              <Input uppercase value={fields.foreign_currency_code} onChange={(e) => set("foreign_currency_code", e.target.value)} disabled={!canEdit} placeholder="e.g. USD" />
            </div>
            <div>
              <Label>Exchange Rate</Label>
              <Input type="number" step="0.0001" value={fields.exchange_rate} onChange={(e) => set("exchange_rate", e.target.value)} disabled={!canEdit} />
            </div>
          </>
        )}
        {/* Every free-text value here carries `uppercase` (client 2026-07-23,
            extended app-wide 2026-07-29). These are `text` columns with no
            picker behind them, so casing was whatever the operator typed and
            "Sea" / "sea" / "SEA" all coexisted. The prop also fixes rows saved
            BEFORE this, because it applies a CSS text-transform on top of the
            type-time one. Exchange Rate and the two Selects are deliberately
            left alone — see doc/ui/LAYOUT.md. */}
        <div>
          <Label>Payment Terms</Label>
          <Input uppercase value={fields.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>Pay Mode</Label>
          <Input uppercase value={fields.pay_mode} onChange={(e) => set("pay_mode", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>Ship Mode</Label>
          <Input uppercase value={fields.ship_mode} onChange={(e) => set("ship_mode", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>Ship Type</Label>
          <Input uppercase value={fields.ship_type} onChange={(e) => set("ship_type", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>Place of Delivery</Label>
          <Input uppercase value={fields.place_of_delivery} onChange={(e) => set("place_of_delivery", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>Invoice Send To</Label>
          <Input uppercase value={fields.invoice_send_to} onChange={(e) => set("invoice_send_to", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>VAT/GST Against</Label>
          <Input uppercase value={fields.vat_against} onChange={(e) => set("vat_against", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>Duty Against</Label>
          <Input uppercase value={fields.duty_against} onChange={(e) => set("duty_against", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>Freight Type</Label>
          <Select value={fields.freight_type} onChange={(e) => set("freight_type", e.target.value)} disabled={!canEdit}>
            <option value="">-- None --</option>
            <option value="itemwise">Itemwise</option>
            <option value="consolidated">Consolidated</option>
          </Select>
        </div>
      </div>

      {/* Additional Charges */}
      <AdditionalChargesGrid
        charges={po.additional_charges}
        canEdit={canEdit}
        isPending={isPending}
        onSave={onSaveCharges}
      />

      {/* Value summary */}
      <Card>
        <CardHeader><CardTitle>Value Summary</CardTitle></CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-4">
            <div>
              <span className="text-xs text-muted-foreground">Basic (INR)</span>
              <p className="tabular-nums font-medium">{fmtMoney(po.basic_inr)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Freight</span>
              <p className="tabular-nums font-medium">{fmtMoney(po.freight_inr)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Insurance</span>
              <p className="tabular-nums font-medium">{fmtMoney(po.insurance_inr)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">GST/VAT</span>
              <p className="tabular-nums font-medium">{fmtMoney(po.vat_inr)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Discount</span>
              <p className="tabular-nums font-medium">{fmtMoney(po.discount_inr)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Duty</span>
              <p className="tabular-nums font-medium">{fmtMoney(po.duty_inr)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Net (INR)</span>
              <p className="tabular-nums font-semibold text-primary">{fmtMoney(po.net_inr)}</p>
            </div>
            {po.po_type === "import" && (
              <div>
                <span className="text-xs text-muted-foreground">Net (FGN)</span>
                <p className="tabular-nums font-semibold">{fmtMoney(po.net_fgn, po.foreign_currency_code)}</p>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {canEdit && dirty && (
        <div className="flex justify-end">
          <Button
            disabled={isPending}
            onClick={() => {
              const payload: Record<string, unknown> = {
                po_type: fields.po_type,
                payment_terms: fields.payment_terms || null,
                ship_mode: fields.ship_mode || null,
                ship_type: fields.ship_type || null,
                pay_mode: fields.pay_mode || null,
                place_of_delivery: fields.place_of_delivery || null,
                invoice_send_to: fields.invoice_send_to || null,
                vat_against: fields.vat_against || null,
                duty_against: fields.duty_against || null,
                freight_type: fields.freight_type || null,
              };
              if (fields.po_type === "import") {
                payload.foreign_currency_code = fields.foreign_currency_code || null;
                payload.exchange_rate = parseFloat(fields.exchange_rate) || null;
              }
              onSave(payload);
              setDirty(false);
            }}
          >
            {isPending ? "Saving..." : "Save Commercial"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------- General Tab ----------

function GeneralTab({
  po,
  canEdit,
  isPending,
  onSave,
}: {
  po: PoWithDetails;
  canEdit: boolean;
  isPending: boolean;
  onSave: (fields: Record<string, unknown>) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [fields, setFields] = useState({
    quality_requirements: po.quality_requirements ?? "",
    bank_guarantee: po.bank_guarantee ?? "",
    warranty_terms: po.warranty_terms ?? "",
    delivery_instructions: po.delivery_instructions ?? "",
    insurance_details: po.insurance_details ?? "",
    port_of_shipment: po.port_of_shipment ?? "",
    transport_name: po.transport_name ?? "",
    transport_details: po.transport_details ?? "",
  });

  useUnsavedGuard(dirty || isPending);

  function set(key: string, val: string) {
    setDirty(true);
    setFields((f) => ({ ...f, [key]: val }));
  }

  const textareaFields = [
    { key: "quality_requirements", label: "Quality Requirements" },
    { key: "bank_guarantee", label: "Bank Guarantee" },
    { key: "warranty_terms", label: "Warranty / Guarantee" },
    { key: "delivery_instructions", label: "Delivery Instructions" },
    { key: "insurance_details", label: "Insurance Details" },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <Label>Port of Shipment</Label>
          <Input value={fields.port_of_shipment} onChange={(e) => set("port_of_shipment", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>Transport Name</Label>
          <Input value={fields.transport_name} onChange={(e) => set("transport_name", e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <Label>Transport Details</Label>
          <Input value={fields.transport_details} onChange={(e) => set("transport_details", e.target.value)} disabled={!canEdit} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {textareaFields.map(({ key, label }) => (
          <div key={key}>
            <Label>{label}</Label>
            <Textarea
              rows={3}
              value={fields[key]}
              onChange={(e) => set(key, e.target.value)}
              disabled={!canEdit}
            />
          </div>
        ))}
      </div>

      {canEdit && dirty && (
        <div className="flex justify-end">
          <Button
            disabled={isPending}
            onClick={() => {
              const payload: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(fields)) {
                payload[k] = v.trim() || null;
              }
              onSave(payload);
              setDirty(false);
            }}
          >
            {isPending ? "Saving..." : "Save General"}
          </Button>
        </div>
      )}
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

  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<LineFields>(emptyLine());
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());

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
      if (result.ok) success("Line deleted.");
      else toastError(result.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitPo(po.id);
      if (result.ok) success("Submitted for approval.");
      else toastError(result.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approvePo(po.id);
      if (result.ok) success("Purchase order approved.");
      else toastError(result.error);
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

  function handleAddGroup() {
    startTransition(async () => {
      const result = await addPoItemGroup({
        purchase_order_id: po.id,
        sl_no: po.item_groups.length + 1,
        sort_order: po.item_groups.length,
      });
      if (result.ok) success("Item group added.");
      else toastError(result.error);
    });
  }

  function handleDeleteGroup(groupId: string) {
    startTransition(async () => {
      const result = await deletePoItemGroup(groupId, po.id);
      if (result.ok) success("Item group deleted.");
      else toastError(result.error);
    });
  }

  function handleSaveCharges(charges: { charge_type: "add" | "less"; label: string; rate_type?: string | null; rate?: number; inr_amount: number; fgn_amount: number; sort_order?: number }[]) {
    startTransition(async () => {
      const result = await savePoCharges(po.id, charges.map((c) => ({
        purchase_order_id: po.id,
        ...c,
        rate: c.rate ?? 0,
        sort_order: c.sort_order ?? 0,
      })));
      if (result.ok) success("Charges saved.");
      else toastError(result.error);
    });
  }

  function handleSaveCommercial(fields: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updatePoCommercial(po.id, fields as never);
      if (result.ok) success("Commercial details saved.");
      else toastError(result.error);
    });
  }

  function handleSaveGeneral(fields: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updatePoGeneral(po.id, fields as never);
      if (result.ok) success("General details saved.");
      else toastError(result.error);
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
          {r.uom_id ? (uomMap[r.uom_id] ?? "--") : "--"}
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
          /* Deliveries expands the line in place — a disclosure toggle, not row
             CRUD — so it keeps its own labelled column (LAYOUT.md §6a). */
          {
            header: "Deliveries",
            align: "right" as const,
            cell: (r: PoLineItem) => (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={expandedLines.has(r.id)}
                onClick={() => {
                  setExpandedLines((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    return next;
                  });
                }}
              >
                {expandedLines.has(r.id) ? "Hide" : "Show"}
              </Button>
            ),
          },
          rowActionsColumn<PoLineItem>((r) => (
            <RowActions
              /* Editing this line means opening the form below it, so Edit also
                 CLOSES it when it is already this line's form that is open. */
              onEdit={() => (formMode === r.id ? closeForm() : openEdit(r))}
              canEdit={canMutateLines}
              onDelete={() => handleDelete(r.id)}
              canDelete={isDraft && canDelete}
              isPending={isPending}
            />
          )),
        ]
      : []),
  ];

  // ---------- Purchase Tab content ----------

  const purchaseTab = (
    <div className="space-y-4">
      {/* Item Groups (Band 0) */}
      <Card>
        <CardHeader>
          <CardTitle>Item Groups ({po.item_groups.length})</CardTitle>
          {canMutateLines && (
            <Button size="sm" onClick={handleAddGroup}>+ Add Group</Button>
          )}
        </CardHeader>
        <CardBody>
          {po.item_groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No item groups. Lines without groups are treated as ungrouped.</p>
          ) : (
            <div className="space-y-2">
              {po.item_groups.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-3 rounded border border-border p-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{g.group_description || g.group_no || `Group ${g.sl_no}`}</span>
                    {g.ppm_no && <span className="text-xs text-muted-foreground">PPM: {g.ppm_no}</span>}
                    {g.style_no && <span className="text-xs text-muted-foreground">Style: {g.style_no}</span>}
                    {g.customer_name && <span className="text-xs text-muted-foreground">Customer: {g.customer_name}</span>}
                  </div>
                  {canMutateLines && (
                    <Button size="sm" variant="ghost" className="text-danger" disabled={isPending}
                      onClick={() => handleDeleteGroup(g.id)}>
                      Delete
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle>Line Items ({po.lines.length})</CardTitle>
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

          {/* Expanded delivery editors for each line */}
          {po.lines
            .filter((l) => expandedLines.has(l.id))
            .map((l) => (
              <div key={`del-${l.id}`} className="ml-4">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  Delivery schedule for: {l.description}
                </p>
                <PoDeliveryEditor
                  lineItemId={l.id}
                  poId={po.id}
                  isSizeWise={l.is_size_wise ?? false}
                  canEdit={canMutateLines}
                />
              </div>
            ))}

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

      {/* Total */}
      <div className="flex justify-end">
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total Amount</p>
          <p className="tabular-nums text-lg font-bold">
            {fmtMoney(po.total_amount, po.currency_code)}
          </p>
        </div>
      </div>
    </div>
  );

  // ---------- Approvals Tab content ----------

  const approvalsTab = (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Workflow</CardTitle></CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd><StatusPill tone={poStatusTone(po.status)}>{PO_STATUS_LABELS[po.status]}</StatusPill></dd>
            </div>
            {po.approved_at && (
              <div>
                <dt className="text-xs text-muted-foreground">Approved</dt>
                <dd>{fmtDate(po.approved_at)}</dd>
              </div>
            )}
            {po.reference && (
              <div>
                <dt className="text-xs text-muted-foreground">Reference</dt>
                <dd>{po.reference}</dd>
              </div>
            )}
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isDraft && canEdit && (
              <Button variant="outline" disabled={isPending} onClick={handleSubmit}>
                Submit for approval
              </Button>
            )}

            {isPendingApproval && canApprove && (
              <>
                <Button disabled={isPending} onClick={handleApprove}>Approve</Button>
                {!showRejectForm && (
                  <Button variant="danger" disabled={isPending} onClick={() => setShowRejectForm(true)}>
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
                placeholder="Reason for rejection..."
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowRejectForm(false); setRejectNote(""); }}>
                  Cancel
                </Button>
                <Button variant="danger" size="sm" disabled={isPending} onClick={handleReject}>
                  {isPending ? "Rejecting..." : "Confirm reject"}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {po.notes && (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardBody>
            <p className="whitespace-pre-wrap text-sm">{po.notes}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );

  // ---------- render with tabs ----------

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Vendor</dt>
              <dd className="font-medium">{po.vendor_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Type</dt>
              <dd className="font-medium capitalize">{po.po_type ?? "local"}</dd>
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
              <dd>{po.currency_code ?? "--"}</dd>
            </div>
            {po.agent_id && (
              <div>
                <dt className="text-xs text-muted-foreground">Agent Commission</dt>
                <dd className="tabular-nums">{fmtMoney(po.agent_commission_amount)}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Tabs */}
      <Tabs
        items={[
          { key: "purchase", label: "Purchase", content: purchaseTab },
          {
            key: "commercial",
            label: "Commercial",
            content: (
              <CommercialTab
                po={po}
                canEdit={isDraft && canEdit}
                isPending={isPending}
                onSave={handleSaveCommercial}
                onSaveCharges={handleSaveCharges}
              />
            ),
          },
          {
            key: "general",
            label: "General",
            content: (
              <GeneralTab
                po={po}
                canEdit={isDraft && canEdit}
                isPending={isPending}
                onSave={handleSaveGeneral}
              />
            ),
          },
          { key: "approvals", label: "Approvals", content: approvalsTab },
        ]}
      />
    </div>
  );
}
