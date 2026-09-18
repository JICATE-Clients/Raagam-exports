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
 */

import type { ReactNode } from "react";
import { fmtNumber } from "@/lib/format";
import { isRefusal, type GeneralSummary, type Refusal } from "@/lib/orders/budget/totals";
import { cn } from "@/lib/utils";

export function BudgetGeneral({ summary }: { summary: GeneralSummary }) {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl rounded-lg border border-border">
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

      <dl className="max-w-2xl space-y-2">
        {/* THE UNIT IS NAMED on the sales figure — every order is converted to
            INR before it reaches a budget (see the bottom bar's note). */}
        <Highlight label="Gross Sales (INR)" value={summary.sales} />
        <Highlight label="Total Expenses" value={summary.total.amount} />
        <Highlight label="Other Incomes" value={summary.income} />
        <Highlight label="Net Profit" value={summary.profit} strong signed />
        <Highlight label="Margin %" value={summary.marginPct} suffix="%" signed />
        {/* ON SQ QTY — the pieces MADE, the client's own definition, not the
            Order Qty the sales figure is priced on. */}
        <Highlight label="Cost per piece (on SQ Qty)" value={summary.costPerPiece} />
      </dl>
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
        "flex items-baseline gap-4 border-b border-border px-3 py-2 last:border-b-0",
        header && "text-xs font-bold uppercase tracking-wide text-foreground",
        strong && "border-t-2 border-border-strong font-semibold",
      )}
    >
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <span className="w-40 shrink-0 text-right">{amount}</span>
      <span className="w-36 shrink-0 text-right">{pct}</span>
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

function Highlight({
  label,
  value,
  suffix = "",
  strong = false,
  signed = false,
}: {
  label: string;
  value: number | Refusal;
  suffix?: string;
  strong?: boolean;
  signed?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right">
        <Figure value={value} suffix={suffix} strong={strong} signed={signed} />
      </dd>
    </div>
  );
}
