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
import { createPpmIssue } from "@/lib/planning/extras-actions";
import { PPM_STATUS_LABELS, type PpmStatus } from "@/lib/planning/types";
import type { PpmIssueWithRefs, OrderForPicker } from "@/lib/planning/extras-service";

function tone(s: PpmStatus): StatusTone {
  switch (s) {
    case "draft":
      return "neutral";
    case "issued":
      return "warning";
    case "received":
      return "success";
    case "cancelled":
      return "danger";
  }
}

interface Props {
  rows: PpmIssueWithRefs[];
  orders: OrderForPicker[];
  canCreate: boolean;
}

export function PpmClient({ rows, orders, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState("");
  const [description, setDescription] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createPpmIssue({
        sales_order_id: orderId || null,
        description: description || null,
        issue_date: issueDate || null,
        notes: notes || null,
      });
      if (r.ok) {
        success("PPM created");
        router.push(`/planning/ppm/${r.ppmId}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<PpmIssueWithRefs>[] = [
    {
      header: "PPM #",
      cell: (r) => (
        <Link href={`/planning/ppm/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description ?? "—"}</span> },
    { header: "Issue date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.issue_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{PPM_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New PPM issue</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="pp-order">Sales order (optional)</Label>
                    <Select id="pp-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pp-date">Issue date</Label>
                    <Input id="pp-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-1">
                    <Label htmlFor="pp-desc">Description</Label>
                    <Input id="pp-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="pp-notes">Notes</Label>
                    <Textarea id="pp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New PPM</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No PPM issues yet." />
    </div>
  );
}
