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
import { createJobOrder } from "@/lib/production/extras-actions";
import { JOB_ORDER_STATUS_LABELS, type JobOrderStatus } from "@/lib/production/extras-types";
import type { JobOrderWithRefs, OrderOption } from "@/lib/production/extras-service";

function tone(s: JobOrderStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "open" ? "info" : s === "completed" ? "success" : "danger";
}

interface Props {
  rows: JobOrderWithRefs[];
  orders: OrderOption[];
  canCreate: boolean;
  canExport?: boolean;
}

export function JobOrdersClient({ rows, orders, canCreate, canExport = false }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState("");
  const [description, setDescription] = useState("");
  const [stageFrom, setStageFrom] = useState("");
  const [stageTo, setStageTo] = useState("");
  const [styleRef, setStyleRef] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createJobOrder({
        sales_order_id: orderId || null,
        description: description || null,
        stage_from: stageFrom || null,
        stage_to: stageTo || null,
        style_ref: styleRef || null,
      });
      if (r.ok) {
        success("Job order created");
        router.push(`/production/job-orders/${r.id}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<JobOrderWithRefs>[] = [
    {
      header: "JO #",
      cell: (r) => (
        <Link href={`/production/job-orders/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Stage", cell: (r) => <span className="text-sm">{[r.stage_from, r.stage_to].filter(Boolean).join(" → ") || "—"}</span> },
    { header: "Style", cell: (r) => <span className="text-sm">{r.style_ref ?? "—"}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{JOB_ORDER_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="production_job_orders" rows={rows} canExport={canExport} />
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New job order</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="jo-order">Sales order</Label>
                    <Select id="jo-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="jo-from">Stage from</Label>
                    <Input id="jo-from" placeholder="CP" value={stageFrom} onChange={(e) => setStageFrom(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="jo-to">Stage to</Label>
                    <Input id="jo-to" placeholder="PACK" value={stageTo} onChange={(e) => setStageTo(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="jo-style">Style ref</Label>
                    <Input id="jo-style" value={styleRef} onChange={(e) => setStyleRef(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="jo-desc">Description</Label>
                    <Textarea id="jo-desc" rows={1} value={description} onChange={(e) => setDescription(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New job order</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No job orders yet." />
    </div>
  );
}
