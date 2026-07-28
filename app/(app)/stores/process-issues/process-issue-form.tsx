"use client";

import { useState, useTransition } from "react";
import { createProcessIssue, postProcessIssue } from "@/lib/stores/process-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type PickerItem = { id: string; code?: string | null; name: string };
type LineRow = { item_id: string; quantity: string };

export function ProcessIssueForm({
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
  const [issueDate, setIssueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([{ item_id: "", quantity: "" }]);

  const dirty = !!(procOrderId || storeId);
  useUnsavedGuard(open && (dirty || isPending));

  function reset() {
    setProcOrderId("");
    setStoreId("");
    setIssueDate("");
    setNotes("");
    setLines([{ item_id: "", quantity: "" }]);
    setOpen(false);
  }

  function handleSubmit() {
    if (!procOrderId || !storeId) return;
    const validLines = lines
      .filter((l) => l.item_id && parseFloat(l.quantity) > 0)
      .map((l, i) => ({
        item_id: l.item_id,
        quantity: parseFloat(l.quantity),
        sort_order: i,
      }));

    startTransition(async () => {
      const result = await createProcessIssue({
        process_order_id: procOrderId,
        store_id: storeId,
        issue_date: issueDate || null,
        notes: notes.trim() || null,
        lines: validLines,
      });
      if (result.ok) {
        // auto-post immediately
        const postResult = await postProcessIssue(result.issueId);
        if (postResult.ok) {
          success("Material issued and posted.");
        } else {
          success("Issue created (draft). Post failed: " + postResult.error);
        }
        reset();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Issue Material</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Issue Material for Processing">
        <div className="space-y-4 p-4">
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
            <Label>From Store *</Label>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">-- Select --</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Issue Date</Label>
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Items</Label>
              <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, { item_id: "", quantity: "" }])}>+ Add</Button>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="mb-2 flex gap-2">
                <Select className="flex-1" value={line.item_id} onChange={(e) => setLines((p) => p.map((l, i) => i === idx ? { ...l, item_id: e.target.value } : l))}>
                  <option value="">-- Item --</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </Select>
                <Input className="w-28" type="number" min="0" step="0.001" placeholder="Qty" value={line.quantity} onChange={(e) => setLines((p) => p.map((l, i) => i === idx ? { ...l, quantity: e.target.value } : l))} />
                {lines.length > 1 && (
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>X</Button>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button disabled={isPending || !procOrderId || !storeId} onClick={handleSubmit}>
              {isPending ? "Issuing..." : "Issue & Post"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
