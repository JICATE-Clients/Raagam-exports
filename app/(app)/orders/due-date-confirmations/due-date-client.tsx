"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { Sheet } from "@/components/ui/sheet";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { RecordPicker } from "@/components/masters/record-picker";
import { fmtDate } from "@/lib/format";
import { sectionValidity } from "@/lib/screens/validity";
import { createDueDateConfirmation, deleteDueDateConfirmation } from "@/lib/orders/booking-actions";
import type { DueDateConfirmationRow } from "@/lib/orders/booking-service";
import type { OrderOption } from "@/lib/orders/order-options";
import { withCreatedColumns } from "@/components/ui/created-columns";

const BLANK = {
  sales_order_id: null as string | null,
  entry_date: new Date().toISOString().slice(0, 10),
  delivery_date: "",
  notes: "",
};

export function DueDateClient({
  rows,
  orders,
}: {
  rows: DueDateConfirmationRow[];
  orders: OrderOption[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);

  // Four fields and no child grid, so a Sheet — see the surface table in the
  // `raagam-screen-layout` skill. The section rail starts at >15 fields or the
  // first child grid; a rail with one row in it is chrome around nothing.
  function openAdd() {
    setForm(BLANK);
    setOpen(true);
  }

  /**
   * DERIVED, never hand-assembled. It was `!form.sales_order_id` inline on the
   * button — right today, and a list this screen has to remember to extend the
   * moment a second field turns mandatory. `fields` mirrors the `required` props
   * below, so the red `*`, the cursor hold and the Save gate cannot disagree.
   */
  const validity = sectionValidity({
    sections: [{ key: "details" }],
    values: form,
    fields: [
      {
        section: "details",
        id: "ddc-order",
        label: "Sales Order",
        required: true,
        empty: (f) => !f.sales_order_id,
      },
    ],
  });

  function submit() {
    startTransition(async () => {
      const res = await createDueDateConfirmation({
        sales_order_id: form.sales_order_id ?? "",
        entry_date: form.entry_date,
        delivery_date: form.delivery_date || null,
        notes: form.notes || null,
        items: [],
      });
      if (res.ok) { success("Due date confirmation created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<DueDateConfirmationRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-xs">{r.order_code ?? "—"}</span> },
    { header: "Entry Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.entry_date)}</span> },
    { header: "Delivery Date", cell: (r) => r.delivery_date ? <span className="text-xs tabular-nums">{fmtDate(r.delivery_date)}</span> : "—" },
    {
      // `line-clamp-1` on its own is an ellipsis with nothing behind it — a
      // value cut off and left there (AGENTS.md, "Truncated values"). <Truncated>
      // writes the clamp itself, measures the box, and reveals the whole note on
      // hover or press-and-hold only when something is actually hidden.
      header: "Notes",
      cell: (r) => (
        <Truncated text={r.notes ?? "—"} className="text-xs text-muted-foreground" />
      ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.code}
        onDelete={() => startTransition(async () => { const res = await deleteDueDateConfirmation(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })}
        isPending={isPending}
      />
    )),
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={openAdd}>+ New Confirmation</Button></div>
      <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No due date confirmations yet." />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New Due Date Confirmation"
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            {/* Names the ENTITY rather than reading a bare "Save" that could
                belong to any record on any screen. */}
            <Button size="md" disabled={isPending || !validity.canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save confirmation"}
            </Button>
          </>
        }
      >
        {/* `cols={12}` is the same FIELD_TRACK `FieldGrid` uses, so every field
            here sits on the one width the app fixes a field at. */}
        <DetailSection label="Details" cols={12}>
          {/* THE ORDER IS PICKED, NOT TYPED. This was
              `<Input placeholder="UUID">` — the operator was expected to know a
              36-character id by heart, so the form could not be filled in at
              all. `Field` carries the span only; the picker draws its own label
              and its own `*`. */}
          <Field size="sm">
            <RecordPicker
              id="ddc-order"
              label="Sales Order"
              items={orders}
              value={form.sales_order_id}
              onChange={(id) => setForm({ ...form, sales_order_id: id })}
              required
            />
          </Field>
          <Field label="Entry Date" size="sm" htmlFor="ddc-entry">
            <Input id="ddc-entry" type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
          </Field>
          <Field label="Delivery Date" size="sm" htmlFor="ddc-delivery">
            <Input id="ddc-delivery" type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} />
          </Field>
          <Field label="Notes" size="sm" htmlFor="ddc-notes">
            <Input id="ddc-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </DetailSection>
      </Sheet>
    </div>
  );
}
