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
import { createProductionPlan, addProductionPlanOrder, confirmProductionPlan, deleteProductionPlan } from "@/lib/planning/capacity-actions";
import type { ProductionPlan } from "@/lib/planning/capacity-types";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", confirmed: "success", cancelled: "danger" };

export function ProductionPlanningClient({ rows }: { rows: ProductionPlan[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingOrder, setAddingOrder] = useState(false);
  const [orderForm, setOrderForm] = useState({ work_order_no: "", order_no: "", customer_name: "", style_no: "", order_qty: "", sam: "", target_efficiency: "", target_qty: "", plan_qty: "", period_from: "", period_to: "", location_name: "", team_name: "" });
  const [form, setForm] = useState({
    plan_date: new Date().toISOString().slice(0, 10), notes: "",
    orders: [] as { work_order_no: string; order_no: string; customer_name: string; style_no: string; order_qty: string; sam: string; target_efficiency: string; target_qty: string; plan_qty: string; period_from: string; period_to: string; location_name: string; team_name: string }[],
  });

  function addFormOrder() { setForm({ ...form, orders: [...form.orders, { work_order_no: "", order_no: "", customer_name: "", style_no: "", order_qty: "0", sam: "0", target_efficiency: "80", target_qty: "0", plan_qty: "0", period_from: "", period_to: "", location_name: "", team_name: "" }] }); }
  function removeFormOrder(i: number) { setForm({ ...form, orders: form.orders.filter((_, idx) => idx !== i) }); }
  function updateFormOrder(i: number, field: string, val: string) { setForm({ ...form, orders: form.orders.map((o, idx) => idx === i ? { ...o, [field]: val } : o) }); }

  function submit() {
    startTransition(async () => {
      const res = await createProductionPlan({
        plan_date: form.plan_date, notes: form.notes || null,
        orders: form.orders.map(o => ({ work_order_no: o.work_order_no || null, order_no: o.order_no || null, customer_name: o.customer_name || null, style_no: o.style_no || null, order_qty: Number(o.order_qty) || 0, sam: Number(o.sam) || 0, target_efficiency: Number(o.target_efficiency) || 0, target_qty: Number(o.target_qty) || 0, plan_qty: Number(o.plan_qty) || 0, period_from: o.period_from || null, period_to: o.period_to || null, location_name: o.location_name || null, team_name: o.team_name || null, with_learning_curve: false })),
      });
      if (res.ok) { success("Created."); setOpen(false); router.refresh(); } else error(res.error);
    });
  }

  function submitOrder() {
    if (!selectedId) return;
    startTransition(async () => {
      const o = orderForm;
      const res = await addProductionPlanOrder(selectedId, { work_order_no: o.work_order_no || null, order_no: o.order_no || null, customer_name: o.customer_name || null, style_no: o.style_no || null, order_qty: Number(o.order_qty) || 0, sam: Number(o.sam) || 0, target_efficiency: Number(o.target_efficiency) || 0, target_qty: Number(o.target_qty) || 0, plan_qty: Number(o.plan_qty) || 0, period_from: o.period_from || null, period_to: o.period_to || null, location_name: o.location_name || null, team_name: o.team_name || null });
      if (res.ok) { success("Order added."); setAddingOrder(false); setOrderForm({ work_order_no: "", order_no: "", customer_name: "", style_no: "", order_qty: "", sam: "", target_efficiency: "", target_qty: "", plan_qty: "", period_from: "", period_to: "", location_name: "", team_name: "" }); router.refresh(); } else error(res.error);
    });
  }

  const columns: Column<ProductionPlan>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.plan_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    {
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "draft" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await confirmProductionPlan(r.id); if (res.ok) { success("Confirmed."); router.refresh(); } else error(res.error); })} disabled={isPending}>Confirm</Button>}
          {r.status === "draft" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteProductionPlan(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Production Plan</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No production plans yet." />

      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Orders for: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingOrder(!addingOrder)}>{addingOrder ? "Cancel" : "+ Add Order"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingOrder && (
            <div className="space-y-2 rounded border border-border p-3">
              <div className="flex gap-2 items-end flex-wrap">
                <div><Label>WO No</Label><Input className="w-20" value={orderForm.work_order_no} onChange={(e) => setOrderForm({ ...orderForm, work_order_no: e.target.value })} /></div>
                <div><Label>Order</Label><Input className="w-16" value={orderForm.order_no} onChange={(e) => setOrderForm({ ...orderForm, order_no: e.target.value })} /></div>
                <div><Label>Customer</Label><Input className="w-24" value={orderForm.customer_name} onChange={(e) => setOrderForm({ ...orderForm, customer_name: e.target.value })} /></div>
                <div><Label>Style</Label><Input className="w-16" value={orderForm.style_no} onChange={(e) => setOrderForm({ ...orderForm, style_no: e.target.value })} /></div>
                <div><Label>Qty</Label><Input className="w-16" type="number" value={orderForm.order_qty} onChange={(e) => setOrderForm({ ...orderForm, order_qty: e.target.value })} /></div>
                <div><Label>SAM</Label><Input className="w-12" type="number" value={orderForm.sam} onChange={(e) => setOrderForm({ ...orderForm, sam: e.target.value })} /></div>
              </div>
              <div className="flex gap-2 items-end flex-wrap">
                <div><Label>Eff%</Label><Input className="w-12" type="number" value={orderForm.target_efficiency} onChange={(e) => setOrderForm({ ...orderForm, target_efficiency: e.target.value })} /></div>
                <div><Label>Target</Label><Input className="w-16" type="number" value={orderForm.target_qty} onChange={(e) => setOrderForm({ ...orderForm, target_qty: e.target.value })} /></div>
                <div><Label>Plan</Label><Input className="w-16" type="number" value={orderForm.plan_qty} onChange={(e) => setOrderForm({ ...orderForm, plan_qty: e.target.value })} /></div>
                <div><Label>From</Label><Input className="w-28" type="date" value={orderForm.period_from} onChange={(e) => setOrderForm({ ...orderForm, period_from: e.target.value })} /></div>
                <div><Label>To</Label><Input className="w-28" type="date" value={orderForm.period_to} onChange={(e) => setOrderForm({ ...orderForm, period_to: e.target.value })} /></div>
                <div><Label>Location</Label><Input className="w-16" value={orderForm.location_name} onChange={(e) => setOrderForm({ ...orderForm, location_name: e.target.value })} /></div>
                <div><Label>Team</Label><Input className="w-16" value={orderForm.team_name} onChange={(e) => setOrderForm({ ...orderForm, team_name: e.target.value })} /></div>
                <Button size="sm" disabled={isPending} onClick={submitOrder}>{isPending ? "Adding…" : "Add"}</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Production Plan" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label>Plan Date</Label><Input type="date" value={form.plan_date} onChange={(e) => setForm({ ...form, plan_date: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Plan Orders">
            <div className="flex justify-end mb-2"><Button type="button" variant="outline" size="sm" onClick={addFormOrder}>+ Add Order</Button></div>
            {form.orders.map((o, i) => (
              <div key={i} className="mb-3 rounded border border-border p-2 space-y-1">
                <div className="flex gap-2 items-end flex-wrap">
                  <div><Label>WO</Label><Input className="w-16" value={o.work_order_no} onChange={(e) => updateFormOrder(i, "work_order_no", e.target.value)} /></div>
                  <div><Label>Order</Label><Input className="w-14" value={o.order_no} onChange={(e) => updateFormOrder(i, "order_no", e.target.value)} /></div>
                  <div><Label>Customer</Label><Input className="w-20" value={o.customer_name} onChange={(e) => updateFormOrder(i, "customer_name", e.target.value)} /></div>
                  <div><Label>Style</Label><Input className="w-14" value={o.style_no} onChange={(e) => updateFormOrder(i, "style_no", e.target.value)} /></div>
                  <div><Label>Qty</Label><Input className="w-14" type="number" value={o.order_qty} onChange={(e) => updateFormOrder(i, "order_qty", e.target.value)} /></div>
                  <div><Label>SAM</Label><Input className="w-12" type="number" value={o.sam} onChange={(e) => updateFormOrder(i, "sam", e.target.value)} /></div>
                  <div><Label>Eff%</Label><Input className="w-12" type="number" value={o.target_efficiency} onChange={(e) => updateFormOrder(i, "target_efficiency", e.target.value)} /></div>
                  <div><Label>Plan</Label><Input className="w-14" type="number" value={o.plan_qty} onChange={(e) => updateFormOrder(i, "plan_qty", e.target.value)} /></div>
                  <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeFormOrder(i)}>x</Button>
                </div>
              </div>
            ))}
            {form.orders.length === 0 && <p className="text-xs text-muted-foreground">No orders. Add production plan orders.</p>}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
