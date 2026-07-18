"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate } from "@/lib/format";
import { createPriceConfirmation, confirmPriceConf, amendPriceConf, deletePriceConf, addPcPurchaseItem, addPcProcess } from "@/lib/orders/pricing-actions";
import { ITEM_CLASS_TYPES, PROCESS_TYPES } from "@/lib/orders/pricing-types";
import type { PriceConfirmationRow } from "@/lib/orders/pricing-service";
import type { StatusTone } from "@/components/ui/status-pill";

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
    <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
      <div><Label>Item</Label><Input className="w-32" value={f.item_name} onChange={(e) => setF({ ...f, item_name: e.target.value })} /></div>
      <div><Label>Vendor</Label><Input className="w-28" value={f.vendor_name} onChange={(e) => setF({ ...f, vendor_name: e.target.value })} /></div>
      <div><Label>UOM</Label><Input className="w-16" value={f.uom_id} onChange={(e) => setF({ ...f, uom_id: e.target.value })} /></div>
      <div><Label>Qty</Label><Input className="w-20" type="number" value={f.reqd_qty} onChange={(e) => setF({ ...f, reqd_qty: e.target.value })} /></div>
      <div><Label>Rate</Label><Input className="w-20" type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
      <div><Label>Currency</Label><Input className="w-16" value={f.currency_code} onChange={(e) => setF({ ...f, currency_code: e.target.value })} /></div>
      <div><Label>Ex Rate</Label><Input className="w-16" type="number" value={f.exchange_rate} onChange={(e) => setF({ ...f, exchange_rate: e.target.value })} /></div>
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
    <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
      <div><Label>Process</Label><Input className="w-32" value={f.process_name} onChange={(e) => setF({ ...f, process_name: e.target.value })} /></div>
      <div><Label>Vendor</Label><Input className="w-28" value={f.vendor_name} onChange={(e) => setF({ ...f, vendor_name: e.target.value })} /></div>
      <div><Label>UOM</Label><Input className="w-16" value={f.uom_id} onChange={(e) => setF({ ...f, uom_id: e.target.value })} /></div>
      <div><Label>Qty</Label><Input className="w-20" type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
      <div><Label>Rate</Label><Input className="w-20" type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
      <div><Label>Currency</Label><Input className="w-16" value={f.currency_code} onChange={(e) => setF({ ...f, currency_code: e.target.value })} /></div>
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

export function PriceConfirmationClient({ rows }: { rows: PriceConfirmationRow[] }) {
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
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "draft" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await confirmPriceConf(r.id); if (res.ok) { success("Confirmed."); router.refresh(); } else error(res.error); })} disabled={isPending}>Confirm</Button>}
          {r.status === "confirmed" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await amendPriceConf(r.id); if (res.ok) { success("Amendment created."); router.refresh(); } else error(res.error); })} disabled={isPending}>Amend</Button>}
          {r.status === "draft" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deletePriceConf(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
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
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No price confirmations yet." />

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
          <DetailSection label="Details">
            <div><Label>Sales Order ID *</Label><Input value={form.sales_order_id} onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
