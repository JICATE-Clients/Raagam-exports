"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate } from "@/lib/format";
import { createDueDateConfirmation, deleteDueDateConfirmation } from "@/lib/orders/booking-actions";
import type { DueDateConfirmationRow } from "@/lib/orders/booking-service";

export function DueDateClient({ rows }: { rows: DueDateConfirmationRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    sales_order_id: "",
    entry_date: new Date().toISOString().slice(0, 10),
    delivery_date: "",
    notes: "",
  });

  function submit() {
    startTransition(async () => {
      const res = await createDueDateConfirmation({
        sales_order_id: form.sales_order_id,
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
    { header: "Notes", cell: (r) => <span className="text-xs text-muted-foreground line-clamp-1">{r.notes ?? "—"}</span> },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteDueDateConfirmation(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Confirmation</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No due date confirmations yet." />
      <Sheet open={open} onClose={() => setOpen(false)} title="New Due Date Confirmation" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.sales_order_id} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Details">
            <div><Label>Sales Order ID *</Label><Input value={form.sales_order_id} onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label>Entry Date</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
            <div><Label>Delivery Date</Label><Input type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
