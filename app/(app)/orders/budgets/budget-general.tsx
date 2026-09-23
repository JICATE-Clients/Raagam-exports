"use client";

/**
 * Budget ▸ General — the last rail section: where the money goes, by category,
 * against what the orders sell for; then the bottom line.
 *
 * READ-ONLY. Every figure is `generalSummary()`'s — the same `budgetTotals` the
 * bottom bar reads — so this page and the bar can never tell two stories. It
 * holds no fields, so nothing here is a Tab stop.
 *
 * ## A REFUSAL IS ITS SENTENCE
 *
 * A category whose lines include one waiting on a sales value does not print a
 * smaller total beside a plausible percentage; it prints the reason. The SQL
 * view the blueprint proposed would have part-summed exactly there.
 *
 * ## NOT A TABLE
 *
 * Three short columns of text, drawn as rows of fixed tracks rather than a
 * `<table>` or a `grid-cols-*` (raagam-screen-layout: a screen composes, it
 * does not draw). There is nothing to sort, page or select, so `DataTable`
 * would only add chrome — and a Created column this matrix has no row for.
 *
 * ## THE TRACKS ARE THE SEVEN WIDTHS (Phase 6, 2026-09-18)
 *
 * Every column is a `FIELD_WIDTH` step sized by the KIND of value, never a
 * literal — see `COL` below — and every box that holds them is capped at the
 * sum of its own tracks, so the figures sit beside their labels instead of
 * three hundred pixels across an empty card.
 */

import type { ReactNode } from "react";
import { FIELD_WIDTH } from "@/components/ui/field";
import type { FieldWidth } from "@/lib/ui/sizes";
import { fmtNumber } from "@/lib/format";
import {
  isNoOrdersYet,
  isRefusal,
  type GeneralSummary,
  type Refusal,
} from "@/lib/orders/budget/totals";
import type { BaselineRow } from "@/lib/orders/budget/amendment";
import { cn } from "@/lib/utils";

/**
 * THE MATRIX'S THREE TRACKS, and the baseline table's too.
 *
 *  - `label` `term` (176): the longest category is "Total Budget Expenses",
 *    ~158px at 14px/600 — a two-to-three-word enum, which is that step.
 *  - `amount` `code` (144): an INR amount in the lakhs-and-crores grouping,
 *    "1,23,45,678.90" is 14 characters, ~118px of tabular figures. `range`
 *    (112) clips a crore; `code` clears it with room for the sign.
 *  - `pct` `hug` (88): "-12.34%" is seven characters. The header "% of Gross
 *    Sales" is longer than any value and wraps to two lines, which is why the
 *    header row aligns on its bottom edge.
 *
 * A REFUSAL IN A CELL WRAPS, it never clips: the sentence is the figure.
 */
const COL = { label: "term", amount: "code", pct: "hug" } satisfies Record<string, FieldWidth>;

/**
 * THE MATRIX'S CAP — the sum of its tracks, not the pane.
 *
 *     176 + 144 + 88   the three tracks
 *   + 2 x 16           `gap-4` between them
 *   + 2 x 12           the row's `px-3`
 *   + 2 x 1            the border
 *   = 466  ->  30rem (480), 14px of slack
 *
 * A DEFINITE LENGTH, NEVER `max-w-fit`: a content-sized cap resolves to 0
 * under any `@container` ancestor (the Vendor master's bug).
 */
const MATRIX_W = "max-w-[30rem]";

/**
 * THE BASELINE TABLE'S CAP — the same tracks, three figure columns.
 *
 *     176 + 3 x 144    label + Approved baseline / Current / Variance
 *   + 3 x 16           `gap-4`
 *   + 2 x 12 + 2 x 1   `px-3` and the border
 *   = 682  ->  44rem (704), 22px of slack
 */
const BASELINE_W = "max-w-[44rem]";

/**
 * THE HIGHLIGHTS' CAP. One wrapping row of TILES (user 2026-09-20: "this area
 * also need some highlighted good visibility", then "make it compacted, no
 * need this much bigger" — so the tint and the bold carry it, at 16px, not
 * the size). Each figure's step plus the tile's 12px padding each side and
 * 1px border:
 *
 *     3 x (144 + 26)   Gross Sales, Total Expenses, Net Profit
 *   + 88 + 26          Margin %
 *   + 176 + 26         "Cost per piece (on Cut Qty)" — its label is the width
 *   + 4 x 10           the row's gap
 *   = 866  ->  55rem (880), 14px of slack
 *
 * It fixes WHERE the row folds, so a laptop and a 1920 monitor break it in the
 * same place. (Other Incomes left with its tab, 2026-09-19.)
 */
