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
  addIndentLine,
  deleteIndentLine,
  acknowledgeIndent,
  convertIndent,
  cancelIndent,
  deleteIndent,
} from "@/lib/purchase/extras-actions";
import type { IndentStatus, PurchaseIndentLine } from "@/lib/purchase/extras-types";
import type { Item, Uom } from "@/lib/masters/types";

interface Props {
  indentId: string;
  status: IndentStatus;
  lines: PurchaseIndentLine[];
  items: Item[];
  uoms: Uom[];
  canEdit: boolean;
  canDelete: boolean;
}

export function IndentDetail({ indentId, status, lines, items, uoms, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const editable = status === "open";

  const [itemId, setItemId] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [uomId, setUomId] = useState("");

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
      const r = await addIndentLine(indentId, {
        item_id: itemId || null,
        description,
        quantity: parseFloat(qty) || 0,
        uom_id: uomId || null,
        sort_order: (lines.length + 1) * 10,
      });
      if (r.ok) {
        success("Line added");
        setItemId(""); setDescription(""); setQty(""); setUomId("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<PurchaseIndentLine>[] = [
    { header: "Description", cell: (r) => <span className="text-sm">{r.description}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quantity)}</span> },
    ...(canEdit && editable
      ? [
          {
            header: "",
            cell: (r: PurchaseIndentLine) => (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending} onClick={() => run(() => deleteIndentLine(r.id, indentId), "Removed")}>Remove</Button>
            ),
          } satisfies Column<PurchaseIndentLine>,
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
              <div className="w-40">
                <Label htmlFor="il-item">Item</Label>
                <Select id="il-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">— none —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </Select>
              </div>
              <div className="min-w-[200px] flex-1">
                <Label htmlFor="il-desc">Description</Label>
                <Input id="il-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
              </div>
              <div className="w-28">
                <Label htmlFor="il-qty">Qty</Label>
                <Input id="il-qty" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="w-28">
                <Label htmlFor="il-uom">UOM</Label>
                <Select id="il-uom" value={uomId} onChange={(e) => setUomId(e.target.value)}>
                  <option value="">—</option>
                  {uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </Select>
              </div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={lines} getKey={(r) => r.id} empty="No lines yet." />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {status === "open" && (
            <>
              <Button disabled={isPending || lines.length === 0}
                onClick={() => run(() => acknowledgeIndent(indentId), "Acknowledged")}>Acknowledge</Button>
              <Button variant="outline" disabled={isPending}
                onClick={() => run(() => cancelIndent(indentId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {status === "acknowledged" && (
            <>
              <Button disabled={isPending}
                onClick={() => run(() => convertIndent(indentId), "Marked converted")}>Mark converted</Button>
              <Button variant="outline" disabled={isPending}
                onClick={() => run(() => cancelIndent(indentId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canDelete && (status === "open" || status === "cancelled") && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deleteIndent(indentId);
                if (r.ok) router.push("/purchase/indents");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
