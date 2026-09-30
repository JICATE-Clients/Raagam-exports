"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { Truncated } from "@/components/ui/truncated";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isRefusal, type Refusal } from "@/lib/orders/budget/totals";
import type { BreakdownBucketKey, BudgetBreakdown } from "@/lib/orders/budget/breakdown";

/**
 * WHERE EACH RUPEE OF SALES GOES — the approval chart (client 2026-09-29,
 * "Budget Chart in Approval View"). Drawn on the MD's phone decision sheet
 * (`/approvals`) and in the desktop approval sheet's Figures section
 * (`/orders/budget-approval`), from one `BudgetBreakdown` each, so the two
 * cannot disagree.
 *
 * TWO PICTURES, BOTH READ AS TEXT TOO:
 *  - one 100% stacked bar — Fabric · Process · Trims & Accessories · CMT &
 *    Overheads · Net Profit — with a legend row per bucket carrying its % of
 *    sales and its amount. The legend is not decoration: three of the five
 *    colours sit under 3:1 on the light surface (the palette note in
 *    globals.css), so the values MUST be printed beside the marks.
 *  - on a revised budget, V0 (the original approval) against now, one row per
 *    bucket: the original as a grey bar, now in the bucket's colour, and the
 *    move in points ("41.2% → 44.0% ▲2.8"). One hue per row, so the second
 *    version needs no second palette.
 *
 * A FIGURE THE BUDGET REFUSES IS SAID, NEVER DRAWN AS 0. Profit is
 * suppressed while any line is unrated (client 2026-09-21): the cost buckets
 * still draw, the profit row says "Suppressed — N rates missing", and the
 * bar's unfilled track is the part nobody can yet account for. A bucket that
 * refuses (a pending percent line) means the proportions are unknown, so no
 * bar is drawn at all — only the reason. A LOSS draws the costs past the sales
 * mark and says "Loss" in words beside the danger colour, never colour alone.
 */
const COLOR: Record<BreakdownBucketKey | "profit", string> = {
  fabric: "var(--viz-1)",
  process: "var(--viz-2)",
  trims: "var(--viz-3)",
  cmt_overheads: "var(--viz-4)",
  profit: "var(--viz-5)",
};

type Fig = number | Refusal;

const pctText = (f: Fig) => (isRefusal(f) ? "—" : `${f.toFixed(1)}%`);
const moneyText = (f: Fig) => (isRefusal(f) ? f.refused : fmtMoney(f));

export function BudgetBreakdownChart({
  current,
  original = null,
  compare = true,
  className,
}: {
  current: BudgetBreakdown;
  /** V0 — omit for a budget that has never been revised. */
  original?: BudgetBreakdown | null;
  /** `false` draws the share bar only — for a surface that shows V0 its own
   *  way (the approval card's per-piece variance table). */
  compare?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <ShareBar b={current} />
      {compare && original && <VersionCompare original={original} current={current} />}
    </div>
  );
}

function ShareBar({ b }: { b: BudgetBreakdown }) {
  const blocked: Refusal | null = isRefusal(b.sales)
    ? b.sales
    : (b.buckets.find((x) => isRefusal(x.amount))?.amount as Refusal | undefined) ?? null;

  const segments: { key: BreakdownBucketKey | "profit"; label: string; amount: number; pct: Fig }[] = blocked
    ? []
    : [
        ...b.buckets.map((x) => ({ key: x.key, label: x.label, amount: x.amount as number, pct: x.pct })),
        ...(typeof b.profit === "number" && b.profit > 0
          ? [{ key: "profit" as const, label: "Net Profit", amount: b.profit, pct: b.profitPct }]
          : []),
      ];
  const sales = typeof b.sales === "number" ? b.sales : 0;
  const drawn = segments.reduce((a, s) => a + s.amount, 0);
  // With a profit the segments sum to sales + other income; with a loss (or a
  // suppressed profit) they are the costs alone, measured against sales.
  const base = Math.max(drawn, sales);
  const loss = typeof b.profit === "number" && b.profit < 0;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Cost breakdown
        </span>
        <span className="text-[11px] text-muted-foreground">% of gross sales</span>
      </div>

      {blocked ? (
        <p className="text-sm text-warning">Breakdown unavailable — {blocked.refused}</p>
      ) : (
        base > 0 && (
          <div className="relative" aria-hidden>
            {/* The track shows through wherever nothing is drawn — the part of
                sales a suppressed profit leaves unaccounted for. The 2px gap
                between segments is the surface, per the mark spec. */}
            <div className="flex h-3.5 gap-[2px] overflow-hidden rounded-[4px] bg-surface-muted">
              {segments.map((s) => (
                <div
                  key={s.key}
                  className="h-full min-w-[2px]"
                  style={{ width: `${(s.amount / base) * 100}%`, background: COLOR[s.key] }}
                >
                  <Tooltip
                    label={`${s.label} · ${pctText(s.pct)} · ${fmtMoney(s.amount)}`}
                    touch
                    className="block h-full w-full"
                  >
                    <span className="block h-full w-full" />
                  </Tooltip>
                </div>
              ))}
            </div>
            {loss && sales > 0 && (
              /* Where sales end: everything drawn past this tick is the loss. */
              <div
                className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground"
                style={{ left: `calc(${(sales / base) * 100}% - 1px)` }}
              />
            )}
          </div>
        )
      )}

      <ul className="grid gap-1 text-sm">
        {b.buckets.map((x) => (
          <LegendRow key={x.key} color={COLOR[x.key]} label={x.label} pct={x.pct} amount={x.amount} />
        ))}
        <LegendRow
          color={COLOR.profit}
          label={loss ? "Net Loss" : "Net Profit"}
          pct={b.profitPct}
          amount={b.profit}
          danger={loss}
        />
      </ul>
    </div>
  );
}

