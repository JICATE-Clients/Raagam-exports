"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate } from "@/lib/format";
import { createMaterialExcessPlan, addExcessPlanItem, deleteMaterialExcessPlan } from "@/lib/planning/excess-consumption-actions";
import { ALLOWANCE_TYPES } from "@/lib/planning/excess-consumption-types";
import type { MaterialExcessPlanRow } from "@/lib/planning/excess-consumption-service";

export function MaterialExcessPlanClient({ rows }: { rows: MaterialExcessPlanRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [itemForm, setItemForm] = useState({ item_class_name: "", description: "", uom_id: "", qty_for_plan: "", at_order: "pct", av_order: "", at_issue: "pct", av_issue: "", at_receive: "pct", av_receive: "" });
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    sq_no: "", sq_description: "", notes: "",
    items: [] as { item_class_name: string; description: string; uom_id: string; qty_for_plan: string; at_order: string; av_order: string; at_issue: string; av_issue: string; at_receive: string; av_receive: string }[],
  });

  function addFormItem() {
    setForm({ ...form, items: [...form.items, { item_class_name: "", description: "", uom_id: "", qty_for_plan: "0", at_order: "pct", av_order: "0", at_issue: "pct", av_issue: "0", at_receive: "pct", av_receive: "0" }] });
  }
  function removeFormItem(i: number) { setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) }); }
  function updateFormItem(i: number, field: string, val: string) {
    setForm({ ...form, items: form.items.map((it, idx) => idx === i ? { ...it, [field]: val } : it) });
  }

  function submit() {
    startTransition(async () => {
      const res = await createMaterialExcessPlan({
        entry_date: form.entry_date,
        is_allowance_from_base: false,
        sq_no: form.sq_no || null,
        sq_description: form.sq_description || null,
        notes: form.notes || null,
        items: form.items.map(it => ({
          item_class_name: it.item_class_name || null,
          description: it.description || null,
          uom_id: it.uom_id || null,
          qty_for_plan: Number(it.qty_for_plan) || 0,
          allowance_type_order: (it.at_order as (typeof ALLOWANCE_TYPES)[number]) || null,
          allowance_value_order: Number(it.av_order) || 0,
          allowance_type_issue: (it.at_issue as (typeof ALLOWANCE_TYPES)[number]) || null,
          allowance_value_issue: Number(it.av_issue) || 0,
          allowance_type_receive: (it.at_receive as (typeof ALLOWANCE_TYPES)[number]) || null,
          allowance_value_receive: Number(it.av_receive) || 0,
        })),
      });
      if (res.ok) { success("Created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  function submitItem() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addExcessPlanItem(selectedId, {
        item_class_name: itemForm.item_class_name || null,
        description: itemForm.description || null,
        uom_id: itemForm.uom_id || null,
        qty_for_plan: Number(itemForm.qty_for_plan) || 0,
        allowance_type_order: (itemForm.at_order as (typeof ALLOWANCE_TYPES)[number]) || null,
        allowance_value_order: Number(itemForm.av_order) || 0,
        allowance_type_issue: (itemForm.at_issue as (typeof ALLOWANCE_TYPES)[number]) || null,
        allowance_value_issue: Number(itemForm.av_issue) || 0,
        allowance_type_receive: (itemForm.at_receive as (typeof ALLOWANCE_TYPES)[number]) || null,
        allowance_value_receive: Number(itemForm.av_receive) || 0,
      });
      if (res.ok) { success("Item added."); setAddingItem(false); setItemForm({ item_class_name: "", description: "", uom_id: "", qty_for_plan: "", at_order: "pct", av_order: "", at_issue: "pct", av_issue: "", at_receive: "pct", av_receive: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<MaterialExcessPlanRow>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.entry_date)}</span> },
    { header: "SQ No", cell: (r) => r.sq_no ?? "—" },
    { header: "Description", cell: (r) => r.sq_description ?? "—" },
    { header: "Customer", cell: (r) => r.buyer_name ?? "—" },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteMaterialExcessPlan(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  const atOptions = ALLOWANCE_TYPES.map(t => <option key={t} value={t}>{t === "pct" ? "%" : t === "qty" ? "Qty" : t === "mtr" ? "Mtr" : "Wt"}</option>);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Excess Plan</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No material excess plans yet." />

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
            <div className="space-y-2 rounded border border-border p-3">
              <div className="flex gap-2 items-end flex-wrap">
                <div><Label>Class</Label><Input className="w-20" value={itemForm.item_class_name} onChange={(e) => setItemForm({ ...itemForm, item_class_name: e.target.value })} /></div>
                <div><Label>Description</Label><Input className="w-32" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /></div>
                <div><Label>UOM</Label><Input className="w-14" value={itemForm.uom_id} onChange={(e) => setItemForm({ ...itemForm, uom_id: e.target.value })} /></div>
                <div><Label>Plan Qty</Label><Input className="w-20" type="number" value={itemForm.qty_for_plan} onChange={(e) => setItemForm({ ...itemForm, qty_for_plan: e.target.value })} /></div>
              </div>
              <div className="flex gap-2 items-end flex-wrap text-xs">
                <div><Label>Order Type</Label><Select className="w-16" value={itemForm.at_order} onChange={(e) => setItemForm({ ...itemForm, at_order: e.target.value })}>{atOptions}</Select></div>
                <div><Label>Order Val</Label><Input className="w-16" type="number" value={itemForm.av_order} onChange={(e) => setItemForm({ ...itemForm, av_order: e.target.value })} /></div>
                <div><Label>Issue Type</Label><Select className="w-16" value={itemForm.at_issue} onChange={(e) => setItemForm({ ...itemForm, at_issue: e.target.value })}>{atOptions}</Select></div>
                <div><Label>Issue Val</Label><Input className="w-16" type="number" value={itemForm.av_issue} onChange={(e) => setItemForm({ ...itemForm, av_issue: e.target.value })} /></div>
                <div><Label>Recv Type</Label><Select className="w-16" value={itemForm.at_receive} onChange={(e) => setItemForm({ ...itemForm, at_receive: e.target.value })}>{atOptions}</Select></div>
                <div><Label>Recv Val</Label><Input className="w-16" type="number" value={itemForm.av_receive} onChange={(e) => setItemForm({ ...itemForm, av_receive: e.target.value })} /></div>
                <Button size="sm" disabled={isPending} onClick={submitItem}>{isPending ? "Adding…" : "Add"}</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Material Excess Plan" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label>Date</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
            <div><Label>SQ No</Label><Input value={form.sq_no} onChange={(e) => setForm({ ...form, sq_no: e.target.value })} /></div>
            <div><Label>Description</Label><Input value={form.sq_description} onChange={(e) => setForm({ ...form, sq_description: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Allowance Items">
            <div className="flex justify-end mb-2"><Button type="button" variant="outline" size="sm" onClick={addFormItem}>+ Add Item</Button></div>
            {form.items.map((it, i) => (
              <div key={i} className="mb-3 rounded border border-border p-2 space-y-1">
                <div className="flex gap-2 items-end flex-wrap">
                  <div><Label>Class</Label><Input className="w-16" value={it.item_class_name} onChange={(e) => updateFormItem(i, "item_class_name", e.target.value)} /></div>
                  <div className="flex-1"><Label>Description</Label><Input value={it.description} onChange={(e) => updateFormItem(i, "description", e.target.value)} /></div>
                  <div><Label>UOM</Label><Input className="w-12" value={it.uom_id} onChange={(e) => updateFormItem(i, "uom_id", e.target.value)} /></div>
                  <div><Label>Qty</Label><Input className="w-16" type="number" value={it.qty_for_plan} onChange={(e) => updateFormItem(i, "qty_for_plan", e.target.value)} /></div>
                  <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeFormItem(i)}>x</Button>
                </div>
                <div className="flex gap-1 items-end flex-wrap text-xs">
                  <span className="text-muted-foreground w-12">Order:</span>
                  <Select className="w-14" value={it.at_order} onChange={(e) => updateFormItem(i, "at_order", e.target.value)}>{atOptions}</Select>
                  <Input className="w-14" type="number" value={it.av_order} onChange={(e) => updateFormItem(i, "av_order", e.target.value)} />
                  <span className="text-muted-foreground w-12 ml-2">Issue:</span>
                  <Select className="w-14" value={it.at_issue} onChange={(e) => updateFormItem(i, "at_issue", e.target.value)}>{atOptions}</Select>
                  <Input className="w-14" type="number" value={it.av_issue} onChange={(e) => updateFormItem(i, "av_issue", e.target.value)} />
                  <span className="text-muted-foreground w-12 ml-2">Recv:</span>
                  <Select className="w-14" value={it.at_receive} onChange={(e) => updateFormItem(i, "at_receive", e.target.value)}>{atOptions}</Select>
                  <Input className="w-14" type="number" value={it.av_receive} onChange={(e) => updateFormItem(i, "av_receive", e.target.value)} />
                </div>
              </div>
            ))}
            {form.items.length === 0 && <p className="text-xs text-muted-foreground">No items. Add allowance items.</p>}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
