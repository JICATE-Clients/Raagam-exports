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
import { createFabricConsumption, addFabricConsumptionLine, deleteFabricConsumption } from "@/lib/planning/excess-consumption-actions";
import type { FabricConsumptionRecord } from "@/lib/planning/excess-consumption-types";

export function FabricConsumptionClient({ rows }: { rows: FabricConsumptionRecord[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingLine, setAddingLine] = useState(false);
  const [lineForm, setLineForm] = useState({ fabric_name: "", structure_name: "", component: "", coordinate: "", fabric_color: "", gsm: "", uom_id: "", consumption_qty: "", consumption_wt: "" });
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    style_ref_no: "", style_no: "", notes: "",
    lines: [] as { fabric_name: string; structure_name: string; component: string; coordinate: string; fabric_color: string; gsm: string; uom_id: string; consumption_qty: string; consumption_wt: string }[],
  });

  function addFormLine() {
    setForm({ ...form, lines: [...form.lines, { fabric_name: "", structure_name: "", component: "", coordinate: "", fabric_color: "", gsm: "", uom_id: "", consumption_qty: "0", consumption_wt: "0" }] });
  }
  function removeFormLine(i: number) { setForm({ ...form, lines: form.lines.filter((_, idx) => idx !== i) }); }
  function updateFormLine(i: number, field: string, val: string) {
    setForm({ ...form, lines: form.lines.map((l, idx) => idx === i ? { ...l, [field]: val } : l) });
  }

  function submit() {
    startTransition(async () => {
      const res = await createFabricConsumption({
        entry_date: form.entry_date,
        style_ref_no: form.style_ref_no || null,
        style_no: form.style_no || null,
        notes: form.notes || null,
        lines: form.lines.map(l => ({
          fabric_name: l.fabric_name || null,
          structure_name: l.structure_name || null,
          component: l.component || null,
          coordinate: l.coordinate || null,
          fabric_color: l.fabric_color || null,
          gsm: l.gsm ? Number(l.gsm) : null,
          uom_id: l.uom_id || null,
          consumption_qty: Number(l.consumption_qty) || 0,
          consumption_wt: Number(l.consumption_wt) || 0,
        })),
      });
      if (res.ok) { success("Created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  function submitLine() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addFabricConsumptionLine(selectedId, {
        fabric_name: lineForm.fabric_name || null,
        structure_name: lineForm.structure_name || null,
        component: lineForm.component || null,
        coordinate: lineForm.coordinate || null,
        fabric_color: lineForm.fabric_color || null,
        gsm: lineForm.gsm ? Number(lineForm.gsm) : null,
        uom_id: lineForm.uom_id || null,
        consumption_qty: Number(lineForm.consumption_qty) || 0,
        consumption_wt: Number(lineForm.consumption_wt) || 0,
      });
      if (res.ok) { success("Line added."); setAddingLine(false); setLineForm({ fabric_name: "", structure_name: "", component: "", coordinate: "", fabric_color: "", gsm: "", uom_id: "", consumption_qty: "", consumption_wt: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<FabricConsumptionRecord>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.entry_date)}</span> },
    { header: "Style Ref", cell: (r) => r.style_ref_no ?? "—" },
    { header: "Style No", cell: (r) => r.style_no ?? "—" },
    { header: "Notes", cell: (r) => <span className="text-xs text-muted-foreground line-clamp-1">{r.notes ?? "—"}</span> },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteFabricConsumption(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Consumption Record</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No fabric consumption records yet." />

      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Lines for: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingLine(!addingLine)}>{addingLine ? "Cancel" : "+ Add Line"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingLine && (
            <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
              <div><Label>Fabric</Label><Input className="w-24" value={lineForm.fabric_name} onChange={(e) => setLineForm({ ...lineForm, fabric_name: e.target.value })} /></div>
              <div><Label>Structure</Label><Input className="w-24" value={lineForm.structure_name} onChange={(e) => setLineForm({ ...lineForm, structure_name: e.target.value })} /></div>
              <div><Label>Component</Label><Input className="w-24" value={lineForm.component} onChange={(e) => setLineForm({ ...lineForm, component: e.target.value })} /></div>
              <div><Label>Coordinate</Label><Input className="w-20" value={lineForm.coordinate} onChange={(e) => setLineForm({ ...lineForm, coordinate: e.target.value })} /></div>
              <div><Label>Color</Label><Input className="w-20" value={lineForm.fabric_color} onChange={(e) => setLineForm({ ...lineForm, fabric_color: e.target.value })} /></div>
              <div><Label>GSM</Label><Input className="w-14" type="number" value={lineForm.gsm} onChange={(e) => setLineForm({ ...lineForm, gsm: e.target.value })} /></div>
              <div><Label>UOM</Label><Input className="w-12" value={lineForm.uom_id} onChange={(e) => setLineForm({ ...lineForm, uom_id: e.target.value })} /></div>
              <div><Label>Cons Qty</Label><Input className="w-16" type="number" value={lineForm.consumption_qty} onChange={(e) => setLineForm({ ...lineForm, consumption_qty: e.target.value })} /></div>
              <div><Label>Cons Wt</Label><Input className="w-16" type="number" value={lineForm.consumption_wt} onChange={(e) => setLineForm({ ...lineForm, consumption_wt: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={submitLine}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Fabric Consumption" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label>Date</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
            <div><Label>Style Ref</Label><Input value={form.style_ref_no} onChange={(e) => setForm({ ...form, style_ref_no: e.target.value })} /></div>
            <div><Label>Style No</Label><Input value={form.style_no} onChange={(e) => setForm({ ...form, style_no: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Consumption Lines">
            <div className="flex justify-end mb-2"><Button type="button" variant="outline" size="sm" onClick={addFormLine}>+ Add Line</Button></div>
            {form.lines.map((l, i) => (
              <div key={i} className="flex gap-2 items-end mb-2 flex-wrap">
                <div><Label>Fabric</Label><Input className="w-20" value={l.fabric_name} onChange={(e) => updateFormLine(i, "fabric_name", e.target.value)} /></div>
                <div><Label>Structure</Label><Input className="w-20" value={l.structure_name} onChange={(e) => updateFormLine(i, "structure_name", e.target.value)} /></div>
                <div><Label>Component</Label><Input className="w-20" value={l.component} onChange={(e) => updateFormLine(i, "component", e.target.value)} /></div>
                <div><Label>GSM</Label><Input className="w-12" type="number" value={l.gsm} onChange={(e) => updateFormLine(i, "gsm", e.target.value)} /></div>
                <div><Label>Qty</Label><Input className="w-14" type="number" value={l.consumption_qty} onChange={(e) => updateFormLine(i, "consumption_qty", e.target.value)} /></div>
                <div><Label>Wt</Label><Input className="w-14" type="number" value={l.consumption_wt} onChange={(e) => updateFormLine(i, "consumption_wt", e.target.value)} /></div>
                <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeFormLine(i)}>x</Button>
              </div>
            ))}
            {form.lines.length === 0 && <p className="text-xs text-muted-foreground">No lines. Add consumption lines.</p>}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
