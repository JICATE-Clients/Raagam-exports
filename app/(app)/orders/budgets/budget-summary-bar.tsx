"use client";

/**
 * The budget's bottom line — the legacy budget's Sales and Profit / Loss bar,
 * pinned above the footer on every section (`MasterFullScreen`'s `summary`).
 *
 * It replaced a Summary SECTION, and the move is the point: as a section the
 * figures sat one click away from every rate that changes them, so the operator
 * typed a yarn rate and had to leave the grid to see what it did to the margin.
 *
 * ## CHROME, NOT FIELDS
 *
 * Text only — nothing here is focusable, so Tab never lands on it and the
 * keyboard contract has nothing to say about it. A figure that needs acting on
 * is acted on in the section that owns it.
 *
 * ## A REFUSAL IS PRINTED AS ITS SENTENCE
 *
 * Never blank and never 0. A missing figure and a zero figure must not look
 * alike, and on this document the difference is whether a budget gets approved
 * on a margin nobody could compute. The sentence is the engine's
 * (`budgetTotals` / `salesSummary`), word for word — and it WRAPS inside its
 * cell rather than being clipped to fit the column.
 *
 * ## TWO ROWS, ONE SET OF COLUMNS (Phase 6, 2026-09-18)
 *
 * Each band is a row of cells whose widths are `FIELD_WIDTH` steps, and both
 * bands use the SAME steps in the same order (`COLS`), so Expenses sits under
 * Currency, Profit Value under Avg Price, and the eye reads down a column as
 * well as along a row. Before, each figure was as wide as its own text and the
 * two lines drifted apart after the first cell.
 *
 * ## ONE LINE PER BAND — THE LABEL BESIDE ITS FIGURE, NOT ABOVE IT
 *
 * This strip is PINNED on every section, so every pixel of its height is taken
 * from every tab. Label-over-figure cells doubled it (~36px → ~70px of text);
 * the lead sent it back the same day. Each cell is label (muted, left) and
 * figure (right, tabular) side by side inside its one width step, so the two
 * bands are two lines again. `FigureCell` in `budget-general.tsx` stays
 * label-over-figure: those sections scroll and are not pinned.
 *
 * So a column is sized by its LONGEST label plus a lakh figure beside it, at
 * the strip's 12px ("38,85,638.40" is ~82px of tabular digits):
 *
 *     112              the band's title — "PROFIT / LOSS" at 12px/700 caps
 *   + 144   `code`     Currency / Expenses            ~50 + 6 + 82 = 138
 *   + 176   `term`     Conv / Other Income            ~68 + 6 + 82 = 156
 *   + 176   `term`     Avg Price / Profit Value       ~65 + 6 + 82 = 153
 *   + 176   `term`     Order Qty / Profit %           ~55 + 6 + 80 = 141
 *   + 288   `name`     Gross Sales Value (INR) / the unpriced counts
 *                                                    ~138 + 6 + 82 = 226
 *   + 5 x 12           `FIELD_ROW`'s gap
 *   = 1132
 *
 * A CRORE FIGURE WRAPS, IT IS NEVER CLIPPED: the cell is `flex-wrap`, so a
 * value too long to sit beside its label drops under it inside the same
 * column — rare, honest, and the column stays aligned. A refusal sentence
 * does the same.
 *
 * No cap of its own: `MasterFullScreen` already bounds the strip to the pane's
 * width (1440px), and a row of fixed cells ends where its cells end. Below
 * 1132px it folds, like any `FieldRow`, rather than scrolling sideways.
 */

import type { ReactNode } from "react";
import { FIELD_ROW_TOP, FIELD_WIDTH } from "@/components/ui/field";
import type { FieldWidth } from "@/lib/ui/sizes";
import { fmtNumber } from "@/lib/format";
import {
  isRefusal,
  type BudgetTotals,
  type Refusal,
  type SalesSummary,
} from "@/lib/orders/budget/totals";
import { cn } from "@/lib/utils";

/** The five figure columns, shared by both bands — see the header. */
const COLS = ["code", "term", "term", "term", "name"] as const satisfies readonly FieldWidth[];

