"use client";

import { useState, useTransition } from "react";
import { recordMovement } from "@/lib/stores/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type PickerItem = { id: string; code: string | null; name: string };

export function AdjustmentForm({
  stores,
  items,
}: {
  stores: PickerItem[];
  items: PickerItem[];
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState("");
  const [itemId, setItemId] = useState("");
  const [adjustType, setAdjustType] = useState<"adjust_in" | "adjust_out">("adjust_in");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const dirty = !!(storeId || itemId || quantity);
  useUnsavedGuard(open && (dirty || isPending));

  function reset() {
    setStoreId("");
    setItemId("");
    setAdjustType("adjust_in");
    setQuantity("");
    setNote("");
    setOpen(false);
  }

  function handleSubmit() {
    if (!storeId || !itemId || !quantity || !note.trim()) return;
    startTransition(async () => {
      const result = await recordMovement({
        store_id: storeId,
        item_id: itemId,
        movement_type: adjustType,
        quantity: parseFloat(quantity),
        note: note.trim(),
      });
      if (result.ok) {
        success("Adjustment recorded.");
        reset();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ New Adjustment</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New Stock Adjustment">
        <div className="space-y-4 p-4">
          <div>
            <Label>Store *</Label>
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value=""></option>
              {stores.map((s) => (
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
            <Label>Adjustment Type *</Label>
            <Select value={adjustType} onChange={(e) => setAdjustType(e.target.value as "adjust_in" | "adjust_out")}>
              <option value="adjust_in">Adjust IN (+)</option>
              <option value="adjust_out">Adjust OUT (-)</option>
            </Select>
          </div>
          <div>
            <Label>Quantity *</Label>
            <Input type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <Label>Reason * (mandatory)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for adjustment..." />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button disabled={isPending || !storeId || !itemId || !quantity || !note.trim()} onClick={handleSubmit}>
              {isPending ? "Recording..." : "Record Adjustment"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
