"use client";

import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/format";
import { isRefusal, type Refusal } from "@/lib/orders/material-bom/requirement";
import type { BaselineRow } from "@/lib/orders/budget/amendment";
import type { RevisionCompare } from "@/lib/approvals/revision-compare";

/**
 * LAST APPROVED vs LATEST, ON A PHONE (client 2026-09-24).
 *
 * Two blocks, read top to bottom in one column:
 *
 *  1. PROFIT & LOSS — Sales, Total Cost, Net Profit, Margin %, each as
 *     Last → Latest with the difference. These four always show: they are
 *     the question the MD is being asked, even when nothing moved.
 *  2. COST HEADS THAT MOVED — the General matrix's categories (Yarn, Fabric,
 *     Accessories, Processing, CMT, Other), ONLY where the figure changed. A
 *     list of six "no change" lines buries the one that did (the same rule
 *     the revision page's "only what moved" switch applies, 2026-09-23).
 *
 * The rows are `compareToBaseline`'s, unchanged — nothing here computes a
 * figure. A refused side prints its sentence, never a 0 an MD might approve.
 *
 * TONE BY DIRECTION: a cost going UP is red, a sale, profit or margin going
 * DOWN is red — "+₹70,000" is bad news on Total Cost and good news on Sales,
 * so a sign alone would say the wrong thing half the time.
 */

const SUMMARY: { key: BaselineRow["key"]; label: string; good: "up" | "down" }[] = [
  { key: "sales", label: "Sales value", good: "up" },
  { key: "total", label: "Total cost", good: "down" },
  { key: "profit", label: "Net profit", good: "up" },
  { key: "margin", label: "Profit margin", good: "up" },
];
/** Not cost heads: the summary above, and two figures the phone leaves to the revision page. */
const NOT_COST_HEADS = new Set<BaselineRow["key"]>(["sales", "income", "total", "profit", "margin", "cost_per_piece"]);

function fig(v: number | Refusal, kind: BaselineRow["kind"]) {
  if (isRefusal(v)) return <span className="text-warning">{v.refused}</span>;
  return kind === "percent" ? `${fmtNumber(v)}%` : fmtNumber(v);
}

function Diff({ row, good }: { row: BaselineRow; good: "up" | "down" }) {
  const v = row.variance;
  if (isRefusal(v)) return <span className="text-muted-foreground">—</span>;
  if (v === 0) return <span className="text-muted-foreground">No change</span>;
  const favourable = good === "up" ? v > 0 : v < 0;
  return (
    <span className={cn("font-medium", favourable ? "text-success" : "text-danger")}>
      {v > 0 ? "+" : "−"}
      {row.kind === "percent" ? `${fmtNumber(Math.abs(v))}%` : fmtNumber(Math.abs(v))}
    </span>
  );
}

export function RevisionComparePanel({ state }: { state: RevisionCompare | null }) {
  if (!state) {
    return <p className="text-xs text-muted-foreground">Working out Last vs Latest budget…</p>;
  }
  if (!state.ok) {
    /* Says why, rather than an empty block — a sheet with buttons and no
       figures reads as one that failed to load. */
    return (
      <p className="text-xs text-warning">
        The comparison could not be shown: {state.refused}. Open the revision on a desktop before deciding.
      </p>
    );
  }

  const byKey = new Map(state.rows.map((r) => [r.key, r] as const));
  const moved = state.rows.filter(
    (r) => !NOT_COST_HEADS.has(r.key) && (isRefusal(r.variance) || r.variance !== 0),
  );

  return (
    <div className="space-y-3">
      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Profit &amp; loss impact
        </h3>
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-1 pr-2 text-left font-medium">Metric</th>
              <th className="py-1 px-1 text-right font-medium">Last</th>
              <th className="py-1 px-1 text-right font-medium">Latest</th>
              <th className="py-1 pl-1 text-right font-medium">Diff</th>
            </tr>
          </thead>
          <tbody>
            {SUMMARY.map(({ key, label, good }) => {
              const r = byKey.get(key);
              if (!r) return null;
              return (
                <tr key={key} className={cn("border-b border-border/60", key === "profit" && "font-semibold")}>
                  <td className="py-1.5 pr-2 text-left">{label}</td>
                  <td className="py-1.5 px-1 text-right">{fig(r.baseline, r.kind)}</td>
                  <td className="py-1.5 px-1 text-right">{fig(r.current, r.kind)}</td>
                  <td className="py-1.5 pl-1 text-right">
                    <Diff row={r} good={good} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Cost heads that moved
        </h3>
        {moved.length === 0 ? (
          <p className="text-xs text-muted-foreground">No cost head moved.</p>
        ) : (
          <ul className="space-y-1 text-xs tabular-nums">
            {moved.map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>{r.label}</span>
                <span className="text-right">
                  {fig(r.baseline, r.kind)} → {fig(r.current, r.kind)}{" "}
                  <Diff row={r} good="down" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
