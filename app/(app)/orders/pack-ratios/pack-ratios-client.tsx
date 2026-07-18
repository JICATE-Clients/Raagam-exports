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
import { createPackRatio, deletePackRatio } from "@/lib/orders/pack-ratio-actions";
import type { PackRatioRow } from "@/lib/orders/pack-ratio-service";

export function PackRatiosClient({ rows }: { rows: PackRatioRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
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
    { header: "Order", cell: (r) => <span className="text-xs">{r.order_code ?? "—"}</span> },
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
