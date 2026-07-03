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
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { fmtDate } from "@/lib/format";
import { createPurchaseIndent } from "@/lib/purchase/extras-actions";
import { INDENT_STATUS_LABELS, type IndentStatus } from "@/lib/purchase/extras-types";
import type { PurchaseIndentWithRefs, OrderOption } from "@/lib/purchase/extras-service";

function tone(s: IndentStatus): StatusTone {
  switch (s) {
    case "open":
      return "warning";
    case "acknowledged":
      return "info";
    case "converted":
      return "success";
    case "cancelled":
      return "danger";
  }
}

interface Props {
  rows: PurchaseIndentWithRefs[];
  orders: OrderOption[];
  canCreate: boolean;
  canExport?: boolean;
}

export function IndentsClient({ rows, orders, canCreate, canExport = false }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [department, setDepartment] = useState("");
  const [orderId, setOrderId] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createPurchaseIndent({
        department,
        sales_order_id: orderId || null,
        required_date: requiredDate || null,
        notes: notes || null,
      });
      if (r.ok) {
        success("Indent created");
        router.push(`/purchase/indents/${r.indentId}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<PurchaseIndentWithRefs>[] = [
    {
      header: "Indent #",
      cell: (r) => (
        <Link href={`/purchase/indents/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Department", cell: (r) => <span className="text-sm">{r.department}</span> },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Required", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.required_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{INDENT_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="purchase_indents" rows={rows} canExport={canExport} />
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New indent</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="in-dept">Department</Label>
                    <Input id="in-dept" placeholder="e.g. Cutting" value={department} onChange={(e) => setDepartment(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="in-order">Sales order (optional)</Label>
                    <Select id="in-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="in-date">Required date</Label>
                    <Input id="in-date" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="in-notes">Notes</Label>
                    <Textarea id="in-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New indent</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No indents yet." />
    </div>
  );
}
