"use client";

import { useState, useTransition } from "react";
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
import { createSqNote } from "@/lib/planning/extras-actions";
import { SQ_STATUS_LABELS, type SqStatus } from "@/lib/planning/types";
import type { SqNoteWithRefs, OrderForPicker, BuyerOption } from "@/lib/planning/extras-service";

function tone(s: SqStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "allocated" ? "success" : "danger";
}

interface Props {
  rows: SqNoteWithRefs[];
  orders: OrderForPicker[];
  buyers: BuyerOption[];
  canCreate: boolean;
}

export function SqNotesClient({ rows, orders, buyers, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [orderId, setOrderId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createSqNote({
        sales_order_id: orderId || null,
        buyer_id: buyerId || null,
        description,
        notes: notes || null,
      });
      if (r.ok) {
        success("SQ note created");
        router.push(`/planning/sq-notes/${r.sqNoteId}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<SqNoteWithRefs>[] = [
    {
      header: "SQ #",
      cell: (r) => (
        <Link href={`/planning/sq-notes/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Buyer", cell: (r) => <span className="text-sm">{r.buyer_name ?? "—"}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{SQ_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New SQ note</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="sq-order">Sales order (optional)</Label>
                    <Select id="sq-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="sq-buyer">Buyer (optional)</Label>
                    <Select id="sq-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                      <option value="">— none —</option>
                      {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="sq-desc">Description</Label>
                    <Input id="sq-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="sq-notes">Notes</Label>
                    <Textarea id="sq-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New SQ note</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No SQ notes yet." />
    </div>
  );
}
