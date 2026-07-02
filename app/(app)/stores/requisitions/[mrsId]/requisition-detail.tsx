"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import {
  addMrsLine,
  deleteMrsLine,
  submitMrs,
  approveMrs,
  rejectMrs,
  issueMrs,
  cancelMrs,
  deleteMrs,
} from "@/lib/stores/extras-actions";
import type { MrsStatus, MaterialRequisitionLine } from "@/lib/stores/extras-types";
import type { ItemOption } from "@/lib/stores/extras-service";

interface Props {
  docId: string;
  status: MrsStatus;
  lines: MaterialRequisitionLine[];
  items: ItemOption[];
  canEdit: boolean;
  canApprove: boolean;
  canDelete: boolean;
}

export function RequisitionDetail({ docId, status, lines, items, canEdit, canApprove, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const editable = status === "draft";

  const [itemId, setItemId] = useState("");
  const [reqQty, setReqQty] = useState("");

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
    if (!itemId) {
      toastError("Select an item");
      return;
    }
    startTransition(async () => {
      const r = await addMrsLine(docId, {
        item_id: itemId,
        requested_qty: parseFloat(reqQty) || 0,
        sort_order: (lines.length + 1) * 10,
      });
      if (r.ok) {
        success("Line added");
        setItemId(""); setReqQty("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<MaterialRequisitionLine>[] = [
    { header: "Item", cell: (r) => <span className="text-sm">{items.find((i) => i.id === r.item_id)?.name ?? r.item_id.slice(0, 8)}</span> },
    { header: "Requested", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.requested_qty)}</span> },
    { header: "Issued", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.issued_qty)}</span> },
    ...(canEdit && editable
      ? [
          {
            header: "",
            cell: (r: MaterialRequisitionLine) => (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending} onClick={() => run(() => deleteMrsLine(r.id, docId), "Removed")}>Remove</Button>
            ),
          } satisfies Column<MaterialRequisitionLine>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Lines ({lines.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {canEdit && editable && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <Label htmlFor="ml-item">Item</Label>
                <Select id="ml-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">— select item —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ` : ""}{i.name}</option>)}
                </Select>
              </div>
              <div className="w-32">
                <Label htmlFor="ml-qty">Requested</Label>
                <Input id="ml-qty" type="number" min="0" step="0.001" value={reqQty} onChange={(e) => setReqQty(e.target.value)} />
              </div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={lines} getKey={(r) => r.id} empty="No lines yet." />
        </CardBody>
      </Card>

      {(canEdit || canApprove) && (
        <div className="flex flex-wrap gap-3">
          {canEdit && status === "draft" && (
            <>
              <Button disabled={isPending || lines.length === 0} onClick={() => run(() => submitMrs(docId), "Submitted")}>Submit</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => cancelMrs(docId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canApprove && status === "submitted" && (
            <>
              <Button disabled={isPending} onClick={() => run(() => approveMrs(docId), "Approved")}>Approve</Button>
              <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => rejectMrs(docId), "Rejected")}>Reject</Button>
            </>
          )}
          {canEdit && status === "approved" && (
            <Button disabled={isPending} onClick={() => run(() => issueMrs(docId), "Issued — posted to ledger")}>Issue</Button>
          )}
          {canDelete && (status === "draft" || status === "cancelled" || status === "rejected") && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deleteMrs(docId);
                if (r.ok) router.push("/stores/requisitions");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