export function BudgetSummaryBar({
  totals,
  sales,
}: {
  totals: BudgetTotals;
  sales: SalesSummary;
}) {
  const qty: number | string | Refusal = isRefusal(sales.qty)
    ? sales.qty
    : // THE UNIT RIDES WITH THE QUANTITY. "1,200" over a group that is half
      // pieces and half packs is a number with no meaning, so a refused unit
      // speaks for the pair.
      isRefusal(sales.unit)
      ? sales.unit
      : `${fmtNumber(sales.qty)} ${sales.unit}`;

  return (
    <div className="space-y-1 text-xs">
      <Band title="Sales">
        <Figure w={COLS[0]} label="Currency" value={sales.currency} />
        <Figure w={COLS[1]} label="Conv" value={sales.conv} />
        <Figure w={COLS[2]} label="Avg Price" value={sales.avgPrice} />
        {/* ORDER Qty — what was sold, and what Avg Price divides by. SQ Qty
            (what is made) is a different, larger figure; see the Budget
            section's pair. */}
        <Figure w={COLS[3]} label="Order Qty" value={qty} />
        {/* THE UNIT IS NAMED — each order's value is converted to INR before it
            reaches a budget, and an unlabelled total reads as the buyer's own
            currency to the one person most likely to check it. */}
        <Figure w={COLS[4]} label="Gross Sales Value (INR)" value={totals.sales} strong />
      </Band>
      <Band title="Profit / Loss">
        <Figure w={COLS[0]} label="Expenses" value={totals.cost} />
        <Figure w={COLS[1]} label="Other Income" value={totals.income} />
        <Figure w={COLS[2]} label="Profit Value" value={totals.profit} strong signed />
        <Figure w={COLS[3]} label="Profit %" value={totals.profitPct} suffix="%" signed />
        {/* THE FIFTH COLUMN, under Gross Sales: what the totals could not
            count. Absent when there is nothing to say. */}
        {(totals.unpriced.length > 0 || totals.pending.length > 0) && (
          /* ONE LINE, like the figures: the two counts sit side by side
             (~230px together inside `name`'s 288) and wrap only if they must. */
          <span className={cn(FIELD_WIDTH[COLS[4]], "flex min-w-0 flex-wrap gap-x-3 text-danger")}>
            {totals.unpriced.length > 0 && (
              // NEVER SILENTLY EXCLUDED. A cost total that quietly ignored a
              // half-typed line is smaller, plausible, and about to be approved.
              <span>
                {totals.unpriced.length} {totals.unpriced.length === 1 ? "line" : "lines"} unpriced
              </span>
            )}
            {totals.pending.length > 0 && (
              // PRICED, BUT A PERCENTAGE OF A SALES VALUE NOBODY HAS YET. Said
              // apart from "unpriced": it does not block Save, and the fix is on
              // the ORDER (its price or exchange rate), not on this budget.
              <span>
                {totals.pending.length} {totals.pending.length === 1 ? "line" : "lines"} waiting on sales
              </span>
            )}
          </span>
        )}
      </Band>
    </div>
  );
}

function Band({ title, children }: { title: string; children: ReactNode }) {
  return (
    /* TOP-aligned: a refusal (or a crore) wraps DOWN inside its cell, and the
       rest of the band stays on its one line. */
    <div className={FIELD_ROW_TOP}>
      <span className={cn(FIELD_WIDTH.range, "shrink-0 font-bold uppercase tracking-wide text-foreground")}>
        {title}
      </span>
      {children}
    </div>
  );
}

function Figure({
  w,
  label,
  value,
  suffix = "",
  strong = false,
  signed = false,
}: {
  w: FieldWidth;
  label: string;
  value: number | string | Refusal;
  suffix?: string;
  strong?: boolean;
  /** A negative figure is a LOSS and is coloured as one. */
  signed?: boolean;
}) {
  return (
    <span className={cn(FIELD_WIDTH[w], "flex min-w-0 flex-wrap items-baseline justify-between gap-x-1.5")}>
      <span className="text-muted-foreground">{label}</span>
      {isRefusal(value) ? (
        <span className="min-w-0 break-words text-right text-danger">{value.refused}</span>
      ) : (
        <span
          className={cn(
            "ml-auto text-right tabular-nums",
            strong ? "font-semibold" : "font-medium",
            signed && typeof value === "number" && value < 0 ? "text-danger" : "text-foreground",
          )}
        >
          {typeof value === "number" ? `${fmtNumber(value)}${suffix}` : value}
        </span>
      )}
    </span>
  );
}
