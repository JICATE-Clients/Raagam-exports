"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopySourceChooser, PreviewChip } from "@/components/orders/copy-source-chooser";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate } from "@/lib/format";
import type { BomCopySource } from "@/lib/orders/material-bom-amendment/types";

/**
 * "Copy from…" — pull another order's material list onto this one.
 *
 * The client asked for it by name: a merchandiser retypes ~20 accessory lines
 * per order, and most orders for one buyer use the same trims. Nothing in this
 * repo had a copy feature of any kind before.
 *
 * WHAT IS COPIED IS THE RECIPE, NOT THE PLAN. `copyMaterialBomFrom` hands back
 * the materials, their per-garment ratios and how each splits — never a
 * quantity, because quantities recompute against THIS order's production
 * target. That is what makes copying safe rather than a way to spread one
 * order's numbers onto another.
 *
 * A source is offered only when it is RECORDED and has lines: a draft is
 * someone's half-finished thinking, and copying it spreads the half-finished
 * state to a second order where it is harder to notice.
 *
 * Drawn by `CopySourceChooser` (2026-10-16): search, This customer, a preview,
 * then Copy. The amber `BomCopyConfirm` below still asks before replacing.
 */
export function BomCopySheet({
  open,
  onClose,
  sources,
  onPick,
  isPending,
  customerId = null,
}: {
  open: boolean;
  onClose: () => void;
  sources: BomCopySource[];
  onPick: (bomId: string) => void;
  isPending?: boolean;
  /** This order's customer — their BOMs are listed first and get a filter. */
  customerId?: string | null;
}) {
  const sameCustomer = (s: BomCopySource) => !!customerId && s.customer_id === customerId;
  const customerName = sources.find(sameCustomer)?.customer_name;
  return (
    <CopySourceChooser<BomCopySource>
      open={open}
      onClose={onClose}
      title="Copy material list from"
      intro="Brings across the materials, their per-garment ratios and how each one splits. Quantities are recalculated for this order."
      items={sources}
      getId={(s) => s.bom_id}
      searchText={(s) => [s.sc_no, s.customer_name, s.code]}
      searchPlaceholder="Search RE No or customer…"
      filters={customerName ? [{ key: "customer", label: "This customer", test: sameCustomer }] : undefined}
      groups={customerName ? [{ label: `This customer · ${customerName}`, test: sameCustomer }] : undefined}
      renderRow={(s) => (
        <span className="flex items-center justify-between gap-3">
          {/* THE ROW SELECTS ON CLICK, so `touch={false}`: a press-and-hold
              meant to READ a long customer name would reveal it and pick the
              source in the same gesture. The same exemption the picker option
              rows carry. */}
          <span className="min-w-0">
            <Truncated touch={false} className="block font-mono text-xs font-medium text-foreground">
              {s.sc_no ?? s.code ?? "—"}
            </Truncated>
            <Truncated
              touch={false}
              text={`${s.customer_name ?? "—"} · ${fmtDate(s.amend_date)}`}
              className="block text-xs text-muted-foreground"
            />
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {s.line_count} {s.line_count === 1 ? "line" : "lines"}
          </span>
        </span>
      )}
      renderPreview={(s) => (
        <span className="flex flex-wrap gap-1">
          <PreviewChip>
            {s.line_count} {s.line_count === 1 ? "material" : "materials"}
          </PreviewChip>
          <PreviewChip>Ratios and splits</PreviewChip>
          <PreviewChip>Quantities recalculated</PreviewChip>
        </span>
      )}
      onCopy={(id) => onPick(id)}
      copyLabel={(s) => `Copy from ${s.sc_no ?? s.code ?? "this BOM"}`}
      emptyHint="No recorded material BOM to copy from yet."
      isPending={isPending}
    />
  );
}

/**
 * The amber bar that asks before replacing rows already on screen.
 *
 * Lifted from `amendment-screen.tsx`'s order seed, which learned the shape the
 * hard way: it applies NOTHING until the operator confirms, because a
 * half-replaced set of grids is worse than either state on its own.
 */
export function BomCopyConfirm({
  count,
  onAccept,
  onDismiss,
}: {
  count: number;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
      <Copy className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-foreground">
        This will replace the {count} {count === 1 ? "line" : "lines"} already entered.
      </p>
      <Button size="sm" variant="outline" onClick={onDismiss} type="button">
        Keep mine
      </Button>
      <Button size="sm" onClick={onAccept} type="button">
        Replace
      </Button>
    </div>
  );
}
