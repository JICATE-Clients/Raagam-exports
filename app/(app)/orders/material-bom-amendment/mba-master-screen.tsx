"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createMaterialBomAmendment,
  updateMaterialBomAmendment,
  deleteMaterialBomAmendment,
} from "@/lib/orders/material-bom-amendment/actions";
import {
  MATERIAL_TYPE_OPTIONS,
  SUPPLY_TYPE_OPTIONS,
  mbaStatusTone,
  mbaStatusText,
  type MaterialBomAmendment,
} from "@/lib/orders/material-bom-amendment/types";
import type { MbaFormData } from "@/lib/orders/material-bom-amendment/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Tab = "items" | "processes" | "calc";

interface Props {
  rows: MaterialBomAmendment[];
  data: MbaFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

type ItemRow = {
  key: string;
  category_id: string | null;
  type: string;
  item_id: string | null;
  attribute_id: string | null;
  supply_type: string;
  vendor_id: string | null;
  purchase_uom_id: string | null;
  consumption_uom_id: string | null;
  alternate_uom_id: string | null;
  combination: string;
  moq: string;
  quantity_nos: string;
};
type ProcRow = { key: string; item_id: string | null };

type HeaderForm = {
  sales_order_id: string | null;
  customer_id: string | null;
  amend_date: string;
  remarks: string;
};

const BLANK: HeaderForm = {
  sales_order_id: null,
  customer_id: null,
  amend_date: "",
  remarks: "",
};

const blankItem = (key: string): ItemRow => ({
  key,
  category_id: null,
  type: "",
  item_id: null,
  attribute_id: null,
  supply_type: "",
  vendor_id: null,
  purchase_uom_id: null,
  consumption_uom_id: null,
  alternate_uom_id: null,
  combination: "",
  moq: "",
  quantity_nos: "",
});

const today = () => new Date().toISOString().slice(0, 10);

export function MbaMasterScreen({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [amendmentNo, setAmendmentNo] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [procs, setProcs] = useState<ProcRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const materialCategories = useMemo(
    () => data.lookups.filter((l) => l.kind === "material_category"),
    [data.lookups],
  );
  const materialAttributes = useMemo(
    () => data.lookups.filter((l) => l.kind === "material_attribute"),
    [data.lookups],
  );

  const orderItems = useMemo(
    () =>
      data.orders.map((o) => ({
        id: o.id,
        code: o.order_number,
        name: o.buyer_name ?? "—",
      })),
    [data.orders],
  );
  const selectedOrder = useMemo(
    () => data.orders.find((o) => o.id === form.sales_order_id) ?? null,
    [data.orders, form.sales_order_id],
  );

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));
  const updItem = (key: string, patch: Partial<ItemRow>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const updProc = (key: string, patch: Partial<ProcRow>) =>
    setProcs((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function openAdd() {
    setEditId(null);
    setAmendmentNo(null);
    setForm({ ...BLANK, amend_date: today() });
    setItems([blankItem(newKey())]);
    setProcs([{ key: newKey(), item_id: null }]);
    setTab("items");
    setMode("edit");
  }

  function openEdit(r: MaterialBomAmendment) {
    setEditId(r.id);
    setAmendmentNo(r.amendment_no);
    setForm({
      sales_order_id: r.sales_order_id,
      customer_id: r.customer_id,
      amend_date: r.amend_date ?? today(),
      remarks: r.remarks ?? "",
    });
    setItems(
      r.items.map((c) => ({
        key: newKey(),
        category_id: c.category_id,
        type: c.type ?? "",
        item_id: c.item_id,
        attribute_id: c.attribute_id,
        supply_type: c.supply_type ?? "",
        vendor_id: c.vendor_id,
        purchase_uom_id: c.purchase_uom_id,
        consumption_uom_id: c.consumption_uom_id,
        alternate_uom_id: c.alternate_uom_id,
        combination: c.combination ?? "",
        moq: c.moq != null ? String(c.moq) : "",
        quantity_nos: c.quantity_nos != null ? String(c.quantity_nos) : "",
      })),
    );
    setProcs(r.processes.map((p) => ({ key: newKey(), item_id: p.item_id })));
    setTab("items");
    setMode("edit");
  }

  function submit(asDraft: boolean) {
    const payload = {
      sales_order_id: form.sales_order_id,
      customer_id: form.customer_id,
      amend_date: form.amend_date,
      remarks: form.remarks || null,
      is_draft: asDraft,
      items: items.map((c) => ({
        sno: 0,
        category_id: c.category_id,
        type: c.type || null,
        item_id: c.item_id,
        attribute_id: c.attribute_id,
        supply_type: c.supply_type || null,
        vendor_id: c.vendor_id,
        purchase_uom_id: c.purchase_uom_id,
        consumption_uom_id: c.consumption_uom_id,
        alternate_uom_id: c.alternate_uom_id,
        combination: c.combination || null,
        moq: c.moq ? Number(c.moq) : null,
        quantity_nos: c.quantity_nos ? Number(c.quantity_nos) : null,
      })),
      processes: procs.map((p) => ({ sno: 0, item_id: p.item_id })),
    };
    start(async () => {
      const res = editId
        ? await updateMaterialBomAmendment(editId, payload)
        : await createMaterialBomAmendment(payload);
      if (res.ok) {
        success(editId ? "Amendment updated" : "Amendment created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: MaterialBomAmendment) {
    if (!confirm(`Delete amendment ${r.code ?? ""}?`)) return;
    start(async () => {
      const res = await deleteMaterialBomAmendment(r.id);
      if (res.ok) {
        success("Amendment deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST MODE ----------------
  if (mode === "list") {
    const columns: Column<MaterialBomAmendment>[] = [
      {
        header: "Entry No",
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
      {
        header: "Customer",
        cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span>,
      },
      {
        header: "Order",
        cell: (r) => (
          <span className="font-mono text-xs">
            {r.sales_orders?.order_number ?? "—"}
          </span>
        ),
      },
      {
        header: "A. No",
        align: "right",
        cell: (r) => <span className="tabular-nums text-sm">{r.amendment_no}</span>,
      },
      {
        header: "Date",
        align: "right",
        cell: (r) => (
          <span className="tabular-nums text-xs text-muted-foreground">
            {fmtDate(r.amend_date)}
          </span>
        ),
      },
      {
        header: "Status",
        cell: (r) => (
          <StatusPill tone={mbaStatusTone(r.is_draft)}>
            {mbaStatusText(r.is_draft)}
          </StatusPill>
        ),
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
        {perms.canCreate && (
          <div className="flex justify-end">
            <Button onClick={openAdd}>New Amendment</Button>
          </div>
        )}
        <DataTable
          columns={columns}
          rows={rows}
          getKey={(r) => r.id}
          empty="No material BOM amendments yet. Use 'New Amendment' to create the first."
        />
      </div>
    );
  }

  // ---------------- EDIT MODE ----------------
  const canSave = !!form.amend_date && !!form.sales_order_id;
  const orderQty = selectedOrder?.order_qty ?? 0;
  const catName = (id: string | null) =>
    materialCategories.find((l) => l.id === id)?.name ?? "—";
  const itemName = (id: string | null) =>
    data.items.find((i) => i.id === id)?.name ?? "—";
  const uomName = (id: string | null) =>
    data.uoms.find((u) => u.id === id)?.name ?? "—";

  const calcRows = items
    .filter((r) => r.item_id || r.category_id || r.quantity_nos)
    .map((r, i) => {
      const per = r.quantity_nos ? Number(r.quantity_nos) : null;
      return {
        sno: i + 1,
        category: catName(r.category_id),
        description: itemName(r.item_id),
        uom: uomName(r.consumption_uom_id ?? r.purchase_uom_id),
        calc_qty: per != null ? per * orderQty : null,
        order_qty: orderQty,
      };
    });

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={
        "border-b-2 px-4 py-2 text-sm font-medium " +
        (tab === t
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>Entry No</Label>
            <div className="flex h-9 items-center rounded-md border border-border bg-surface-muted px-3 font-mono text-sm text-muted-foreground">
              {editId ? "—" : "Auto"}
            </div>
          </div>
          <div>
            <Label htmlFor="mba-date">Date *</Label>
            <Input
              id="mba-date"
              type="date"
              value={form.amend_date}
              onChange={(e) => set({ amend_date: e.target.value })}
            />
          </div>
          <CustomerPicker
            customers={data.customers}
            value={form.customer_id}
            onChange={(id) => set({ customer_id: id })}
            label="Customer"
          />
          <div>
            <Label>A. No</Label>
            <div className="flex h-9 items-center rounded-md border border-border bg-surface-muted px-3 text-sm text-muted-foreground">
              {amendmentNo ?? "Auto"}
            </div>
          </div>
          <RecordPicker
            label="SC No / Order"
            items={orderItems}
            value={form.sales_order_id}
            onChange={(id) => set({ sales_order_id: id })}
            required
          />
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="mba-remarks">Remarks</Label>
            <Input
              id="mba-remarks"
              value={form.remarks}
              onChange={(e) => set({ remarks: e.target.value })}
              placeholder="Optional"
            />
          </div>
        </CardBody>
      </Card>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabBtn("items", "Items")}
        {tabBtn("processes", "Processes")}
        {tabBtn("calc", "Calculated Quantities")}
      </div>

      {/* Items tab */}
      {tab === "items" && (
        <Card>
          <CardBody>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Item Details</h3>
              <Button
                type="button"
                variant="subtle"
                size="sm"
                onClick={() => setItems((xs) => [...xs, blankItem(newKey())])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add row
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1400px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                    <th className="w-10 px-2 py-1.5 text-left font-medium">S No</th>
                    <th className="px-2 py-1.5 text-left font-medium">Category</th>
                    <th className="px-2 py-1.5 text-left font-medium">Type</th>
                    <th className="px-2 py-1.5 text-left font-medium">Item</th>
                    <th className="px-2 py-1.5 text-left font-medium">Attribute</th>
                    <th className="px-2 py-1.5 text-left font-medium">Supply Type</th>
                    <th className="px-2 py-1.5 text-left font-medium">Vendor</th>
                    <th className="px-2 py-1.5 text-left font-medium">Purchase Uom</th>
                    <th className="px-2 py-1.5 text-left font-medium">Consumption Uom</th>
                    <th className="px-2 py-1.5 text-left font-medium">Alternate Uom</th>
                    <th className="px-2 py-1.5 text-left font-medium">Combination</th>
                    <th className="px-2 py-1.5 text-right font-medium">MOQ</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => (
                    <tr key={r.key} className="border-b border-border last:border-0">
                      <td className="px-2 py-1 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-1 min-w-[150px]">
                        <LookupDialogPicker
                          kind="material_category"
                          label="Category"
                          options={materialCategories}
                          value={r.category_id}
                          onChange={(id) => updItem(r.key, { category_id: id })}
                          canCreate={masterPerms.canCreate}
                          canEdit={masterPerms.canEdit}
                          compact
                        />
                      </td>
                      <td className="px-2 py-1 min-w-[110px]">
                        <Select
                          value={r.type}
                          onChange={(e) => updItem(r.key, { type: e.target.value })}
                          className="h-8"
                        >
                          <option value="">—</option>
                          {MATERIAL_TYPE_OPTIONS.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1 min-w-[160px]">
                        <RecordPicker
                          label="Item"
                          items={data.items}
                          value={r.item_id}
                          onChange={(id) => updItem(r.key, { item_id: id })}
                          compact
                        />
                      </td>
                      <td className="px-2 py-1 min-w-[150px]">
                        <LookupDialogPicker
                          kind="material_attribute"
                          label="Attribute"
                          options={materialAttributes}
                          value={r.attribute_id}
                          onChange={(id) => updItem(r.key, { attribute_id: id })}
                          canCreate={masterPerms.canCreate}
                          canEdit={masterPerms.canEdit}
                          compact
                        />
                      </td>
                      <td className="px-2 py-1 min-w-[120px]">
                        <Select
                          value={r.supply_type}
                          onChange={(e) => updItem(r.key, { supply_type: e.target.value })}
                          className="h-8"
                        >
                          <option value="">—</option>
                          {SUPPLY_TYPE_OPTIONS.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1 min-w-[150px]">
                        <RecordPicker
                          label="Vendor"
                          items={data.vendors}
                          value={r.vendor_id}
                          onChange={(id) => updItem(r.key, { vendor_id: id })}
                          compact
                        />
                      </td>
                      <td className="px-2 py-1 min-w-[130px]">
                        <RecordPicker
                          label="Purchase Uom"
                          items={data.uoms}
                          value={r.purchase_uom_id}
                          onChange={(id) => updItem(r.key, { purchase_uom_id: id })}
                          compact
                        />
                      </td>
                      <td className="px-2 py-1 min-w-[130px]">
                        <RecordPicker
                          label="Consumption Uom"
                          items={data.uoms}
                          value={r.consumption_uom_id}
                          onChange={(id) => updItem(r.key, { consumption_uom_id: id })}
                          compact
                        />
                      </td>
                      <td className="px-2 py-1 min-w-[130px]">
                        <RecordPicker
                          label="Alternate Uom"
                          items={data.uoms}
                          value={r.alternate_uom_id}
                          onChange={(id) => updItem(r.key, { alternate_uom_id: id })}
                          compact
                        />
                      </td>
                      <td className="px-2 py-1 min-w-[120px]">
                        <Input
                          value={r.combination}
                          onChange={(e) => updItem(r.key, { combination: e.target.value })}
                          className="h-8"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={r.moq}
                          onChange={(e) => updItem(r.key, { moq: e.target.value })}
                          className="h-8 w-20 text-right"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={r.quantity_nos}
                          onChange={(e) => updItem(r.key, { quantity_nos: e.target.value })}
                          className="h-8 w-20 text-right"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <RowRemove onClick={() => setItems((xs) => xs.filter((x) => x.key !== r.key))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Processes tab */}
      {tab === "processes" && (
        <Card>
          <CardBody>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Detail</h3>
              <Button
                type="button"
                variant="subtle"
                size="sm"
                onClick={() => setProcs((xs) => [...xs, { key: newKey(), item_id: null }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add row
              </Button>
            </div>
            <div className="max-w-xl space-y-2">
              {procs.map((r, i) => (
                <div key={r.key} className="flex items-center gap-2">
                  <span className="w-8 text-xs text-muted-foreground">{i + 1}</span>
                  <div className="flex-1">
                    <RecordPicker
                      label="Item"
                      items={data.items}
                      value={r.item_id}
                      onChange={(id) => updProc(r.key, { item_id: id })}
                      compact
                    />
                  </div>
                  <RowRemove onClick={() => setProcs((xs) => xs.filter((x) => x.key !== r.key))} />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Calculated Quantities tab (read-only, provisional) */}
      {tab === "calc" && (
        <Card>
          <CardBody>
            <p className="mb-3 text-xs text-muted-foreground">
              Provisional calculation — Calc Qty = per-piece Qty × order qty
              {selectedOrder ? ` (${fmtNumber(orderQty)})` : " (select an order)"}.
              Process / Size mapping pending the legacy formula.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                    <th className="w-10 px-3 py-1.5 text-left font-medium">S No</th>
                    <th className="px-3 py-1.5 text-left font-medium">Category</th>
                    <th className="px-3 py-1.5 text-left font-medium">Description</th>
                    <th className="px-3 py-1.5 text-left font-medium">Process</th>
                    <th className="px-3 py-1.5 text-left font-medium">Size</th>
                    <th className="px-3 py-1.5 text-left font-medium">Uom</th>
                    <th className="px-3 py-1.5 text-right font-medium">Calc Qty</th>
                    <th className="px-3 py-1.5 text-right font-medium">Order Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {calcRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        Add items with a quantity to see calculated requirements.
                      </td>
                    </tr>
                  ) : (
                    calcRows.map((r) => (
                      <tr key={r.sno} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.sno}</td>
                        <td className="px-3 py-1.5">{r.category}</td>
                        <td className="px-3 py-1.5">{r.description}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">—</td>
                        <td className="px-3 py-1.5 text-muted-foreground">—</td>
                        <td className="px-3 py-1.5">{r.uom}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {r.calc_qty != null ? fmtNumber(r.calc_qty) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {fmtNumber(r.order_qty)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Footer */}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>
          Cancel
        </Button>
        {perms.canCreate && (
          <Button variant="outline" disabled={isPending || !canSave} onClick={() => submit(true)}>
            Save as Draft
          </Button>
        )}
        <Button disabled={isPending || !canSave} onClick={() => submit(false)}>
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
