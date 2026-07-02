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
import { fmtDate } from "@/lib/format";
import { createRequisition } from "@/lib/stores/extras-actions";
import { MRS_STATUS_LABELS, type MrsStatus } from "@/lib/stores/extras-types";
import type { MrsWithRefs, StoreOption } from "@/lib/stores/extras-service";

function tone(s: MrsStatus): StatusTone {
  switch (s) {
    case "draft":
      return "neutral";
    case "submitted":
      return "info";
    case "approved":
      return "warning";
    case "issued":
      return "success";
    case "rejected":
    case "cancelled":
      return "danger";
  }
}

interface Props {
  rows: MrsWithRefs[];
  stores: StoreOption[];
  canCreate: boolean;
}

export function RequisitionsClient({ rows, stores, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [storeId, setStoreId] = useState("");
  const [department, setDepartment] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId) {
      toastError("Select a store");
      return;
    }
    startTransition(async () => {
      const r = await createRequisition({
        store_id: storeId,
        department,
        required_date: requiredDate || null,
        notes: notes || null,
      });
      if (r.ok) {
        success("Requisition created");
        router.push(`/stores/requisitions/${r.id}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<MrsWithRefs>[] = [
    {
      header: "MRS #",
      cell: (r) => (
        <Link href={`/stores/requisitions/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Store", cell: (r) => <span className="text-sm">{r.store_code ?? "—"}</span> },
    { header: "Department", cell: (r) => <span className="text-sm">{r.department}</span> },
    { header: "Required", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.required_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{MRS_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New requisition</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="mr-store">Store</Label>
                    <Select id="mr-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                      <option value="">— select store —</option>
                      {stores.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="mr-dept">Department</Label>
                    <Input id="mr-dept" placeholder="e.g. Sewing" value={department} onChange={(e) => setDepartment(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="mr-date">Required date</Label>
                    <Input id="mr-date" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="mr-notes">Notes</Label>
                    <Textarea id="mr-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New requisition</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No requisitions yet." />
    </div>
  );
}
