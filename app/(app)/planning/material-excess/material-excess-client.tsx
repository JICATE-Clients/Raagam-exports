"use client";

import { useState, useTransition } from "react";
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
  createMaterialExcess,
  receiveMaterialExcess,
  closeMaterialExcess,
  cancelMaterialExcess,
  deleteMaterialExcess,
} from "@/lib/planning/extras-actions";
import {
  MATERIAL_EXCESS_STATUS_LABELS,
  type MaterialExcessStatus,
} from "@/lib/planning/types";
import type {
  MaterialExcessWithRefs,
  OrderForPicker,
  ItemOption,
  UomOption,
} from "@/lib/planning/extras-service";

function tone(s: MaterialExcessStatus): StatusTone {
  switch (s) {
    case "open":
      return "warning";
    case "received":
      return "info";
    case "closed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

interface Props {
  rows: MaterialExcessWithRefs[];
  orders: OrderForPicker[];
  items: ItemOption[];
  uoms: UomOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function MaterialExcessClient({
  rows,
  orders,
  items,
  uoms,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [orderId, setOrderId] = useState("");
  const [itemId, setItemId] = useState("");
  const [description, setDescription] = useState("");
  const [uomId, setUomId] = useState("");
  const [orderedQty, setOrderedQty] = useState("");
  const [reason, setReason] = useState("");

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
      const r = await createMaterialExcess({
        sales_order_id: orderId || null,
        item_id: itemId || null,
        description,
        uom_id: uomId || null,
        ordered_qty: parseFloat(orderedQty) || 0,
        reason: reason || null,
      });
      if (r.ok) {
        success("Excess order created");
        setOrderId(""); setItemId(""); setDescription(""); setUomId(""); setOrderedQty(""); setReason("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<MaterialExcessWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Item / description", cell: (r) => <span className="text-sm">{r.item_name ? `${r.item_name} — ` : ""}{r.description}</span> },
    { header: "Ordered", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.ordered_qty)}</span> },
    { header: "Received", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{MATERIAL_EXCESS_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "open" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => receiveMaterialExcess(r.id, r.ordered_qty), "Received (full qty)")}>Receive</Button>
          )}
          {canEdit && r.status === "received" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => closeMaterialExcess(r.id), "Closed")}>Close</Button>
          )}
          {canEdit && (r.status === "open" || r.status === "received") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => cancelMaterialExcess(r.id), "Cancelled")}>Cancel</Button>
          )}
          {canDelete && (r.status === "open" || r.status === "cancelled") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(() => deleteMaterialExcess(r.id), "Deleted")}>Del</Button>
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
              <CardTitle>New excess order</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="me-order">Sales order (optional)</Label>
                    <Select id="me-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="me-item">Item (optional)</Label>
                    <Select id="me-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                      <option value="">— none —</option>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ` : ""}{i.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="me-uom">UOM</Label>
                    <Select id="me-uom" value={uomId} onChange={(e) => setUomId(e.target.value)}>
                      <option value="">— select —</option>
                      {uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="me-desc">Description</Label>
                    <Input id="me-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="me-qty">Ordered qty</Label>
                    <Input id="me-qty" type="number" min="0" step="0.001" value={orderedQty} onChange={(e) => setOrderedQty(e.target.value)} />
                  </div>
                  <div className="sm:col-span-3">
                    <Label htmlFor="me-reason">Reason</Label>
                    <Input id="me-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New excess order</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No excess orders yet." />
    </div>
  );
}
