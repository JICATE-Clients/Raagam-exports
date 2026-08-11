"use client";

import { useRef, useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";
import { createColorCard } from "@/lib/orders/color-cards/actions";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { Buyer } from "@/lib/masters/types";

/** `key` is what `ChildGrid` identifies a row by. These used to be keyed on the
 *  array index, which React reuses across a removal — delete the second of three
 *  colours and the third inherited the second's DOM node, so a focused input kept
 *  focus while its value changed underneath the cursor. */
type ColorRow = { key: string; name: string; code: string; hex: string };

interface Props {
  buyers: Pick<Buyer, "id" | "name" | "code" | "currency_code">[];
  /** When set, the card is scoped to this customer: the buyer picker is hidden. */
  fixedBuyer?: { id: string; name: string };
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function NewColorCardForm({ buyers, fixedBuyer }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Expand-in-place form, invisible to the guard's DOM scan — see
  // new-order-form.tsx.
  useUnsavedGuard(open || isPending);
  useCreateIntent(() => setOpen(true));

  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;
  const blankColor = (): ColorRow => ({ key: newKey(), name: "", code: "", hex: "" });

  const [buyerId, setBuyerId] = useState(fixedBuyer?.id ?? "");
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [notes, setNotes] = useState("");
  // Starts EMPTY and the grid seeds it — `ChildGrid`'s `seedRow` adds the first
  // row through `onAdd`. A lazy `useState(() => [blankColor()])` would read
  // `keySeq` during render, which `react-hooks/refs` rejects and which is the
  // real hazard it is guarding: a ref read in a render is not stable across a
  // re-render React discards.
  const [colors, setColors] = useState<ColorRow[]>([]);

  function resetForm() {
    setBuyerId(fixedBuyer?.id ?? "");
    setName("");
    setSeason("");
    setNotes("");
    // Empty, not one blank row — `seedRow` puts the row back, which keeps one
    // rule in one place instead of two things both deciding what "fresh" means.
    setColors([]);
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  function addColor() {
    setColors((cs) => [...cs, blankColor()]);
  }

  function removeColor(key: string) {
    setColors((cs) => cs.filter((c) => c.key !== key));
  }

  function updateColor(key: string, field: keyof ColorRow, val: string) {
    setColors((cs) => cs.map((c) => (c.key === key ? { ...c, [field]: val } : c)));
  }

  const colorColumns: ChildGridColumn<ColorRow>[] = [
    {
      header: "Colour name",
      cell: (r) => (
        <Input
          placeholder="e.g. Navy"
          uppercase
          value={r.name}
          onChange={(e) => updateColor(r.key, "name", e.target.value)}
          className="h-8"
        />
      ),
    },
    {
      header: "Ref / Pantone",
      cell: (r) => (
        <Input
          placeholder="e.g. 19-3920 TCX"
          uppercase
          value={r.code}
          onChange={(e) => updateColor(r.key, "code", e.target.value)}
          className="h-8"
        />
      ),
    },
    {
      header: "Hex",
      cell: (r) => (
        <Input
          placeholder="#1B2A4A"
          value={r.hex}
          onChange={(e) => updateColor(r.key, "hex", e.target.value)}
          className="h-8"
        />
      ),
    },
    {
      // The swatch only appears once the hex parses, so a half-typed "#1B" shows
      // nothing rather than a misleading colour. `aria-hidden` because the value
      // beside it already says what it is.
      header: "",
      width: "3rem",
      align: "center",
      cell: (r) => {
        const swatch = HEX_RE.test(r.hex.trim()) ? r.hex.trim() : null;
        return (
          <span
            className="inline-block h-5 w-5 rounded border border-border align-middle"
            style={swatch ? { backgroundColor: swatch } : undefined}
            aria-hidden
          />
        );
      },
    },
  ];

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
          <form
            onSubmit={handleSubmit}
            // ONE MARKER, NEVER A HANDLER — without it `isEditorScope()` is
            // false, Tab keeps native order and leaves the form. See the
            // `raagam-keyboard-contract` skill.
            data-focus-scope
            className="space-y-4"
          >
            {/* `FieldGrid`, not a hand-rolled `grid-cols-*` — a screen composes
                primitives, it does not draw (LAYOUT.md §3). */}
            <FieldGrid>
              {fixedBuyer ? (
                // Opened from a customer's own page: the buyer is settled, so it
                // reads back rather than being asked for. `Input readOnly` rather
                // than a styled `<div>` — the div was a value the primitives
                // could not see, and readOnly brings the right look, keeps it in
                // the accessibility tree and sets `tabIndex={-1}` so it stays off
                // the typing path.
                <Field label="Customer" size="sm" htmlFor="cc-buyer">
                  <Input id="cc-buyer" value={fixedBuyer.name} readOnly />
                </Field>
              ) : (
                // `required` on the Field, not a `*` typed into the label — one
                // prop draws the star AND holds the cursor on a blank box.
                <Field label="Buyer" required size="sm" htmlFor="cc-buyer">
                  <Select
                    id="cc-buyer"
                    value={buyerId}
                    onChange={(e) => setBuyerId(e.target.value)}
                    required
                  >
                    <option value="">— select buyer —</option>
                    {buyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Card name" required size="sm" htmlFor="cc-name">
                <Input
                  id="cc-name"
                  uppercase
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. SS26 Core Palette"
                  required
                />
              </Field>
              <Field label="Season" size="sm" htmlFor="cc-season">
                <Input
                  id="cc-season"
                  uppercase
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                  placeholder="e.g. SS26"
                />
              </Field>
              <Field label="Notes" size="sm" htmlFor="cc-notes">
                <Input
                  id="cc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
            </FieldGrid>

            {/* Colours — `ChildGrid`, not the hand-rolled <table> this carried.
                That one drew its own header and its own ✕, so it inherited
                neither Ctrl+Del nor `data-row-remove`; its remove control was a
                bare `×` character that Tab stopped on. Four columns fit, so it
                keeps the table layout rather than wrapping. */}
            <div>
              <ChildGrid<ColorRow>
                label="Colours"
                columns={colorColumns}
                rows={colors}
                seedRow
                onAdd={addColor}
                onRemove={(r) => removeColor(r.key)}
                addLabel="+ Add colour"
              />
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
