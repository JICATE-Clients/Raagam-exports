"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate } from "@/lib/format";
import { createIndentConversion, convertIndent, addConversionItem, deleteIndentConversion } from "@/lib/planning/indent-actions";
import type { IndentConversionRow } from "@/lib/planning/indent-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { pending: "neutral", converted: "success", cancelled: "danger" };

export function IndentToPurchaseClient({ rows }: { rows: IndentConversionRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [itemForm, setItemForm] = useState({ item_class_name: "", item_description: "", uom_id: "", qty: "", rate: "", vendor_name: "", required_date: "" });
  const [form, setForm] = useState({
    indent_id: "",
    conversion_date: new Date().toISOString().slice(0, 10),
    notes: "",
    items: [] as { item_class_name: string; item_description: string; uom_id: string; qty: string; rate: string; vendor_name: string; required_date: string }[],
  });

  function addFormItem() {
    setForm({ ...form, items: [...form.items, { item_class_name: "", item_description: "", uom_id: "", qty: "0", rate: "0", vendor_name: "", required_date: "" }] });
  }
  function removeFormItem(i: number) { setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) }); }
  function updateFormItem(i: number, field: string, val: string) {
    setForm({ ...form, items: form.items.map((it, idx) => idx === i ? { ...it, [field]: val } : it) });
  }

  function submit() {
    startTransition(async () => {
      const res = await createIndentConversion({
        indent_id: form.indent_id,
        conversion_date: form.conversion_date,
        notes: form.notes || null,
        items: form.items.map(it => ({
          item_class_name: it.item_class_name || null,
          item_description: it.item_description || null,
          uom_id: it.uom_id || null,
          qty: Number(it.qty) || 0,
          rate: Number(it.rate) || 0,
          vendor_name: it.vendor_name || null,
          required_date: it.required_date || null,
        })),
      });
      if (res.ok) { success("Conversion created."); setOpen(false); setForm({ indent_id: "", conversion_date: new Date().toISOString().slice(0, 10), notes: "", items: [] }); router.refresh(); }
      else error(res.error);
    });
  }

  function submitItem() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addConversionItem(selectedId, {
        item_class_name: itemForm.item_class_name || null,
        item_description: itemForm.item_description || null,
        uom_id: itemForm.uom_id || null,
        qty: Number(itemForm.qty) || 0,
        rate: Number(itemForm.rate) || 0,
        vendor_name: itemForm.vendor_name || null,
        required_date: itemForm.required_date || null,
      });
      if (res.ok) { success("Item added."); setAddingItem(false); setItemForm({ item_class_name: "", item_description: "", uom_id: "", qty: "", rate: "", vendor_name: "", required_date: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<IndentConversionRow>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Indent", cell: (r) => <span className="text-xs">{r.indent_code ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.conversion_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    { header: "Notes", cell: (r) => <span className="text-xs text-muted-foreground line-clamp-1">{r.notes ?? "—"}</span> },
    {
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "pending" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await convertIndent(r.id); if (res.ok) { success("Converted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Convert to PO</Button>}
          {r.status === "pending" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteIndentConversion(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Conversion</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No indent conversions yet." />

      {/* Child items panel */}
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Items for: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingItem(!addingItem)}>{addingItem ? "Cancel" : "+ Add Item"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingItem && (
            <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
              <div><Label>Class</Label><Input className="w-20" value={itemForm.item_class_name} onChange={(e) => setItemForm({ ...itemForm, item_class_name: e.target.value })} /></div>
              <div><Label>Description</Label><Input className="w-32" value={itemForm.item_description} onChange={(e) => setItemForm({ ...itemForm, item_description: e.target.value })} /></div>
              <div><Label>UOM</Label><Input className="w-14" value={itemForm.uom_id} onChange={(e) => setItemForm({ ...itemForm, uom_id: e.target.value })} /></div>
              <div><Label>Qty</Label><Input className="w-16" type="number" value={itemForm.qty} onChange={(e) => setItemForm({ ...itemForm, qty: e.target.value })} /></div>
              <div><Label>Rate</Label><Input className="w-16" type="number" value={itemForm.rate} onChange={(e) => setItemForm({ ...itemForm, rate: e.target.value })} /></div>
              <div><Label>Vendor</Label><Input className="w-24" value={itemForm.vendor_name} onChange={(e) => setItemForm({ ...itemForm, vendor_name: e.target.value })} /></div>
              <div><Label>Required</Label><Input className="w-28" type="date" value={itemForm.required_date} onChange={(e) => setItemForm({ ...itemForm, required_date: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={submitItem}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Indent Conversion" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.indent_id} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label>Indent ID *</Label><Input value={form.indent_id} onChange={(e) => setForm({ ...form, indent_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label>Conversion Date</Label><Input type="date" value={form.conversion_date} onChange={(e) => setForm({ ...form, conversion_date: e.target.value })} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Items">
            <div className="flex justify-end mb-2"><Button type="button" variant="outline" size="sm" onClick={addFormItem}>+ Add Item</Button></div>
            {form.items.map((it, i) => (
              <div key={i} className="flex gap-2 items-end mb-2 flex-wrap">
                <div><Label>Class</Label><Input className="w-16" value={it.item_class_name} onChange={(e) => updateFormItem(i, "item_class_name", e.target.value)} /></div>
                <div className="flex-1"><Label>Description</Label><Input value={it.item_description} onChange={(e) => updateFormItem(i, "item_description", e.target.value)} /></div>
                <div><Label>UOM</Label><Input className="w-12" value={it.uom_id} onChange={(e) => updateFormItem(i, "uom_id", e.target.value)} /></div>
                <div><Label>Qty</Label><Input className="w-14" type="number" value={it.qty} onChange={(e) => updateFormItem(i, "qty", e.target.value)} /></div>
                <div><Label>Rate</Label><Input className="w-14" type="number" value={it.rate} onChange={(e) => updateFormItem(i, "rate", e.target.value)} /></div>
                <div><Label>Vendor</Label><Input className="w-20" value={it.vendor_name} onChange={(e) => updateFormItem(i, "vendor_name", e.target.value)} /></div>
                <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeFormItem(i)}>x</Button>
              </div>
            ))}
            {form.items.length === 0 && <p className="text-xs text-muted-foreground">No items. Add items to convert.</p>}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
