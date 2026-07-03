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
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { fmtNumber, fmtDate } from "@/lib/format";
import {
  createInspection,
  recordInspectionResult,
  cancelInspection,
  deleteInspection,
} from "@/lib/production/extras-actions";
import {
  INSPECTION_RESULT_LABELS,
  INSPECTION_STATUS_LABELS,
  type InspectionResult,
  type InspectionStatus,
} from "@/lib/production/extras-types";
import type { InspectionWithRefs, OrderOption } from "@/lib/production/extras-service";

function resultTone(r: InspectionResult): StatusTone {
  switch (r) {
    case "pending":
      return "neutral";
    case "pass":
      return "success";
    case "fail":
      return "danger";
    case "rework":
      return "warning";
  }
}
function statusTone(s: InspectionStatus): StatusTone {
  return s === "draft" ? "info" : s === "completed" ? "success" : "danger";
}

interface Props {
  rows: InspectionWithRefs[];
  orders: OrderOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport?: boolean;
}

export function InspectionsClient({ rows, orders, canCreate, canEdit, canDelete, canExport = false }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState("");
  const [date, setDate] = useState("");
  const [inspector, setInspector] = useState("");
  const [sampleSize, setSampleSize] = useState("");
  const [defects, setDefects] = useState("");
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
      const r = await createInspection({
        sales_order_id: orderId || null,
        inspection_date: date || null,
        inspector: inspector || null,
        sample_size: parseFloat(sampleSize) || 0,
        defects_found: parseFloat(defects) || 0,
        notes: notes || null,
      });
      if (r.ok) {
        success("Inspection created");
        setOrderId(""); setDate(""); setInspector(""); setSampleSize(""); setDefects(""); setNotes("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<InspectionWithRefs>[] = [
    { header: "INS #", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.inspection_date)}</span> },
    { header: "Sample", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.sample_size)}</span> },
    { header: "Defects", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.defects_found)}</span> },
    { header: "Result", cell: (r) => <StatusPill tone={resultTone(r.result)}>{INSPECTION_RESULT_LABELS[r.result]}</StatusPill> },
    { header: "Status", cell: (r) => <StatusPill tone={statusTone(r.status)}>{INSPECTION_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => recordInspectionResult(r.id, "pass"), "Passed")}>Pass</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => recordInspectionResult(r.id, "rework"), "Rework")}>Rework</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => recordInspectionResult(r.id, "fail"), "Failed")}>Fail</Button>
            </>
          )}
          {canEdit && r.status === "draft" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => cancelInspection(r.id), "Cancelled")}>Cancel</Button>
          )}
          {canDelete && (r.status === "draft" || r.status === "cancelled") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => deleteInspection(r.id), "Deleted")}>Del</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="inspections" rows={rows} canExport={canExport} />
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New inspection</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="in-order">Sales order</Label>
                    <Select id="in-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="in-date">Date</Label><Input id="in-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div><Label htmlFor="in-inspector">Inspector</Label><Input id="in-inspector" value={inspector} onChange={(e) => setInspector(e.target.value)} /></div>
                  <div><Label htmlFor="in-sample">Sample size</Label><Input id="in-sample" type="number" min="0" value={sampleSize} onChange={(e) => setSampleSize(e.target.value)} /></div>
                  <div><Label htmlFor="in-def">Defects found</Label><Input id="in-def" type="number" min="0" value={defects} onChange={(e) => setDefects(e.target.value)} /></div>
                  <div className="sm:col-span-2 lg:col-span-1"><Label htmlFor="in-notes">Notes</Label><Input id="in-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New inspection</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No inspections yet." />
    </div>
  );
}
