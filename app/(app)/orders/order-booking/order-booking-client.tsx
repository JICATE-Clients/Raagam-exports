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
import { createOrderBooking, deleteOrderBooking } from "@/lib/orders/booking-actions";
import { RECEIPT_MODES, SHIP_MODES } from "@/lib/orders/booking-types";
import type { OrderBookingRow } from "@/lib/orders/booking-service";

export function OrderBookingClient({ rows }: { rows: OrderBookingRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    sales_order_id: "",
    booking_date: new Date().toISOString().slice(0, 10),
    order_no: "",
    season: "",
    season_yr: "",
    delivery_date: "",
    agent_name: "",
    receipt_mode: "",
    ship_mode: "",
    pay_mode: "",
    material_composition: "",
    notes: "",
    certifications: "" as string,
  });

  function submit() {
    startTransition(async () => {
      const certs = form.certifications.split("\n").map((c) => c.trim()).filter(Boolean).map((c) => ({ certification: c }));
      const res = await createOrderBooking({
        sales_order_id: form.sales_order_id,
        booking_date: form.booking_date,
        order_no: form.order_no || null,
        season: form.season || null,
        season_yr: form.season_yr || null,
        delivery_date: form.delivery_date || null,
        agent_name: form.agent_name || null,
        receipt_mode: (form.receipt_mode as (typeof RECEIPT_MODES)[number]) || null,
        ship_mode: (form.ship_mode as (typeof SHIP_MODES)[number]) || null,
        pay_mode: form.pay_mode || null,
        material_composition: form.material_composition || null,
        notes: form.notes || null,
        certifications: certs,
      });
      if (res.ok) { success("Order booking created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<OrderBookingRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-xs">{r.order_code ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.booking_date)}</span> },
    { header: "Customer", cell: (r) => r.buyer_name ?? "—" },
    { header: "Order No", cell: (r) => r.order_no ?? "—" },
    { header: "Season", cell: (r) => [r.season, r.season_yr].filter(Boolean).join(" ") || "—" },
    { header: "Delivery", cell: (r) => r.delivery_date ? fmtDate(r.delivery_date) : "—" },
    { header: "Ship", cell: (r) => r.ship_mode ?? "—" },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteOrderBooking(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Booking</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No order bookings yet." />
      <Sheet open={open} onClose={() => setOpen(false)} title="New Order Booking" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.sales_order_id} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Order Reference">
            <div><Label>Sales Order ID *</Label><Input value={form.sales_order_id} onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label>Order No</Label><Input value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} /></div>
            <div><Label>Booking Date</Label><Input type="date" value={form.booking_date} onChange={(e) => setForm({ ...form, booking_date: e.target.value })} /></div>
            <div><Label>Delivery Date</Label><Input type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Details">
            <div><Label>Season</Label><Input value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} /></div>
            <div><Label>Season Year</Label><Input value={form.season_yr} onChange={(e) => setForm({ ...form, season_yr: e.target.value })} /></div>
            <div><Label>Agent</Label><Input value={form.agent_name} onChange={(e) => setForm({ ...form, agent_name: e.target.value })} /></div>
            <div><Label>Receipt Mode</Label><Select value={form.receipt_mode} onChange={(e) => setForm({ ...form, receipt_mode: e.target.value })}><option value="">Select…</option>{RECEIPT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</Select></div>
            <div><Label>Ship Mode</Label><Select value={form.ship_mode} onChange={(e) => setForm({ ...form, ship_mode: e.target.value })}><option value="">Select…</option>{SHIP_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</Select></div>
            <div><Label>Pay Mode</Label><Input value={form.pay_mode} onChange={(e) => setForm({ ...form, pay_mode: e.target.value })} /></div>
            <div><Label>Material Composition</Label><Input value={form.material_composition} onChange={(e) => setForm({ ...form, material_composition: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Certifications (one per line)">
            <div><textarea className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" rows={4} value={form.certifications} onChange={(e) => setForm({ ...form, certifications: e.target.value })} placeholder="GOTS&#10;BCI&#10;OEKO-TEX" /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
