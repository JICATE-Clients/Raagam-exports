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
  addSqAllocation,
  deleteSqAllocation,
  allocateSqNote,
  cancelSqNote,
  deleteSqNote,
} from "@/lib/planning/extras-actions";
import type { SqStatus, SqAllocation } from "@/lib/planning/types";
import type { ItemOption, UomOption } from "@/lib/planning/extras-service";

interface Props {
  sqId: string;
  status: SqStatus;
  allocations: SqAllocation[];
  items: ItemOption[];
  uoms: UomOption[];
  canEdit: boolean;
  canDelete: boolean;
}

export function SqNoteDetail({ sqId, status, allocations, items, uoms, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const isDraft = status === "draft";

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
      const r = await addSqAllocation(sqId, {
        item_id: itemId || null,
        description,
        allocated_qty: parseFloat(qty) || 0,
        uom_id: uomId || null,
        sort_order: (allocations.length + 1) * 10,
      });
      if (r.ok) {
        success("Allocation added");
        setItemId(""); setDescription(""); setQty(""); setUomId("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<SqAllocation>[] = [
    { header: "Description", cell: (r) => <span className="text-sm">{r.description}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.allocated_qty)}</span> },
    ...(canEdit && isDraft
      ? [
          {
            header: "",
            cell: (r: SqAllocation) => (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending} onClick={() => run(() => deleteSqAllocation(r.id, sqId), "Removed")}>Remove</Button>
            ),
          } satisfies Column<SqAllocation>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Allocation lines ({allocations.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {canEdit && isDraft && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Label htmlFor="al-item">Item</Label>
                <Select id="al-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">— none —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ` : ""}{i.name}</option>)}
                </Select>
              </div>
              <div className="min-w-[200px] flex-1">
                <Label htmlFor="al-desc">Description</Label>
                <Input id="al-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
              </div>
              <div className="w-28">
                <Label htmlFor="al-qty">Qty</Label>
                <Input id="al-qty" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="w-28">
                <Label htmlFor="al-uom">UOM</Label>
                <Select id="al-uom" value={uomId} onChange={(e) => setUomId(e.target.value)}>
                  <option value="">—</option>
                  {uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </Select>
              </div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={allocations} getKey={(r) => r.id} empty="No allocation lines yet." />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {isDraft && (
            <>
              <Button disabled={isPending || allocations.length === 0}
                onClick={() => run(() => allocateSqNote(sqId), "Allocated")}>Allocate</Button>
              <Button variant="outline" disabled={isPending}
                onClick={() => run(() => cancelSqNote(sqId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {status === "allocated" && (
            <Button variant="outline" disabled={isPending}
              onClick={() => run(() => cancelSqNote(sqId), "Cancelled")}>Cancel</Button>
          )}
          {canDelete && (status === "draft" || status === "cancelled") && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deleteSqNote(sqId);
                if (r.ok) router.push("/planning/sq-notes");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
