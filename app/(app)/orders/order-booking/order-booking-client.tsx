"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { RecordPicker } from "@/components/masters/record-picker";
import { fmtDate } from "@/lib/format";
import { sectionValidity } from "@/lib/screens/validity";
import { createOrderBooking, deleteOrderBooking } from "@/lib/orders/booking-actions";
import { RECEIPT_MODES, SHIP_MODES } from "@/lib/orders/booking-types";
import type { OrderBookingRow } from "@/lib/orders/booking-service";
import type { OrderOption } from "@/lib/orders/order-options";
import { withCreatedColumns } from "@/components/ui/created-columns";

const BLANK = {
  sales_order_id: null as string | null,
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
};

export function OrderBookingClient({
  rows,
  orders,
}: {
  rows: OrderBookingRow[];
  orders: OrderOption[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);

  // Twelve fields across two sections and no child grid — still a Sheet. The
  // surface table in `raagam-screen-layout` puts the section rail at >15 fields
  // or the first child grid; between 7 and 15 it is a Sheet with more than one
  // `DetailSection`, which is exactly the shape this already had.
  //
  // `canSave` DERIVED from the same `required` that draws the `*`, replacing the
  // inline `!form.sales_order_id` the Save button used to carry.
  const validity = sectionValidity({
    sections: [{ key: "reference" }, { key: "details" }],
    values: form,
    fields: [
      {
        section: "reference",
        id: "ob-order",
        label: "Sales Order",
        required: true,
        empty: (f) => !f.sales_order_id,
      },
    ],
  });

  function submit() {
    startTransition(async () => {
      const res = await createOrderBooking({
        sales_order_id: form.sales_order_id ?? "",
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
        // `certifications` is omitted, not empty-by-accident: the Certifications
        // master was removed (2026-08-01) and this form no longer collects them.
        // The Zod input defaults it to [], and `order_booking_certifications`
        // rows written before the removal are untouched.
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
    rowActionsColumn((r) => (
      <RowActions
        label={r.code}
        onDelete={() => startTransition(async () => { const res = await deleteOrderBooking(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })}
        isPending={isPending}
      />
    )),
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => { setForm(BLANK); setOpen(true); }}>+ New Booking</Button></div>
      <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No order bookings yet." />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New Order Booking"
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !validity.canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save booking"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Order Reference" cols={12}>
            {/* THE ORDER IS PICKED, NOT TYPED. This was a raw uuid `<Input>`
                carrying a comment explaining why it must not be uppercased —
                a correct answer to the wrong question, because no operator can
                type a 36-character id in the first place. The picker hands back
                the id and shows the order number, so the casing problem the old
                comment guarded against cannot arise at all. */}
            <Field size="sm">
              <RecordPicker
                id="ob-order"
                label="Sales Order"
                items={orders}
                value={form.sales_order_id}
                onChange={(id) => setForm({ ...form, sales_order_id: id })}
                required
              />
            </Field>
            <Field label="Order No" size="sm" htmlFor="ob-orderno">
              <Input id="ob-orderno" uppercase value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} />
            </Field>
            <Field label="Booking Date" size="sm" htmlFor="ob-booking">
              <Input id="ob-booking" type="date" value={form.booking_date} onChange={(e) => setForm({ ...form, booking_date: e.target.value })} />
            </Field>
            <Field label="Delivery Date" size="sm" htmlFor="ob-delivery">
              <Input id="ob-delivery" type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} />
            </Field>
          </DetailSection>
          <DetailSection label="Details" cols={12}>
            <Field label="Season" size="sm" htmlFor="ob-season">
              <Input id="ob-season" uppercase value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} />
            </Field>
            <Field label="Season Year" size="sm" htmlFor="ob-seasonyr">
              <Input id="ob-seasonyr" uppercase value={form.season_yr} onChange={(e) => setForm({ ...form, season_yr: e.target.value })} />
            </Field>
            <Field label="Agent" size="sm" htmlFor="ob-agent">
              <Input id="ob-agent" uppercase value={form.agent_name} onChange={(e) => setForm({ ...form, agent_name: e.target.value })} />
            </Field>
            <Field label="Receipt Mode" size="sm" htmlFor="ob-receipt">
              <Select id="ob-receipt" value={form.receipt_mode} onChange={(e) => setForm({ ...form, receipt_mode: e.target.value })}>
                <option value="">Select…</option>
                {RECEIPT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Ship Mode" size="sm" htmlFor="ob-ship">
              <Select id="ob-ship" value={form.ship_mode} onChange={(e) => setForm({ ...form, ship_mode: e.target.value })}>
                <option value="">Select…</option>
                {SHIP_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Pay Mode" size="sm" htmlFor="ob-pay">
              <Input id="ob-pay" uppercase value={form.pay_mode} onChange={(e) => setForm({ ...form, pay_mode: e.target.value })} />
            </Field>
            <Field label="Material Composition" size="sm" htmlFor="ob-material">
              <Input id="ob-material" uppercase value={form.material_composition} onChange={(e) => setForm({ ...form, material_composition: e.target.value })} />
            </Field>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
