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
 *       counts         red banner naming unrated lines, amber for lines
 *                      waiting on sales.
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
 *
 * ## THE SUPPRESSION BANNER (client 2026-09-21)
 *
 * While any line is unrated, `budgetTotals` refuses the profit and the margin
 * outright — no partial figure — and hands back `unratedNotice`, the sentence
 * naming the lines ("2 process rates missing: SINGLE JERSEY · DYEING, … .
 * Profit calculation suppressed."). That sentence is too long for a 176px
 * cell, so the two profit cells print a SHORT refusal and the whole sentence
 * is a full-width red banner under the strip, replacing the old "N lines
 * unpriced" chip (which counted without naming, and stood beside a green
 * margin it should have cancelled).
 *
 * THE BANNER BECAME A STATUS LINE (2026-09-22, screenshots 2998 / 2999). On
 * a real order the sentence ran six lines — 22 yarn names with their
 * compositions — and took ~150px from the grid it was about; nobody found
 * the 23rd line from it. The line now says the COUNT, by section ("39 rates
 * missing — Purchases 22 · Processes 16 · CMT & other 1"), and carries two
 * controls: **Next missing**, which puts the cursor on the next unpriced
 * line's own box (across tabs and sections), and **Which lines?**, which
 * opens the full list — one entry per line, each a link to its box — so the
 * naming the old banner did is still there, on request. The engine's
 * sentence is unchanged and still what a blocked Save says.
 *
 * The list is a plain positioned panel, NOT a dialog: it has no `role`
 * that `lib/reload-guard.ts`'s DOM scan would read as a modal (a bubble of
 * links must never hold the silent auto-update), and it closes on Escape
 * from inside it, on picking a line, or on its own ✕.
 */

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, Clock3, IndianRupee, Scale, TrendingDown, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { FIELD_WIDTH } from "@/components/ui/field";
import type { FieldWidth } from "@/lib/ui/sizes";
import { fmtNumber } from "@/lib/format";
import {
  isNoOrdersYet,
  isRefusal,
  suppressedRefusal,
  type BudgetTotals,
  type Refusal,
  type SalesSummary,
  type UnratedPart,
} from "@/lib/orders/budget/totals";
import { cn } from "@/lib/utils";

/** The unpriced lines as the status line needs them — see the header. */
export type UnratedStatus = {
  total: number;
  parts: UnratedPart[];
  /** One entry per unpriced line, in the order Next missing walks them. */
  lines: { key: string; label: string; go: () => void }[];
  /** Put the cursor on the next unpriced line after the one holding it. */
  onNext: () => void;
};

export function BudgetSummaryBar({
  totals,
  sales,
  unrated,
}: {
  totals: BudgetTotals;
  sales: SalesSummary;
  unrated?: UnratedStatus;
}) {
  const [listOpen, setListOpen] = useState(false);
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
        <Figure w="term" label="Profit Value" value={suppressedRefusal(totals.profit, totals)} lead signed />
        <Figure w="hug" label="Profit %" value={suppressedRefusal(totals.profitPct, totals)} suffix="%" lead signed />
      </Group>

      {totals.unratedNotice && (
        // NEVER SILENTLY EXCLUDED, AND NEVER PART-SUMMED. One line: the
        // count by section (see the header), a way to the next line, and the
        // engine's naming sentence behind "Which lines?". Without `unrated`
        // (a caller with no cursor to steer) the sentence prints as before.
        <div
          role="status"
          className="relative flex basis-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-danger/40 bg-danger-soft px-3 py-1 text-[13px] font-semibold leading-snug text-danger"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {unrated ? (
            <>
              <span>
                {unrated.total} {unrated.total === 1 ? "rate" : "rates"} missing
                {unrated.parts.length > 0 && (
                  <span className="font-medium">
                    {" — "}
                    {unrated.parts.map((p) => `${p.label} ${p.count}`).join(" · ")}
                  </span>
                )}
                . Profit suppressed until every line is rated.
              </span>
              <span className="grow" />
              <button
                type="button"
                className="text-[12.5px] font-medium underline underline-offset-2 hover:text-danger/80"
                aria-expanded={listOpen}
                onClick={() => setListOpen((o) => !o)}
              >
                Which lines?
              </button>
              {/* `size="sm"` — this is the summary bar, not a header row
                  (toolbar-size: exempt -- a status line inside the pinned summary bar, sized to its 13px text). */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 border-danger/50 text-danger hover:bg-danger/10"
                onClick={unrated.onNext}
              >
                Next missing
                <ArrowDown className="ml-1 h-3.5 w-3.5" aria-hidden />
              </Button>
              {listOpen && (
                <div
                  className="absolute bottom-full right-0 z-20 mb-1 max-h-72 w-[26rem] max-w-[90vw] overflow-y-auto rounded-md border border-border bg-surface p-2 text-foreground shadow-lg"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setListOpen(false);
                    }
                  }}
                >
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {unrated.total} unpriced {unrated.total === 1 ? "line" : "lines"}
                    </span>
                    <button
                      type="button"
                      aria-label="Close"
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setListOpen(false)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  <ul className="divide-y divide-border">
                    {unrated.lines.map((l) => (
                      <li key={l.key}>
                        <button
                          type="button"
                          className="block w-full px-1 py-1 text-left text-[13px] font-normal hover:bg-surface-muted"
                          onClick={() => {
                            setListOpen(false);
                            l.go();
                          }}
                        >
                          <Truncated>{l.label}</Truncated>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <span>{totals.unratedNotice}</span>
          )}
        </div>
      )}
      {totals.pending.length > 0 && (
        // PRICED, BUT A PERCENTAGE OF A SALES VALUE NOBODY HAS YET. Said
        // apart from "unrated": it does not block Save, and the fix is on
        // the ORDER (its price or exchange rate), not on this budget.
        <div className="flex flex-col justify-center">
          <Chip tone="warning" icon={<Clock3 className="h-3.5 w-3.5" aria-hidden />}>
            {totals.pending.length} {totals.pending.length === 1 ? "line" : "lines"} waiting on sales
          </Chip>
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
