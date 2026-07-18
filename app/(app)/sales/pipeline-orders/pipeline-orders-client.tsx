"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate } from "@/lib/format";
import { createPipelineOrder, confirmPipelineOrder, deletePipelineOrder, createSeasonalOrder, deleteSeasonalOrder } from "@/lib/sales/pipeline-actions";
import type { PipelineOrderRow } from "@/lib/sales/pipeline-service";
import type { SeasonalOrder } from "@/lib/sales/pipeline-types";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", confirmed: "success", cancelled: "danger" };

function PipelineTab({ rows }: { rows: PipelineOrderRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    oc_date: new Date().toISOString().slice(0, 10),
    customer_id: "",
    order_no: "",
    season: "",
    season_yr: "",
    order_category: "",
    notes: "",
  });

  function submit() {
    startTransition(async () => {
      const res = await createPipelineOrder({
        oc_date: form.oc_date,
        is_repeat_order: false,
        customer_id: form.customer_id || null,
        order_no: form.order_no || null,
        season: form.season || null,
        season_yr: form.season_yr || null,
        order_category: form.order_category || null,
        notes: form.notes || null,
      });
      if (res.ok) { success("Pipeline order created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<PipelineOrderRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.oc_date)}</span> },
    { header: "Customer", cell: (r) => r.buyer_name ?? "—" },
    { header: "Order No", cell: (r) => r.order_no ?? "—" },
    { header: "Season", cell: (r) => [r.season, r.season_yr].filter(Boolean).join(" ") || "—" },
    { header: "Category", cell: (r) => r.order_category ?? "—" },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    {
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "draft" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await confirmPipelineOrder(r.id); if (res.ok) { success("Confirmed."); router.refresh(); } else error(res.error); })} disabled={isPending}>Confirm</Button>}
          {r.status === "draft" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deletePipelineOrder(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Pipeline Order</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No pipeline orders yet." />
      <Sheet open={open} onClose={() => setOpen(false)} title="New Pipeline Order" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label htmlFor="plo-date">OC Date</Label><Input id="plo-date" type="date" value={form.oc_date} onChange={(e) => setForm({ ...form, oc_date: e.target.value })} /></div>
            <div><Label htmlFor="plo-cust">Customer ID</Label><Input id="plo-cust" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label htmlFor="plo-order">Order No</Label><Input id="plo-order" value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} /></div>
            <div><Label htmlFor="plo-season">Season</Label><Input id="plo-season" value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} /></div>
            <div><Label htmlFor="plo-yr">Season Year</Label><Input id="plo-yr" value={form.season_yr} onChange={(e) => setForm({ ...form, season_yr: e.target.value })} /></div>
            <div><Label htmlFor="plo-cat">Category</Label><Input id="plo-cat" value={form.order_category} onChange={(e) => setForm({ ...form, order_category: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}

function SeasonalTab({ rows }: { rows: SeasonalOrder[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    oc_date: new Date().toISOString().slice(0, 10),
    style_no: "",
    season: "",
    season_yr: "",
    order_no: "",
  });

  function submit() {
    startTransition(async () => {
      const res = await createSeasonalOrder({
        oc_date: form.oc_date,
        style_no: form.style_no || null,
        season: form.season || null,
        season_yr: form.season_yr || null,
        order_no: form.order_no || null,
      });
      if (res.ok) { success("Seasonal order created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<SeasonalOrder>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.oc_date)}</span> },
    { header: "Style", cell: (r) => r.style_no ?? "—" },
    { header: "Season", cell: (r) => [r.season, r.season_yr].filter(Boolean).join(" ") || "—" },
    { header: "Order No", cell: (r) => r.order_no ?? "—" },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    {
      header: "", align: "right", cell: (r) => r.status === "draft" ? (
        <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteSeasonalOrder(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Seasonal Order</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No seasonal orders yet." />
      <Sheet open={open} onClose={() => setOpen(false)} title="New Seasonal Order" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Details">
            <div><Label htmlFor="sno-date">OC Date</Label><Input id="sno-date" type="date" value={form.oc_date} onChange={(e) => setForm({ ...form, oc_date: e.target.value })} /></div>
            <div><Label htmlFor="sno-style">Style No</Label><Input id="sno-style" value={form.style_no} onChange={(e) => setForm({ ...form, style_no: e.target.value })} /></div>
            <div><Label htmlFor="sno-season">Season</Label><Input id="sno-season" value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} /></div>
            <div><Label htmlFor="sno-yr">Season Year</Label><Input id="sno-yr" value={form.season_yr} onChange={(e) => setForm({ ...form, season_yr: e.target.value })} /></div>
            <div><Label htmlFor="sno-order">Order No</Label><Input id="sno-order" value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}

export function PipelineOrdersClient({
  pipelineOrders,
  seasonalOrders,
}: {
  pipelineOrders: PipelineOrderRow[];
  seasonalOrders: SeasonalOrder[];
}) {
  const items = [
    { key: "pipeline", label: `Pipeline (${pipelineOrders.length})`, content: <PipelineTab rows={pipelineOrders} /> },
    { key: "seasonal", label: `Seasonal (${seasonalOrders.length})`, content: <SeasonalTab rows={seasonalOrders} /> },
  ];

  return <Tabs items={items} />;
}
