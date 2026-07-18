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
import { createFabricOrder, addFabricOrderStyle, submitFabricOrder, deleteFabricOrder } from "@/lib/planning/fabric-order-actions";
import type { FabricOrderRow } from "@/lib/planning/fabric-order-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", submitted: "info", approved: "success", cancelled: "danger" };

export function FabricOrdersClient({ rows }: { rows: FabricOrderRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingStyle, setAddingStyle] = useState(false);
  const [styleForm, setStyleForm] = useState({ style_ref_no: "", article_no: "", delivery_date: "" });
  const [form, setForm] = useState({
    order_date: new Date().toISOString().slice(0, 10), sales_order_id: "", notes: "",
    styles: [] as { style_ref_no: string; article_no: string; delivery_date: string }[],
  });

  function addFormStyle() { setForm({ ...form, styles: [...form.styles, { style_ref_no: "", article_no: "", delivery_date: "" }] }); }
  function removeFormStyle(i: number) { setForm({ ...form, styles: form.styles.filter((_, idx) => idx !== i) }); }
  function updateFormStyle(i: number, field: string, val: string) { setForm({ ...form, styles: form.styles.map((s, idx) => idx === i ? { ...s, [field]: val } : s) }); }

  function submit() {
    startTransition(async () => {
      const res = await createFabricOrder({
        order_date: form.order_date, sales_order_id: form.sales_order_id || null, notes: form.notes || null,
        styles: form.styles.map(s => ({ style_ref_no: s.style_ref_no || null, article_no: s.article_no || null, delivery_date: s.delivery_date || null })),
      });
      if (res.ok) { success("Created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  function submitStyle() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addFabricOrderStyle(selectedId, { style_ref_no: styleForm.style_ref_no || null, article_no: styleForm.article_no || null, delivery_date: styleForm.delivery_date || null });
      if (res.ok) { success("Style added."); setAddingStyle(false); setStyleForm({ style_ref_no: "", article_no: "", delivery_date: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<FabricOrderRow>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.order_date)}</span> },
    { header: "Order", cell: (r) => <span className="text-xs">{r.order_code ?? "—"}</span> },
    { header: "Customer", cell: (r) => r.buyer_name ?? "—" },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    {
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "draft" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await submitFabricOrder(r.id); if (res.ok) { success("Submitted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Submit</Button>}
          {r.status === "draft" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteFabricOrder(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Fabric Order</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No fabric orders yet." />

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
              <div><Label>Style Ref</Label><Input className="w-24" value={styleForm.style_ref_no} onChange={(e) => setStyleForm({ ...styleForm, style_ref_no: e.target.value })} /></div>
              <div><Label>Article No</Label><Input className="w-24" value={styleForm.article_no} onChange={(e) => setStyleForm({ ...styleForm, article_no: e.target.value })} /></div>
              <div><Label>Delivery Date</Label><Input className="w-32" type="date" value={styleForm.delivery_date} onChange={(e) => setStyleForm({ ...styleForm, delivery_date: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={submitStyle}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Fabric Order" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label>Date</Label><Input type="date" value={form.order_date} onChange={(e) => setForm({ ...form, order_date: e.target.value })} /></div>
            <div><Label>Sales Order ID</Label><Input value={form.sales_order_id} onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })} placeholder="UUID" /></div>
          </DetailSection>
          <DetailSection label="Styles">
            <div className="flex justify-end mb-2"><Button type="button" variant="outline" size="sm" onClick={addFormStyle}>+ Add Style</Button></div>
            {form.styles.map((s, i) => (
              <div key={i} className="flex gap-2 items-end mb-2">
                <div><Label>Style Ref</Label><Input className="w-24" value={s.style_ref_no} onChange={(e) => updateFormStyle(i, "style_ref_no", e.target.value)} /></div>
                <div><Label>Article</Label><Input className="w-24" value={s.article_no} onChange={(e) => updateFormStyle(i, "article_no", e.target.value)} /></div>
                <div><Label>Delivery</Label><Input className="w-28" type="date" value={s.delivery_date} onChange={(e) => updateFormStyle(i, "delivery_date", e.target.value)} /></div>
                <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeFormStyle(i)}>x</Button>
              </div>
            ))}
            {form.styles.length === 0 && <p className="text-xs text-muted-foreground">No styles. Add fabric order styles.</p>}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
