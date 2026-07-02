"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import { createPackingList } from "@/lib/production/extras-actions";
import { PACKING_STATUS_LABELS, type PackingStatus } from "@/lib/production/extras-types";
import type { PackingListWithRefs, OrderOption } from "@/lib/production/extras-service";

function tone(s: PackingStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "finalized" ? "success" : "danger";
}

interface Props {
  rows: PackingListWithRefs[];
  orders: OrderOption[];
  canCreate: boolean;
}

export function PackingListsClient({ rows, orders, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState("");
  const [packingDate, setPackingDate] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createPackingList({
        sales_order_id: orderId || null,
        packing_date: packingDate || null,
        notes: notes || null,
      });
      if (r.ok) {
        success("Packing list created");
        router.push(`/production/packing-lists/${r.id}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<PackingListWithRefs>[] = [
    {
      header: "PKL #",
      cell: (r) => (
        <Link href={`/production/packing-lists/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.packing_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{PACKING_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New packing list</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="pk-order">Sales order</Label>
                    <Select id="pk-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pk-date">Packing date</Label>
                    <Input id="pk-date" type="date" value={packingDate} onChange={(e) => setPackingDate(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-1">
                    <Label htmlFor="pk-notes">Notes</Label>
                    <Textarea id="pk-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New packing list</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No packing lists yet." />
    </div>
  );
}