const HIGHLIGHTS_W = "max-w-[55rem]";

export function BudgetGeneral({
  summary,
  baseline,
}: {
  summary: GeneralSummary;
  /** Approved baseline vs current (`compareToBaseline`) — present once the
   *  budget has been reopened under the Amendment Protocol, null before. */
  baseline?: readonly BaselineRow[] | null;
}) {
  return (
    <div className="space-y-6">
      {/* A NEW BUDGET IS EMPTY, NOT WRONG. With no orders every percentage and
          sales figure refuses for the same reason; it is said once, here, in
          muted text, and each cell shows a dash — not fifteen red copies of one
          sentence that read as errors on a screen nobody has touched yet. */}
      {isNoOrdersYet(summary.sales) && (
        <p className="text-sm text-muted-foreground">
          Add orders in the Orders section to see sales, percentages and profit.
        </p>
      )}
      <div className={cn(MATRIX_W, "rounded-lg border border-border")}>
        <Row header label="Category" amount="Amount (INR)" pct="% of Gross Sales" />
        {summary.rows.map((r) => (
          <Row
            key={r.key}
            label={r.label}
            amount={<Figure value={r.amount} />}
            pct={<Figure value={r.pctOfSales} suffix="%" />}
          />
        ))}
        <Row
          strong
          label="Total Budget Expenses"
          amount={<Figure value={summary.total.amount} strong />}
          pct={<Figure value={summary.total.pctOfSales} suffix="%" strong />}
        />
      </div>

      {/* THE BOTTOM LINE, AS TILES — the same colour language as the pinned
          Sales / Profit bar (budget-summary-bar.tsx), so the two read as one:
          Gross Sales in the brand blue, Net Profit and Margin green for a
          profit and red for a loss, the rest on white. NOT `FigureCell`, which
          the approval sheet shares and keeps as plain cells. */}
      <dl className={cn("flex flex-wrap items-stretch gap-2.5", HIGHLIGHTS_W)}>
        {/* THE UNIT IS NAMED on the sales figure — every order is converted to
            INR before it reaches a budget (see the bottom bar's note). */}
        <HighlightTile w="code" tone="sales" label="Gross Sales (INR)" value={summary.sales} />
        <HighlightTile w="code" tone="plain" label="Total Expenses" value={summary.total.amount} />
        <HighlightTile w="code" tone={signTone(summary.profit)} label="Net Profit" value={summary.profit} />
        <HighlightTile w="hug" tone={signTone(summary.profit)} label="Margin %" value={summary.marginPct} suffix="%" />
        {/* ON CUT QTY — the pieces MADE, the client's own definition, not the
            Order Qty the sales figure is priced on. */}
        <HighlightTile w="term" tone="plain" label="Cost per piece (on Cut Qty)" value={summary.costPerPiece} />
      </dl>

      {baseline && baseline.length > 0 && (
        /* WHAT THE AMENDMENT CHANGED — the figures the approver signed off,
           beside today's, and the difference. The approver re-approving a
           reopened budget is approving the VARIANCE as much as the total, so
           it is spelled out rather than left for them to subtract. */
        <div className={cn(BASELINE_W, "rounded-lg border border-border")}>
          <BaselineHeader />
          {baseline.map((r) => (
            <div
              key={r.key}
              className={cn(
                "flex items-baseline gap-4 border-b border-border px-3 py-2 last:border-b-0",
                r.key === "total" && "border-t-2 border-border-strong font-semibold",
              )}
            >
              <span className={cn(FIELD_WIDTH[COL.label], "shrink-0 text-sm")}>{r.label}</span>
              {[r.baseline, r.current, r.variance].map((v, i) => (
                <span key={i} className={cn(FIELD_WIDTH[COL.amount], "shrink-0 text-right")}>
                  <Figure
                    value={v}
                    suffix={r.kind === "percent" ? "%" : ""}
                    signed={i === 2}
                  />
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  amount,
  pct,
  header = false,
  strong = false,
}: {
  label: string;
  amount: ReactNode;
  pct: ReactNode;
  header?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-4 border-b border-border px-3 py-2 last:border-b-0",
        // The header's "% of Gross Sales" wraps inside `hug`, so it aligns on
        // its bottom edge; the figure rows keep the baseline.
        header ? "items-end" : "items-baseline",
        header && "text-xs font-bold uppercase tracking-wide text-foreground",
        strong && "border-t-2 border-border-strong font-semibold",
      )}
    >
      <span className={cn(FIELD_WIDTH[COL.label], "shrink-0 text-sm")}>{label}</span>
      <span className={cn(FIELD_WIDTH[COL.amount], "shrink-0 text-right")}>{amount}</span>
      <span className={cn(FIELD_WIDTH[COL.pct], "shrink-0 text-right")}>{pct}</span>
    </div>
  );
}

function Figure({
  value,
  suffix = "",
  strong = false,
  signed = false,
}: {
  value: number | Refusal;
  suffix?: string;
  strong?: boolean;
  signed?: boolean;
}) {
  // No orders yet: nothing is wrong, there is just nothing to compute.
  if (isNoOrdersYet(value)) return <span className="text-sm text-muted-foreground">—</span>;
  if (isRefusal(value)) return <span className="text-xs text-danger">{value.refused}</span>;
  return (
    <span
      className={cn(
        "tabular-nums text-sm",
        strong && "font-semibold",
        signed && value < 0 ? "text-danger" : "text-foreground",
      )}
    >
      {fmtNumber(value)}
      {suffix}
    </span>
  );
}

/**
 * ONE FIGURE AS A WIDTH-LAID CELL — its label above, the figure below, the
 * cell exactly one `FIELD_WIDTH` step wide. Meant for a `<dl>` carrying
 * `FIELD_ROW`, so a row of them wraps like a row of fields and lines up with
 * one. Exported because the approval sheet shows the same figures and must
 * lay them out the same way.
 *
 * `value` may be TEXT (an RE No, a date) as well as a figure. A refusal
 * prints its sentence and WRAPS inside the cell — never clipped, never 0.
 */
export function FigureCell({
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
  signed?: boolean;
}) {
  return (
    <div className={cn(FIELD_WIDTH[w], "min-w-0")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">
        {typeof value === "string" ? (
          <span className="text-sm text-foreground">{value || "—"}</span>
        ) : (
          <Figure value={value} suffix={suffix} strong={strong} signed={signed} />
        )}
      </dd>
    </div>
  );
}

export type TileTone = "sales" | "profit" | "loss" | "plain";

/** A profit figure's tone: its sign, or plain while it cannot be worked out. */
export const signTone = (v: number | Refusal): TileTone =>
  typeof v === "number" ? (v < 0 ? "loss" : "profit") : "plain";

const TILE_TONE: Record<TileTone, { box: string; value: string }> = {
  sales: { box: "border-primary/30 bg-primary/5", value: "text-primary" },
  profit: { box: "border-success/40 bg-success-soft", value: "text-success" },
  loss: { box: "border-danger/40 bg-danger-soft", value: "text-danger" },
  plain: { box: "border-border bg-surface", value: "text-foreground" },
};

/** One highlight: label above, the figure large and bold, the tile tinted by
 *  what the figure means. A refusal prints its sentence; no order yet, a dash.
 *  Exported for the approval sheet, which shows the same bottom line and must
 *  read the same way (2026-09-20). */
export function HighlightTile({
  w,
  tone,
  label,
  value,
  suffix = "",
}: {
  w: FieldWidth;
  tone: TileTone;
  label: string;
  value: number | Refusal;
  suffix?: string;
}) {
  return (
    <div className={cn("flex flex-col rounded-md border px-3 py-1.5", TILE_TONE[tone].box)}>
      {/* `FIELD_WIDTH` on the INNER box, so the step is the figure's width and
          the padding is added to it rather than taken out of it. */}
      <dt className={cn(FIELD_WIDTH[w], "text-xs font-medium text-muted-foreground")}>{label}</dt>
      <dd className={cn(FIELD_WIDTH[w], "break-words")}>
        {isNoOrdersYet(value) ? (
          <span className="text-base font-bold text-muted-foreground">—</span>
        ) : isRefusal(value) ? (
          <span className="text-xs font-semibold text-danger">{value.refused}</span>
        ) : (
          <span className={cn("text-base font-bold tabular-nums", TILE_TONE[tone].value)}>
            {fmtNumber(value)}
            {suffix}
          </span>
        )}
      </dd>
    </div>
  );
}

function BaselineHeader() {
  return (
    <div className="flex items-end gap-4 border-b border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-foreground">
      <span className={cn(FIELD_WIDTH[COL.label], "shrink-0")}>Compared with approval</span>
      <span className={cn(FIELD_WIDTH[COL.amount], "shrink-0 text-right")}>Approved baseline</span>
      <span className={cn(FIELD_WIDTH[COL.amount], "shrink-0 text-right")}>Current</span>
      <span className={cn(FIELD_WIDTH[COL.amount], "shrink-0 text-right")}>Variance</span>
    </div>
  );
}
