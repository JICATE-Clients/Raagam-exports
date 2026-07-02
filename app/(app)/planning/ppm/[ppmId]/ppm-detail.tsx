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
  addPpmLine,
  updatePpmLineReceipt,
  deletePpmLine,
  issuePpm,
  receivePpm,
  cancelPpm,
  deletePpm,
} from "@/lib/planning/extras-actions";
import type { PpmStatus, PpmIssueLine } from "@/lib/planning/types";
import type { ItemOption, UomOption } from "@/lib/planning/extras-service";

interface Props {
  ppmId: string;
  status: PpmStatus;
  lines: PpmIssueLine[];
  items: ItemOption[];
  uoms: UomOption[];
  canEdit: boolean;
  canDelete: boolean;
}

export function PpmDetail({ ppmId, status, lines, items, uoms, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = status === "draft";
  const isIssued = status === "issued";

  const [itemId, setItemId] = useState("");
  const [description, setDescription] = useState("");
  const [issuedQty, setIssuedQty] = useState("");
  const [uomId, setUomId] = useState("");
  const [rate, setRate] = useState("");
  const [receipts, setReceipts] = useState<Record<string, string>>({});

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
      const r = await addPpmLine(ppmId, {
        item_id: itemId || null,
        description,
        issued_qty: parseFloat(issuedQty) || 0,
        uom_id: uomId || null,
        rate: parseFloat(rate) || 0,
      });
      if (r.ok) {
        success("Line added");
        setItemId(""); setDescription(""); setIssuedQty(""); setUomId(""); setRate("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<PpmIssueLine>[] = [
    { header: "Description", cell: (r) => <span className="text-sm">{r.description}</span> },
    { header: "Issued", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.issued_qty)}</span> },
    { header: "Rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.rate)}</span> },
    {
      header: "Received",
      align: "right",
      cell: (r) =>
        isIssued && canEdit ? (
          <div className="flex items-center justify-end gap-1">
            <Input
              type="number"
              min="0"
              step="0.001"
              defaultValue={String(r.received_qty)}
              className="h-7 w-24 text-xs"
              value={receipts[r.id] ?? String(r.received_qty)}
              onChange={(e) => setReceipts((m) => ({ ...m, [r.id]: e.target.value }))}
            />
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => updatePpmLineReceipt(r.id, ppmId, parseFloat(receipts[r.id] ?? String(r.received_qty)) || 0), "Receipt saved")}>
              Save
            </Button>
          </div>
        ) : (
          <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span>
        ),
    },
    ...(canEdit && isDraft
      ? [
          {
            header: "",
            cell: (r: PpmIssueLine) => (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending} onClick={() => run(() => deletePpmLine(r.id, ppmId), "Removed")}>Remove</Button>
            ),
          } satisfies Column<PpmIssueLine>,
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
          {canEdit && isDraft && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
              <div className="w-36">
                <Label htmlFor="pl-item">Item</Label>
                <Select id="pl-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">— none —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ` : ""}{i.name}</option>)}
                </Select>
              </div>
              <div className="min-w-[180px] flex-1">
                <Label htmlFor="pl-desc">Description</Label>
                <Input id="pl-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
              </div>
              <div className="w-24">
                <Label htmlFor="pl-qty">Issued</Label>
                <Input id="pl-qty" type="number" min="0" step="0.001" value={issuedQty} onChange={(e) => setIssuedQty(e.target.value)} />
              </div>
              <div className="w-24">
                <Label htmlFor="pl-uom">UOM</Label>
                <Select id="pl-uom" value={uomId} onChange={(e) => setUomId(e.target.value)}>
                  <option value="">—</option>
                  {uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </Select>
              </div>
              <div className="w-24">
                <Label htmlFor="pl-rate">Rate</Label>
                <Input id="pl-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={lines} getKey={(r) => r.id} empty="No lines yet." />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {isDraft && (
            <>
              <Button disabled={isPending || lines.length === 0} onClick={() => run(() => issuePpm(ppmId), "Issued")}>Issue</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => cancelPpm(ppmId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {isIssued && (
            <>
              <Button disabled={isPending} onClick={() => run(() => receivePpm(ppmId), "Marked received")}>Mark received</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => cancelPpm(ppmId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canDelete && (status === "draft" || status === "cancelled") && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deletePpm(ppmId);
                if (r.ok) router.push("/planning/ppm");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
