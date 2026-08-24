"use client";

import type { ReactNode } from "react";
import { gridKeyNav } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { fmtQty } from "@/lib/uom/convert";
import { cn } from "@/lib/utils";

/**
 * THE MATERIAL BOM'S SUB-ROW — legacy's nested grid, column for column
 * (client 2026-08-21, screenshots 2458 / 2459: "our screen we right but field
 * listing is wrong").
 *
 * Legacy's columns, and what became of each:
 *
 *     Choose ☑        kept — an untick means this row buys none of the material
 *     S No            dropped — a row number nobody refers to
 *     Description     kept — the slice's own name
 *     Size wise ☑     kept, and it REPLACED two Attribute options
 *     Item Color      kept — per row, overriding the line's
 *     Specification   kept
 *     Size / Spec     kept — the MATERIAL's size, not the garment's
 *     No of Items     kept
 *     No of Pcs       kept
 *     Allowance % / Qty   dropped — client: not needed, the buffer stays on the line
 *     Conv Item       dropped — ours is per line (`uom_conversion_id`); raised, not built
 *
 * ## THE SIZE-WISE TICK IS THE MODEL, NOT A VIEW SETTING
 *
 * Legacy shows `Attribute = Country` with a tick on each row, and the client
 * confirmed what that implies: the Attribute picks ONE axis and a row splits
 * ITSELF. So "Size-wise" and "Combination" left the Attribute dropdown —
 * Colour + tick IS combination, Order + tick IS size-wise, and
 * `check-bom-requirement.mts` asserts that equivalence rather than trusting it.
 *
 * A ticked row keeps its own Choose / Item Color / Specification and grows a
 * strip of size boxes beneath it. The two FIGURES move to the strip, because
 * that is what the tick was for.
 *
 * ## SIZES GO ACROSS, AND THAT IS THE RULE THE TWO TABS BESIDE THIS ONE FOUND
 *
 * `price-matrix.tsx`: colour x size is a table with two axes, and a flat list
 * pays for the second in REPETITION — three colours over seven sizes was 21 rows
 * with the colour typed out seven times. `approval-qty-lines.tsx`: "six sizes
 * were six stacked rows and are one strip here — the same six numbers in a sixth
 * of the height." Both were arrived at independently; this follows them.
 *
 * ## PRESENTATIONAL
 *
 * It owns no state and no rows. The slices are `productionSlices`', the flags
 * are the screen's, and the Item Color picker is INJECTED — a component that
 * imported `LookupDialogPicker` and the permission flags would stop being
 * testable and start being a second copy of the line's cell.
 */

/** One overrideable slice — a whole row, or one size box within one. */
export interface BomSliceCell {
  key: string;
  /** Column heading inside a size strip; null on a row's own cell. */
  sizeLabel: string | null;
  /**
   * THE THREE DERIVED FIGURES, per attribute value (client 2026-08-21:
   * "calculated to final qty also not a common value, which is also attribute
   * based"). All three are computed, never typed.
   *
   *   calc   the ratio applied to this slice, before any buffer
   *   needs  the same with this row's Excess % — what it actually consumes
   *   final  after the line's MOQ and Round To, which stay per LINE (see below)
   */
  calc: number;
  needs: number;
  final: number | null;
  items: string;
  pieces: string;
  /** The wastage buffer for this row (0450) - legacy's per-sub-row Allowance %. */
  excess: string;
}

export interface BomSliceRow {
  key: string;
  label: string;
  /**
   * LEGACY'S COMBINATION (0463) — the garment part this row is a split for, or
   * null on a line that has none.
   *
   * NOT part of `label`. The label is the AXIS value (a style ref, a colourway,
   * a country) and the combination is a second axis crossed with it, so joining
   * them into one string would make "TEST · STL/26-27/0007" the row's name and
   * leave nothing to sort, group or read a single part by.
   */
  combination?: string | null;
  chosen: boolean;
  sizeWise: boolean;
  specification: string;
  sizeSpec: string;
  /**
   * The row's own figures, ALWAYS present (client 2026-08-21, screenshot 2465:
   * "why can't I give input for Items, Pcs, Exc % — it should allow the manual
   * entry").
   *
   * They used to be replaced by a "per size below" note once the Size tick
   * went on, which was wrong twice over: it took away a box the operator
   * expected to type in, and it left the size strip with nothing to inherit
   * FROM. A size box that is blank now falls back to this row, which falls
   * back to the line — the same per-field chain `consumptionFor` already
   * walks, one level deeper.
   */
  cell: BomSliceCell;
  /** The size boxes, when the row is ticked. */
  sizes: BomSliceCell[];
  /** False where the order has no size break-up for this row to split by. */
  canSizeWise: boolean;
}

