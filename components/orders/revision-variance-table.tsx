"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isRefusal, type Refusal } from "@/lib/orders/budget/totals";
import type { BaselineRow } from "@/lib/orders/budget/amendment";
import type { AmendmentEntryDetail } from "@/lib/orders/order-amendments/service";

/**
 * THE REVISION'S THREE BUDGETS, SIDE BY SIDE — Original (V0), Last (approved
 * just before this revision) and Latest, by cost head, down to the margin.
 *
 * ONE TABLE, TWO READERS (client 2026-09-24): the Revision's own Overview, and
 * the MD's decision sheet on Orders ▸ Budget Approval, directly above the
 * Approve / Reject buttons. It lived inside the entry screen until the MD
 * needed the same figures; a second copy on the approval screen is how the
 * two would start to disagree about what the revision moves.
 */
export type RevisionComparison = Pick<
  AmendmentEntryDetail,
  "baselineKpis" | "currentKpis" | "currentRefusal" | "variance" | "original" | "originalKpis"
>;

type Kind = "amount" | "percent" | "qty";

function fmt(v: number | Refusal, kind: Kind, unit?: string): string {
  if (isRefusal(v)) return `— (${v.refused})`;
  if (kind === "percent") return `${fmtNumber(v)}%`;
  if (kind === "qty") return `${fmtNumber(v)}${unit ? ` ${unit}` : ""}`;
  return fmtMoney(v);
}

/** The matrix's direction column: an arrow and a word, toned by what it means
 *  for the business — more cost is `danger`, more revenue or profit `success`. */
function Direction({ v, kind, good }: { v: number | Refusal; kind: "cost" | "revenue" | "profit" | "qty" | "margin"; good?: "up" | "down" }) {
  if (isRefusal(v)) return <span className="text-xs text-muted-foreground">—</span>;
  if (v === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> No change
      </span>
    );
  }
  const up = v > 0;
  const word =
    kind === "cost" ? (up ? "Cost up" : "Cost down") :
    kind === "revenue" ? (up ? "Revenue up" : "Revenue down") :
    kind === "profit" ? (up ? "Profit up" : "Profit down") :
    kind === "margin" ? (up ? "Margin up" : "ALERT — margin down") :
    up ? "Increase" : "Reduced";
  const favourable = good ? (good === "up") === up : kind === "cost" ? !up : up;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        favourable ? "text-success" : "text-danger",
        kind === "margin" && !up && "uppercase",
      )}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {word}
    </span>
  );
}

