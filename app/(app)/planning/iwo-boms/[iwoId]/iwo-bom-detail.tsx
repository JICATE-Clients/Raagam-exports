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
  addIwoBomItem,
  deleteIwoBomItem,
  finalizeIwoBom,
} from "@/lib/planning/extras-actions";
import type { BomStatus, IwoBomItem } from "@/lib/planning/types";
import type { ItemOption, UomOption } from "@/lib/planning/extras-service";

interface Props {
  iwoId: string;
  bomStatus: BomStatus | null;
  items: IwoBomItem[];
  itemOptions: ItemOption[];
  uoms: UomOption[];
  canEdit: boolean;
}

export function IwoBomDetail({ iwoId, bomStatus, items, itemOptions, uoms, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const editable = canEdit && bomStatus !== "final";

  const [itemId, setItemId] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [uomId, setUomId] = useState("");
  const [unitCost, setUnitCost] = useState("");

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
      const r = await addIwoBomItem(iwoId, {
        item_id: itemId || null,
        description,
        quantity: parseFloat(qty) || 0,
        uom_id: uomId || null,
        unit_cost: parseFloat(unitCost) || 0,
      });
      if (r.ok) {
        success("Item added");
        setItemId(""); setDescription(""); setQty(""); setUomId(""); setUnitCost("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<IwoBomItem>[] = [
    { header: "Description", cell: (r) => <span className="text-sm">{r.description}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quantity)}</span> },
    { header: "Unit cost", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.unit_cost)}</span> },
    { header: "Amount", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quantity * r.unit_cost)}</span> },
    ...(editable
      ? [
          {
            header: "",
            cell: (r: IwoBomItem) => (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending} onClick={() => run(() => deleteIwoBomItem(r.id, iwoId), "Removed")}>Remove</Button>
            ),
          } satisfies Column<IwoBomItem>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>BOM items ({items.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {editable && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Label htmlFor="ib-item">Item</Label>
                <Select id="ib-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">— none —</option>
                  {itemOptions.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ` : ""}{i.name}</option>)}
                </Select>
              </div>
              <div className="min-w-[180px] flex-1">
                <Label htmlFor="ib-desc">Description</Label>
                <Input id="ib-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
              </div>
              <div className="w-24">
                <Label htmlFor="ib-qty">Qty</Label>
                <Input id="ib-qty" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="w-24">
                <Label htmlFor="ib-uom">UOM</Label>
                <Select id="ib-uom" value={uomId} onChange={(e) => setUomId(e.target.value)}>
                  <option value="">—</option>
                  {uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </Select>
              </div>
              <div className="w-28">
                <Label htmlFor="ib-cost">Unit cost</Label>
                <Input id="ib-cost" type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              </div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={items} getKey={(r) => r.id} empty="No BOM items yet." />
        </CardBody>
      </Card>

      {editable && items.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" disabled={isPending}
            onClick={() => run(() => finalizeIwoBom(iwoId), "BOM finalized")}>Finalize BOM</Button>
        </div>
      )}
    </div>
  );
}