function LegendRow({
  color,
  label,
  pct,
  amount,
  danger = false,
}: {
  color: string;
  label: string;
  pct: Fig;
  amount: Fig;
  danger?: boolean;
}) {
  const refused = isRefusal(amount) ? amount.refused : isRefusal(pct) ? pct.refused : null;
  return (
    <li className="grid grid-cols-[0.625rem_minmax(0,1fr)_auto_auto] items-center gap-x-2">
      <span className="size-2.5 rounded-[3px]" style={{ background: color }} aria-hidden />
      <Truncated className={cn(danger && "font-semibold text-danger")}>
        {danger ? `▼ ${label}` : label}
      </Truncated>
      {refused ? (
        <span className="col-span-2 text-right text-xs text-warning">{refused}</span>
      ) : (
        <>
          <span className={cn("text-right font-semibold tabular-nums", danger && "text-danger")}>
            {pctText(pct)}
          </span>
          <span className="min-w-[6.5rem] text-right text-xs tabular-nums text-muted-foreground">
            {moneyText(amount)}
          </span>
        </>
      )}
    </li>
  );
}

function VersionCompare({ original, current }: { original: BudgetBreakdown; current: BudgetBreakdown }) {
  const rows = [
    ...current.buckets.map((c) => ({
      key: c.key as BreakdownBucketKey | "profit",
      label: c.label,
      was: original.buckets.find((o) => o.key === c.key)?.pct ?? ({ refused: "Not recorded" } as Refusal),
      now: c.pct,
    })),
    { key: "profit" as const, label: "Net Profit", was: original.profitPct, now: current.profitPct },
  ];
  const max = Math.max(
    1,
    ...rows.flatMap((r) => [r.was, r.now]).map((f) => (typeof f === "number" ? f : 0)),
  );
  const w = (f: Fig) => (typeof f === "number" && f > 0 ? `${(f / max) * 100}%` : "0%");

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Original (V0) → Now
        </span>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-muted-foreground/50" aria-hidden /> V0
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-foreground" aria-hidden /> Now
          </span>
        </span>
      </div>
      <ul className="grid gap-2">
        {rows.map((r) => {
          const delta =
            typeof r.was === "number" && typeof r.now === "number" ? Math.round((r.now - r.was) * 10) / 10 : null;
          return (
            <li key={r.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-x-2">
              <Truncated className="text-sm">{r.label}</Truncated>
              <span className="grid gap-[3px]" aria-hidden>
                <span className="h-1.5 rounded-full bg-muted-foreground/50" style={{ width: w(r.was) }} />
                <span className="h-1.5 rounded-full" style={{ width: w(r.now), background: COLOR[r.key] }} />
              </span>
              <span className="whitespace-nowrap text-right text-xs tabular-nums">
                <span className="text-muted-foreground">{pctText(r.was)}</span>
                {" → "}
                <span className="font-semibold">{pctText(r.now)}</span>
                {delta != null && (
                  <span className="ml-1 text-muted-foreground">
                    {delta > 0 ? "▲" : delta < 0 ? "▼" : "="}
                    {delta !== 0 ? Math.abs(delta).toFixed(1) : ""}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
