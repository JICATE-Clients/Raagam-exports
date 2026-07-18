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
import { createDomesticProdPlan, addDomesticProdPlanStyle, confirmDomesticProdPlan, deleteDomesticProdPlan } from "@/lib/planning/fabric-order-actions";
import type { DomesticProdPlanRow } from "@/lib/planning/fabric-order-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", confirmed: "success", cancelled: "danger" };

export function DomesticProductionClient({ rows }: { rows: DomesticProdPlanRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingStyle, setAddingStyle] = useState(false);
  const [styleForm, setStyleForm] = useState({ style_no: "", style_description: "", uom_id: "", order_qty: "", no_of_box: "" });
  const [form, setForm] = useState({
    plan_date: new Date().toISOString().slice(0, 10), sales_order_id: "", notes: "",
    styles: [] as { style_ref_no: string; style_no: string; style_description: string; uom_id: string; order_qty: string; no_of_box: string }[],
  });

  function addFormStyle() { setForm({ ...form, styles: [...form.styles, { style_ref_no: "", style_no: "", style_description: "", uom_id: "", order_qty: "0", no_of_box: "0" }] }); }
  function removeFormStyle(i: number) { setForm({ ...form, styles: form.styles.filter((_, idx) => idx !== i) }); }
  function updateFormStyle(i: number, field: string, val: string) { setForm({ ...form, styles: form.styles.map((s, idx) => idx === i ? { ...s, [field]: val } : s) }); }

  function submit() {
    startTransition(async () => {
      const res = await createDomesticProdPlan({
        plan_date: form.plan_date, sales_order_id: form.sales_order_id || null, notes: form.notes || null,
        styles: form.styles.map(s => ({ style_ref_no: s.style_ref_no || null, style_no: s.style_no || null, style_description: s.style_description || null, uom_id: s.uom_id || null, order_qty: Number(s.order_qty) || 0, no_of_box: Number(s.no_of_box) || 0 })),
      });
      if (res.ok) { success("Created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  function submitStyle() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addDomesticProdPlanStyle(selectedId, { style_no: styleForm.style_no || null, style_description: styleForm.style_description || null, uom_id: styleForm.uom_id || null, order_qty: Number(styleForm.order_qty) || 0, no_of_box: Number(styleForm.no_of_box) || 0 });
      if (res.ok) { success("Style added."); setAddingStyle(false); setStyleForm({ style_no: "", style_description: "", uom_id: "", order_qty: "", no_of_box: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<DomesticProdPlanRow>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.plan_date)}</span> },
    { header: "Customer", cell: (r) => r.buyer_name ?? "—" },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    {
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "draft" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await confirmDomesticProdPlan(r.id); if (res.ok) { success("Confirmed."); router.refresh(); } else error(res.error); })} disabled={isPending}>Confirm</Button>}
          {r.status === "draft" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteDomesticProdPlan(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Production Plan</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No domestic production plans yet." />

      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Styles for: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingStyle(!addingStyle)}>{addingStyle ? "Cancel" : "+ Add Style"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingStyle && (
            <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
              <div><Label>Style No</Label><Input className="w-24" value={styleForm.style_no} onChange={(e) => setStyleForm({ ...styleForm, style_no: e.target.value })} /></div>
              <div><Label>Description</Label><Input className="w-32" value={styleForm.style_description} onChange={(e) => setStyleForm({ ...styleForm, style_description: e.target.value })} /></div>
              <div><Label>UOM</Label><Input className="w-14" value={styleForm.uom_id} onChange={(e) => setStyleForm({ ...styleForm, uom_id: e.target.value })} /></div>
              <div><Label>Order Qty</Label><Input className="w-20" type="number" value={styleForm.order_qty} onChange={(e) => setStyleForm({ ...styleForm, order_qty: e.target.value })} /></div>
              <div><Label>No of Box</Label><Input className="w-16" type="number" value={styleForm.no_of_box} onChange={(e) => setStyleForm({ ...styleForm, no_of_box: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={submitStyle}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Domestic Production Plan" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label>Date</Label><Input type="date" value={form.plan_date} onChange={(e) => setForm({ ...form, plan_date: e.target.value })} /></div>
            <div><Label>Sales Order ID</Label><Input value={form.sales_order_id} onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })} placeholder="UUID" /></div>
          </DetailSection>
          <DetailSection label="Styles">
            <div className="flex justify-end mb-2"><Button type="button" variant="outline" size="sm" onClick={addFormStyle}>+ Add Style</Button></div>
            {form.styles.map((s, i) => (
              <div key={i} className="flex gap-2 items-end mb-2 flex-wrap">
                <div><Label>Style No</Label><Input className="w-20" value={s.style_no} onChange={(e) => updateFormStyle(i, "style_no", e.target.value)} /></div>
                <div className="flex-1"><Label>Description</Label><Input value={s.style_description} onChange={(e) => updateFormStyle(i, "style_description", e.target.value)} /></div>
                <div><Label>UOM</Label><Input className="w-12" value={s.uom_id} onChange={(e) => updateFormStyle(i, "uom_id", e.target.value)} /></div>
                <div><Label>Qty</Label><Input className="w-16" type="number" value={s.order_qty} onChange={(e) => updateFormStyle(i, "order_qty", e.target.value)} /></div>
                <div><Label>Boxes</Label><Input className="w-14" type="number" value={s.no_of_box} onChange={(e) => updateFormStyle(i, "no_of_box", e.target.value)} /></div>
                <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeFormStyle(i)}>x</Button>
              </div>
            ))}
            {form.styles.length === 0 && <p className="text-xs text-muted-foreground">No styles. Add production plan styles.</p>}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
