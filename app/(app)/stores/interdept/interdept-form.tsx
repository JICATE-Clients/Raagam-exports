"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";

type PickerItem = { id: string; code?: string | null; name: string };
type LineRow = { item_id: string; quantity: string };

export function InterdeptForm({
  stores,
  items,
}: {
  stores: PickerItem[];
  items: PickerItem[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [fromDept, setFromDept] = useState("");
  const [toDept, setToDept] = useState("");
  const [fromStore, setFromStore] = useState("");
  const [toStore, setToStore] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([{ item_id: "", quantity: "" }]);

  const dirty = !!(fromDept || toDept);
  useUnsavedGuard(open && (dirty || isPending));

  function reset() {
    setFromDept("");
    setToDept("");
    setFromStore("");
    setToStore("");
    setDeliveryDate("");
    setNotes("");
    setLines([{ item_id: "", quantity: "" }]);
    setOpen(false);
  }

  function handleSubmit() {
    if (!fromDept || !toDept || !fromStore || !toStore) return;
    startTransition(async () => {
      const supabase = createClient();
      const { data: delivery, error } = await supabase
        .from("interdept_deliveries")
        .insert({
          from_department: fromDept.trim(),
          to_department: toDept.trim(),
          from_store_id: fromStore,
          to_store_id: toStore,
          delivery_date: deliveryDate || null,
          status: "draft",
          notes: notes.trim() || null,
        })
        .select("id")
        .single();

      if (error || !delivery) {
        toastError(error?.message ?? "Failed");
        return;
      }

      // insert lines
      const validLines = lines
        .filter((l) => l.item_id && parseFloat(l.quantity) > 0)
        .map((l, i) => ({
          delivery_id: delivery.id,
          item_id: l.item_id,
          quantity: parseFloat(l.quantity),
          sort_order: i,
        }));

      if (validLines.length > 0) {
        await supabase.from("interdept_delivery_lines").insert(validLines);
      }

      success("Inter-department delivery created.");
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ New Delivery</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New Inter-department Delivery" size="lg">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>From Department *</Label>
              <Input value={fromDept} onChange={(e) => setFromDept(e.target.value)} placeholder="e.g. Cutting" />
            </div>
            <div>
              <Label>To Department *</Label>
              <Input value={toDept} onChange={(e) => setToDept(e.target.value)} placeholder="e.g. Sewing" />
            </div>
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
              <Label>Delivery Date</Label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
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
                  <option value="">Item</option>
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
            <Button disabled={isPending || !fromDept || !toDept || !fromStore || !toStore} onClick={handleSubmit}>
              {isPending ? "Creating..." : "Create Delivery"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
