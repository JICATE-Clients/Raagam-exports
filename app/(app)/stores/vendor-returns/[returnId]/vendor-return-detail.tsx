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
  addVrtLine,
  deleteVrtLine,
  postVendorReturn,
  recordReplacement,
  closeVendorReturn,
  cancelVendorReturn,
  deleteVendorReturn,
} from "@/lib/stores/extras-actions";
import type { VendorReturnStatus, VendorReturnLine } from "@/lib/stores/extras-types";
import type { ItemOption } from "@/lib/stores/extras-service";

interface Props {
  docId: string;
  status: VendorReturnStatus;
  lines: VendorReturnLine[];
  items: ItemOption[];
  canEdit: boolean;
  canDelete: boolean;
}

export function VendorReturnDetail({ docId, status, lines, items, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const editable = status === "draft";

  const [itemId, setItemId] = useState("");
  const [returnQty, setReturnQty] = useState("");
  const [replacementQty, setReplacementQty] = useState("");

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
      const r = await addVrtLine(docId, {
        item_id: itemId,
        return_qty: parseFloat(returnQty) || 0,
        replacement_qty: parseFloat(replacementQty) || 0,
        sort_order: (lines.length + 1) * 10,
      });
      if (r.ok) {
        success("Line added");
        setItemId(""); setReturnQty(""); setReplacementQty("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<VendorReturnLine>[] = [
    { header: "Item", cell: (r) => <span className="text-sm">{items.find((i) => i.id === r.item_id)?.name ?? r.item_id.slice(0, 8)}</span> },
    { header: "Return qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.return_qty)}</span> },
    { header: "Replacement qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.replacement_qty)}</span> },
    ...(canEdit && editable
      ? [
          {
            header: "",
            cell: (r: VendorReturnLine) => (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending} onClick={() => run(() => deleteVrtLine(r.id, docId), "Removed")}>Remove</Button>
            ),
          } satisfies Column<VendorReturnLine>,
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
              <div className="w-52">
                <Label htmlFor="vl-item">Item</Label>
                <Select id="vl-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">— select item —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ` : ""}{i.name}</option>)}
                </Select>
              </div>
              <div className="w-28">
                <Label htmlFor="vl-ret">Return</Label>
                <Input id="vl-ret" type="number" min="0" step="0.001" value={returnQty} onChange={(e) => setReturnQty(e.target.value)} />
              </div>
              <div className="w-32">
                <Label htmlFor="vl-rep">Replacement</Label>
                <Input id="vl-rep" type="number" min="0" step="0.001" value={replacementQty} onChange={(e) => setReplacementQty(e.target.value)} />
              </div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={lines} getKey={(r) => r.id} empty="No lines yet." />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {status === "draft" && (
            <>
              <Button disabled={isPending || lines.length === 0} onClick={() => run(() => postVendorReturn(docId), "Return posted (issued from store)")}>Post return</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => cancelVendorReturn(docId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {status === "returned" && (
            <>
              <Button disabled={isPending} onClick={() => run(() => recordReplacement(docId), "Replacement received")}>Record replacement</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => closeVendorReturn(docId), "Closed")}>Close</Button>
            </>
          )}
          {status === "replaced" && (
            <Button variant="outline" disabled={isPending} onClick={() => run(() => closeVendorReturn(docId), "Closed")}>Close</Button>
          )}
          {canDelete && (status === "draft" || status === "cancelled") && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deleteVendorReturn(docId);
                if (r.ok) router.push("/stores/vendor-returns");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
