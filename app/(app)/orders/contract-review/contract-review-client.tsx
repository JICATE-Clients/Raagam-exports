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
import { fmtDate, fmtMoney } from "@/lib/format";
import { createContractReview, approveContractReview, rejectContractReview, sendToRevision, deleteContractReview } from "@/lib/orders/booking-actions";
import { usePermission } from "@/lib/auth/permission-context";
import type { ContractReviewRow } from "@/lib/orders/booking-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { pending: "neutral", approved: "success", rejected: "danger", revision: "warning" };

export function ContractReviewClient({ rows }: { rows: ContractReviewRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const canApprove = usePermission("orders", "approve");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    sales_order_id: "",
    review_date: new Date().toISOString().slice(0, 10),
    order_no: "",
    merchandiser_name: "",
    currency_code: "USD",
    ioc_value: "",
    order_value: "",
    remarks: "",
  });

  function submit() {
    startTransition(async () => {
      const res = await createContractReview({
        sales_order_id: form.sales_order_id,
        review_date: form.review_date,
        order_no: form.order_no || null,
        merchandiser_name: form.merchandiser_name || null,
        currency_code: form.currency_code || null,
        ioc_value: form.ioc_value ? Number(form.ioc_value) : 0,
        order_value: form.order_value ? Number(form.order_value) : 0,
        remarks: form.remarks || null,
        styles: [],
      });
      if (res.ok) { success("Contract review created."); setOpen(false); router.refresh(); }
      else error(res.error);
    });
  }

  function approve(id: string) { startTransition(async () => { const res = await approveContractReview(id); if (res.ok) { success("Approved."); router.refresh(); } else error(res.error); }); }
  function reject(id: string) { startTransition(async () => { const res = await rejectContractReview(id); if (res.ok) { success("Rejected."); router.refresh(); } else error(res.error); }); }
  function revision(id: string) { startTransition(async () => { const res = await sendToRevision(id); if (res.ok) { success("Sent to revision."); router.refresh(); } else error(res.error); }); }

  const columns: Column<ContractReviewRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-xs">{r.order_code ?? r.order_no ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.review_date)}</span> },
    { header: "Customer", cell: (r) => r.buyer_name ?? "—" },
    { header: "IOC Value", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.ioc_value, r.currency_code)}</span> },
    { header: "Order Value", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.order_value, r.currency_code)}</span> },
    { header: "P/L %", align: "right", cell: (r) => <span className={`tabular-nums ${r.profit_loss_pct >= 0 ? "text-green-600" : "text-red-600"}`}>{r.profit_loss_pct.toFixed(1)}%</span> },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.approval_status] ?? "neutral"}>{r.approval_status}</StatusPill> },
    {
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {canApprove && r.approval_status === "pending" && <>
            <Button variant="ghost" size="sm" onClick={() => approve(r.id)} disabled={isPending}>Approve</Button>
            <Button variant="ghost" size="sm" onClick={() => revision(r.id)} disabled={isPending}>Revision</Button>
            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => reject(r.id)} disabled={isPending}>Reject</Button>
          </>}
          {r.approval_status === "pending" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteContractReview(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Review</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No contract reviews yet." />
      <Sheet open={open} onClose={() => setOpen(false)} title="New Contract Review" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.sales_order_id} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Order">
            <div><Label>Sales Order ID *</Label><Input value={form.sales_order_id} onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label>Order No</Label><Input value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} /></div>
            <div><Label>Review Date</Label><Input type="date" value={form.review_date} onChange={(e) => setForm({ ...form, review_date: e.target.value })} /></div>
            <div><Label>Merchandiser</Label><Input value={form.merchandiser_name} onChange={(e) => setForm({ ...form, merchandiser_name: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Values">
            <div><Label>Currency</Label><Input value={form.currency_code} onChange={(e) => setForm({ ...form, currency_code: e.target.value })} maxLength={3} /></div>
            <div><Label>IOC Value (Cost)</Label><Input type="number" value={form.ioc_value} onChange={(e) => setForm({ ...form, ioc_value: e.target.value })} /></div>
            <div><Label>Order Value (Revenue)</Label><Input type="number" value={form.order_value} onChange={(e) => setForm({ ...form, order_value: e.target.value })} /></div>
            <div><Label>Remarks</Label><Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
