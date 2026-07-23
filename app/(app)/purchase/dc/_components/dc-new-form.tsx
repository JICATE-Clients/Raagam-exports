"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDc } from "@/lib/purchase/grn-actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { Vendor } from "@/lib/purchase/types";
import type { Item, Uom } from "@/lib/masters/types";

interface DcDraftLine {
  tempId: string;
  itemId: string;
  description: string;
  sentQty: string;
  uomId: string;
}

function makeTempId(): string {
  return `tmp-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyLine(): DcDraftLine {
  return {
    tempId: makeTempId(),
    itemId: "",
    description: "",
    sentQty: "0",
    uomId: "",
  };
}

interface Props {
  vendors: Pick<Vendor, "id" | "code" | "name">[];
  locations: { id: string; code: string; name: string }[];
  items: Pick<Item, "id" | "code" | "name">[];
  uoms: Pick<Uom, "id" | "code" | "name">[];
}

export function DcNewForm({ vendors, locations, items, uoms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [vendorId, setVendorId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [dcDate, setDcDate] = useState(new Date().toISOString().split("T")[0]);
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DcDraftLine[]>([emptyLine()]);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(tempId: string) {
    setLines((prev) => prev.filter((l) => l.tempId !== tempId));
  }

  function updateLine(
    tempId: string,
    patch: Partial<Omit<DcDraftLine, "tempId">>,
  ) {
    setLines((prev) =>
      prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)),
    );
  }

  function handleItemChange(tempId: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(tempId, {
      itemId,
      description: item?.name ?? "",
    });
  }

  function handleSave() {
    if (!dcDate) {
      toastError("Please enter a DC date");
      return;
    }
    if (!purpose.trim()) {
      toastError("Please enter a purpose for this DC");
      return;
    }
    const validLines = lines.filter((l) => l.description.trim());
    if (validLines.length === 0) {
      toastError("Add at least one line with a description");
      return;
    }

    startTransition(async () => {
      const result = await createDc({
        vendor_id: vendorId || null,
        location_id: locationId || null,
        dc_date: dcDate,
        purpose: purpose || null,
        notes: notes || null,
        lines: validLines.map((l, i) => ({
          item_id: l.itemId || null,
          description: l.description,
          sent_qty: parseFloat(l.sentQty) || 0,
          uom_id: l.uomId || null,
          sort_order: i,
        })),
      });

      if (result.ok) {
        success("Delivery Challan created");
        router.push(`/purchase/dc/${result.dcId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Header fields */}
      <Card>
        <CardHeader>
          <CardTitle>DC Details</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="vendor">Vendor / Processor</Label>
              <Select
                id="vendor"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              >
                <option value="">Select vendor</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="location">Location</Label>
              <Select
                id="location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Select location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="dc-date">DC Date *</Label>
              <Input
                id="dc-date"
                type="date"
                value={dcDate}
                onChange={(e) => setDcDate(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <Label htmlFor="purpose">Purpose *</Label>
              <Input
                id="purpose"
                placeholder="e.g. Button Coloring, Embroidery"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={1}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
          <Button size="sm" variant="outline" onClick={addLine}>
            Add Line
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                    Item
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                    Description *
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                    Sent Qty
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                    UOM
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.tempId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2">
                      <Select
                        value={l.itemId}
                        onChange={(e) =>
                          handleItemChange(l.tempId, e.target.value)
                        }
                        className="w-40"
                      >
                        <option value="">Select item</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        placeholder="Description"
                        value={l.description}
                        onChange={(e) =>
                          updateLine(l.tempId, { description: e.target.value })
                        }
                        className="w-48"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        value={l.sentQty}
                        onChange={(e) =>
                          updateLine(l.tempId, { sentQty: e.target.value })
                        }
                        className="w-24 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={l.uomId}
                        onChange={(e) =>
                          updateLine(l.tempId, { uomId: e.target.value })
                        }
                        className="w-28"
                      >
                        <option value="">UOM</option>
                        {uoms.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeLine(l.tempId)}
                        disabled={lines.length === 1}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Creating…" : "Create DC"}
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push("/purchase/dc")}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
