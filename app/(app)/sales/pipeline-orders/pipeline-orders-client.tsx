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
import { Select } from "@/components/ui/select";
import { createPipelineOrder, confirmPipelineOrder, deletePipelineOrder, createSeasonalOrder, deleteSeasonalOrder, addPipelineStyle, deletePipelineStyle, addPipelineDyeColor, deletePipelineDyeColor } from "@/lib/sales/pipeline-actions";
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingStyle, setAddingStyle] = useState(false);
  const [addingDye, setAddingDye] = useState(false);
  const [styleForm, setStyleForm] = useState({ style_no: "", style_description: "", uom_id: "", order_qty: "" });
  const [dyeForm, setDyeForm] = useState({ color_type: "yarn", description: "", process_loss_pct: "", dye_type: "" });

  function submitStyle() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addPipelineStyle(selectedId, {
        style_no: styleForm.style_no || null,
        style_description: styleForm.style_description || null,
        uom_id: styleForm.uom_id || null,
        order_qty: styleForm.order_qty ? Number(styleForm.order_qty) : 0,
      });
      if (res.ok) { success("Style added."); setAddingStyle(false); setStyleForm({ style_no: "", style_description: "", uom_id: "", order_qty: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  function submitDye() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addPipelineDyeColor(selectedId, {
        color_type: dyeForm.color_type,
        description: dyeForm.description || null,
        process_loss_pct: dyeForm.process_loss_pct ? Number(dyeForm.process_loss_pct) : 0,
        dye_type: dyeForm.dye_type || null,
      });
      if (res.ok) { success("Dyeing color added."); setAddingDye(false); setDyeForm({ color_type: "yarn", description: "", process_loss_pct: "", dye_type: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<PipelineOrderRow>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
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

      {/* Styles + Dyeing editor for selected pipeline order */}
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Details for: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
          </div>

          {/* Styles */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Styles</span>
              <Button variant="outline" size="sm" onClick={() => setAddingStyle(!addingStyle)}>{addingStyle ? "Cancel" : "+ Add Style"}</Button>
            </div>
            {addingStyle && (
              <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
                <div><Label>Style No</Label><Input className="w-24" value={styleForm.style_no} onChange={(e) => setStyleForm({ ...styleForm, style_no: e.target.value })} /></div>
                <div><Label>Description</Label><Input className="w-40" value={styleForm.style_description} onChange={(e) => setStyleForm({ ...styleForm, style_description: e.target.value })} /></div>
                <div><Label>UOM</Label><Input className="w-16" value={styleForm.uom_id} onChange={(e) => setStyleForm({ ...styleForm, uom_id: e.target.value })} /></div>
                <div><Label>Order Qty</Label><Input className="w-24" type="number" value={styleForm.order_qty} onChange={(e) => setStyleForm({ ...styleForm, order_qty: e.target.value })} /></div>
                <Button size="sm" disabled={isPending} onClick={submitStyle}>{isPending ? "Adding…" : "Add"}</Button>
              </div>
            )}
          </div>

          {/* Dyeing Colors */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Dyeing Colors</span>
              <Button variant="outline" size="sm" onClick={() => setAddingDye(!addingDye)}>{addingDye ? "Cancel" : "+ Add Color"}</Button>
            </div>
            {addingDye && (
              <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
                <div><Label>Type</Label><Select className="w-24" value={dyeForm.color_type} onChange={(e) => setDyeForm({ ...dyeForm, color_type: e.target.value })}><option value="yarn">Yarn</option><option value="fabric">Fabric</option></Select></div>
                <div><Label>Description</Label><Input className="w-32" value={dyeForm.description} onChange={(e) => setDyeForm({ ...dyeForm, description: e.target.value })} /></div>
                <div><Label>Loss %</Label><Input className="w-16" type="number" value={dyeForm.process_loss_pct} onChange={(e) => setDyeForm({ ...dyeForm, process_loss_pct: e.target.value })} /></div>
                <div><Label>Dye Type</Label><Input className="w-24" value={dyeForm.dye_type} onChange={(e) => setDyeForm({ ...dyeForm, dye_type: e.target.value })} /></div>
                <Button size="sm" disabled={isPending} onClick={submitDye}>{isPending ? "Adding…" : "Add"}</Button>
              </div>
            )}
          </div>
        </div>
      )}

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
