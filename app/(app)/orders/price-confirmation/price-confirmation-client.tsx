"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { createPriceConfirmation, confirmPriceConf, amendPriceConf, deletePriceConf, addPcPurchaseItem, addPcProcess } from "@/lib/orders/pricing-actions";
import { ITEM_CLASS_TYPES, PROCESS_TYPES } from "@/lib/orders/pricing-types";
import { RecordPicker } from "@/components/masters/record-picker";
import type { OrderOption } from "@/lib/orders/order-options";
import type { PriceConfirmationRow } from "@/lib/orders/pricing-service";
import type { StatusTone } from "@/components/ui/status-pill";
import { withCreatedColumns } from "@/components/ui/created-columns";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", confirmed: "success", amended: "warning", cancelled: "danger" };

// ---------------------------------------------------------------------------
// Purchase Item Inline Add (reused for yarn/fabric/accessories)
// ---------------------------------------------------------------------------
function PurchaseAddForm({ pcId, itemClassType, onDone }: { pcId: string; itemClassType: string; onDone: () => void }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [f, setF] = useState({ item_name: "", vendor_name: "", uom_id: "", reqd_qty: "", rate: "", currency_code: "INR", exchange_rate: "1" });

  function submit() {
    startTransition(async () => {
      const res = await addPcPurchaseItem({
        price_conf_id: pcId,
        item_class_type: itemClassType as (typeof ITEM_CLASS_TYPES)[number],
        item_name: f.item_name || null,
        vendor_name: f.vendor_name || null,
        uom_id: f.uom_id || null,
        reqd_qty: Number(f.reqd_qty) || 0,
        rate: Number(f.rate) || 0,
        currency_code: f.currency_code || null,
        exchange_rate: Number(f.exchange_rate) || 1,
        is_foc: false,
        is_import: false,
      });
      if (res.ok) { success("Item added."); onDone(); router.refresh(); }
      else error(res.error);
    });
  }

  return (
    // ONE MARKER, NEVER A HANDLER — an inline panel under a tab, not an overlay,
    // so `isEditorScope()` is false without it and Tab leaves the form.
    <div data-focus-scope className="space-y-3 rounded border border-border p-3">
      {/* `FieldGrid`, in place of a `flex gap-2 items-end flex-wrap` of
          `w-32` / `w-28` / `w-20` / `w-16` boxes. This form and the process one
          below it hold the SAME seven fields and sized four of them differently,
          on tabs the operator moves between — the drift is visible without
          leaving the screen. */}
      <FieldGrid>
        <Field label="Item" size="sm" htmlFor="pcp-item">
          <Input id="pcp-item" uppercase value={f.item_name} onChange={(e) => setF({ ...f, item_name: e.target.value })} />
        </Field>
        <Field label="Vendor" size="sm" htmlFor="pcp-vendor">
          <Input id="pcp-vendor" uppercase value={f.vendor_name} onChange={(e) => setF({ ...f, vendor_name: e.target.value })} />
        </Field>
        <Field label="UOM" size="sm" htmlFor="pcp-uom">
          <Input id="pcp-uom" uppercase value={f.uom_id} onChange={(e) => setF({ ...f, uom_id: e.target.value })} />
        </Field>
        <Field label="Qty" size="sm" htmlFor="pcp-qty">
          <Input id="pcp-qty" type="number" value={f.reqd_qty} onChange={(e) => setF({ ...f, reqd_qty: e.target.value })} />
        </Field>
        <Field label="Rate" size="sm" htmlFor="pcp-rate">
          <Input id="pcp-rate" type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        </Field>
        <Field label="Currency" size="sm" htmlFor="pcp-currency">
          <Input id="pcp-currency" uppercase maxLength={3} value={f.currency_code} onChange={(e) => setF({ ...f, currency_code: e.target.value })} />
        </Field>
        <Field label="Ex Rate" size="sm" htmlFor="pcp-exrate">
          <Input id="pcp-exrate" type="number" value={f.exchange_rate} onChange={(e) => setF({ ...f, exchange_rate: e.target.value })} />
        </Field>
      </FieldGrid>
      <Button size="sm" disabled={isPending} onClick={submit}>{isPending ? "Adding…" : "Add"}</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Process Inline Add (reused for all 5 process types)
// ---------------------------------------------------------------------------
function ProcessAddForm({ pcId, processType, onDone }: { pcId: string; processType: string; onDone: () => void }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [f, setF] = useState({ process_name: "", vendor_name: "", uom_id: "", qty: "", rate: "", currency_code: "INR", exchange_rate: "1" });

  function submit() {
    startTransition(async () => {
      const res = await addPcProcess({
        price_conf_id: pcId,
        process_type: processType as (typeof PROCESS_TYPES)[number],
        process_name: f.process_name || null,
        vendor_name: f.vendor_name || null,
        uom_id: f.uom_id || null,
        qty: Number(f.qty) || 0,
        rate: Number(f.rate) || 0,
        currency_code: f.currency_code || null,
        exchange_rate: Number(f.exchange_rate) || 1,
        is_foc: false,
      });
      if (res.ok) { success("Process added."); onDone(); router.refresh(); }
      else error(res.error);
    });
  }

  return (
    <div data-focus-scope className="space-y-3 rounded border border-border p-3">
      <FieldGrid>
        <Field label="Process" size="sm" htmlFor="pcx-process">
          <Input id="pcx-process" uppercase value={f.process_name} onChange={(e) => setF({ ...f, process_name: e.target.value })} />
        </Field>
        <Field label="Vendor" size="sm" htmlFor="pcx-vendor">
          <Input id="pcx-vendor" uppercase value={f.vendor_name} onChange={(e) => setF({ ...f, vendor_name: e.target.value })} />
        </Field>
        <Field label="UOM" size="sm" htmlFor="pcx-uom">
          <Input id="pcx-uom" uppercase value={f.uom_id} onChange={(e) => setF({ ...f, uom_id: e.target.value })} />
        </Field>
        <Field label="Qty" size="sm" htmlFor="pcx-qty">
          <Input id="pcx-qty" type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        </Field>
        <Field label="Rate" size="sm" htmlFor="pcx-rate">
          <Input id="pcx-rate" type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        </Field>
        <Field label="Currency" size="sm" htmlFor="pcx-currency">
          <Input id="pcx-currency" uppercase maxLength={3} value={f.currency_code} onChange={(e) => setF({ ...f, currency_code: e.target.value })} />
        </Field>
        {/* `exchange_rate` is sent as "1" and has no box here, unlike the
            purchase form beside it. Left as it stands: adding a field posts a
            value the operator has not been asked for on any process to date. */}
      </FieldGrid>
      <Button size="sm" disabled={isPending} onClick={submit}>{isPending ? "Adding…" : "Add"}</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category Tab (one per purchase/process type)
// ---------------------------------------------------------------------------
function CategoryTab({ pcId, type, kind }: { pcId: string; type: string; kind: "purchase" | "process" }) {
  const [adding, setAdding] = useState(false);
  const label = type.charAt(0).toUpperCase() + type.slice(1);

  // These tabs render inline under the table, not inside the "New Price
  // Confirmation" Sheet — nothing registers them with the reload guard. Guarding
  // here rather than inside the two add-forms covers both with one call, since
  // they only exist while `adding` is true.
  useUnsavedGuard(adding);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium">{label} {kind === "purchase" ? "Purchases" : "Processes"}</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : `+ Add ${label}`}</Button>
      </div>
      {adding && (
        kind === "purchase"
          ? <PurchaseAddForm pcId={pcId} itemClassType={type} onDone={() => setAdding(false)} />
          : <ProcessAddForm pcId={pcId} processType={type} onDone={() => setAdding(false)} />
      )}
      <p className="text-xs text-muted-foreground">Items are loaded when viewing the detail page.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function PriceConfirmationClient({
  rows,
  orders,
}: {
  rows: PriceConfirmationRow[];
  orders: OrderOption[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ sales_order_id: "", notes: "" });

  function submit() {
    startTransition(async () => {
      const res = await createPriceConfirmation({
        sales_order_id: form.sales_order_id,
        notes: form.notes || null,
      });
      if (res.ok) { success("Price confirmation created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<PriceConfirmationRow>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Order", cell: (r) => <span className="text-xs">{r.order_code ?? "—"}</span> },
    { header: "Amendment", align: "right", cell: (r) => <span className="tabular-nums">{r.amendment_sno}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    { header: "Created", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.created_at)}</span> },
    {
      /* Confirm / Amend are workflow — labelled column, Delete moves to the
         standard action cell (LAYOUT.md §6a). */
      header: "Workflow", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "draft" && <Button variant="outline" size="sm" onClick={() => startTransition(async () => { const res = await confirmPriceConf(r.id); if (res.ok) { success("Confirmed."); router.refresh(); } else error(res.error); })} disabled={isPending}>Confirm</Button>}
          {r.status === "confirmed" && <Button variant="outline" size="sm" onClick={() => startTransition(async () => { const res = await amendPriceConf(r.id); if (res.ok) { success("Amendment created."); router.refresh(); } else error(res.error); })} disabled={isPending}>Amend</Button>}
        </div>
      ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.code}
        onDelete={() => startTransition(async () => { const res = await deletePriceConf(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })}
        canDelete={r.status === "draft"}
        isPending={isPending}
      />
    )),
  ];

  // Build 9 category tabs for the selected PC
  const pcTabs = selectedId ? [
    { key: "yarn-purchase", label: "Yarn Purchases", content: <CategoryTab pcId={selectedId} type="yarn" kind="purchase" /> },
    { key: "fabric-purchase", label: "Fabric Purchases", content: <CategoryTab pcId={selectedId} type="fabric" kind="purchase" /> },
    { key: "acc-purchase", label: "Accessories", content: <CategoryTab pcId={selectedId} type="accessories" kind="purchase" /> },
    { key: "yarn-process", label: "Yarn Processes", content: <CategoryTab pcId={selectedId} type="yarn" kind="process" /> },
    { key: "fabric-process", label: "Fabric Processes", content: <CategoryTab pcId={selectedId} type="fabric" kind="process" /> },
    { key: "acc-process", label: "Acc Processes", content: <CategoryTab pcId={selectedId} type="accessories" kind="process" /> },
    { key: "garment-process", label: "Garment Processes", content: <CategoryTab pcId={selectedId} type="garment" kind="process" /> },
    { key: "cmt", label: "CMT Operations", content: <CategoryTab pcId={selectedId} type="unplanned" kind="process" /> },
    { key: "unplanned", label: "Unplanned", content: <CategoryTab pcId={selectedId} type="unplanned" kind="process" /> },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Price Confirmation</Button></div>
      <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No price confirmations yet." />

      {/* 9-tab detail panel for selected PC */}
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Price Details: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
          </div>
          <Tabs items={pcTabs} />
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Price Confirmation" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.sales_order_id} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          {/* `cols={12}` IS the field track — the same string `FieldGrid`
              renders. */}
          <DetailSection label="Details" cols={12}>
            {/* THE ORDER IS PICKED, NOT TYPED. Was `<Input placeholder="UUID">`.
                `<Field size>` + `compact` — the Field supplies the track span,
                `compact` drops the picker's own label so the two do not stack,
                and `required` is declared once. */}
            <Field label="Sales Order" required size="sm">
              <RecordPicker
                id="pc-order"
                label="Sales Order"
                compact
                items={orders}
                value={form.sales_order_id || null}
                onChange={(id) => setForm({ ...form, sales_order_id: id ?? "" })}
              />
            </Field>
            <Field label="Notes" size="sm" htmlFor="pc-notes">
              <Input id="pc-notes" uppercase value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
