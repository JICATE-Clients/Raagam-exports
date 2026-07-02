"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createColorCard } from "@/lib/orders/color-cards/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { Buyer } from "@/lib/masters/types";

type ColorRow = { name: string; code: string; hex: string };

interface Props {
  buyers: Pick<Buyer, "id" | "name" | "code" | "currency_code">[];
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function NewColorCardForm({ buyers }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [buyerId, setBuyerId] = useState("");
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [notes, setNotes] = useState("");
  const [colors, setColors] = useState<ColorRow[]>([{ name: "", code: "", hex: "" }]);

  function resetForm() {
    setBuyerId("");
    setName("");
    setSeason("");
    setNotes("");
    setColors([{ name: "", code: "", hex: "" }]);
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  function addColor() {
    setColors((cs) => [...cs, { name: "", code: "", hex: "" }]);
  }

  function removeColor(i: number) {
    setColors((cs) => cs.filter((_, idx) => idx !== i));
  }

  function updateColor(i: number, field: keyof ColorRow, val: string) {
    setColors((cs) => cs.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // client-side hex guard (matches the zod rule) for a friendlier message
    const badHex = colors.find((c) => c.hex.trim() && !HEX_RE.test(c.hex.trim()));
    if (badHex) {
      toastError(`Invalid hex "${badHex.hex}". Use a value like #1B2A4A.`);
      return;
    }

    const payload = {
      buyer_id: buyerId,
      name,
      season: season || null,
      notes: notes || null,
      colors: colors
        .filter((c) => c.name.trim())
        .map((c, i) => ({
          name: c.name.trim(),
          code: c.code.trim() || null,
          hex: c.hex.trim() || null,
          sort_order: (i + 1) * 10,
        })),
    };

    startTransition(async () => {
      const result = await createColorCard(payload);
      if (result.ok) {
        success("Colour card created");
        router.push(`/orders/color-cards/${result.cardId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New colour card</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={handleClose}>
          Cancel
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New colour card</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="cc-buyer">Buyer *</Label>
                <Select
                  id="cc-buyer"
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  required
                >
                  <option value="">— select buyer —</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="cc-name">Card name *</Label>
                <Input
                  id="cc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. SS26 Core Palette"
                  required
                />
              </div>
              <div>
                <Label htmlFor="cc-season">Season</Label>
                <Input
                  id="cc-season"
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                  placeholder="e.g. SS26"
                />
              </div>
              <div>
                <Label htmlFor="cc-notes">Notes</Label>
                <Input
                  id="cc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            {/* Colours */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="mb-0">Colours</Label>
                <Button type="button" variant="subtle" size="sm" onClick={addColor}>
                  + Add colour
                </Button>
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted">
                      <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">
                        Colour name
                      </th>
                      <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">
                        Ref / Pantone
                      </th>
                      <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">
                        Hex
                      </th>
                      <th className="w-10 px-3 py-1.5" />
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {colors.map((c, i) => {
                      const swatch = HEX_RE.test(c.hex.trim()) ? c.hex.trim() : null;
                      return (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-3 py-1">
                            <Input
                              placeholder="e.g. Navy"
                              value={c.name}
                              onChange={(e) => updateColor(i, "name", e.target.value)}
                              className="h-7 text-xs"
                            />
                          </td>
                          <td className="px-3 py-1">
                            <Input
                              placeholder="e.g. 19-3920 TCX"
                              value={c.code}
                              onChange={(e) => updateColor(i, "code", e.target.value)}
                              className="h-7 text-xs"
                            />
                          </td>
                          <td className="px-3 py-1">
                            <Input
                              placeholder="#1B2A4A"
                              value={c.hex}
                              onChange={(e) => updateColor(i, "hex", e.target.value)}
                              className="h-7 text-xs"
                            />
                          </td>
                          <td className="px-3 py-1">
                            <span
                              className="inline-block h-5 w-5 rounded border border-border align-middle"
                              style={swatch ? { backgroundColor: swatch } : undefined}
                              aria-hidden
                            />
                          </td>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              onClick={() => removeColor(i)}
                              className="text-muted-foreground hover:text-danger"
                              aria-label="Remove colour"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Rows with no colour name are ignored. You can add more colours later.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create colour card"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
