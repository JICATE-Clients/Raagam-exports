"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { RecordPicker } from "@/components/masters/record-picker";
import { fmtDate } from "@/lib/format";
import { sectionValidity } from "@/lib/screens/validity";
import { createExcessOrder, confirmExcessOrder, deleteExcessOrder } from "@/lib/orders/pack-ratio-actions";
import type { ExcessOrderRow } from "@/lib/orders/pack-ratio-service";
import type { OrderOption } from "@/lib/orders/order-options";
import type { StatusTone } from "@/components/ui/status-pill";
import { withCreatedColumns } from "@/components/ui/created-columns";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", confirmed: "success", cancelled: "danger" };

const BLANK = {
  sales_order_id: null as string | null,
  req_no: "",
  ppm_no: "",
  customer_name: "",
  notes: "",
};

export function ExcessOrdersClient({
  rows,
  orders,
}: {
  rows: ExcessOrderRow[];
  orders: OrderOption[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);

  // Five fields, no child grid → a Sheet, per the surface table in the
  // `raagam-screen-layout` skill. The rail starts at >15 fields or a child grid.
  //
  // `canSave` DERIVED rather than the inline `!form.sales_order_id` this button
  // used to carry — one declaration the `required` prop below also feeds.
  const validity = sectionValidity({
    sections: [{ key: "details" }],
    values: form,
    fields: [
      {
        section: "details",
        id: "exo-order",
        label: "Sales Order",
        required: true,
        empty: (f) => !f.sales_order_id,
      },
    ],
  });

  function submit() {
    startTransition(async () => {
      const res = await createExcessOrder({
        sales_order_id: form.sales_order_id ?? "",
        req_no: form.req_no || null,
        ppm_no: form.ppm_no || null,
        customer_name: form.customer_name || null,
        notes: form.notes || null,
        items: [],
      });
      if (res.ok) { success("Excess order created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<ExcessOrderRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-xs">{r.order_code ?? "—"}</span> },
    { header: "Req No", cell: (r) => r.req_no ?? "—" },
    { header: "PPM No", cell: (r) => r.ppm_no ?? "—" },
    { header: "Customer", cell: (r) => r.customer_name ?? "—" },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    { header: "Created", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.created_at)}</span> },
    {
      /* Workflow, so it keeps a labelled column of its own (LAYOUT.md §6a). */
      header: "Confirm", align: "right", cell: (r) => (
        r.status === "draft" ? <Button variant="outline" size="sm" onClick={() => startTransition(async () => { const res = await confirmExcessOrder(r.id); if (res.ok) { success("Confirmed."); router.refresh(); } else error(res.error); })} disabled={isPending}>Confirm</Button> : null
      ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.code}
        onDelete={() => startTransition(async () => { const res = await deleteExcessOrder(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })}
        canDelete={r.status === "draft"}
        isPending={isPending}
      />
    )),
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => { setForm(BLANK); setOpen(true); }}>+ New Excess Order</Button></div>
      <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No excess orders yet." />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New Excess Order"
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !validity.canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save excess order"}
            </Button>
          </>
        }
      >
        {/* `cols={12}` is the same FIELD_TRACK `FieldGrid` uses, so these fields
            take the one width the app fixes a field at. */}
        <DetailSection label="Details" cols={12}>
          {/* PICKED, NOT TYPED — this was `<Input placeholder="UUID">`, which no
              operator can fill in. `Field` carries the span; the picker draws its
              own label and its own `*`. */}
          <Field size="sm">
            <RecordPicker
              id="exo-order"
              label="Sales Order"
              items={orders}
              value={form.sales_order_id}
              onChange={(id) => setForm({ ...form, sales_order_id: id })}
              required
            />
          </Field>
          <Field label="Req No" size="sm" htmlFor="exo-req">
            <Input id="exo-req" uppercase value={form.req_no} onChange={(e) => setForm({ ...form, req_no: e.target.value })} />
          </Field>
          <Field label="PPM No" size="sm" htmlFor="exo-ppm">
            <Input id="exo-ppm" uppercase value={form.ppm_no} onChange={(e) => setForm({ ...form, ppm_no: e.target.value })} />
          </Field>
          <Field label="Customer Name" size="sm" htmlFor="exo-customer">
            <Input id="exo-customer" uppercase value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
          </Field>
          <Field label="Notes" size="sm" htmlFor="exo-notes">
            <Input id="exo-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </DetailSection>
      </Sheet>
    </div>
  );
}
