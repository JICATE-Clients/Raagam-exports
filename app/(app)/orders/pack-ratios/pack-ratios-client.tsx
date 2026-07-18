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
import { createPackRatio, deletePackRatio, addPackRatioLine } from "@/lib/orders/pack-ratio-actions";
import type { PackRatioRow } from "@/lib/orders/pack-ratio-service";

const SIZE_LABELS = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];

export function PackRatiosClient({ rows }: { rows: PackRatioRow[] }) {
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
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deletePackRatio(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Pack Ratio</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No pack ratios yet." />

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
            <div className="space-y-3 rounded border border-border p-3">
              <div className="flex gap-2 items-end flex-wrap">
                <div><Label>Style</Label><Input className="w-24" value={lineForm.style_no} onChange={(e) => setLineForm({ ...lineForm, style_no: e.target.value })} /></div>
                <div><Label>Combo</Label><Input className="w-24" value={lineForm.combo} onChange={(e) => setLineForm({ ...lineForm, combo: e.target.value })} /></div>
                <div><Label>Cartons</Label><Input className="w-16" type="number" value={lineForm.no_of_cartons} onChange={(e) => setLineForm({ ...lineForm, no_of_cartons: e.target.value })} /></div>
                <div><Label>Pcs/Pack</Label><Input className="w-16" type="number" value={lineForm.pcs_per_pack} onChange={(e) => setLineForm({ ...lineForm, pcs_per_pack: e.target.value })} /></div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Size Quantities</Label>
                <div className="flex gap-1 flex-wrap">
                  {SIZE_LABELS.map((label, i) => (
                    <div key={label} className="text-center">
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                      <Input
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
          <DetailSection label="Order">
            <div><Label>Sales Order ID *</Label><Input value={form.sales_order_id} onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label>Style No</Label><Input value={form.style_no} onChange={(e) => setForm({ ...form, style_no: e.target.value })} /></div>
            <div><Label>Assortment Type</Label><Input value={form.assortment_type} onChange={(e) => setForm({ ...form, assortment_type: e.target.value })} /></div>
            <div><Label>Delivery Date</Label><Input type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Carton Structure">
            <div><Label>No of Cartons</Label><Input type="number" value={form.no_of_cartons} onChange={(e) => setForm({ ...form, no_of_cartons: e.target.value })} /></div>
            <div><Label>Pcs per Inner</Label><Input type="number" value={form.pcs_per_inner} onChange={(e) => setForm({ ...form, pcs_per_inner: e.target.value })} /></div>
            <div><Label>Inner per Master</Label><Input type="number" value={form.inner_per_master} onChange={(e) => setForm({ ...form, inner_per_master: e.target.value })} /></div>
            <div><Label>Master Carton Name</Label><Input value={form.master_carton_name} onChange={(e) => setForm({ ...form, master_carton_name: e.target.value })} /></div>
            <div><Label>Inner Carton Name</Label><Input value={form.inner_carton_name} onChange={(e) => setForm({ ...form, inner_carton_name: e.target.value })} /></div>
            <div><Label>Ratio For</Label><Select value={form.ratio_for} onChange={(e) => setForm({ ...form, ratio_for: e.target.value })}><option value="">Select…</option><option value="master">Master</option><option value="inner">Inner</option></Select></div>
            <div><Label>Country</Label><Input value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
