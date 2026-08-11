"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { RecordPicker } from "@/components/masters/record-picker";
import { fmtDate, fmtMoney } from "@/lib/format";
import { sectionValidity } from "@/lib/screens/validity";
import { createContractReview, approveContractReview, rejectContractReview, sendToRevision, deleteContractReview } from "@/lib/orders/booking-actions";
import { usePermission } from "@/lib/auth/permission-context";
import type { ContractReviewRow } from "@/lib/orders/booking-service";
import type { OrderOption } from "@/lib/orders/order-options";
import type { StatusTone } from "@/components/ui/status-pill";
import { withCreatedColumns } from "@/components/ui/created-columns";

const STATUS_TONE: Record<string, StatusTone> = { pending: "neutral", approved: "success", rejected: "danger", revision: "warning" };

const BLANK = {
  sales_order_id: null as string | null,
  review_date: new Date().toISOString().slice(0, 10),
  order_no: "",
  merchandiser_name: "",
  currency_code: "USD",
  ioc_value: "",
  order_value: "",
  remarks: "",
};

export function ContractReviewClient({
  rows,
  orders,
}: {
  rows: ContractReviewRow[];
  orders: OrderOption[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const canApprove = usePermission("orders", "approve");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);

  // Eight fields across two sections, no child grid → a Sheet, per the surface
  // table in `raagam-screen-layout`. `canSave` is DERIVED from the same
  // `required` declaration that draws the `*`.
  const validity = sectionValidity({
    sections: [{ key: "order" }, { key: "values" }],
    values: form,
    fields: [
      {
        section: "order",
        id: "cr-order",
        label: "Sales Order",
        required: true,
        empty: (f) => !f.sales_order_id,
      },
    ],
  });

  function submit() {
    startTransition(async () => {
      const res = await createContractReview({
        sales_order_id: form.sales_order_id ?? "",
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
      /* The approval decision is workflow, not row CRUD — labelled column of
         its own, with Delete moved to the standard action cell (LAYOUT.md §6a). */
      header: "Decision", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {canApprove && r.approval_status === "pending" && <>
            <Button variant="outline" size="sm" onClick={() => approve(r.id)} disabled={isPending}>Approve</Button>
            <Button variant="outline" size="sm" onClick={() => revision(r.id)} disabled={isPending}>Revision</Button>
            <Button variant="danger" size="sm" onClick={() => reject(r.id)} disabled={isPending}>Reject</Button>
          </>}
        </div>
      ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.code}
        onDelete={() => startTransition(async () => { const res = await deleteContractReview(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })}
        canDelete={r.approval_status === "pending"}
        isPending={isPending}
      />
    )),
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => { setForm(BLANK); setOpen(true); }}>+ New Review</Button></div>
      <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No contract reviews yet." />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New Contract Review"
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !validity.canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save review"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Order" cols={12}>
            {/* PICKED, NOT TYPED — this was `<Input placeholder="UUID">`. */}
            <Field size="sm">
              <RecordPicker
                id="cr-order"
                label="Sales Order"
                items={orders}
                value={form.sales_order_id}
                onChange={(id) => setForm({ ...form, sales_order_id: id })}
                required
              />
            </Field>
            <Field label="Order No" size="sm" htmlFor="cr-orderno">
              <Input id="cr-orderno" uppercase value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} />
            </Field>
            <Field label="Review Date" size="sm" htmlFor="cr-date">
              <Input id="cr-date" type="date" value={form.review_date} onChange={(e) => setForm({ ...form, review_date: e.target.value })} />
            </Field>
            <Field label="Merchandiser" size="sm" htmlFor="cr-merch">
              <Input id="cr-merch" uppercase value={form.merchandiser_name} onChange={(e) => setForm({ ...form, merchandiser_name: e.target.value })} />
            </Field>
          </DetailSection>
          <DetailSection label="Values" cols={12}>
            <Field label="Currency" size="sm" htmlFor="cr-currency">
              <Input id="cr-currency" uppercase value={form.currency_code} onChange={(e) => setForm({ ...form, currency_code: e.target.value })} maxLength={3} />
            </Field>
            <Field label="IOC Value (Cost)" size="sm" htmlFor="cr-ioc">
              <Input id="cr-ioc" type="number" value={form.ioc_value} onChange={(e) => setForm({ ...form, ioc_value: e.target.value })} />
            </Field>
            <Field label="Order Value (Revenue)" size="sm" htmlFor="cr-value">
              <Input id="cr-value" type="number" value={form.order_value} onChange={(e) => setForm({ ...form, order_value: e.target.value })} />
            </Field>
            <Field label="Remarks" size="sm" htmlFor="cr-remarks">
              <Input id="cr-remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
