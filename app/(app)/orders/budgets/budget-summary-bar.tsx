"use client";

/**
 * The budget's bottom line — the legacy budget's Sales and Profit / Loss bar,
 * pinned above the footer on every section (`MasterFullScreen`'s `summary`).
 *
 * It replaced a Summary SECTION, and the move is the point: as a section the
 * figures sat one click away from every rate that changes them, so the operator
 * typed a yarn rate and had to leave the grid to see what it did to the margin.
 *
 * ## REDESIGNED 2026-09-19 — FOUR PASSES IN ONE EVENING, keep all four in mind
 *
 *   1. Screenshot 2961: "the footer area is too important but look too small …
 *      I need all the footer fields without missing fields". It was two lines
 *      of 12px grey text, label BESIDE figure.
 *   2. Framed panels with the title on its own line above: 15px values, 18px
 *      leads — "too small".
 *   3. 18px bold / 22px extra-bold, 2px borders — "much bigger".
 *   4. 16px / 20px ("medium") — then "more compacted with better colouring and
 *      better design layout … better visibility is important".
 *
 * WHAT THIS IS (pass 4): the SIZE stays at medium, and the height comes out of
 * the LAYOUT instead of the type — which is where the first three passes went
 * wrong, trading readability against height when the title line and the gaps
 * were the real cost.
 *
 *   - ONE ROW PER GROUP. Each group opens with a small solid TAG (icon + name)
 *     rather than a title line above it: −16px of height, same meaning.
 *   - DIVIDED CELLS, not gaps. Fields sit edge to edge with a hairline between
 *     them, so the eye reads a strip, not scattered numbers.
 *   - COLOUR THAT MEANS SOMETHING, never decoration:
 *       Sales          brand blue — tinted strip, solid tag, Gross Sales in blue;
 *       Profit / Loss  green for a profit, red for a loss, grey while it cannot
 *                      be worked out — the tag's icon turns with it
 *                      (TrendingUp / TrendingDown);
 *       counts         red for unpriced lines, amber for lines waiting on sales.
 *   - EVERY FIELD IS KEPT, label ABOVE figure: Currency, Conv, Avg Price,
 *     Order Qty, Gross Sales Value (INR); Expenses, Profit Value, Profit %.
 *     (Other Income left with its tab — client, 2026-09-19.)
 *
 * ~60px high. Widths are `FIELD_WIDTH` steps, so a figure does not move
 * sideways as its digits change: Sales 72 + 72 + 88 + 112 + 176 = 520 + 5 cells
 * x 24 + tag ~76 ≈ 716; Profit / Loss 144 + 176 + 88 = 408 + 72 + ~96 ≈ 576;
 * chips ~180 — ≈ 1470 with gaps, so on the 1440 bar the chips take a second
 * line only when BOTH are showing; narrower, whole groups fold under. Never a
 * sideways scroll.
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
 * cell rather than being clipped. A NEW budget with no order yet shows a muted
 * dash instead (`isNoOrdersYet`): empty, not wrong.
 */

import type { ReactNode } from "react";
import { AlertTriangle, Clock3, IndianRupee, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { FIELD_WIDTH } from "@/components/ui/field";
import type { FieldWidth } from "@/lib/ui/sizes";
import { fmtNumber } from "@/lib/format";
import {
  isNoOrdersYet,
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

  /** The profit group's tone: its sign, or none while it cannot be worked out. */
  const profitTone: GroupTone =
    typeof totals.profit === "number" ? (totals.profit < 0 ? "loss" : "profit") : "none";
  const ProfitIcon = profitTone === "loss" ? TrendingDown : profitTone === "profit" ? TrendingUp : Scale;

  return (
    <div className="flex flex-wrap items-stretch gap-2.5">
      <Group title="Sales" tone="sales" icon={<IndianRupee className="h-3.5 w-3.5" aria-hidden />}>
        <Figure w="num" label="Currency" value={sales.currency} />
        <Figure w="num" label="Conv" value={sales.conv} />
        <Figure w="hug" label="Avg Price" value={sales.avgPrice} />
        {/* ORDER Qty — what was sold, and what Avg Price divides by. SQ Qty
            (what is made) is a different, larger figure; see the Budget
            section's pair. */}
        <Figure w="range" label="Order Qty" value={qty} />
        {/* THE UNIT IS NAMED — each order's value is converted to INR before it
            reaches a budget, and an unlabelled total reads as the buyer's own
            currency to the one person most likely to check it. */}
        <Figure w="term" label="Gross Sales Value (INR)" value={totals.sales} lead accent="primary" />
      </Group>

      <Group title="Profit / Loss" tone={profitTone} icon={<ProfitIcon className="h-3.5 w-3.5" aria-hidden />}>
        <Figure w="code" label="Expenses" value={totals.cost} />
        <Figure w="term" label="Profit Value" value={totals.profit} lead signed />
        <Figure w="hug" label="Profit %" value={totals.profitPct} suffix="%" lead signed />
      </Group>

      {(totals.unpriced.length > 0 || totals.pending.length > 0) && (
        <div className="flex flex-col justify-center gap-1.5">
          {totals.unpriced.length > 0 && (
            // NEVER SILENTLY EXCLUDED. A cost total that quietly ignored a
            // half-typed line is smaller, plausible, and about to be approved.
            <Chip tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}>
              {totals.unpriced.length} {totals.unpriced.length === 1 ? "line" : "lines"} unpriced
            </Chip>
          )}
          {totals.pending.length > 0 && (
            // PRICED, BUT A PERCENTAGE OF A SALES VALUE NOBODY HAS YET. Said
            // apart from "unpriced": it does not block Save, and the fix is on
            // the ORDER (its price or exchange rate), not on this budget.
            <Chip tone="warning" icon={<Clock3 className="h-3.5 w-3.5" aria-hidden />}>
              {totals.pending.length} {totals.pending.length === 1 ? "line" : "lines"} waiting on sales
            </Chip>
          )}
        </div>
      )}
    </div>
  );
}

