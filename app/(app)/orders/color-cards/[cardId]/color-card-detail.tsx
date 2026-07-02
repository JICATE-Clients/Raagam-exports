"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addColorCardColor,
  deleteColorCardColor,
  setColorCardStatus,
} from "@/lib/orders/color-cards/actions";
import { colorCardStatusTone } from "@/lib/orders/color-cards/types";
import type { ColorCardColor } from "@/lib/orders/color-cards/types";
import type { ColorCardDetail as ColorCardDetailType } from "@/lib/orders/color-cards/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
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
          {
            header: "",
            align: "right",
            cell: (c: ColorCardColor) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(c.id)}
                disabled={isPending}
                className="h-7 px-2 text-xs text-danger hover:opacity-80"
              >
                Delete
              </Button>
            ),
          } satisfies Column<ColorCardColor>,
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
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-mono font-medium">{card.code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Buyer</dt>
              <dd className="font-medium">{card.buyers?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Season</dt>
              <dd className="font-medium">{card.season ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="tabular-nums font-medium">{fmtDate(card.created_at)}</dd>
            </div>
            {card.notes && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="text-sm">{card.notes}</dd>
              </div>
            )}
          </dl>
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
              className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
            >
              <div>
                <Label htmlFor="add-name" className="mb-0.5">
                  Colour name *
                </Label>
                <Input
                  id="add-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Navy"
                  required
                  className="w-36"
                />
              </div>
              <div>
                <Label htmlFor="add-code" className="mb-0.5">
                  Ref / Pantone
                </Label>
                <Input
                  id="add-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="19-3920 TCX"
                  className="w-36"
                />
              </div>
              <div>
                <Label htmlFor="add-hex" className="mb-0.5">
                  Hex
                </Label>
                <Input
                  id="add-hex"
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  placeholder="#1B2A4A"
                  className="w-28"
                />
              </div>
              <span
                className="mb-1 inline-block h-8 w-8 rounded border border-border"
                style={
                  HEX_RE.test(hex.trim())
                    ? { backgroundColor: hex.trim() }
                    : undefined
                }
                aria-hidden
              />
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
