"use client";

import { useState, useTransition } from "react";
import { transferStock } from "@/lib/stores/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type PickerItem = { id: string; code: string | null; name: string };

export function TransferForm({
  stores,
  items,
}: {
  stores: PickerItem[];
  items: PickerItem[];
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [fromStore, setFromStore] = useState("");
  const [toStore, setToStore] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const dirty = !!(fromStore || toStore || itemId || quantity);
  useUnsavedGuard(open && (dirty || isPending));

  function reset() {
    setFromStore("");
    setToStore("");
    setItemId("");
    setQuantity("");
    setNote("");
    setOpen(false);
  }

  function handleSubmit() {
    if (!fromStore || !toStore || !itemId || !quantity) return;
    startTransition(async () => {
      const result = await transferStock({
        from_store_id: fromStore,
        to_store_id: toStore,
        item_id: itemId,
        quantity: parseFloat(quantity),
        note: note.trim() || null,
      });
      if (result.ok) {
        success("Transfer recorded.");
        reset();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ New Transfer</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New Material Transfer">
        <div className="space-y-4 p-4">
          <div>
            <Label>From Store *</Label>
            <Select value={fromStore} onChange={(e) => setFromStore(e.target.value)}>
              <option value=""></option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>To Store *</Label>
            <Select value={toStore} onChange={(e) => setToStore(e.target.value)}>
              <option value=""></option>
              {stores.filter((s) => s.id !== fromStore).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Item *</Label>
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value=""></option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name} ({i.code})</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Quantity *</Label>
            <Input type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for transfer..." />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button disabled={isPending || !fromStore || !toStore || !itemId || !quantity} onClick={handleSubmit}>
              {isPending ? "Transferring..." : "Transfer"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
