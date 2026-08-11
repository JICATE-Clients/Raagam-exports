"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addColorCardColor,
  deleteColorCardColor,
  setColorCardStatus,
} from "@/lib/orders/color-cards/actions";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { colorCardStatusTone } from "@/lib/orders/color-cards/types";
import type { ColorCardColor } from "@/lib/orders/color-cards/types";
import type { ColorCardDetail as ColorCardDetailType } from "@/lib/orders/color-cards/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface Props {
  card: ColorCardDetailType;
  colors: ColorCardColor[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ColorCardDetail({ card, colors, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // add-colour form
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [hex, setHex] = useState("");

  // Expand-in-place form, invisible to the guard's DOM scan — see
  // new-order-form.tsx.
  useUnsavedGuard(formOpen || isPending);

  function resetForm() {
    setName("");
    setCode("");
    setHex("");
    setFormOpen(false);
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (hex.trim() && !HEX_RE.test(hex.trim())) {
      toastError(`Invalid hex "${hex}". Use a value like #1B2A4A.`);
      return;
    }
    startTransition(async () => {
      const result = await addColorCardColor(card.id, {
        name: name.trim(),
        code: code.trim() || null,
        hex: hex.trim() || null,
        sort_order: (colors.length + 1) * 10,
      });
      if (result.ok) {
        success("Colour added");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(colorId: string) {
    startTransition(async () => {
      const result = await deleteColorCardColor(colorId, card.id);
      if (result.ok) {
        success("Colour removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleToggleStatus() {
    const next = card.status === "active" ? "archived" : "active";
    startTransition(async () => {
      const result = await setColorCardStatus(card.id, next);
      if (result.ok) {
        success(next === "archived" ? "Card archived" : "Card restored");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<ColorCardColor>[] = [
    {
      header: "",
      cell: (c) => (
        <span
          className="inline-block h-5 w-5 rounded border border-border align-middle"
          style={
            c.hex && HEX_RE.test(c.hex) ? { backgroundColor: c.hex } : undefined
          }
          aria-hidden
        />
      ),
    },
    { header: "Colour", cell: (c) => <span className="text-sm font-medium">{c.name}</span> },
    {
      header: "Ref / Pantone",
      cell: (c) => (
        <span className="font-mono text-xs text-muted-foreground">{c.code ?? "—"}</span>
      ),
    },
    {
      header: "Hex",
      cell: (c) => (
        <span className="font-mono text-xs text-muted-foreground">{c.hex ?? "—"}</span>
      ),
    },
    ...(canDelete
      ? [
          rowActionsColumn<ColorCardColor>((c) => (
            <RowActions
              onDelete={() => handleDelete(c.id)}
              isPending={isPending}
            />
          )),
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle>Card details</CardTitle>
          <div className="flex items-center gap-2">
            <StatusPill tone={colorCardStatusTone(card.status)}>
              {card.status === "active" ? "Active" : "Archived"}
            </StatusPill>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleToggleStatus}
                disabled={isPending}
              >
                {card.status === "active" ? "Archive" : "Restore"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody>
          {/* A READ-ONLY BAND ON THE FIELD TRACK, not its own `grid-cols-2
              sm:grid-cols-4`. `Field` gives the label and the ~280px slot; the
              children stay plain text rather than becoming `readOnly` inputs,
              because these are facts being reported, not values being edited,
              and boxing them would invite a click that does nothing.

              This costs the `<dl>/<dt>/<dd>` grouping. `Field` renders a real
              `<Label>` against its content, so each pair is still announced as a
              labelled value — what is lost is only that the four are announced
              as ONE list. Worth it to have every band on this screen sharing the
              left edge and the width of the fields below it. */}
          <FieldGrid>
            <Field label="Code" size="sm">
              <div className="font-mono text-sm font-medium">{card.code ?? "—"}</div>
            </Field>
            <Field label="Buyer" size="sm">
              <div className="text-sm font-medium">{card.buyers?.name ?? "—"}</div>
            </Field>
            <Field label="Season" size="sm">
              <div className="text-sm font-medium">{card.season ?? "—"}</div>
            </Field>
            <Field label="Created" size="sm">
              <div className="text-sm font-medium tabular-nums">{fmtDate(card.created_at)}</div>
            </Field>
            {card.notes && (
              // `full` is the row — a note runs long and reads badly in a
              // quarter of one.
              <Field label="Notes" size="full">
                <div className="text-sm">{card.notes}</div>
              </Field>
            )}
          </FieldGrid>
        </CardBody>
      </Card>

      {/* Colours */}
      <Card>
        <CardHeader>
          <CardTitle>Colours ({colors.length})</CardTitle>
          {canEdit && !formOpen && (
            <Button size="sm" variant="subtle" onClick={() => setFormOpen(true)}>
              + Add colour
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable
            columns={columns}
            rows={colors}
            getKey={(c) => c.id}
            empty="No colours on this card yet."
          />

          {canEdit && formOpen && (
            <form
              onSubmit={handleAdd}
              // ONE MARKER, NEVER A HANDLER — without it `isEditorScope()` is
              // false, Tab keeps native order and leaves the form. See the
              // `raagam-keyboard-contract` skill.
              data-focus-scope
              className="space-y-3 rounded-md border border-border bg-surface-muted p-3"
            >
              {/* `FieldGrid` and one field width, in place of a
                  `flex flex-wrap items-end gap-3` of `w-36` / `w-28` boxes.
                  Sizing each control to its own data is what LAYOUT.md §3 fixes
                  a field at ~280px to avoid: nothing lined up with the grid
                  above it. */}
              <FieldGrid>
                {/* `required` on the Field, not a `*` typed into the label — one
                    prop draws the star AND holds the cursor on a blank box. */}
                <Field label="Colour name" required size="sm" htmlFor="add-name">
                  <Input
                    id="add-name"
                    uppercase
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Navy"
                    required
                  />
                </Field>
                <Field label="Ref / Pantone" size="sm" htmlFor="add-code">
                  <Input
                    id="add-code"
                    uppercase
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="19-3920 TCX"
                  />
                </Field>
                <Field label="Hex" size="sm" htmlFor="add-hex">
                  <Input
                    id="add-hex"
                    value={hex}
                    onChange={(e) => setHex(e.target.value)}
                    placeholder="#1B2A4A"
                  />
                </Field>
                {/* An unlabelled cell that still takes a slot on the track, so
                    the swatch sits beside Hex instead of breaking the row. It
                    only fills once the value parses, so a half-typed "#1B" shows
                    nothing rather than a misleading colour. */}
                <Field size="sm">
                  <span
                    className="inline-block h-9 w-9 rounded border border-border"
                    style={
                      HEX_RE.test(hex.trim())
                        ? { backgroundColor: hex.trim() }
                        : undefined
                    }
                    aria-hidden
                  />
                </Field>
              </FieldGrid>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
                  {isPending ? "Adding…" : "Add"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
