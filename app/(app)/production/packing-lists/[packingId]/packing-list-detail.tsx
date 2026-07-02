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
  addPackingLine,
  deletePackingLine,
  finalizePackingList,
  cancelPackingList,
  deletePackingList,
} from "@/lib/production/extras-actions";
import type { PackingStatus, PackingListLine } from "@/lib/production/extras-types";

interface Props {
  docId: string;
  status: PackingStatus;
  lines: PackingListLine[];
  canEdit: boolean;
  canDelete: boolean;
}

export function PackingListDetail({ docId, status, lines, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const editable = status === "draft";

  const [cartonNo, setCartonNo] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [qty, setQty] = useState("");
  const [netW, setNetW] = useState("");
  const [grossW, setGrossW] = useState("");

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
      const r = await addPackingLine(docId, {
        carton_no: cartonNo || null,
        color: color || null,
        size: size || null,
        quantity: parseFloat(qty) || 0,
        net_weight: netW ? parseFloat(netW) : null,
        gross_weight: grossW ? parseFloat(grossW) : null,
        sort_order: (lines.length + 1) * 10,
      });
      if (r.ok) {
        success("Line added");
        setCartonNo(""); setColor(""); setSize(""); setQty(""); setNetW(""); setGrossW("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);

  const columns: Column<PackingListLine>[] = [
    { header: "Carton", cell: (r) => <span className="text-sm">{r.carton_no ?? "—"}</span> },
    { header: "Colour", cell: (r) => <span className="text-sm">{r.color ?? "—"}</span> },
    { header: "Size", cell: (r) => <span className="text-sm">{r.size ?? "—"}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quantity)}</span> },
    { header: "Net wt", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.net_weight != null ? fmtNumber(r.net_weight) : "—"}</span> },
    { header: "Gross wt", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.gross_weight != null ? fmtNumber(r.gross_weight) : "—"}</span> },
    ...(canEdit && editable
      ? [{ header: "", cell: (r: PackingListLine) => (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
            onClick={() => run(() => deletePackingLine(r.id, docId), "Removed")}>Remove</Button>
        ) } satisfies Column<PackingListLine>]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Cartons ({lines.length})</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {canEdit && editable && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
              <div className="w-28"><Label htmlFor="pl-carton">Carton #</Label><Input id="pl-carton" value={cartonNo} onChange={(e) => setCartonNo(e.target.value)} /></div>
              <div className="w-28"><Label htmlFor="pl-color">Colour</Label><Input id="pl-color" value={color} onChange={(e) => setColor(e.target.value)} /></div>
              <div className="w-20"><Label htmlFor="pl-size">Size</Label><Input id="pl-size" value={size} onChange={(e) => setSize(e.target.value)} /></div>
              <div className="w-24"><Label htmlFor="pl-qty">Qty</Label><Input id="pl-qty" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <div className="w-24"><Label htmlFor="pl-nw">Net wt</Label><Input id="pl-nw" type="number" min="0" step="0.01" value={netW} onChange={(e) => setNetW(e.target.value)} /></div>
              <div className="w-24"><Label htmlFor="pl-gw">Gross wt</Label><Input id="pl-gw" type="number" min="0" step="0.01" value={grossW} onChange={(e) => setGrossW(e.target.value)} /></div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={lines} getKey={(r) => r.id} empty="No cartons yet." />
          {lines.length > 0 && (
            <div className="flex justify-end pr-3 text-sm font-semibold tabular-nums">Total qty: {fmtNumber(totalQty)}</div>
          )}
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {editable && (
            <>
              <Button disabled={isPending || lines.length === 0} onClick={() => run(() => finalizePackingList(docId), "Finalized")}>Finalize</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => cancelPackingList(docId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canDelete && (status === "draft" || status === "cancelled") && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deletePackingList(docId);
                if (r.ok) router.push("/production/packing-lists");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
