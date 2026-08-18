"use client";

import { ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * THE TRAILING AFFORDANCE OF A FIELD — the ▼ that opens its list, or the ✕ that
 * clears it — drawn as a SEGMENT OF THE CONTROL rather than a glyph adrift
 * inside it (client 2026-08-18: "that close, drop down button icon look
 * floating into the screen ... we need make it look like integrated with screen
 * look").
 *
 * WHAT WAS ACTUALLY FLOATING, since "it looks wrong" is not a spec. The chevron
 * sat at `right-3` — 12px of blank field to its right — and was centred with
 * `top-1/2 -translate-y-1/2`, so it was anchored to NOTHING: not the border, not
 * the corner, not the value beside it. A mark placed in the middle of a box
 * belongs to the box's contents; a mark placed ON the box's edge belongs to the
 * box. That is the whole change: `inset-y-px right-px` puts the slot against the
 * field's inner border on three sides, and the corner radius carries through it.
 *
 * IT ALSO TELLS THE TWO KINDS OF FIELD APART. On the Garment Order header,
 * `Customer` (a picker) and `PO No` (a text box) were the same white rectangle
 * distinguished by one faint 16px glyph. A segmented right edge is what the
 * legacy RP-Software combobox had, and it answers "does this field have a list?"
 * without the operator clicking to find out.
 *
 * ONE COMPONENT BECAUSE THERE WERE TWO COPIES. `data-picker.tsx` and
 * `combobox.tsx` each drew this pair themselves — and had already drifted:
 * clearing a picker hovered `text-danger`, clearing a combobox hovered
 * `text-foreground`, for the same act on the same kind of control. Every
 * dropdown the operator sees is one of these two (`select.tsx` upgrades to
 * `Combobox` on a fine pointer, and all 19 adapters wrap `DataPicker`), so this
 * file is the app's entire answer to the question.
 */

/**
 * The right-hand padding an input needs so its value clears the slot.
 *
 * Stated here, beside `SLOT`'s width, because the two are one measurement: 28px
 * of slot plus a 4px gutter. Kept at the `pr-8` both inputs already carried, so
 * the value's usable width does not move by a pixel and nothing about existing
 * truncation, ellipsis or `useOverflow` measurement shifts with this change.
 */
export const AFFORDANCE_PAD = "pr-8";

/**
 * The same measurement for a `compact` control — a dense grid cell.
 *
 * 28px of slot is a third of an 80px cell, and it is what pushes the VALUE into
 * truncating: "Colour" rendering as "C..". A 20px slot still reads as a
 * segmented edge and hands ~8px back to the text. Stated here beside
 * `SLOT_COMPACT` for the reason the full-size pair is: the pad and the slot are
 * one measurement and must never be edited apart.
 */
export const AFFORDANCE_PAD_COMPACT = "pr-6";

/**
 * `rounded-r-[5px]` is `rounded-md` (6px) MINUS the field's 1px border — the
 * radius of the hole the border encloses, not of the border itself. At 6px it
 * would bulge a hair past the corner; at 0 it would square off inside a rounded
 * box, which is the tell that a fill was pasted over a control rather than cut
 * from it.
 *
 * `inset-y-px` rather than a height: the field is `h-9`, or `h-8` inside the
 * compact editor container query, and a slot that reads its own box from the
 * parent's insets is correct at both without knowing either.
 */
const SLOT = cn(
  "absolute inset-y-px right-px flex items-center justify-center",
  "rounded-r-[5px] border-l border-border bg-surface-muted text-muted-foreground",
);

/** Width and glyph size, the only two things `compact` changes. Everything else
 *  about the slot — the insets, the radius, the border, the fill — is shared, so
 *  a dense cell and a full field are visibly the same control at two sizes. */
const SLOT_W = { full: "w-7", compact: "w-5" };
const GLYPH = { full: "h-4 w-4", compact: "h-3 w-3" };

export function FieldAffordance({
  onClear,
  clearLabel = "Clear",
  disabled = false,
  compact = false,
}: {
  /**
   * Given → the slot shows ✕ and clears on click. Omitted → it shows ▼.
   *
   * One element with a mode, not two the caller picks between, because the slot
   * is one place on the control and the geometry must not be restated per
   * branch — that restating is how the two copies drifted in the first place.
   */
  onClear?: () => void;
  /** Names the ✕ for a screen reader: "Clear Customer", not "Clear". */
  clearLabel?: string;
  disabled?: boolean;
  /**
   * A DENSE GRID CELL — a 20px slot and a 12px glyph instead of 28 and 16.
   *
   * The flag `DataPicker` and `Select` already carry, threaded through rather
   * than re-derived, because a picker and a select sit side by side in one grid
   * row: two rules for one slot would draw two different right edges in
   * adjacent cells, which is precisely the drift this file was created to end.
   *
   * Pair it with `AFFORDANCE_PAD_COMPACT` on the input, or the value runs under
   * the slot.
   */
  compact?: boolean;
}) {
  return onClear ? (
    <button
      type="button"
      aria-label={clearLabel}
      /**
       * TAB NEVER LANDS HERE. `lib/focus.ts` moves between FIELDS and nothing
       * else, and this is drawn ON a field — leaving it focusable made "Tab
       * after picking" look like it did nothing, because focus had moved onto a
       * ✕ sitting on top of the box the operator was still looking at. Giving
       * the slot a fill makes it look more like a button than it did, so this
       * matters more now, not less: it is reachable by mouse, and by Ctrl+Del
       * where it is a grid row's remove. See the keyboard contract in
       * AGENTS.md.
       */
      tabIndex={-1}
      onClick={onClear}
      className={cn(
        SLOT,
        SLOT_W[compact ? "compact" : "full"],
        "hover:bg-border hover:text-danger",
        // The input dims itself with `disabled:opacity-50`; an absolutely
        // positioned SIBLING inherits none of that, so a disabled field would
        // otherwise carry a slot at full strength offering to clear it.
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <X className={cn(GLYPH[compact ? "compact" : "full"], "shrink-0")} />
    </button>
  ) : (
    <span
      aria-hidden
      className={cn(
        SLOT,
        SLOT_W[compact ? "compact" : "full"],
        /**
         * `pointer-events-none` IS THE BEHAVIOUR, not a detail. The field opens
         * its own list on click, so the chevron must let the click through to
         * it — a slot that swallowed the pointer would be a dead spot on
         * exactly the 28px the operator aims at to open the thing.
         */
        "pointer-events-none",
        disabled && "opacity-50",
      )}
    >
      <ChevronDown className={cn(GLYPH[compact ? "compact" : "full"], "shrink-0")} />
    </span>
  );
}
