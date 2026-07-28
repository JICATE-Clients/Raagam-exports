"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProcessOrder } from "@/lib/stores/process-actions";
import { PROCESS_TYPES } from "@/lib/stores/process-types";
import type { ProcessType } from "@/lib/stores/process-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtMoney } from "@/lib/format";

type PickerItem = { id: string; code?: string | null; name: string };

type LineRow = {
  description: string;
  sent_qty: string;
  rate: string;
  item_id: string;
  uom_id: string;
};

function emptyLine(): LineRow {
  return { description: "", sent_qty: "0", rate: "0", item_id: "", uom_id: "" };
}

export function NewProcessOrderForm({
  vendors,
  items,
  uoms,
  locations,
}: {
  vendors: PickerItem[];
  items: PickerItem[];
  uoms: PickerItem[];
  locations: PickerItem[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [vendorId, setVendorId] = useState("");
  const [processType, setProcessType] = useState<ProcessType>("dyeing");
  const [locationId, setLocationId] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);

  const dirty = !!(vendorId || lines.some((l) => l.description.trim()));
  useUnsavedGuard(open && (dirty || isPending));

  function reset() {
    setVendorId("");
    setProcessType("dyeing");
    setLocationId("");
    setOrderDate("");
    setExpectedDate("");
    setNotes("");
    setLines([emptyLine()]);
    setOpen(false);
  }

  function updateLine(idx: number, key: keyof LineRow, val: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: val } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    if (!vendorId) return;
    const validLines = lines
      .filter((l) => l.description.trim())
      .map((l, i) => ({
        description: l.description.trim(),
        sent_qty: parseFloat(l.sent_qty) || 0,
        rate: parseFloat(l.rate) || 0,
        item_id: l.item_id || null,
        uom_id: l.uom_id || null,
        sort_order: i,
      }));

    startTransition(async () => {
      const result = await createProcessOrder({
        vendor_id: vendorId,
        process_type: processType,
        location_id: locationId || null,
        order_date: orderDate || null,
        expected_date: expectedDate || null,
        notes: notes.trim() || null,
        lines: validLines,
      });
      if (result.ok) {
        success("Process order created.");
        reset();
        router.push(`/stores/process-orders/${result.orderId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ New Process Order</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New Process Order" size="lg">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Processor (Vendor) *</Label>
              <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">-- Select --</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Process Type *</Label>
              <Select value={processType} onChange={(e) => setProcessType(e.target.value as ProcessType)}>
                {PROCESS_TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Location</Label>
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">-- Select --</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Order Date</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div>
              <Label>Expected Date</Label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {/* Line items */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Line Items</Label>
              <Button size="sm" variant="outline" onClick={addLine}>+ Add Line</Button>
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 rounded border border-border p-2">
                  <div className="col-span-4">
                    <Input placeholder="Description *" value={line.description} onChange={(e) => updateLine(idx, "description", e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Select value={line.item_id} onChange={(e) => updateLine(idx, "item_id", e.target.value)}>
                      <option value="">Item</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Input type="number" min="0" step="0.001" placeholder="Qty" value={line.sent_qty} onChange={(e) => updateLine(idx, "sent_qty", e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Input type="number" min="0" step="0.01" placeholder="Rate" value={line.rate} onChange={(e) => updateLine(idx, "rate", e.target.value)} />
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
                    <span className="tabular-nums text-xs">{fmtMoney((parseFloat(line.sent_qty) || 0) * (parseFloat(line.rate) || 0))}</span>
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
                    {lines.length > 1 && (
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => removeLine(idx)}>X</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button disabled={isPending || !vendorId} onClick={handleSubmit}>
              {isPending ? "Creating..." : "Create Process Order"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