export interface BomSliceFlagPatch {
  chosen?: boolean;
  size_wise?: boolean;
  specification?: string;
  size_spec?: string;
}

/** The app's own scale, copied from the two tabs this follows rather than
 *  re-chosen — a size the app does not own reads as not quite ours. */
const T_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * EVERY VARIANT THE PRIMITIVE DECLARES HAS TO BE ANSWERED. `Input` ships
 * `h-9 @2xl/editor:h-8 … text-base md:text-sm`, and `twMerge` only resolves a
 * conflict WITHIN one variant — so `text-[12.5px]` alone loses to `md:text-sm`
 * from `md` up, which is every desktop this grid is for. Same trap
 * `price-matrix.tsx` documents; same answer.
 */
const BOX =
  "h-[26px] @2xl/editor:h-[26px] text-[12.5px] md:text-[12.5px] rounded-none border-0 bg-transparent px-1.5";

/** Nine columns. Sums to ~840px, so it WRAPS rather than scrolling sideways —
 *  the operator had a sideways-scrolling grid removed on 2026-08-10 and
 *  `raagam-screen-layout` rule 4 makes that standing. */
/* THIRTEEN COLUMNS, AND IT STILL WRAPS RATHER THAN SCROLLING SIDEWAYS — the
 * operator had a sideways-scrolling grid removed on 2026-08-10 and
 * `raagam-screen-layout` rule 4 makes that standing. The three derived figures
 * are narrow because they hold four or five digits, and the descriptive
 * columns gave up the width for them. */
const COLS =
  "grid-cols-[2rem_minmax(104px,1fr)_2.75rem_minmax(112px,1fr)_minmax(88px,1fr)_minmax(80px,1fr)_3.75rem_3.75rem_3.5rem_4.5rem_4.5rem_4.75rem]";

/**
 * THE SAME TRACK WITH COMBINATION IN FRONT (0463).
 *
 * A SECOND CONSTANT RATHER THAN A COMPUTED ONE, because Tailwind's compiler only
 * emits classes it can see as literals — a template string built at runtime
 * produces a class name that never reaches the stylesheet, and the grid silently
 * collapses to one column. That is the same reason `FIELD_TRACK_*` are literals
 * on the screen next door.
 *
 * IT LEADS, ahead of the axis, because the combination is the coarser grouping:
 * the operator reads "TEST, and within it these styles". Putting it after the
 * axis would interleave the two parts of one style and read as noise.
 */
const COLS_COMBO =
  "grid-cols-[2rem_minmax(96px,1fr)_minmax(104px,1fr)_2.75rem_minmax(112px,1fr)_minmax(88px,1fr)_minmax(80px,1fr)_3.75rem_3.75rem_3.5rem_4.5rem_4.5rem_4.75rem]";

const TICK =
  "h-3.5 w-3.5 rounded border-border accent-primary disabled:opacity-40";

