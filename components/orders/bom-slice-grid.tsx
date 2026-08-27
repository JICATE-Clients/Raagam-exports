"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
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
   *
   * ALL THREE ARE NULLABLE, and `calc` and `needs` became so on 2026-08-26.
   * They were `number`, and the caller coerced a REFUSAL to 0 to satisfy that —
   * so an unanswered row printed `0`, `0` as though somebody had computed them.
   * Null is the honest value and `fmtQty` already renders it as an em dash.
   */
  calc: number | null;
  needs: number | null;
  final: number | null;
  items: string;
  pieces: string;
  /** The wastage buffer for this row (0450) - legacy's per-sub-row Allowance %. */
  excess: string;
  /**
   * WHY THIS CELL HAS NO FIGURES, verbatim from `sliceRequirement`, or null when
   * it has them. Three dashes on their own read as "nothing needed"; the
   * sentence is what turns them into "not answered yet, and here is what is
   * missing". Rendered as a `title` rather than as text — the grid has no room
   * for a sentence per row and `qtyRibbon` already prints one below it.
   */
  refusal: string | null;
  /**
   * WHETHER THIS BOX IS THE ONE THAT MUST BE ANSWERED — derived from the SAME
   * `consumptionChain` call the caption's refusal-to-close reads, so the red
   * star, the cursor hold and the closed-section refusal cannot disagree.
   *
   * CONDITIONAL, NEVER ALWAYS. A blank box whose value the LINE already supplies
   * is not unfilled — `linePlaceholder` shows what it will use — so an
   * unconditional `required` would hold the cursor on a correctly-empty box and
   * cage the operator on a row that is finished.
   */
  itemsRequired: boolean;
  piecesRequired: boolean;
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
  /**
   * WHY THIS ROW CANNOT SPLIT ITSELF BY SIZE, or null when it can.
   *
   * A REASON AND NOT A BOOLEAN, because the box's `disabled` and its own tooltip
   * are one fact and there is now more than one cause: an order carrying no size
   * break-up, and an Attribute the requirement cannot store a per-row tick
   * against. A boolean beside a hard-coded sentence made the second cause read as
   * the first.
   */
  sizeWiseWhyNot: string | null;
  /**
   * THE GROUP THIS ROW OPENS, or null when it continues the one above.
   *
   * Set on the FIRST row of each combination run. Null on every row when the
   * grid has only one axis value — there the combination is the row's own
   * identity column and a band naming it would repeat the row beneath it.
   */
  groupHead: BomSliceGroup | null;
  /** WHICH GROUP HIDES THIS ROW. Null in identity mode, where nothing folds. */
  groupKey: string | null;
}

/**
 * THE BAND ABOVE A RUN OF ROWS SHARING ONE COMBINATION.
 *
 * `crossCombinations` is name-major, so the runs are already consecutive — this
 * is a scan of the rows, never a regroup, and `check-bom-slices` asserts that
 * rather than trusting it.
 */
