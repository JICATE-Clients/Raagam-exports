"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import {
  addVrtLine,
  deleteVrtLine,
  postVendorReturn,
  recordReplacement,
  cancelVendorReturn,
  deleteVendorReturn,
} from "@/lib/stores/extras-actions";
import type { VendorReturnStatus, VendorReturnLine } from "@/lib/stores/extras-types";
import type { ItemOption } from "@/lib/stores/extras-service";

interface Props {
  docId: string;
  status: VendorReturnStatus;
  /**
   * A REJECTION DC raised by a posted GRN (0780). Its lines ARE the GRN's rejections, so
   * they are not edited here, it is not deleted, and its replacement is RECEIVED on a
   * Replacement GRN (Purchase ▸ Goods Receipts) — never "Record replacement" here, which
   * would book the stock with no PO line, no tolerance and no debit-note settlement.
   */
  fromGrn?: boolean;
  /** A Replacement DC — the only kind where "Replacement qty" means anything. */
  replacement?: boolean;
  lines: VendorReturnLine[];
  items: ItemOption[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ReturnDcDetail({ docId, status, lines, items, canEdit, canDelete, fromGrn = false, replacement = false }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const editable = status === "draft" && !fromGrn;

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
    // A Rejection DC is never resent, so its column was a row of 0s (screenshot 3997).
    // A hand-raised draft keeps it: the add form above still types a replacement.
    ...(replacement || editable
      ? [{ header: "Replacement qty", align: "right" as const, cell: (r: VendorReturnLine) => <span className="tabular-nums text-sm">{fmtNumber(r.replacement_qty)}</span> }]
      : []),
    ...(canEdit && editable
      ? [
          rowActionsColumn<VendorReturnLine>((r) => (
            <RowActions
              onDelete={() => run(() => deleteVrtLine(r.id, docId), "Removed")}
              deleteLabel="Remove"
              isPending={isPending}
            />
          )),
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* NO "Lines" CARD (user 2026-11-03): the table sits on the page at full width — the card
          only added a second frame and a width that made the table scroll sideways. */}
      <div className="space-y-4">
          {canEdit && editable && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
              <div className="w-52">
                <Label htmlFor="vl-item">Item</Label>
                <Select id="vl-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value=""></option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
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
          <DataTable paginate={false} columns={columns} rows={lines} getKey={(r) => r.id} empty="No lines yet." />
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {status === "draft" && (
            <>
              {/* DISPATCH (user 2026-11-02, two-screen return plan): was "Post return". The goods
                  leave the Rejection store; the return slip prints from then on. */}
              <Button disabled={isPending || lines.length === 0} onClick={() => run(() => postVendorReturn(docId), "Dispatched — print the return slip")}>Dispatch</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => cancelVendorReturn(docId), "Cancelled")}>Cancel</Button>
            </>
          )}
          {status === "returned" && (
            <>
              {fromGrn ? null : (
                <Button disabled={isPending} onClick={() => run(() => recordReplacement(docId), "Replacement received")}>Record replacement</Button>
              )}
              {/* NO CLOSE BUTTON (user 2026-10-31, screenshot 3951). Posting already
                  finished the return; one the vendor still owes moves on by itself
                  when the replacement is received, and `replaced` is final. */}
            </>
          )}
          {canDelete && !fromGrn && (status === "draft" || status === "cancelled") && (
            <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(async () => {
                const r = await deleteVendorReturn(docId);
                if (r.ok) router.push("/purchase/dc?type=rejection");
                return r;
              }, "Deleted")}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}
