"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate, fmtNumber } from "@/lib/format";
import { RecordPicker } from "@/components/masters/record-picker";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createPackingAdvice,
  updatePackingAdvice,
  deletePackingAdvice,
} from "@/lib/orders/packing-advice/actions";
import {
  CARTON_SLNO_BY,
  ASSORT_TYPES,
  PLA_STATUS_LABELS,
  plaStatusTone,
  type PackingAdvice,
  type PlaStatus,
} from "@/lib/orders/packing-advice/types";
import type { PackingAdviceFormData, PickerRow } from "@/lib/orders/packing-advice/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  rows: PackingAdvice[];
  data: PackingAdviceFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

type LineRow = {
  key: string;
  ctn_from: string;
  ctn_to: string;
  ctns: string;
  sc_no_id: string | null;
  po_no: string;
  country_id: string | null;
  ref_no: string;
  assort_type: string;
  customer_order_no: string;
  multiple_pack: boolean;
  qty_per_ctn: string;
  total_qty: string;
  unit_id: string | null;
  measurement: string;
};

type HeaderForm = {
  advice_date: string;
  reference: string;
  carton_slno_by: string;
  customer_id: string | null;
  consignee_id: string | null;
  warehouse_id: string | null;
  warehouse_address: string;
  status: PlaStatus;
};

const BLANK: HeaderForm = {
  advice_date: "",
  reference: "",
  carton_slno_by: "",
  customer_id: null,
  consignee_id: null,
  warehouse_id: null,
  warehouse_address: "",
  status: "draft",
};

const today = () => new Date().toISOString().slice(0, 10);
const numOrNull = (v: string) => (v.trim() ? Number(v) : null);
const n = (v: string) => Number(v) || 0;