type GroupTone = "sales" | "profit" | "loss" | "none";

/** Each group's strip, divider and tag — one row, so the tones stay in step. */
const GROUP_TONE: Record<GroupTone, { strip: string; tag: string }> = {
  sales: { strip: "border-primary/30 bg-primary/5 divide-primary/20", tag: "bg-primary text-primary-foreground" },
  profit: { strip: "border-success/40 bg-success-soft divide-success/25", tag: "bg-success text-white" },
  loss: { strip: "border-danger/40 bg-danger-soft divide-danger/25", tag: "bg-danger text-white" },
  none: { strip: "border-border bg-surface divide-border", tag: "bg-surface-muted text-foreground" },
};

/** One group: a solid tag, then its fields edge to edge with a hairline between. */
function Group({
  title,
  tone,
  icon,
  children,
}: {
  title: string;
  tone: GroupTone;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-wrap items-center divide-x overflow-hidden rounded-lg border",
        GROUP_TONE[tone].strip,
      )}
    >
      {/* THE TAG — the group's name where a title line used to sit above. */}
      <h3
        className={cn(
          "m-1.5 mr-0 inline-flex shrink-0 items-center gap-1 self-stretch rounded-md border-0 px-2 text-[11px] font-bold uppercase tracking-wide",
          GROUP_TONE[tone].tag,
        )}
      >
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Figure({
  w,
  label,
  value,
  suffix = "",
  lead = false,
  signed = false,
  accent,
}: {
  w: FieldWidth;
  label: string;
  value: number | string | Refusal;
  suffix?: string;
  /** One of the figures the budget exists for — drawn larger and bold. */
  lead?: boolean;
  /** A negative figure is a LOSS and is coloured as one; a positive one, a gain. */
  signed?: boolean;
  /** An unsigned lead figure's colour — Gross Sales takes the brand blue. */
  accent?: "primary";
}) {
  return (
    // `box-content` so the step is the TEXT's width and the 12px each side is
    // added to it, rather than eating into a width chosen for the figure.
    <div className={cn(FIELD_WIDTH[w], "box-content flex min-w-0 flex-col self-stretch justify-center px-3 py-1.5")}>
      {/* Every label fits its step ("Gross Sales Value (INR)" is ~140px in
          `term`'s 176), so nothing is clipped and nothing needs revealing. */}
      <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{label}</span>
      {isNoOrdersYet(value) ? (
        // A NEW BUDGET IS EMPTY, NOT WRONG — a muted dash, not the sentence in
        // red on every cell. General says why, once.
        <span className="text-base font-semibold text-muted-foreground">—</span>
      ) : isRefusal(value) ? (
        <span className="break-words text-xs font-semibold leading-snug text-danger">{value.refused}</span>
      ) : (
        <span
          className={cn(
            "tabular-nums leading-tight",
            lead ? "text-xl font-bold" : "text-base font-semibold",
            signed && typeof value === "number"
              ? value < 0
                ? "text-danger"
                : "text-success"
              : accent === "primary"
                ? "text-primary"
                : "text-foreground",
          )}
        >
          {typeof value === "number" ? `${fmtNumber(value)}${suffix}` : value}
        </span>
      )}
    </div>
  );
}

const CHIP_TONE = {
  danger: "border-danger/40 bg-danger-soft text-danger",
  warning: "border-warning/40 bg-warning-soft text-warning",
} as const;

function Chip({
  tone,
  icon,
  children,
}: {
  tone: keyof typeof CHIP_TONE;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold",
        CHIP_TONE[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}