export interface BomSliceGroup {
  key: string;
  name: string;
  rows: number;
  /** How many of its rows still need a figure. THE NUMBER THAT MAKES A WALL
   *  NAVIGABLE — "21 of 21 unanswered" says where to go and work. */
  unanswered: number;
  /** The group's own + Exc roll-up, NULL while any chosen row is unanswered —
   *  a partial sum of a half-typed group is a figure somebody would act on. */
  needs: number | null;
  /*
   * `whyNotClose` WAS HERE AND IS GONE (2026-08-27). It disabled the chevron
   * while the run held an unanswered required cell. The accordion replaced it —
   * see the band's own note for why the "N of M unanswered" count on a shut band
   * is what satisfies the rule it was citing.
   *
   * Deleted rather than left unread: a field the grid no longer consults is the
   * same half-state as a header `*` with no hold behind it, and the next reader
   * would reasonably assume something still enforced it.
   */
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

/* `COLS_COMBO` WENT WITH THE COLUMN IT SIZED (2026-08-26). The combination is
   a GROUP HEADING or the row's own identity now, and neither needs a track —
   so the reason that constant existed (Tailwind emits only the literals it can
   see) is why there is ONE track list again rather than a computed one. */

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
  finalDecimals,
  finalUnit,
  openGroup,
  onToggleGroup,
}: {
  caption: ReactNode;
  axisHead: string;
  /**
   * WHICH GROUP IS OPEN — one name, or null for none (client 2026-08-27: "add
   * that automatic collapse option, now it's totally open ... open the first
   * section, close the second one").
   *
   * THE ACCORDION IS IN THE TYPE, and that is the whole reason this replaced a
   * `shutGroups` SET. A set can hold "TOP and BOTTOM are both shut", so it can
   * equally hold "both open" — the one-at-a-time rule would then live in whoever
   * writes to it, and every future writer would have to know. One name cannot
   * express two open groups, so the invariant cannot be broken by a caller.
   *
   * It also reverses the old comment's reasoning deliberately. The shut set was
   * chosen so "a combination added later arrives OPEN rather than hidden behind
   * a set nobody updated" — sound for a multi-open fold, and wrong here: under an
   * accordion a new combination arriving open is a SECOND open group. It now
   * arrives closed, with its own band and its own "N of M unanswered" count
   * visible, which is the thing that made it safe to hide (see the band below).
   *
   * `approval-qty-lines.tsx` still uses the set shape and is untouched — it is a
   * different component on a different screen and multi-open is correct there.
   */
  openGroup?: string | null;
  onToggleGroup?: (groupKey: string) => void;
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
  /**
   * `decimal_places_allowed` of the PURCHASE unit, where the line names a pack.
   *
   * THE FINAL COLUMN IS NOT IN THE SAME UNIT AS THE TWO BESIDE IT. Calc and
   * + Exc are what the row CONSUMES; Final is what is BOUGHT, because the MOQ
   * and the rounding step that produced it are properties of the purchase
   * (0451). Absent means the line names no pack and all three share `decimals`,
   * which is every row written before this.
   */
  finalDecimals?: number | null;
  /** The purchase unit's name, appended to the Final heading. Null on a line
   *  with no pack, where the heading is already unambiguous. */
  finalUnit?: string | null;
}) {
  if (rows.length === 0) return null;

  /* IT ONLY DISPLAYS AFTER VALUES ARE GIVEN (client 2026-08-24: "that
     combination is only display after give that value not static field").
     Read off the ROWS rather than passed in as a flag, so the column cannot be
     shown with nothing in it or hidden with something in it — the two states a
     separate prop would let drift apart. */
  /*
   * ## TWO SHAPES, AND WHICH ONE IS A PROPERTY OF THE ROWS
   *
   * An axis constant across the WHOLE grid belongs in the caption; an axis
   * constant across a RUN belongs in a band above that run. Combinations are
   * one or the other and never a column, because a column is what made eleven
   * rows read identically: it was the narrowest track in the grid, in the
   * weakest colour, clipped by an END ellipsis — so names differing in their
   * last token rendered the same. They are provably distinct (the Combination
   * sheet blocks a duplicate), so widening could never have been the fix.
   *
   * IDENTITY MODE — one axis value, so the axis is in the caption and the
   * combination IS the row's name, at the width the axis column had. This is
   * the reported case (client 2026-08-26, screenshot 2505: eleven rows all
   * reading "TEST 2"), and it costs no height at all.
   *
   * GROUPED MODE — many axis values, so each combination gets a band naming it
   * once, with its own count, roll-up and fold.
   */
  const identityMode = rows.length > 0 && rows.every((r) => !!(r.combination ?? "").trim())
    && new Set(rows.map((r) => r.label)).size === 1;
  const grouped = rows.some((r) => r.groupHead);
  const cols = COLS;

  /*
   * ONE SPOKEN NAME FOR EVERY CONTROL ON A ROW.
   *
   * Seven call sites each built their own from `row.label` and every one of them
   * omitted the combination — so a screen reader heard "Include
   * STL/26-27/0007" eleven times over eleven different panels. One function is
   * what stops the eighth from doing it again; it also drops the trailing space
   * the size strip emitted when `sizeLabel` was null.
   */
  const nameOf = (row: BomSliceRow, sizeLabel?: string | null) =>
    [row.label, row.combination, sizeLabel].filter((x) => !!x && String(x).trim()).join(", ");

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
          {/* ONE IDENTITY COLUMN, NOT TWO. In identity mode it names the
              combination and the caption carries the axis; otherwise it names
              the axis and the bands carry the combination. */}
          <div className={cn("flex min-h-8 items-center px-2", T_LABEL)}>
            {identityMode ? "Combination" : axisHead}
          </div>
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
          {/* THE UNIT IS IN THE HEADING BECAUSE THE COLUMN CHANGED UNITS. Three
              figures in a row, the last one in cones and the first two in
              metres, with one unlabelled heading over all three, is how a
              converted quantity gets read as a consumption quantity. */}
          <div className={cn("flex min-h-8 items-center justify-end px-2", T_LABEL)}>
            {finalUnit ? `Final (${finalUnit})` : "Final"}
          </div>
        </div>

        {rows.map((row) => {
          /* A ROW IS HIDDEN BY ITS GROUP, NEVER BY ITSELF — and a band is never
             hidden by its own group, or a shut group would have no way back. */
          const shut = !row.groupHead && !!row.groupKey && row.groupKey !== openGroup;
          return (
          <div key={row.key} className="border-b border-border last:border-b-0">
            {/*
              THE BAND — a combination named ONCE above its run, and the grid's
              first real separator. `crossCombinations` is name-major so the runs
              are already consecutive; this emits, never reorders.

              IT IS A `data-grid-row` CARRYING A `data-row-open` CHEVRON, because
              `ROW_FIELDS` counts that marker — without it an entire group's fold
              would be mouse-only, which is the exact defect the marker exists
              for. Accepted cost, stated: the band has one field, so ↓ down a
              column of Items boxes lands on the chevron before the next group's
              ✓. `focusColIn` declines rather than dead-ends, so no key is lost.

              THE COUNT IS THE POINT. "21 of 21 unanswered" says where to go and
              work; a bare name over a wall says only that the wall is sorted.
            */}
            {row.groupHead && (
              <div
                data-grid-row
                className="flex items-center gap-2 border-t-2 border-border-strong bg-surface-muted px-3 py-1.5 first:border-t-0"
              >
                {/*
                  AN UNANSWERED GROUP CAN NOW BE CLOSED, and dropping that guard
                  is what makes the accordion exist at all.

                  It used to be `disabled` while the run held an unanswered
                  required cell, reasoning that "hiding a required blank is a
                  record that cannot be saved with nothing on screen to say why"
                  — AGENTS.md's mandatory-field rule, correctly cited. But on a
                  NEW BOM every group is unanswered, so every chevron was dead:
                  the screen the client photographed (2026-08-27) could not fold
                  one single band. A guard that only lets you tidy up what you
                  have already finished is off exactly when tidying is the point.

                  WHAT MAKES IT SAFE IS THE BAND ITSELF, which is why this is a
                  narrowing rather than a waiver. The rule forbids hiding a blank
                  with NOTHING ON SCREEN TO SAY WHY — and a shut group still
                  renders its own "21 of 21 unanswered" in warning colour, one
                  line up. The count is not hidden with the rows; it is the one
                  thing a shut band exists to keep saying. Under an accordion
                  that reads BETTER than before: the operator sees every group's
                  outstanding count at a glance instead of scrolling a wall to
                  find out. Save is still gated by the same figures.

                  `aria-expanded` is now the accordion's own answer, so a screen
                  reader is told what the chevron shows.
                */}
                <button
                  type="button"
                  data-row-open
                  onClick={() => onToggleGroup?.(row.groupHead!.key)}
                  aria-expanded={row.groupHead.key === openGroup}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground"
                >
                  {row.groupHead.key !== openGroup ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{row.groupHead.name}</span>
                </button>
                <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
                  {row.groupHead.unanswered > 0 ? (
                    <span className="text-warning">
                      {row.groupHead.unanswered} of {row.groupHead.rows} unanswered
                    </span>
                  ) : (
                    <span>all {row.groupHead.rows} answered</span>
                  )}
                  {/* NULL WHILE ANY CHOSEN ROW IS UNANSWERED — a partial sum of a
                      half-typed group is a figure somebody would act on. */}
                  <span className="tabular-nums font-medium text-info">
                    {fmtQty(row.groupHead.needs, decimals)}
                  </span>
                </span>
              </div>
            )}
            {/* A SHUT GROUP RENDERS ITS BAND AND NOTHING ELSE — never `hidden`.
                A hidden field is still in the DOM, so Tab and the required-holds
                would both visit a box the operator cannot see. Same call the
                caption makes one level up, for the same reason. */}
            {!shut && (
            <div
              data-grid-row
              className={cn("grid", cols, !row.chosen && "opacity-45")}
            >
              <div className="flex min-h-9 items-center justify-center">
                <input
                  type="checkbox"
                  checked={row.chosen}
                  aria-label={`Include ${nameOf(row)}`}
                  onChange={(e) => onFlag(row.key, { chosen: e.target.checked })}
                  className={TICK}
                />
              </div>
              {/* THE ROW'S NAME, at full width and in full-strength text.
                  In identity mode this is the COMBINATION — the thing that used
                  to sit in a 96px muted track and clip its own distinguishing
                  suffix, so eleven distinct panels rendered as eleven copies of
                  one string. Here it has the width the axis column had. */}
              <div className="flex min-h-9 items-center px-2">
                <Truncated className="text-[13px] font-medium text-foreground">
                  {identityMode ? (row.combination ?? "").trim() : row.label}
                </Truncated>
              </div>
              <div className="flex min-h-9 items-center justify-center border-l border-border">
                <input
                  type="checkbox"
                  checked={row.sizeWise}
                  disabled={!row.chosen || !!row.sizeWiseWhyNot}
                  aria-label={`Split ${row.label} by size`}
                  /* THE REASON COMES FROM THE CALLER, and it used to be one
                     hard-coded sentence beside a boolean. There is more than one
                     cause now — an order with no size break-up, and an Attribute
                     the requirement cannot store a per-row tick against — and a
                     fixed sentence made the second read as the first, sending the
                     operator to the Assort tab to fix nothing. */
                  title={row.sizeWiseWhyNot ?? undefined}
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
                  aria-label={`Specification, ${nameOf(row)}`}
                  onChange={(e) => onFlag(row.key, { specification: e.target.value })}
                  className={cn(BOX, "w-full")}
                />
              </div>
              <div className="flex min-h-9 items-center border-l border-border">
                <Input
                  uppercase
                  value={row.sizeSpec}
                  aria-label={`Material size, ${nameOf(row)}`}
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
                        required={row.cell.itemsRequired}
                      placeholder={linePlaceholder.items}
                      aria-label={`No. of items, ${nameOf(row)}`}
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
                        required={row.cell.piecesRequired}
                      placeholder={linePlaceholder.pieces}
                      aria-label={`Per pieces, ${nameOf(row)}`}
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
                      aria-label={`Excess percent, ${nameOf(row)}`}
                      onChange={(e) => onSet(row.cell.key, { excess: e.target.value })}
                      className={cn(BOX, "w-full text-right")}
                    />
                  </div>
                  <div className="flex min-h-9 items-center justify-end border-l border-border px-2">
                    <span className="tabular-nums text-[12.5px] text-muted-foreground">
                      {row.chosen ? fmtQty(row.cell.calc, decimals) : "—"}
                    </span>
                  </div>
                  {/* THE SENTENCE ON THE LOUDEST CELL. Three dashes read as
                      "nothing needed"; `title` turns them into "not answered
                      yet, and here is what is missing" without spending a row on
                      a sentence `qtyRibbon` already prints in full below. */}
                  <div
                    className="flex min-h-9 items-center justify-end border-l border-border bg-info-soft/40 px-2"
                    title={row.chosen ? (row.cell.refusal ?? undefined) : undefined}
                  >
                    <span className="tabular-nums text-[12.5px] font-medium text-info">
                      {row.chosen ? fmtQty(row.cell.needs, decimals) : "—"}
                    </span>
                  </div>
                  {/* THE FIGURE A PURCHASE ORDER IS WRITTEN FROM, so it is the
                      loudest cell on the row — the same weight the line's own
                      Final Quantity carries. */}
                  <div className="flex min-h-9 items-center justify-end border-l border-border bg-accent-soft/50 px-2">
                    <span className="tabular-nums text-[12.5px] font-semibold text-accent">
                      {row.chosen && row.cell.final != null
                        ? fmtQty(row.cell.final, finalDecimals ?? decimals)
                        : "—"}
                    </span>
                  </div>
              </>
            </div>
            )}

            {/* THE SIZE STRIP — sizes ACROSS, the row named once above it. This is
                what turns 3 colours x 7 sizes from 21 labelled rows into 3. */}
            {!shut && row.sizeWise && row.chosen && row.sizes.length > 0 && (
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
                          judged against — `approval-qty-lines`' own rule.

                          NOTHING WHERE THERE IS NO FIGURE, and this is the one
                          place the blank rule beats the dash rule: an annotation
                          has no column to keep aligned, so fourteen dashes in a
                          strip are noise where fourteen blanks are silence. It
                          printed a bare `0` until 2026-08-26 — the caller
                          coerced a refusal to zero and nothing here guarded it. */}
                      <span className="tabular-nums opacity-75">
                        {c.needs == null ? "" : fmtQty(c.needs, decimals)}
                      </span>
                    </div>
                    <div className="flex divide-x divide-border rounded border border-border">
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={c.items}
                        required={c.itemsRequired}
                        placeholder={row.cell.items || linePlaceholder.items}
                        aria-label={`No. of items, ${nameOf(row, c.sizeLabel)}`}
                        onChange={(e) => onSet(c.key, { items: e.target.value })}
                        className={cn(BOX, "min-w-0 flex-1 text-right")}
                      />
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={c.pieces}
                        required={c.piecesRequired}
                        placeholder={row.cell.pieces || linePlaceholder.pieces}
                        aria-label={`Per pieces, ${nameOf(row, c.sizeLabel)}`}
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
          );
        })}
      </div>

      <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        A blank figure uses the line&rsquo;s own. Untick a row to buy none of this material for
        it; tick <b className="font-semibold text-foreground">Size</b> to split that row into
        sizes.
      </p>
    </div>
  );
}
