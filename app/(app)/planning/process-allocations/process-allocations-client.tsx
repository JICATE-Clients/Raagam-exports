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
import {
  createProcessAllocation,
  confirmProcessAllocation,
  cancelProcessAllocation,
  deleteProcessAllocation,
} from "@/lib/planning/extras-actions";
import {
  PROCESS_ALLOC_STATUS_LABELS,
  type ProcessAllocStatus,
} from "@/lib/planning/types";
import type {
  ProcessAllocationWithRefs,
  OrderForPicker,
  VendorOption,
  UomOption,
} from "@/lib/planning/extras-service";

function tone(s: ProcessAllocStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "confirmed" ? "success" : "danger";
}

interface Props {
  rows: ProcessAllocationWithRefs[];
  orders: OrderForPicker[];
  vendors: VendorOption[];
  uoms: UomOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function ProcessAllocationsClient({
  rows,
  orders,
  vendors,
  uoms,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState("");
  const [processName, setProcessName] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [qty, setQty] = useState("");
  const [uomId, setUomId] = useState("");
  const [rate, setRate] = useState("");
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
      const r = await createProcessAllocation({
        sales_order_id: orderId || null,
        process_name: processName,
        vendor_id: vendorId || null,
        allocated_qty: parseFloat(qty) || 0,
        uom_id: uomId || null,
        rate: parseFloat(rate) || 0,
        notes: notes || null,
      });
      if (r.ok) {
        success("Allocation created");
        setOrderId(""); setProcessName(""); setVendorId(""); setQty(""); setUomId(""); setRate(""); setNotes("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<ProcessAllocationWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Process", cell: (r) => <span className="text-sm">{r.process_name}</span> },
    { header: "Vendor", cell: (r) => <span className="text-sm">{r.vendor_name ?? "—"}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.allocated_qty)}</span> },
    { header: "Rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.rate)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{PROCESS_ALLOC_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => confirmProcessAllocation(r.id), "Confirmed")}>Confirm</Button>
          )}
          {canEdit && r.status !== "cancelled" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => cancelProcessAllocation(r.id), "Cancelled")}>Cancel</Button>
          )}
          {canDelete && (r.status === "draft" || r.status === "cancelled") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(() => deleteProcessAllocation(r.id), "Deleted")}>Del</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New process allocation</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="pa-order">Sales order (optional)</Label>
                    <Select id="pa-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pa-proc">Process</Label>
                    <Input id="pa-proc" placeholder="e.g. Dyeing" value={processName} onChange={(e) => setProcessName(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="pa-vendor">Vendor (optional)</Label>
                    <Select id="pa-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                      <option value="">— none —</option>
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} — ` : ""}{v.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pa-qty">Allocated qty</Label>
                    <Input id="pa-qty" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="pa-uom">UOM</Label>
                    <Select id="pa-uom" value={uomId} onChange={(e) => setUomId(e.target.value)}>
                      <option value="">— select —</option>
                      {uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pa-rate">Rate</Label>
                    <Input id="pa-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="pa-notes">Notes</Label>
                    <Input id="pa-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New allocation</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No process allocations yet." />
    </div>
  );
}
