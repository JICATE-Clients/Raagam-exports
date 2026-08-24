"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 */
export function BomCopySheet({
  open,
  onClose,
  sources,
  onPick,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  sources: BomCopySource[];
  onPick: (bomId: string) => void;
  isPending?: boolean;
}) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sources;
    return sources.filter((s) =>
      [s.sc_no, s.customer_name, s.code].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [sources, q]);

  return (
    <Sheet open={open} onClose={onClose} title="Copy material list from" size="sm">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Brings across the materials, their per-garment ratios and how each one splits.
          Quantities are recalculated for this order.
        </p>

        {/* caps-input: exempt -- a search QUERY is not a stored value. */}
        <Input uppercase={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search RE No or customer…"
          aria-label="Search orders to copy from"
        />

        {shown.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            {sources.length === 0
              ? "No recorded material BOM to copy from yet."
              : "No order matches that search."}
          </p>
        ) : (
          <ul className="max-h-[52vh] space-y-1 overflow-y-auto">
            {shown.map((s) => (
              <li key={s.bom_id}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onPick(s.bom_id)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-surface-muted disabled:opacity-60"
                >
                  {/* THE ROW COMMITS ON CLICK, so `touch={false}`: a
                      press-and-hold meant to READ a long customer name would
                      reveal it and pick the source in the same gesture. The same
                      exemption the picker option rows carry. */}
                  <span className="min-w-0">
                    <Truncated
                      touch={false}
                      className="block font-mono text-xs font-medium text-foreground"
                    >
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
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
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
