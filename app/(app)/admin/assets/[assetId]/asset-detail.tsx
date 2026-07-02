"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import {
  assignAsset,
  returnAsset,
  setAssetStatus,
  deleteAsset,
} from "@/lib/admin/extras-actions";
import type { AssetStatus, AssetAssignment } from "@/lib/admin/extras-types";

interface Props {
  assetId: string;
  status: AssetStatus;
  assignments: AssetAssignment[];
  canEdit: boolean;
  canDelete: boolean;
}

export function AssetDetail({ assetId, status, assignments, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [assignee, setAssignee] = useState("");
  const [department, setDepartment] = useState("");
  const [date, setDate] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await assignAsset(assetId, {
        assignee_name: assignee,
        department: department || null,
        assigned_date: date || null,
        notes: null,
      });
      if (r.ok) {
        success("Asset assigned");
        setAssignee(""); setDepartment(""); setDate("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<AssetAssignment>[] = [
    { header: "Assignee", cell: (r) => <span className="text-sm">{r.assignee_name}</span> },
    { header: "Department", cell: (r) => <span className="text-sm">{r.department ?? "—"}</span> },
    { header: "Assigned", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.assigned_date)}</span> },
    { header: "Returned", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.returned_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={r.status === "assigned" ? "info" : "success"}>{r.status === "assigned" ? "Assigned" : "Returned"}</StatusPill> },
    ...(canEdit
      ? [{ header: "", cell: (r: AssetAssignment) => (
          r.status === "assigned" ? (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => returnAsset(r.id, assetId), "Returned")}>Return</Button>
          ) : <span className="text-xs text-muted-foreground">—</span>
        ) } satisfies Column<AssetAssignment>]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Assignment history ({assignments.length})</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {canEdit && status === "active" && (
            <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px] flex-1"><Label htmlFor="ax-assignee">Assign to</Label><Input id="ax-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} required /></div>
              <div className="w-40"><Label htmlFor="ax-dept">Department</Label><Input id="ax-dept" value={department} onChange={(e) => setDepartment(e.target.value)} /></div>
              <div className="w-40"><Label htmlFor="ax-date">Date</Label><Input id="ax-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <Button type="submit" disabled={isPending}>Assign</Button>
            </form>
          )}
          <DataTable columns={columns} rows={assignments} getKey={(r) => r.id} empty="No assignments yet." />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {(status === "active") && (
            <>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => setAssetStatus(assetId, "retired"), "Retired")}>Retire</Button>
              <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => setAssetStatus(assetId, "disposed"), "Disposed")}>Dispose</Button>
            </>
          )}
          {(status === "retired") && (
            <>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => setAssetStatus(assetId, "active"), "Reactivated")}>Reactivate</Button>
              <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => setAssetStatus(assetId, "disposed"), "Disposed")}>Dispose</Button>
            </>
          )}
          {canDelete && status !== "assigned" && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deleteAsset(assetId);
                if (r.ok) router.push("/admin/assets");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