export function BomSliceGrid({
  caption,
  axisHead,
  rows,
  onSet,
  onFlag,
  renderColour,
  linePlaceholder,
  decimals,
}: {
  caption: ReactNode;
  axisHead: string;
  rows: readonly BomSliceRow[];
  onSet: (
    cellKey: string,
    patch: { items?: string; pieces?: string; excess?: string },
  ) => void;
  onFlag: (rowKey: string, patch: BomSliceFlagPatch) => void;
  /** The line's own Item Color cell, wired for this row. Injected — see header. */
  renderColour: (rowKey: string) => ReactNode;
  linePlaceholder: { items: string; pieces: string; excess: string };
  /**
   * `decimal_places_allowed` of the line's CONSUMPTION unit — the same figure
   * `ceilToPrecision` rounded these three columns by. Printing them through
   * `fmtNumber` capped a six-decimal unit at three digits AND rounded to
   * nearest, so the screen showed less than the stored requirement; see
   * `fmtQty`. Optional, and `uomPrecision` floors an absent one at 2 decimals.
   */
  decimals?: number | null;
}) {
  if (rows.length === 0) return null;

  /* IT ONLY DISPLAYS AFTER VALUES ARE GIVEN (client 2026-08-24: "that
     combination is only display after give that value not static field").
     Read off the ROWS rather than passed in as a flag, so the column cannot be
     shown with nothing in it or hidden with something in it — the two states a
     separate prop would let drift apart. */
  const hasCombination = rows.some((r) => !!(r.combination ?? "").trim());
  const cols = hasCombination ? COLS_COMBO : COLS;

  return (
    <div className="mt-4 rounded-lg border border-border">
      {caption}

      {/* `data-grid-body` + `data-grid-row` ARE THE WHOLE KEYBOARD. A tick box is
          a COLUMN on the arrow axis — `ROW_FIELDS` in child-grid.tsx counts a
          checkbox — so ←/→ reach it and Enter ticks it, with no handler of this
          file's own. The precedent and its warning are at
          `ta-department-assign-screen.tsx:184-201`. */}
      <div data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
        <div className={cn("grid border-b border-border-strong bg-surface-muted", cols)}>
          <div className={cn("flex min-h-8 items-center justify-center px-1", T_LABEL)}>✓</div>
          {hasCombination && (
            <div className={cn("flex min-h-8 items-center px-2", T_LABEL)}>Combination</div>
          )}
          <div className={cn("flex min-h-8 items-center px-2", T_LABEL)}>{axisHead}</div>
          <div className={cn("flex min-h-8 items-center justify-center px-1 text-center", T_LABEL)}>
            Size
          </div>
          <div className={cn("flex min-h-8 items-center px-2", T_LABEL)}>Item Color</div>
          <div className={cn("flex min-h-8 items-center px-2", T_LABEL)}>Specification</div>
          <div className={cn("flex min-h-8 items-center px-2", T_LABEL)}>Size / Spec</div>
          {/* THE RED STAR IS EARNED. Items and Pcs left the line on 2026-08-21
              and are typed HERE now, so the requiredness came with them. The
              caption refuses to close while one is blank, for the reason
              AGENTS.md gives: requiring a hidden field is a record that cannot
              be saved with nothing on screen to say why. */}
          <div className={cn("flex min-h-8 items-center justify-end px-2", T_LABEL)}>
            Items <span className="ml-0.5 text-danger">*</span>
          </div>
          <div className={cn("flex min-h-8 items-center justify-end px-2", T_LABEL)}>
            Pcs <span className="ml-0.5 text-danger">*</span>
          </div>
          <div className={cn("flex min-h-8 items-center justify-end px-2", T_LABEL)}>Exc %</div>
          <div className={cn("flex min-h-8 items-center justify-end px-2", T_LABEL)}>Calc</div>
          <div className={cn("flex min-h-8 items-center justify-end px-2", T_LABEL)}>+ Exc</div>
          <div className={cn("flex min-h-8 items-center justify-end px-2", T_LABEL)}>Final</div>
        </div>

        {rows.map((row) => (
          <div key={row.key} className="border-b border-border last:border-b-0">
            <div
              data-grid-row
              className={cn("grid", cols, !row.chosen && "opacity-45")}
            >
              <div className="flex min-h-9 items-center justify-center">
                <input
                  type="checkbox"
                  checked={row.chosen}
                  aria-label={`Include ${row.label}`}
                  onChange={(e) => onFlag(row.key, { chosen: e.target.checked })}
                  className={TICK}
                />
              </div>
              {hasCombination && (
                /* READ-ONLY HERE. The name is typed in the Combination popup and
                   this is where it is READ — a second editable copy would be two
                   places to rename a part from, and the rename would have to
                   re-key every stored row to keep its figures. Blank rather than
                   a dash on a row that is not a combination split: a dash would
                   read as "this part is called —". */
                <div className="flex min-h-9 items-center px-2">
                  <Truncated className="text-[13px] text-muted-foreground">
                    {(row.combination ?? "").trim()}
                  </Truncated>
                </div>
              )}
              <div className="flex min-h-9 items-center px-2">
                <Truncated className="text-[13px] text-foreground">{row.label}</Truncated>
              </div>
              <div className="flex min-h-9 items-center justify-center border-l border-border">
                <input
                  type="checkbox"
                  checked={row.sizeWise}
                  disabled={!row.chosen || !row.canSizeWise}
                  aria-label={`Split ${row.label} by size`}
                  title={
                    !row.canSizeWise
                      ? "This order has no size break-up on Quantities ▸ Assort to split by"
                      : undefined
                  }
                  onChange={(e) => onFlag(row.key, { size_wise: e.target.checked })}
                  className={TICK}
                />
              </div>
              <div className="flex min-h-9 items-center border-l border-border px-1">
                {renderColour(row.key)}
              </div>
              <div className="flex min-h-9 items-center border-l border-border">
                <Input
                  uppercase
                  value={row.specification}
                  aria-label={`Specification, ${row.label}`}
                  onChange={(e) => onFlag(row.key, { specification: e.target.value })}
                  className={cn(BOX, "w-full")}
                />
              </div>
              <div className="flex min-h-9 items-center border-l border-border">
                <Input
                  uppercase
                  value={row.sizeSpec}
                  aria-label={`Material size, ${row.label}`}
                  onChange={(e) => onFlag(row.key, { size_spec: e.target.value })}
                  className={cn(BOX, "w-full")}
                />
              </div>

              {/* A TICKED ROW'S FIGURES MOVED TO THE STRIP, so these three read as
                  the row's total rather than offering a second place to type one. */}
              <>
                  <div className="flex min-h-9 items-center border-l border-border">
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={row.cell.items}
                      placeholder={linePlaceholder.items}
                      aria-label={`No. of items, ${row.label}`}
                      onChange={(e) => onSet(row.cell.key, { items: e.target.value })}
                      className={cn(BOX, "w-full text-right")}
                    />
                  </div>
                  <div className="flex min-h-9 items-center border-l border-border">
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={row.cell.pieces}
                      placeholder={linePlaceholder.pieces}
                      aria-label={`Per pieces, ${row.label}`}
                      onChange={(e) => onSet(row.cell.key, { pieces: e.target.value })}
                      className={cn(BOX, "w-full text-right")}
                    />
                  </div>
                  <div className="flex min-h-9 items-center border-l border-border">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={row.cell.excess}
                      aria-label={`Excess percent, ${row.label}`}
                      onChange={(e) => onSet(row.cell.key, { excess: e.target.value })}
                      className={cn(BOX, "w-full text-right")}
                    />
                  </div>
                  <div className="flex min-h-9 items-center justify-end border-l border-border px-2">
                    <span className="tabular-nums text-[12.5px] text-muted-foreground">
                      {row.chosen ? fmtQty(row.cell.calc, decimals) : "—"}
                    </span>
                  </div>
                  <div className="flex min-h-9 items-center justify-end border-l border-border bg-info-soft/40 px-2">
                    <span className="tabular-nums text-[12.5px] font-medium text-info">
                      {row.chosen ? fmtQty(row.cell.needs, decimals) : "—"}
                    </span>
                  </div>
                  {/* THE FIGURE A PURCHASE ORDER IS WRITTEN FROM, so it is the
                      loudest cell on the row — the same weight the line's own
                      Final Quantity carries. */}
                  <div className="flex min-h-9 items-center justify-end border-l border-border bg-accent-soft/50 px-2">
                    <span className="tabular-nums text-[12.5px] font-semibold text-accent">
                      {row.chosen && row.cell.final != null ? fmtQty(row.cell.final, decimals) : "—"}
                    </span>
                  </div>
              </>
            </div>

            {/* THE SIZE STRIP — sizes ACROSS, the row named once above it. This is
                what turns 3 colours x 7 sizes from 21 labelled rows into 3. */}
            {row.sizeWise && row.chosen && row.sizes.length > 0 && (
              <div
                data-grid-row
                className="border-t border-dashed border-border px-3 pb-2.5 pt-2"
              >
                <p className="pb-1 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  Per size &mdash; Items · Pcs · Exc %, blank uses the row above
                </p>
                <div className="flex flex-wrap gap-1.5">
                {row.sizes.map((c) => (
                  <div key={c.key} className="w-[8.5rem] shrink-0">
                    <div className="flex justify-between gap-1.5 pb-0.5 text-[11px] text-muted-foreground">
                      <span>{c.sizeLabel}</span>
                      {/* Above the box, not in it: it is what the typed figure is
                          judged against — `approval-qty-lines`' own rule. */}
                      <span className="tabular-nums opacity-75">{fmtQty(c.needs, decimals)}</span>
                    </div>
                    <div className="flex divide-x divide-border rounded border border-border">
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={c.items}
                        placeholder={row.cell.items || linePlaceholder.items}
                        aria-label={`No. of items, ${row.label} ${c.sizeLabel ?? ""}`}
                        onChange={(e) => onSet(c.key, { items: e.target.value })}
                        className={cn(BOX, "min-w-0 flex-1 text-right")}
                      />
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={c.pieces}
                        placeholder={row.cell.pieces || linePlaceholder.pieces}
                        aria-label={`Per pieces, ${row.label} ${c.sizeLabel ?? ""}`}
                        onChange={(e) => onSet(c.key, { pieces: e.target.value })}
                        className={cn(BOX, "min-w-0 flex-1 text-right")}
                      />
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={c.excess}
                        placeholder={row.cell.excess || linePlaceholder.excess}
                        aria-label={`Excess percent, ${row.label} ${c.sizeLabel ?? ""}`}
                        onChange={(e) => onSet(c.key, { excess: e.target.value })}
                        className={cn(BOX, "min-w-0 flex-1 text-right")}
                      />
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        A blank figure uses the line&rsquo;s own. Untick a row to buy none of this material for
        it; tick <b className="font-semibold text-foreground">Size</b> to split that row into
        sizes.
      </p>
    </div>
  );
}
