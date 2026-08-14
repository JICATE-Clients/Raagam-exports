"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { RecordPicker } from "@/components/masters/record-picker";
import type { OrderOption } from "@/lib/orders/order-options";
import { fmtDate } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { createPackRatio, deletePackRatio, addPackRatioLine } from "@/lib/orders/pack-ratio-actions";
import type { PackRatioRow } from "@/lib/orders/pack-ratio-service";
import { withCreatedColumns } from "@/components/ui/created-columns";

const SIZE_LABELS = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];

export function PackRatiosClient({
  rows,
  orders,
}: {
  rows: PackRatioRow[];
  orders: OrderOption[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingLine, setAddingLine] = useState(false);
  const [lineForm, setLineForm] = useState({
    style_no: "", combo: "", no_of_cartons: "", pcs_per_pack: "",
    s1: "", s2: "", s3: "", s4: "", s5: "", s6: "", s7: "", s8: "",
  });

  // The "New Pack Ratio" Sheet below registers itself via useModalGuard, but
  // this ratio-line editor is an inline panel on the page, outside that Sheet —
  // so it has to declare itself or a silent auto-update discards the typed line.
  useUnsavedGuard(addingLine || isPending);

  function submitLine() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addPackRatioLine(selectedId, {
        style_no: lineForm.style_no || null,
        combo: lineForm.combo || null,
        no_of_cartons: lineForm.no_of_cartons ? Number(lineForm.no_of_cartons) : 0,
        pcs_per_pack: lineForm.pcs_per_pack ? Number(lineForm.pcs_per_pack) : 0,
        order_qty: [lineForm.s1, lineForm.s2, lineForm.s3, lineForm.s4, lineForm.s5, lineForm.s6, lineForm.s7, lineForm.s8].reduce((sum, v) => sum + (Number(v) || 0), 0),
        size1_qty: Number(lineForm.s1) || 0,
        size2_qty: Number(lineForm.s2) || 0,
        size3_qty: Number(lineForm.s3) || 0,
        size4_qty: Number(lineForm.s4) || 0,
        size5_qty: Number(lineForm.s5) || 0,
        size6_qty: Number(lineForm.s6) || 0,
        size7_qty: Number(lineForm.s7) || 0,
        size8_qty: Number(lineForm.s8) || 0,
      });
      if (res.ok) {
        success("Ratio line added.");
        setAddingLine(false);
        setLineForm({ style_no: "", combo: "", no_of_cartons: "", pcs_per_pack: "", s1: "", s2: "", s3: "", s4: "", s5: "", s6: "", s7: "", s8: "" });
        router.refresh();
      } else error(res.error);
    });
  }

  const [form, setForm] = useState({
    sales_order_id: "", style_no: "", assortment_type: "", delivery_date: "",
    no_of_cartons: "", pcs_per_inner: "", inner_per_master: "",
    master_carton_name: "", inner_carton_name: "", pack_description: "",
    ratio_for: "", country_code: "",
  });

  function submit() {
    startTransition(async () => {
      const res = await createPackRatio({
        sales_order_id: form.sales_order_id,
        style_no: form.style_no || null,
        assortment_type: form.assortment_type || null,
        delivery_date: form.delivery_date || null,
        no_of_cartons: form.no_of_cartons ? Number(form.no_of_cartons) : 0,
        pcs_per_inner: form.pcs_per_inner ? Number(form.pcs_per_inner) : 0,
        inner_per_master: form.inner_per_master ? Number(form.inner_per_master) : 0,
        master_carton_name: form.master_carton_name || null,
        inner_carton_name: form.inner_carton_name || null,
        pack_description: form.pack_description || null,
        ratio_for: (form.ratio_for as "master" | "inner") || null,
        country_code: form.country_code || null,
        pcs_per_pack: 0,
        is_ratio_wise_pack: false,
        is_single_style_pack: false,
      });
      if (res.ok) { success("Pack ratio created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<PackRatioRow>[] = [
    { header: "Order", cell: (r) => <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.order_code ?? "—"}</button> },
    { header: "Style", cell: (r) => r.style_no ?? "—" },
    { header: "Type", cell: (r) => r.assortment_type ?? "—" },
    { header: "Cartons", align: "right", cell: (r) => <span className="tabular-nums">{r.no_of_cartons}</span> },
    { header: "Pcs/Inner", align: "right", cell: (r) => <span className="tabular-nums">{r.pcs_per_inner}</span> },
    { header: "Inner/Master", align: "right", cell: (r) => <span className="tabular-nums">{r.inner_per_master}</span> },
    { header: "Pcs/Master", align: "right", cell: (r) => <span className="tabular-nums">{r.pcs_per_master}</span> },
    { header: "Total Qty", align: "right", cell: (r) => <span className="tabular-nums">{r.total_qty}</span> },
    { header: "Delivery", cell: (r) => r.delivery_date ? fmtDate(r.delivery_date) : "—" },
    rowActionsColumn((r) => (
      <RowActions
        label={r.order_code}
        onDelete={() => startTransition(async () => { const res = await deletePackRatio(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })}
        isPending={isPending}
      />
    )),
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Pack Ratio</Button></div>
      <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No pack ratios yet." />

      {/* Size matrix editor for selected pack ratio */}
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Size Matrix for: {rows.find(r => r.id === selectedId)?.style_no ?? rows.find(r => r.id === selectedId)?.order_code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingLine(!addingLine)}>{addingLine ? "Cancel" : "+ Add Ratio Line"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingLine && (
            // ONE MARKER, NEVER A HANDLER. An `addingLine`-gated panel on the
            // page, not an overlay, so `isEditorScope()` is false without it and
            // Tab walks out of the panel it just opened. The Sheet below is a
            // separate surface and keeps its own.
            <div data-focus-scope className="space-y-3 rounded border border-border p-3">
              <FieldGrid>
                <Field label="Style" size="sm" htmlFor="prl-style">
                  <Input id="prl-style" uppercase value={lineForm.style_no} onChange={(e) => setLineForm({ ...lineForm, style_no: e.target.value })} />
                </Field>
                <Field label="Combo" size="sm" htmlFor="prl-combo">
                  <Input id="prl-combo" uppercase value={lineForm.combo} onChange={(e) => setLineForm({ ...lineForm, combo: e.target.value })} />
                </Field>
                <Field label="Cartons" size="sm" htmlFor="prl-cartons">
                  <Input id="prl-cartons" type="number" value={lineForm.no_of_cartons} onChange={(e) => setLineForm({ ...lineForm, no_of_cartons: e.target.value })} />
                </Field>
                <Field label="Pcs/Pack" size="sm" htmlFor="prl-pcs">
                  <Input id="prl-pcs" type="number" value={lineForm.pcs_per_pack} onChange={(e) => setLineForm({ ...lineForm, pcs_per_pack: e.target.value })} />
                </Field>
              </FieldGrid>
              {/* THE SIZE MATRIX IS NOT EIGHT FIELDS, and this is the one place
                  on the screen the ~280px rule is deliberately not applied.
                  LAYOUT.md §3 sizes a FIELD; XS…4XL is one quantity broken
                  across a size range, read as a row against its headers the way
                  the packing list itself is printed. Eight fields at `sm` would
                  be two rows of four with the range split across the wrap, which
                  is the opposite of legible.

                  It still wraps rather than scrolling (`flex-wrap`), the cells
                  are ordinary `<Input>`s so ←/→ and Tab reach every one of them
                  through the scope above, and Total stays plain text: it is
                  computed from the eight beside it, and a box invites a click
                  that does nothing. */}
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Size Quantities</p>
                <div className="flex gap-1 flex-wrap">
                  {SIZE_LABELS.map((label, i) => (
                    <div key={label} className="text-center">
                      <Label htmlFor={`prl-s${i + 1}`} className="block text-[10px] text-muted-foreground">{label}</Label>
                      <Input
                        id={`prl-s${i + 1}`}
                        className="w-14 text-xs text-center"
                        type="number"
                        value={(lineForm as Record<string, string>)[`s${i + 1}`] ?? ""}
                        onChange={(e) => setLineForm({ ...lineForm, [`s${i + 1}`]: e.target.value })}
                      />
                    </div>
                  ))}
                  <div className="text-center">
                    <div className="text-[10px] text-muted-foreground">Total</div>
                    <div className="w-14 h-9 flex items-center justify-center text-xs font-semibold tabular-nums">
                      {[lineForm.s1, lineForm.s2, lineForm.s3, lineForm.s4, lineForm.s5, lineForm.s6, lineForm.s7, lineForm.s8].reduce((s, v) => s + (Number(v) || 0), 0)}
                    </div>
                  </div>
                </div>
              </div>
              <Button size="sm" disabled={isPending} onClick={submitLine}>{isPending ? "Adding…" : "Add Line"}</Button>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Pack Ratio" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.sales_order_id} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          {/* `cols={12}` IS the field track — the same string `FieldGrid`
              renders — so these sections share one grid with every other editor
              in the module rather than stacking one field per row. */}
          <DetailSection label="Order" cols={12}>
            {/* THE ORDER IS PICKED, NOT TYPED. Was `<Input placeholder="UUID">`,
                which asked the operator for a 36-character id and so could not
                be filled in at all.

                `<Field size>` + `compact` is the established pairing (see
                `amendment-screen.tsx`): the Field supplies the track span, and
                `compact` drops the picker's OWN label so the two do not stack.
                A bare picker in the track carries no span and comes out a
                different width from the fields beside it. `required` is
                declared once, on the Field — the star and the hold come from
                the same prop or they can disagree. */}
            <Field label="Sales Order" required size="sm">
              <RecordPicker
                id="pr-order"
                label="Sales Order"
                compact
                items={orders}
                value={form.sales_order_id || null}
                onChange={(id) => setForm({ ...form, sales_order_id: id ?? "" })}
              />
            </Field>
            <Field label="Style No" size="sm" htmlFor="pr-style">
              <Input id="pr-style" uppercase value={form.style_no} onChange={(e) => setForm({ ...form, style_no: e.target.value })} />
            </Field>
            <Field label="Assortment Type" size="sm" htmlFor="pr-assort">
              <Input id="pr-assort" uppercase value={form.assortment_type} onChange={(e) => setForm({ ...form, assortment_type: e.target.value })} />
            </Field>
            <Field label="Delivery Date" size="sm" htmlFor="pr-delivery">
              <Input id="pr-delivery" type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} />
            </Field>
          </DetailSection>
          <DetailSection label="Carton Structure" cols={12}>
            <Field label="No of Cartons" size="sm" htmlFor="pr-cartons">
              <Input id="pr-cartons" type="number" value={form.no_of_cartons} onChange={(e) => setForm({ ...form, no_of_cartons: e.target.value })} />
            </Field>
            <Field label="Pcs per Inner" size="sm" htmlFor="pr-pcs-inner">
              <Input id="pr-pcs-inner" type="number" value={form.pcs_per_inner} onChange={(e) => setForm({ ...form, pcs_per_inner: e.target.value })} />
            </Field>
            <Field label="Inner per Master" size="sm" htmlFor="pr-inner-master">
              <Input id="pr-inner-master" type="number" value={form.inner_per_master} onChange={(e) => setForm({ ...form, inner_per_master: e.target.value })} />
            </Field>
            <Field label="Master Carton Name" size="sm" htmlFor="pr-master-name">
              <Input id="pr-master-name" uppercase value={form.master_carton_name} onChange={(e) => setForm({ ...form, master_carton_name: e.target.value })} />
            </Field>
            <Field label="Inner Carton Name" size="sm" htmlFor="pr-inner-name">
              <Input id="pr-inner-name" uppercase value={form.inner_carton_name} onChange={(e) => setForm({ ...form, inner_carton_name: e.target.value })} />
            </Field>
            <Field label="Ratio For" size="sm" htmlFor="pr-ratio-for">
              <Select id="pr-ratio-for" value={form.ratio_for} onChange={(e) => setForm({ ...form, ratio_for: e.target.value })}><option value="">Select…</option><option value="master">Master</option><option value="inner">Inner</option></Select>
            </Field>
            <Field label="Country" size="sm" htmlFor="pr-country">
              <Input id="pr-country" uppercase value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })} />
            </Field>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
