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
import { createColorPrintDetail, addColorPrintLine, deleteColorPrintDetail } from "@/lib/planning/config-actions";
import { ENTRY_TYPES } from "@/lib/planning/config-types";
import type { ColorPrintDetailRow } from "@/lib/planning/config-service";

const TYPE_LABELS: Record<string, string> = {
  yarn_dyeing: "Yarn Dyeing", fabric_dyeing: "Fabric Dyeing",
  fabric_print: "Fabric Print", garment_design: "Garment Design", accessories: "Accessories",
};

export function ColorPrintClient({ rows }: { rows: ColorPrintDetailRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingLine, setAddingLine] = useState(false);
  const [lineForm, setLineForm] = useState({ color_type: "", description: "", process_loss_pct: "" });
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    entry_type: "" as string,
    process_name: "",
    notes: "",
    lines: [] as { color_type: string; description: string; process_loss_pct: string }[],
  });

  function addFormLine() {
    setForm({ ...form, lines: [...form.lines, { color_type: "", description: "", process_loss_pct: "0" }] });
  }
  function removeFormLine(i: number) {
    setForm({ ...form, lines: form.lines.filter((_, idx) => idx !== i) });
  }
  function updateFormLine(i: number, field: string, val: string) {
    setForm({ ...form, lines: form.lines.map((l, idx) => idx === i ? { ...l, [field]: val } : l) });
  }

  function submit() {
    startTransition(async () => {
      const res = await createColorPrintDetail({
        entry_date: form.entry_date,
        entry_type: form.entry_type as (typeof ENTRY_TYPES)[number],
        process_name: form.process_name || null,
        notes: form.notes || null,
        lines: form.lines.filter(l => l.description.trim()).map(l => ({
          color_type: l.color_type || null,
          description: l.description.trim(),
          process_loss_pct: Number(l.process_loss_pct) || 0,
          blocked: false,
        })),
      });
      if (res.ok) { success("Created."); setOpen(false); setForm({ entry_date: new Date().toISOString().slice(0, 10), entry_type: "", process_name: "", notes: "", lines: [] }); router.refresh(); }
      else error(res.error);
    });
  }

  function submitLine() {
    if (!selectedId || !lineForm.description.trim()) return;
    startTransition(async () => {
      const res = await addColorPrintLine(selectedId, {
        color_type: lineForm.color_type || null,
        description: lineForm.description.trim(),
        process_loss_pct: Number(lineForm.process_loss_pct) || 0,
      });
      if (res.ok) { success("Line added."); setAddingLine(false); setLineForm({ color_type: "", description: "", process_loss_pct: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<ColorPrintDetailRow>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.entry_date)}</span> },
    { header: "Type", cell: (r) => TYPE_LABELS[r.entry_type] ?? r.entry_type },
    { header: "Process", cell: (r) => r.process_name ?? "—" },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteColorPrintDetail(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Color/Print Detail</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No color/print details yet." />

      {/* Detail panel with child lines */}
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
              <div><Label>Type</Label><Input className="w-24" value={lineForm.color_type} onChange={(e) => setLineForm({ ...lineForm, color_type: e.target.value })} placeholder="e.g. Dyed" /></div>
              <div><Label>Description *</Label><Input className="w-40" value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} /></div>
              <div><Label>Loss %</Label><Input className="w-16" type="number" value={lineForm.process_loss_pct} onChange={(e) => setLineForm({ ...lineForm, process_loss_pct: e.target.value })} /></div>
              <Button size="sm" disabled={isPending || !lineForm.description.trim()} onClick={submitLine}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Color/Print Detail" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.entry_type} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label>Date</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
            <div><Label>Entry Type *</Label><Select value={form.entry_type} onChange={(e) => setForm({ ...form, entry_type: e.target.value })}><option value="">Select…</option>{ENTRY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</Select></div>
            <div><Label>Process Name</Label><Input value={form.process_name} onChange={(e) => setForm({ ...form, process_name: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Lines">
            <div className="flex justify-end mb-2"><Button type="button" variant="outline" size="sm" onClick={addFormLine}>+ Add Line</Button></div>
            {form.lines.map((l, i) => (
              <div key={i} className="flex gap-2 items-end mb-2">
                <div><Label>Type</Label><Input className="w-24" value={l.color_type} onChange={(e) => updateFormLine(i, "color_type", e.target.value)} /></div>
                <div className="flex-1"><Label>Description *</Label><Input value={l.description} onChange={(e) => updateFormLine(i, "description", e.target.value)} /></div>
                <div><Label>Loss %</Label><Input className="w-16" type="number" value={l.process_loss_pct} onChange={(e) => updateFormLine(i, "process_loss_pct", e.target.value)} /></div>
                <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeFormLine(i)}>x</Button>
              </div>
            ))}
            {form.lines.length === 0 && <p className="text-xs text-muted-foreground">No lines. Add lines for color/print specifications.</p>}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
