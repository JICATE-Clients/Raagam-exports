"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import {
  createStockCompletion,
  completeStockCompletion,
  cancelStockCompletion,
  deleteStockCompletion,
} from "@/lib/planning/extras-actions";
import {
  STOCK_COMPLETION_STATUS_LABELS,
  type StockCompletionStatus,
} from "@/lib/planning/types";
import type {
  StockCompletionWithRefs,
  OrderForPicker,
} from "@/lib/planning/extras-service";

function tone(s: StockCompletionStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "completed" ? "success" : "danger";
}

interface Props {
  rows: StockCompletionWithRefs[];
  orders: OrderForPicker[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport?: boolean;
}

export function StockCompletionClient({ rows, orders, canCreate, canEdit, canDelete, canExport = false }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState("");
  const [description, setDescription] = useState("");
  const [completedQty, setCompletedQty] = useState("");
  const [notes, setNotes] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createStockCompletion({
        sales_order_id: orderId || null,
        description,
        completed_qty: parseFloat(completedQty) || 0,
        notes: notes || null,
      });
      if (r.ok) {
        success("Stock completion created");
        setOrderId(""); setDescription(""); setCompletedQty(""); setNotes("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<StockCompletionWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description}</span> },
    { header: "Completed qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.completed_qty)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{STOCK_COMPLETION_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => completeStockCompletion(r.id), "Marked completed")}>Complete</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => cancelStockCompletion(r.id), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canDelete && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(() => deleteStockCompletion(r.id), "Deleted")}>Del</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="stock_completions" rows={rows} canExport={canExport} />

      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New stock completion</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="sc-order">Sales order (optional)</Label>
                    <Select id="sc-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="sc-desc">Description</Label>
                    <Input id="sc-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="sc-qty">Completed qty</Label>
                    <Input id="sc-qty" type="number" min="0" step="0.001" value={completedQty} onChange={(e) => setCompletedQty(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="sc-notes">Notes</Label>
                    <Input id="sc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New stock completion</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No stock completions yet." />
    </div>
  );
}