export function VarianceTable({ detail, onlyChanged = false }: { detail: RevisionComparison; onlyChanged?: boolean }) {
  const b = detail.baselineKpis;
  const c = detail.currentKpis;
  const unit = b && !isRefusal(b.order_unit) ? b.order_unit : c && !isRefusal(c.order_unit) ? c.order_unit : undefined;

  const delta = (x: number | Refusal | undefined, y: number | Refusal | undefined): number | Refusal => {
    if (x === undefined) return { refused: "No Last Budget recorded" };
    if (y === undefined) return { refused: detail.currentRefusal ?? "The budget's figures could not be read" };
    if (isRefusal(x)) return { refused: `Approved figure unknown — ${x.refused}` };
    if (isRefusal(y)) return { refused: `Current figure unknown — ${y.refused}` };
    return Math.round((y - x) * 100) / 100;
  };

  /* THREE BUDGETS (client 2026-09-24): `orig` is the Original Budget (V0),
     `was` the Last Budget (approved just before this revision), `now` the
     Latest Budget. The variance stays Latest − Last — what THIS revision
     moves; the Original column is there to read the drift since V0 by eye. */
  type Row = { label: string; kind: Kind; dir: "cost" | "revenue" | "profit" | "qty" | "margin"; orig: number | Refusal | undefined; was: number | Refusal | undefined; now: number | Refusal | undefined; strong?: boolean };
  const top: Row[] = [
    { label: "Total order quantity", kind: "qty", dir: "qty", orig: detail.originalKpis?.order_qty, was: b?.order_qty, now: c?.order_qty },
  ];

  const byKey = new Map(detail.variance.map((r) => [r.key, r] as const));
  const costRows: BaselineRow[] = detail.variance.filter(
    (r) => !["total", "sales", "income", "profit", "margin", "cost_per_piece"].includes(r.key),
  );
  const pick = (k: string) => byKey.get(k as BaselineRow["key"]);

  const money = (r: BaselineRow | undefined, label: string, dir: Row["dir"], strong = false): Row => ({
    label,
    kind: r?.kind === "percent" ? "percent" : "amount",
    dir,
    orig: r ? detail.original[r.key] : undefined,
    was: r?.baseline,
    now: r?.current,
    strong,
  });

  const rows: (Row | "rule")[] = [
    ...top,
    "rule",
    money(pick("sales"), "Gross sales value (revenue)", "revenue", true),
    money(pick("income"), "Other incomes", "revenue"),
    "rule",
    ...costRows.map((r) => money(r, r.label, "cost")),
    "rule",
    money(pick("total"), "Total estimated expenses", "cost", true),
    "rule",
    money(pick("profit"), "Net profit amount", "profit", true),
    money(pick("margin"), "Net profit margin %", "margin", true),
    money(pick("cost_per_piece"), "Cost per piece", "cost"),
  ];
  /* ONLY WHAT MOVED (2026-09-23, screenshot 3028: a table of rows all reading
     "No change" buries the one that did). The profit and the margin always
     stay — they are the answer the MD is asked about. */
  const keep = (r: Row) =>
    r.label === "Net profit amount" ||
    r.label === "Net profit margin %" ||
    (() => {
      const d = delta(r.was, r.now);
      return !isRefusal(d) && d !== 0;
    })();
  const shown: (Row | "rule")[] = onlyChanged
    ? rows.filter((r): r is Row => r !== "rule").filter(keep)
    : rows;
  /* S.No counts the figure rows 1, 2, 3 — the rules between groups are not rows. */
  let sno = 0;

  /* ONE RENDERING PER FIGURE, read by both layouts below, so the phone cards
     and the desktop table cannot word the same cell two ways. */
  const figure = (v: number | Refusal | undefined, kind: Kind) => (v === undefined ? "—" : fmt(v, kind, unit));
  const latest = (r: Row) =>
    r.now === undefined ? (
      <span className="text-xs text-muted-foreground" title={detail.currentRefusal ?? undefined}>—</span>
    ) : (
      fmt(r.now, r.kind, unit)
    );
  const diff = (r: Row) => {
    const d = delta(r.was, r.now);
    if (isRefusal(d)) return <span className="text-xs text-muted-foreground" title={d.refused}>—</span>;
    const sign = d > 0 ? "+" : "";
    return `${sign}${fmt(d, r.kind, unit)}`;
  };
  const figureRows = shown.filter((r): r is Row => r !== "rule");

  return (
    <>
      {/*
       * ON A PHONE, A CARD PER COST HEAD (2026-09-24, 390px): seven columns in a
       * 50rem table left the MD looking at S.No, Cost head and a clipped
       * "ORIGINAL BUDG…" — Last, Latest and the variance, the three figures the
       * decision turns on, were all off-screen behind a sideways scroll. Each
       * card leads with Last · Latest · Variance and keeps Original as a muted
       * line beneath, since it is context, not the question.
       */}
      <ol className="space-y-2 md:hidden">
        {figureRows.map((r, i) => (
          <li
            key={r.label}
            className={cn("rounded-md border border-border px-3 py-2 text-sm", r.strong && "font-medium")}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span>
                <span className="mr-1.5 tabular-nums text-xs text-muted-foreground">{i + 1}</span>
                {r.label}
              </span>
              <Direction v={delta(r.was, r.now)} kind={r.dir} />
            </div>
            {/* TWO COLUMNS, NOT THREE: at 360px three lakh figures with paise
                ("₹13,02,000.00") ran into each other. Last · Latest side by
                side, then the variance on its own line beside Original. */}
            <dl className="mt-1.5 grid grid-cols-2 gap-3 text-right tabular-nums">
              <div>
                <dt className="text-[11px] font-normal text-muted-foreground">Last</dt>
                <dd className="whitespace-nowrap">{figure(r.was, r.kind)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-normal text-muted-foreground">Latest</dt>
                <dd className="whitespace-nowrap">{latest(r)}</dd>
              </div>
            </dl>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 tabular-nums">
              <span className="text-xs font-normal text-muted-foreground">Original {figure(r.orig, r.kind)}</span>
              <span className="whitespace-nowrap">
                <span className="mr-1 text-[11px] font-normal text-muted-foreground">Variance</span>
                {diff(r)}
              </span>
            </div>
          </li>
        ))}
      </ol>

    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[50rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="w-12 py-2 pr-3 text-right font-semibold">S.No</th>
            <th className="py-2 pr-3 font-semibold">Cost head</th>
            <th className="py-2 px-3 text-right font-semibold">Original Budget</th>
            <th className="py-2 px-3 text-right font-semibold">Last Budget</th>
            <th className="py-2 px-3 text-right font-semibold">Latest Budget</th>
            <th className="py-2 px-3 text-right font-semibold">Variance</th>
            <th className="py-2 pl-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) =>
            r === "rule" ? (
              <tr key={`rule-${i}`}>
                <td colSpan={7} className="border-t border-border" />
              </tr>
            ) : (
              <tr key={r.label} className={cn("border-b border-border/60", r.strong && "font-medium")}>
                <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{++sno}</td>
                <td className="py-1.5 pr-3">{r.label}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{figure(r.orig, r.kind)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{figure(r.was, r.kind)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{latest(r)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{diff(r)}</td>
                <td className="py-1.5 pl-3"><Direction v={delta(r.was, r.now)} kind={r.dir} /></td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}
