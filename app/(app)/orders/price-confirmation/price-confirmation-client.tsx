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
import { createPriceConfirmation, confirmPriceConf, amendPriceConf, deletePriceConf } from "@/lib/orders/pricing-actions";
import type { PriceConfirmationRow } from "@/lib/orders/pricing-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", confirmed: "success", amended: "warning", cancelled: "danger" };

export function PriceConfirmationClient({ rows }: { rows: PriceConfirmationRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ sales_order_id: "", notes: "" });

  function submit() {
    startTransition(async () => {
      const res = await createPriceConfirmation({
        sales_order_id: form.sales_order_id,
        notes: form.notes || null,
      });
      if (res.ok) { success("Price confirmation created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<PriceConfirmationRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-xs">{r.order_code ?? "—"}</span> },
    { header: "Amendment", align: "right", cell: (r) => <span className="tabular-nums">{r.amendment_sno}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    { header: "Created", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.created_at)}</span> },
    {
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "draft" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await confirmPriceConf(r.id); if (res.ok) { success("Confirmed."); router.refresh(); } else error(res.error); })} disabled={isPending}>Confirm</Button>}
          {r.status === "confirmed" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await amendPriceConf(r.id); if (res.ok) { success("Amendment created."); router.refresh(); } else error(res.error); })} disabled={isPending}>Amend</Button>}
          {r.status === "draft" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deletePriceConf(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Price Confirmation</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No price confirmations yet." />
      <Sheet open={open} onClose={() => setOpen(false)} title="New Price Confirmation" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.sales_order_id} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Details">
            <div><Label>Sales Order ID *</Label><Input value={form.sales_order_id} onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
