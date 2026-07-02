"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtNumber, fmtDate } from "@/lib/format";
import {
  createDespatch,
  markDespatched,
  cancelDespatch,
  deleteDespatch,
} from "@/lib/production/extras-actions";
import { DESPATCH_STATUS_LABELS, type DespatchStatus } from "@/lib/production/extras-types";
import type { DespatchWithRefs, OrderOption } from "@/lib/production/extras-service";

function tone(s: DespatchStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "despatched" ? "success" : "danger";
}

interface Props {
  rows: DespatchWithRefs[];
  orders: OrderOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function DespatchClient({ rows, orders, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState("");
  const [date, setDate] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [destination, setDestination] = useState("");
  const [cartons, setCartons] = useState("");
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
      const r = await createDespatch({
        sales_order_id: orderId || null,
        despatch_date: date || null,
        vehicle_no: vehicle || null,
        destination: destination || null,
        cartons: parseFloat(cartons) || 0,
        notes: notes || null,
      });
      if (r.ok) {
        success("Despatch created");
        setOrderId(""); setDate(""); setVehicle(""); setDestination(""); setCartons(""); setNotes("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<DespatchWithRefs>[] = [
    { header: "DSP #", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.despatch_date)}</span> },
    { header: "Vehicle", cell: (r) => <span className="text-sm">{r.vehicle_no ?? "—"}</span> },
    { header: "Destination", cell: (r) => <span className="text-sm">{r.destination ?? "—"}</span> },
    { header: "Cartons", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.cartons)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{DESPATCH_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => markDespatched(r.id), "Despatched")}>Despatch</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => cancelDespatch(r.id), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canDelete && (r.status === "draft" || r.status === "cancelled") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => deleteDespatch(r.id), "Deleted")}>Del</Button>
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
              <CardTitle>New despatch</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="ds-order">Sales order</Label>
                    <Select id="ds-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="ds-date">Despatch date</Label><Input id="ds-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div><Label htmlFor="ds-vehicle">Vehicle no.</Label><Input id="ds-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></div>
                  <div><Label htmlFor="ds-dest">Destination</Label><Input id="ds-dest" value={destination} onChange={(e) => setDestination(e.target.value)} /></div>
                  <div><Label htmlFor="ds-cartons">Cartons</Label><Input id="ds-cartons" type="number" min="0" value={cartons} onChange={(e) => setCartons(e.target.value)} /></div>
                  <div className="sm:col-span-2 lg:col-span-1"><Label htmlFor="ds-notes">Notes</Label><Textarea id="ds-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New despatch</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No despatches yet." />
    </div>
  );
}
