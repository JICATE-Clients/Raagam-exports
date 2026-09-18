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
 * (`budgetTotals` / `salesSummary`), word for word.
 */

import type { ReactNode } from "react";
import { fmtNumber } from "@/lib/format";
import {
  isRefusal,
  type BudgetTotals,
  type Refusal,
  type SalesSummary,
} from "@/lib/orders/budget/totals";
import { cn } from "@/lib/utils";

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
        <Figure label="Currency" value={sales.currency} />
        <Figure label="Conv" value={sales.conv} />
        <Figure label="Avg Price" value={sales.avgPrice} />
        {/* ORDER Qty — what was sold, and what Avg Price divides by. SQ Qty
            (what is made) is a different, larger figure; see the Budget
            section's pair. */}
        <Figure label="Order Qty" value={qty} />
        {/* THE UNIT IS NAMED — each order's value is converted to INR before it
            reaches a budget, and an unlabelled total reads as the buyer's own
            currency to the one person most likely to check it. */}
        <Figure label="Gross Sales Value (INR)" value={totals.sales} strong />
      </Band>
      <Band title="Profit / Loss">
        <Figure label="Expenses" value={totals.cost} />
        <Figure label="Other Income" value={totals.income} />
        <Figure label="Profit Value" value={totals.profit} strong signed />
        <Figure label="Profit %" value={totals.profitPct} suffix="%" signed />
        {totals.unpriced.length > 0 && (
          // NEVER SILENTLY EXCLUDED. A cost total that quietly ignored a
          // half-typed line is smaller, plausible, and about to be approved.
          <span className="text-danger">
            {totals.unpriced.length} {totals.unpriced.length === 1 ? "line" : "lines"} unpriced
          </span>
        )}
        {totals.pending.length > 0 && (
          // PRICED, BUT A PERCENTAGE OF A SALES VALUE NOBODY HAS YET. Said
          // apart from "unpriced": it does not block Save, and the fix is on
          // the ORDER (its price or exchange rate), not on this budget.
          <span className="text-danger">
            {totals.pending.length} {totals.pending.length === 1 ? "line" : "lines"} waiting on sales
          </span>
        )}
      </Band>
    </div>
  );
}

function Band({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-0.5">
      <span className="w-24 shrink-0 font-bold uppercase tracking-wide text-foreground">
        {title}
      </span>
      {children}
    </div>
  );
}

function Figure({
  label,
  value,
  suffix = "",
  strong = false,
  signed = false,
}: {
  label: string;
  value: number | string | Refusal;
  suffix?: string;
  strong?: boolean;
  /** A negative figure is a LOSS and is coloured as one. */
  signed?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      {isRefusal(value) ? (
        <span className="text-danger">{value.refused}</span>
      ) : (
        <span
          className={cn(
            "tabular-nums",
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
