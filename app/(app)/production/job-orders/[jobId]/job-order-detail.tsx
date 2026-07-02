"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import {
  addJobComponent,
  deleteJobComponent,
  openJobOrder,
  completeJobOrder,
  cancelJobOrder,
  deleteJobOrder,
} from "@/lib/production/extras-actions";
import type { JobOrderStatus, JobOrderComponent } from "@/lib/production/extras-types";

interface Props {
  jobId: string;
  status: JobOrderStatus;
  components: JobOrderComponent[];
  canEdit: boolean;
  canDelete: boolean;
}

export function JobOrderDetail({ jobId, status, components, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const editable = status === "draft" || status === "open";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await addJobComponent(jobId, {
        component_name: name,
        description: description || null,
        quantity: parseFloat(qty) || 0,
        sort_order: (components.length + 1) * 10,
      });
      if (r.ok) {
        success("Component added");
        setName(""); setDescription(""); setQty("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<JobOrderComponent>[] = [
    { header: "Component", cell: (r) => <span className="text-sm">{r.component_name}</span> },
    { header: "Description", cell: (r) => <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quantity)}</span> },
    ...(canEdit && editable
      ? [{ header: "", cell: (r: JobOrderComponent) => (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
            onClick={() => run(() => deleteJobComponent(r.id, jobId), "Removed")}>Remove</Button>
        ) } satisfies Column<JobOrderComponent>]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Components ({components.length})</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {canEdit && editable && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
              <div className="w-44"><Label htmlFor="jc-name">Component</Label><Input id="jc-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
              <div className="min-w-[180px] flex-1"><Label htmlFor="jc-desc">Description</Label><Input id="jc-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div className="w-28"><Label htmlFor="jc-qty">Qty</Label><Input id="jc-qty" type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={components} getKey={(r) => r.id} empty="No components yet." />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {status === "draft" && (
            <>
              <Button disabled={isPending} onClick={() => run(() => openJobOrder(jobId), "Opened")}>Open</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => cancelJobOrder(jobId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {status === "open" && (
            <>
              <Button disabled={isPending} onClick={() => run(() => completeJobOrder(jobId), "Completed")}>Complete</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => cancelJobOrder(jobId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canDelete && (status === "draft" || status === "cancelled") && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deleteJobOrder(jobId);
                if (r.ok) router.push("/production/job-orders");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
