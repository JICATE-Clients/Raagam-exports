"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE ROW'S ✕ THAT SHOWS ONLY ON HOVER — one implementation for every table
 * (user 2026-10-12: "Embellishment la irukka mari x icon mouse hover panna
 * mattum therira mari … athey size la neat aa … global aa"). Lifted verbatim
 * from Sample Costing ▸ CMT & charges ▸ Embellishment (2026-10-09, "delete icon
 * remove, mouse hover panna x vara mari"), which is the reference look.
 *
 * - **20px chip, 12px glyph** — the picker's own compact clear glyph
 *   (`FieldAffordance` GLYPH.compact), so a row's ✕ and a field's ✕ are one size.
 * - **Invisible at rest, never removed.** `opacity-0` until the pointer is on
 *   the ROW (a `<tr>` or any `[data-grid-row]`), not just on the chip — the
 *   operator aims at the row, then the ✕ is there. It stays in the DOM, so
 *   Ctrl+Del (`data-row-remove`, `gridKeyNav`) and screen readers still reach it.
 * - **Off the Tab path** (`tabIndex={-1}`) — Tab lands on fields only
 *   (AGENTS.md, "Tab lands on fields"). Keyboard deletion is Ctrl+Del.
 * - **Red on its own hover** — `danger-soft` fill, `danger` glyph: the one
 *   moment it says "this deletes".
 * - **Always visible where there is no hover.** On a touch screen a hover-only
 *   control would be unreachable forever, so `(hover: none)` shows it at rest.
 *
 * Not for a grid that keeps an Actions column with a plain ✕ (`erp-sheet-grid`'s
 * target look) — this is for a ✕ riding INSIDE a value cell, beside the input.
 * The `erp-row-hover-remove` skill has the rule and the placement.
 */
/**
 * THE REVEAL, ONE STRING FOR EVERY ROW ✕ — invisible at rest, shown while the
 * pointer is on the ROW that owns it: a `<tr>`, a `[data-grid-row]` (ChildGrid's
 * table, inline and card rows), a `[data-sheet-row]` band, or — for a
 * hand-built row that is none of those — `[data-hover-row]`, a marker that
 * means ONLY "reveal my ✕" and carries no keyboard meaning (never use
 * `data-grid-row` for that: it puts the row on the arrow/Tab axis). Also shown on
 * keyboard focus, and always on a screen with no hover (touch), where a
 * hover-only ✕ could never be reached. `RowRemoveChip` (ChildGrid's card-corner
 * chip) reads this same string, so no ✕ in the app is visible at rest (user
 * 2026-10-12: "mouse hover pannamaye x theriyuthu sila table la — apdi
 * irukka kudathu").
 */
export const ROW_HOVER_REVEAL =
  "opacity-0 focus-visible:opacity-100 [tr:hover_&]:opacity-100 [[data-grid-row]:hover_&]:opacity-100 [[data-sheet-row]:hover_&]:opacity-100 [[data-hover-row]:hover_&]:opacity-100 [@media(hover:none)]:opacity-100";

export function RowHoverRemove({
  label,
  onClick,
  disabled,
  className,
}: {
  /** What the row is, for the accessible name: "Remove this embellishment". */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    // button-shape: exempt -- a 20px ✕ chip revealed on row hover, an icon not a worded button
    <button
      type="button"
      data-row-remove
      tabIndex={-1}
      aria-label={label}
      title="Remove"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-control text-muted-foreground",
        "hover:bg-danger-soft hover:text-danger disabled:pointer-events-none",
        ROW_HOVER_REVEAL,
        className,
      )}
    >
      <X className="h-3 w-3" aria-hidden />
    </button>
  );
}
