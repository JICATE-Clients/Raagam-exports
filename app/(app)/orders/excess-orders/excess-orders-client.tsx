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
import { createExcessOrder, confirmExcessOrder, deleteExcessOrder } from "@/lib/orders/pack-ratio-actions";
import type { ExcessOrderRow } from "@/lib/orders/pack-ratio-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", confirmed: "success", cancelled: "danger" };

export function ExcessOrdersClient({ rows }: { rows: ExcessOrderRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    sales_order_id: "", req_no: "", ppm_no: "", customer_name: "", notes: "",
  });

  function submit() {
    startTransition(async () => {
      const res = await createExcessOrder({
        sales_order_id: form.sales_order_id,
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
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "draft" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await confirmExcessOrder(r.id); if (res.ok) { success("Confirmed."); router.refresh(); } else error(res.error); })} disabled={isPending}>Confirm</Button>}
          {r.status === "draft" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteExcessOrder(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Excess Order</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No excess orders yet." />
      <Sheet open={open} onClose={() => setOpen(false)} title="New Excess Order" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.sales_order_id} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Details">
            <div><Label>Sales Order ID *</Label><Input value={form.sales_order_id} onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label>Req No</Label><Input value={form.req_no} onChange={(e) => setForm({ ...form, req_no: e.target.value })} /></div>
            <div><Label>PPM No</Label><Input value={form.ppm_no} onChange={(e) => setForm({ ...form, ppm_no: e.target.value })} /></div>
            <div><Label>Customer Name</Label><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
