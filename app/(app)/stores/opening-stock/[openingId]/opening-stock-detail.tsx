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
  addOpeningLine,
  deleteOpeningLine,
  postOpeningStock,
  cancelOpeningStock,
  deleteOpeningStock,
} from "@/lib/stores/extras-actions";
import type { OpeningStockStatus, OpeningStockLine } from "@/lib/stores/extras-types";
import type { ItemOption } from "@/lib/stores/extras-service";

interface Props {
  docId: string;
  status: OpeningStockStatus;
  lines: OpeningStockLine[];
  items: ItemOption[];
  canEdit: boolean;
  canDelete: boolean;
}

export function OpeningStockDetail({ docId, status, lines, items, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const editable = status === "draft";

  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");

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
      const r = await addOpeningLine(docId, {
        item_id: itemId,
        quantity: parseFloat(qty) || 0,
        note: note || null,
        sort_order: (lines.length + 1) * 10,
      });
      if (r.ok) {
        success("Line added");
        setItemId(""); setQty(""); setNote("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<OpeningStockLine>[] = [
    { header: "Item", cell: (r) => <span className="text-sm">{items.find((i) => i.id === r.item_id)?.name ?? r.item_id.slice(0, 8)}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quantity)}</span> },
    { header: "Note", cell: (r) => <span className="text-sm text-muted-foreground">{r.note ?? "—"}</span> },
    ...(canEdit && editable
      ? [
          {
            header: "",
            cell: (r: OpeningStockLine) => (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending} onClick={() => run(() => deleteOpeningLine(r.id, docId), "Removed")}>Remove</Button>
            ),
          } satisfies Column<OpeningStockLine>,
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
                <Label htmlFor="ol-item">Item</Label>
                <Select id="ol-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">— select item —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ` : ""}{i.name}</option>)}
                </Select>
              </div>
              <div className="w-28">
                <Label htmlFor="ol-qty">Qty</Label>
                <Input id="ol-qty" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="min-w-[160px] flex-1">
                <Label htmlFor="ol-note">Note</Label>
                <Input id="ol-note" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={lines} getKey={(r) => r.id} empty="No lines yet." />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {editable && (
            <>
              <Button disabled={isPending || lines.length === 0}
                onClick={() => run(() => postOpeningStock(docId), "Posted to ledger")}>Post</Button>
              <Button variant="outline" disabled={isPending}
                onClick={() => run(() => cancelOpeningStock(docId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canDelete && (status === "draft" || status === "cancelled") && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deleteOpeningStock(docId);
                if (r.ok) router.push("/stores/opening-stock");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
