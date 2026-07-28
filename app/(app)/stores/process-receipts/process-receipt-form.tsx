"use client";

import { useState, useTransition } from "react";
import { createProcessReceipt, postProcessReceipt } from "@/lib/stores/process-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type PickerItem = { id: string; code?: string | null; name: string };
type LineRow = { item_id: string; received_qty: string; accepted_qty: string; rejected_qty: string; rejection_reason: string };

export function ProcessReceiptForm({
  processOrders,
  stores,
  items,
}: {
  processOrders: { id: string; code: string | null }[];
  stores: PickerItem[];
  items: PickerItem[];
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [procOrderId, setProcOrderId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([{ item_id: "", received_qty: "", accepted_qty: "", rejected_qty: "0", rejection_reason: "" }]);

  const dirty = !!(procOrderId || storeId);
  useUnsavedGuard(open && (dirty || isPending));

  function reset() {
    setProcOrderId("");
    setStoreId("");
    setReceiptDate("");
    setNotes("");
    setLines([{ item_id: "", received_qty: "", accepted_qty: "", rejected_qty: "0", rejection_reason: "" }]);
    setOpen(false);
  }

  function updateLine(idx: number, key: keyof LineRow, val: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: val } : l)));
  }

  function handleSubmit() {
    if (!procOrderId || !storeId) return;
    const validLines = lines
      .filter((l) => l.item_id && (parseFloat(l.received_qty) > 0 || parseFloat(l.accepted_qty) > 0))
      .map((l, i) => ({
        item_id: l.item_id,
        received_qty: parseFloat(l.received_qty) || 0,
        accepted_qty: parseFloat(l.accepted_qty) || 0,
        rejected_qty: parseFloat(l.rejected_qty) || 0,
        qc_status: parseFloat(l.rejected_qty) > 0 ? "partial" as const : "passed" as const,
        rejection_reason: l.rejection_reason.trim() || null,
        sort_order: i,
      }));

    startTransition(async () => {
      const result = await createProcessReceipt({
        process_order_id: procOrderId,
        store_id: storeId,
        receipt_date: receiptDate || null,
        notes: notes.trim() || null,
        lines: validLines,
      });
      if (result.ok) {
        const postResult = await postProcessReceipt(result.receiptId);
        if (postResult.ok) {
          success("Receipt posted. Stock updated.");
        } else {
          success("Receipt created (draft). Post failed: " + postResult.error);
        }
        reset();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Receive Material</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Receive from Processing" size="lg">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Process Order *</Label>
              <Select value={procOrderId} onChange={(e) => setProcOrderId(e.target.value)}>
                <option value="">-- Select --</option>
                {processOrders.map((po) => (
                  <option key={po.id} value={po.id}>{po.code ?? po.id.slice(0, 8)}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Into Store *</Label>
              <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">-- Select --</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Receipt Date</Label>
              <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Receipt Lines</Label>
              <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, { item_id: "", received_qty: "", accepted_qty: "", rejected_qty: "0", rejection_reason: "" }])}>+ Add</Button>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="mb-2 space-y-1 rounded border border-border p-2">
                <div className="flex gap-2">
                  <Select className="flex-1" value={line.item_id} onChange={(e) => updateLine(idx, "item_id", e.target.value)}>
                    <option value="">-- Item --</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </Select>
                  <Input className="w-24" type="number" min="0" step="0.001" placeholder="Rcvd" value={line.received_qty} onChange={(e) => updateLine(idx, "received_qty", e.target.value)} />
                  <Input className="w-24" type="number" min="0" step="0.001" placeholder="Accept" value={line.accepted_qty} onChange={(e) => updateLine(idx, "accepted_qty", e.target.value)} />
                  <Input className="w-24" type="number" min="0" step="0.001" placeholder="Reject" value={line.rejected_qty} onChange={(e) => updateLine(idx, "rejected_qty", e.target.value)} />
                  {lines.length > 1 && (
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>X</Button>
                  )}
                </div>
                {parseFloat(line.rejected_qty) > 0 && (
                  <Input placeholder="Rejection reason (required)" value={line.rejection_reason} onChange={(e) => updateLine(idx, "rejection_reason", e.target.value)} />
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button disabled={isPending || !procOrderId || !storeId} onClick={handleSubmit}>
              {isPending ? "Posting..." : "Receive & Post"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