export function PackingAdviceScreen({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  const warehouseOpts = useMemo(
    () => data.lookups.filter((l) => l.kind === "warehouse"),
    [data.lookups],
  );
  // SC No picker items {id, code: order#, name: buyer}.
  const orderItems: PickerRow[] = useMemo(
    () =>
      data.orders.map((o) => ({ id: o.id, code: o.order_number, name: o.buyer_name ?? "(no buyer)" })),
    [data.orders],
  );

  // Header Ctns / Qty are the live totals of the line grid (legacy behaviour).
  const ctnsTotal = useMemo(() => lines.reduce((t, l) => t + n(l.ctns), 0), [lines]);
  const qtyTotal = useMemo(() => lines.reduce((t, l) => t + n(l.total_qty), 0), [lines]);

  const blankLine = (): LineRow => ({
    key: newKey(),
    ctn_from: "",
    ctn_to: "",
    ctns: "",
    sc_no_id: null,
    po_no: "",
    country_id: null,
    ref_no: "",
    assort_type: "",
    customer_order_no: "",
    multiple_pack: false,
    qty_per_ctn: "",
    total_qty: "",
    unit_id: null,
    measurement: "",
  });

  const updateLine = (key: string, patch: Partial<LineRow>) =>
    setLines((xs) =>
      xs.map((x) => {
        if (x.key !== key) return x;
        const next = { ...x, ...patch };
        // Auto-compute Total Qty = Ctns × Qty/Ctn when either changes.
        if ("ctns" in patch || "qty_per_ctn" in patch) {
          next.total_qty = String(n(next.ctns) * n(next.qty_per_ctn));
        }
        return next;
      }),
    );

  function openAdd() {
    setEditId(null);
    setEditCode(null);
    setForm({ ...BLANK, advice_date: today() });
    setLines([blankLine()]);
    setMode("edit");
  }

  function openEdit(r: PackingAdvice) {
    setEditId(r.id);
    setEditCode(r.code);
    setForm({
      advice_date: r.advice_date ?? today(),
      reference: r.reference ?? "",
      carton_slno_by: r.carton_slno_by ?? "",
      customer_id: r.customer_id,
      consignee_id: r.consignee_id,
      warehouse_id: r.warehouse_id,
      warehouse_address: r.warehouse_address ?? "",
      status: r.status,
    });
    setLines(
      r.lines.length
        ? r.lines.map((l) => ({
            key: newKey(),
            ctn_from: l.ctn_from ?? "",
            ctn_to: l.ctn_to ?? "",
            ctns: l.ctns ? String(l.ctns) : "",
            sc_no_id: l.sc_no_id,
            po_no: l.po_no ?? "",
            country_id: l.country_id,
            ref_no: l.ref_no ?? "",
            assort_type: l.assort_type ?? "",
            customer_order_no: l.customer_order_no ?? "",
            multiple_pack: l.multiple_pack,
            qty_per_ctn: l.qty_per_ctn ? String(l.qty_per_ctn) : "",
            total_qty: l.total_qty ? String(l.total_qty) : "",
            unit_id: l.unit_id,
            measurement: l.measurement ?? "",
          }))
        : [blankLine()],
    );
    setMode("edit");
  }

  function submit(status: PlaStatus) {
    const payload = {
      status,
      advice_date: form.advice_date,
      reference: form.reference || null,
      carton_slno_by: form.carton_slno_by || null,
      customer_id: form.customer_id,
      consignee_id: form.consignee_id,
      ctns_total: ctnsTotal,
      qty_total: qtyTotal,
      warehouse_id: form.warehouse_id,
      warehouse_address: form.warehouse_address || null,
      lines: lines.map((l) => ({
        sort_order: 0,
        ctn_from: l.ctn_from || null,
        ctn_to: l.ctn_to || null,
        ctns: numOrNull(l.ctns) ?? 0,
        sc_no_id: l.sc_no_id,
        po_no: l.po_no || null,
        country_id: l.country_id,
        ref_no: l.ref_no || null,
        assort_type: l.assort_type || null,
        customer_order_no: l.customer_order_no || null,
        multiple_pack: l.multiple_pack,
        qty_per_ctn: numOrNull(l.qty_per_ctn) ?? 0,
        total_qty: numOrNull(l.total_qty) ?? 0,
        unit_id: l.unit_id,
        measurement: l.measurement || null,
      })),
    };
    start(async () => {
      const res = editId
        ? await updatePackingAdvice(editId, payload)
        : await createPackingAdvice(payload);
      if (res.ok) {
        success(editId ? "Packing advice updated" : "Packing advice created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: PackingAdvice) {
    if (!confirm(`Delete packing advice ${r.code ?? ""}?`)) return;
    start(async () => {
      const res = await deletePackingAdvice(r.id);
      if (res.ok) {
        success("Packing advice deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST MODE ----------------
  if (mode === "list") {
    const columns: Column<PackingAdvice>[] = [
      {
        header: "PL Adv No",
        cell: (r) => (
          <button
            type="button"
            onClick={() => perms.canEdit && openEdit(r)}
            className="font-mono text-xs font-medium text-primary hover:underline"
          >
            {r.code ?? "—"}
          </button>
        ),
      },
      { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.advice_date)}</span> },
      { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
      { header: "Consignee", cell: (r) => <span className="text-sm">{r.consignee?.name ?? "—"}</span> },
      {
        header: "Ctns",
        align: "right",
        cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.ctns_total)}</span>,
      },
      {
        header: "Status",
        cell: (r) => <StatusPill tone={plaStatusTone(r.status)}>{PLA_STATUS_LABELS[r.status]}</StatusPill>,
      },
      {
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex justify-end gap-1">
            {perms.canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                Edit
              </Button>
            )}
            {perms.canDelete && (
              <Button variant="outline" size="sm" onClick={() => del(r)}>
                Delete
              </Button>
            )}
          </div>
        ),
      },
    ];

    return (
      <div className="space-y-4">
        <PageHeader
          title="Packing List Advice"
          description="Advise how an order is packed — cartons, assortment, consignee & warehouse."
          actions={perms.canCreate ? <Button onClick={openAdd}>New Packing Advice</Button> : undefined}
        />
        <DataTable
          columns={columns}
          rows={rows}
          getKey={(r) => r.id}
          empty="No packing advices yet. Use 'New Packing Advice' to create the first."
        />
      </div>
    );
  }

  // ---------------- EDIT MODE ----------------
  const canSave = !!form.advice_date;

  return (
    <div className="space-y-4">
      <PageHeader
        title={editId ? `Edit Packing Advice ${editCode ?? ""}` : "New Packing Advice"}
        description="Fill the header, then add carton/assortment lines. Every ⓘ / ⊕ field is a picker over stored data."
        actions={
          <Button variant="outline" size="sm" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* Header band */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>PL Adv No</Label>
            <div className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">
              {editCode ?? "Auto (on save)"}
            </div>
          </div>
          <div>
            <Label htmlFor="pa-date">Date *</Label>
            <Input id="pa-date" type="date" value={form.advice_date} onChange={(e) => set({ advice_date: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="pa-ref">Reference</Label>
            <Input id="pa-ref" value={form.reference} onChange={(e) => set({ reference: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="pa-carton">Carton SlNo.By</Label>
            <Select id="pa-carton" value={form.carton_slno_by} onChange={(e) => set({ carton_slno_by: e.target.value })}>
              <option value="">—</option>
              {CARTON_SLNO_BY.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
          <RecordPicker
            label="Customer"
            items={data.buyers}
            value={form.customer_id}
            onChange={(id) => set({ customer_id: id })}
          />
          <RecordPicker
            label="Consignee"
            items={data.consignees}
            value={form.consignee_id}
            onChange={(id) => set({ consignee_id: id })}
          />
          <div>
            <Label>Ctns (total)</Label>
            <div className="flex h-9 items-center justify-end rounded-md border border-border bg-surface-muted px-3 text-sm tabular-nums">
              {fmtNumber(ctnsTotal)}
            </div>
          </div>
          <div>
            <Label>Qty (total)</Label>
            <div className="flex h-9 items-center justify-end rounded-md border border-border bg-surface-muted px-3 text-sm tabular-nums">
              {fmtNumber(qtyTotal)}
            </div>
          </div>
          <div className="sm:col-span-2">
            <LookupDialogPicker
              kind="warehouse"
              label="Warehouse Name"
              options={warehouseOpts}
              value={form.warehouse_id}
              onChange={(id) => set({ warehouse_id: id })}
              canCreate={masterPerms.canCreate}
              canEdit={masterPerms.canEdit}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="pa-waddr">Warehouse Address</Label>
            <Textarea
              id="pa-waddr"
              value={form.warehouse_address}
              onChange={(e) => set({ warehouse_address: e.target.value })}
              rows={2}
            />
          </div>
        </CardBody>
      </Card>

      {/* Packing List detail grid */}
      <Card>
        <CardBody>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Packing List — Details</h3>
            <Button type="button" variant="subtle" size="sm" onClick={() => setLines((xs) => [...xs, blankLine()])}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add row
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">SlNo</th>
                  <th className="px-2 py-1.5 text-left font-medium">Ctn From</th>
                  <th className="px-2 py-1.5 text-left font-medium">Ctn To</th>
                  <th className="px-2 py-1.5 text-right font-medium">Ctns</th>
                  <th className="px-2 py-1.5 text-left font-medium">SC No</th>
                  <th className="px-2 py-1.5 text-left font-medium">PO No</th>
                  <th className="px-2 py-1.5 text-left font-medium">Country</th>
                  <th className="px-2 py-1.5 text-left font-medium">Ref No</th>
                  <th className="px-2 py-1.5 text-left font-medium">Assort Type</th>
                  <th className="px-2 py-1.5 text-left font-medium">Cust Order No</th>
                  <th className="px-2 py-1.5 text-center font-medium">Mult. Pack</th>
                  <th className="px-2 py-1.5 text-center font-medium">Assort</th>
                  <th className="px-2 py-1.5 text-right font-medium">Qty/Ctn</th>
                  <th className="px-2 py-1.5 text-right font-medium">Total Qty</th>
                  <th className="px-2 py-1.5 text-left font-medium">Unit</th>
                  <th className="px-2 py-1.5 text-left font-medium">Measurement</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((r, i) => (
                  <tr key={r.key} className="border-b border-border align-top last:border-0">
                    <td className="px-2 py-1 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1"><Input value={r.ctn_from} onChange={(e) => updateLine(r.key, { ctn_from: e.target.value })} className="h-8 w-20" /></td>
                    <td className="px-2 py-1"><Input value={r.ctn_to} onChange={(e) => updateLine(r.key, { ctn_to: e.target.value })} className="h-8 w-20" /></td>
                    <td className="px-2 py-1"><Input type="number" value={r.ctns} onChange={(e) => updateLine(r.key, { ctns: e.target.value })} className="h-8 w-20 text-right" /></td>
                    <td className="px-2 py-1 min-w-[180px]">
                      <RecordPicker label="SC No" compact items={orderItems} value={r.sc_no_id} onChange={(id) => updateLine(r.key, { sc_no_id: id })} />
                    </td>
                    <td className="px-2 py-1"><Input value={r.po_no} onChange={(e) => updateLine(r.key, { po_no: e.target.value })} className="h-8 w-28" /></td>
                    <td className="px-2 py-1 min-w-[160px]">
                      <CountryPicker compact countries={data.countries} value={r.country_id} onChange={(id) => updateLine(r.key, { country_id: id })} canCreate={masterPerms.canCreate} canEdit={masterPerms.canEdit} />
                    </td>
                    <td className="px-2 py-1"><Input value={r.ref_no} onChange={(e) => updateLine(r.key, { ref_no: e.target.value })} className="h-8 w-24" /></td>
                    <td className="px-2 py-1">
                      <Select value={r.assort_type} onChange={(e) => updateLine(r.key, { assort_type: e.target.value })} className="h-8 min-w-[130px]">
                        <option value="">—</option>
                        {ASSORT_TYPES.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1"><Input value={r.customer_order_no} onChange={(e) => updateLine(r.key, { customer_order_no: e.target.value })} className="h-8 w-28" /></td>
                    <td className="px-2 py-1 text-center">
                      <input type="checkbox" checked={r.multiple_pack} onChange={(e) => updateLine(r.key, { multiple_pack: e.target.checked })} className="h-4 w-4 rounded border-border" />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Button type="button" variant="outline" size="sm" disabled title="Nested Assort screen — awaiting spec">
                        Assort
                      </Button>
                    </td>
                    <td className="px-2 py-1"><Input type="number" value={r.qty_per_ctn} onChange={(e) => updateLine(r.key, { qty_per_ctn: e.target.value })} className="h-8 w-24 text-right" /></td>
                    <td className="px-2 py-1"><Input type="number" value={r.total_qty} onChange={(e) => updateLine(r.key, { total_qty: e.target.value })} className="h-8 w-24 text-right" /></td>
                    <td className="px-2 py-1 min-w-[140px]">
                      <RecordPicker label="Unit" compact items={data.uoms} value={r.unit_id} onChange={(id) => updateLine(r.key, { unit_id: id })} />
                    </td>
                    <td className="px-2 py-1"><Input value={r.measurement} onChange={(e) => updateLine(r.key, { measurement: e.target.value })} className="h-8 w-28" /></td>
                    <td className="px-2 py-1">
                      <RowRemove onClick={() => setLines((xs) => xs.filter((x) => x.key !== r.key))} />
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={17} className="px-2 py-6 text-center text-xs text-muted-foreground">
                      No lines. Use “Add row”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Footer */}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>
          Cancel
        </Button>
        {perms.canCreate && (
          <Button variant="outline" disabled={isPending || !canSave} onClick={() => submit("draft")}>
            Save as Draft
          </Button>
        )}
        <Button disabled={isPending || !canSave} onClick={() => submit("finalised")}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function RowRemove({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove row"
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-danger"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
