"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate } from "@/lib/format";
import { createMaterialRateEntry, addMaterialRateItem, deleteMaterialRateEntry } from "@/lib/planning/config-actions";
import type { MaterialRateRow } from "@/lib/planning/config-service";

export function MaterialRatesClient({ rows }: { rows: MaterialRateRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [itemForm, setItemForm] = useState({ item_class_name: "", description: "", process_name: "", rate_uom_id: "", rate: "" });
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    group_description: "",
    notes: "",
    items: [] as { item_class_name: string; description: string; process_name: string; rate_uom_id: string; rate: string }[],
  });

  function addFormItem() {
    setForm({ ...form, items: [...form.items, { item_class_name: "", description: "", process_name: "", rate_uom_id: "", rate: "0" }] });
  }
  function removeFormItem(i: number) { setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) }); }
  function updateFormItem(i: number, field: string, val: string) {
    setForm({ ...form, items: form.items.map((it, idx) => idx === i ? { ...it, [field]: val } : it) });
  }

  function submit() {
    startTransition(async () => {
      const res = await createMaterialRateEntry({
        entry_date: form.entry_date,
        group_description: form.group_description || null,
        notes: form.notes || null,
        items: form.items.map(it => ({
          item_class_name: it.item_class_name || null,
          description: it.description || null,
          process_name: it.process_name || null,
          rate_uom_id: it.rate_uom_id || null,
          rate: Number(it.rate) || 0,
        })),
      });
      if (res.ok) { success("Created."); setOpen(false); setForm({ entry_date: new Date().toISOString().slice(0, 10), group_description: "", notes: "", items: [] }); router.refresh(); }
      else error(res.error);
    });
  }

  function submitItem() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addMaterialRateItem(selectedId, {
        item_class_name: itemForm.item_class_name || null,
        description: itemForm.description || null,
        process_name: itemForm.process_name || null,
        rate_uom_id: itemForm.rate_uom_id || null,
        rate: Number(itemForm.rate) || 0,
      });
      if (res.ok) { success("Item added."); setAddingItem(false); setItemForm({ item_class_name: "", description: "", process_name: "", rate_uom_id: "", rate: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<MaterialRateRow>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.entry_date)}</span> },
    { header: "Group", cell: (r) => r.group_description ?? "—" },
    { header: "Customer", cell: (r) => r.buyer_name ?? "—" },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteMaterialRateEntry(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Rate Entry</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No material rate entries yet." />

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
              <div><Label>Item Class</Label><Input className="w-24" value={itemForm.item_class_name} onChange={(e) => setItemForm({ ...itemForm, item_class_name: e.target.value })} /></div>
              <div><Label>Description</Label><Input className="w-32" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /></div>
              <div><Label>Process</Label><Input className="w-24" value={itemForm.process_name} onChange={(e) => setItemForm({ ...itemForm, process_name: e.target.value })} /></div>
              <div><Label>UOM</Label><Input className="w-16" value={itemForm.rate_uom_id} onChange={(e) => setItemForm({ ...itemForm, rate_uom_id: e.target.value })} /></div>
              <div><Label>Rate</Label><Input className="w-20" type="number" value={itemForm.rate} onChange={(e) => setItemForm({ ...itemForm, rate: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={submitItem}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Material Rate Entry" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label>Date</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
            <div><Label>Group Description</Label><Input value={form.group_description} onChange={(e) => setForm({ ...form, group_description: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Rate Items">
            <div className="flex justify-end mb-2"><Button type="button" variant="outline" size="sm" onClick={addFormItem}>+ Add Item</Button></div>
            {form.items.map((it, i) => (
              <div key={i} className="flex gap-2 items-end mb-2">
                <div><Label>Class</Label><Input className="w-20" value={it.item_class_name} onChange={(e) => updateFormItem(i, "item_class_name", e.target.value)} /></div>
                <div className="flex-1"><Label>Description</Label><Input value={it.description} onChange={(e) => updateFormItem(i, "description", e.target.value)} /></div>
                <div><Label>Process</Label><Input className="w-20" value={it.process_name} onChange={(e) => updateFormItem(i, "process_name", e.target.value)} /></div>
                <div><Label>UOM</Label><Input className="w-14" value={it.rate_uom_id} onChange={(e) => updateFormItem(i, "rate_uom_id", e.target.value)} /></div>
                <div><Label>Rate</Label><Input className="w-20" type="number" value={it.rate} onChange={(e) => updateFormItem(i, "rate", e.target.value)} /></div>
                <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeFormItem(i)}>x</Button>
              </div>
            ))}
            {form.items.length === 0 && <p className="text-xs text-muted-foreground">No items. Add rate items.</p>}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
