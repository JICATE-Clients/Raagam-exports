"use client";

import { useState } from "react";
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

/**
 * WHERE THE SALES GO — THE GLASS RING (client 2026-09-30: "sophisticated and
 * ultra modern … it should attract"; the glass design approved on the canvas
 * "Glass Approval Chart" the same day).
 *
 * A 176px ring (compacted from 208 the same day, client: "compact the ring a
 * little") on a frosted panel over three soft colour glows, with a frosted
 * disc in the centre carrying the one number an approval turns on — net
 * margin. Below it, one glass row per bucket: a glowing dot, its %, a slim
 * share bar and its amount. Hover or tap a slice or a row and that bucket
 * lifts and glows, the rest recede, and the centre speaks for it; let go and
 * the centre returns to the margin. Slices draw in once (off under reduced
 * motion). Every colour is a token (`--glass-*`, `--viz-*`), so `.dark`
 * restyles the whole panel.
 *
 * It stays honest the same ways the bar did:
 *  - a PART-TO-WHOLE of sales (+ other income) — five marks, the dataviz cap
 *    for a ring read at a glance; every value is ALSO printed in the legend, so
 *    the ring is never the only carrier (three light-mode series colours sit
 *    under 3:1 — globals.css);
 *  - a surface gap between slices (round caps, so the gap allows for them);
 *  - a SUPPRESSED profit leaves its arc as bare track, and the centre says
 *    "Suppressed" instead of a margin nobody can work out;
 *  - a LOSS draws the costs as the whole ring and the centre reads "Net loss"
 *    in the danger colour, in words;
 *  - a refused bucket means the proportions are unknown: no ring, the reason.
 */
type Slice = { key: BreakdownBucketKey | "profit"; label: string; amount: number; pct: Fig };

const R = 80; // ring radius in the 200-unit viewBox
const C = 2 * Math.PI * R;
const STROKE = 20;
/** Round caps overhang each end by half the stroke, so the drawn length gives
 *  back one stroke plus a visible gap. */
const TRIM = STROKE + 6;

/** "₹4.19 L" / "₹1.26 Cr" — the centre has room for a figure, not its paise. */
function compactInr(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return `${sign}${fmtMoney(a)}`;
}

function ShareBar({ b }: { b: BudgetBreakdown }) {
  const [active, setActive] = useState<Slice["key"] | null>(null);

  const blocked: Refusal | null = isRefusal(b.sales)
    ? b.sales
    : (b.buckets.find((x) => isRefusal(x.amount))?.amount as Refusal | undefined) ?? null;

  const loss = typeof b.profit === "number" && b.profit < 0;
  const slices: Slice[] = blocked
    ? []
    : [
        ...b.buckets.map((x) => ({ key: x.key, label: x.label, amount: x.amount as number, pct: x.pct })),
        ...(typeof b.profit === "number" && b.profit > 0
          ? [{ key: "profit" as const, label: "Net Profit", amount: b.profit, pct: b.profitPct }]
          : []),
      ];
  const sales = typeof b.sales === "number" ? b.sales : 0;
  const drawn = slices.reduce((a, s) => a + s.amount, 0);
  // With a profit the slices sum to sales + other income; with a loss (or a
  // suppressed profit) they are the costs alone, measured against sales.
  const base = Math.max(drawn, sales);
  const maxPct = Math.max(1, ...slices.map((s) => (typeof s.pct === "number" ? s.pct : 0)));

  // Arc positions, clockwise from 12 o'clock (the svg is rotated -90°). Each
  // arc starts half a trim in, so its round cap sits inside its own share.
  const arcs: (Slice & { start: number; len: number })[] = [];
  let at = 0;
  for (const s of slices) {
    const len = base > 0 ? (s.amount / base) * C : 0;
    arcs.push({ ...s, start: at + TRIM / 2, len: Math.max(0.1, len - TRIM) });
    at += len;
  }

  const focus = active ? slices.find((s) => s.key === active) : null;
  const money = typeof b.profit === "number" ? compactInr(b.profit) : "";
  const centre = focus
    ? { label: focus.label.split(" ")[0], value: pctText(focus.pct), sub: compactInr(focus.amount), color: COLOR[focus.key], tone: "" }
    : isRefusal(b.profitPct)
      ? { label: "Net margin", value: "—", sub: "Suppressed", color: undefined, tone: "text-warning" }
      : loss
        ? { label: "Net loss", value: pctText(b.profitPct), sub: money, color: undefined, tone: "text-danger" }
        : { label: "Net margin", value: pctText(b.profitPct), sub: money, color: undefined, tone: "" };

  return (
    <div
      className="relative isolate overflow-hidden rounded-[22px]"
      style={{ background: "var(--glass-ground)" }}
    >
      {/* The glows the glass frosts — decorative. */}
      <span aria-hidden className="pointer-events-none absolute -left-16 -top-10 size-60 rounded-full blur-[40px]" style={{ background: "var(--glass-blob-a)" }} />
      <span aria-hidden className="pointer-events-none absolute -right-16 top-40 size-56 rounded-full blur-[44px]" style={{ background: "var(--glass-blob-b)" }} />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 left-10 h-52 w-64 rounded-full blur-[48px]" style={{ background: "var(--glass-blob-c)" }} />

      <div
        className="relative m-3 flex flex-col gap-3.5 rounded-[18px] p-4 backdrop-blur-[22px] backdrop-saturate-[1.7]"
        style={{ background: "var(--glass)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-shadow)" }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Cost breakdown
          </span>
          <span className="text-[11px] text-muted-foreground">% of gross sales</span>
        </div>

        {blocked ? (
          <p className="text-sm text-warning">Breakdown unavailable — {blocked.refused}</p>
        ) : (
          <>
            {/* THE RING — decorative for assistive tech: the legend below
                carries every value as text. */}
            <div className="relative size-[11rem] self-center" onPointerLeave={() => setActive(null)}>
              <svg viewBox="0 0 200 200" className="size-full -rotate-90 overflow-visible" aria-hidden>
                <circle cx="100" cy="100" r={R} fill="none" strokeWidth={STROKE} style={{ stroke: "var(--glass-track)" }} />
                {arcs.map((a) => (
                  <circle
                    key={a.key}
                    cx="100"
                    cy="100"
                    r={R}
                    fill="none"
                    stroke={COLOR[a.key]}
                    strokeWidth={active === a.key ? STROKE + 6 : STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${a.len} ${C}`}
                    strokeDashoffset={-a.start}
                    className="viz-slice cursor-pointer transition-[opacity,stroke-width] duration-200"
                    style={{
                      opacity: active && active !== a.key ? 0.25 : 1,
                      filter: `drop-shadow(0 0 ${active === a.key ? 10 : 4}px ${COLOR[a.key]})`,
                    }}
                    onPointerEnter={() => setActive(a.key)}
                  />
                ))}
              </svg>
              {/* The frosted centre: the margin at rest, the pointed-at bucket otherwise. */}
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 flex size-[6.25rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-center backdrop-blur-md"
                style={{ background: "var(--glass-disc)", border: "1px solid var(--glass-edge)", boxShadow: "var(--glass-disc-shadow)" }}
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {centre.label}
                </span>
                <span
                  className={cn("text-[1.6rem] font-bold leading-[1.1] tracking-tight tabular-nums", centre.tone)}
                  style={centre.color ? { color: centre.color } : undefined}
                >
                  {centre.value}
                </span>
                <span className={cn("text-[11px] tabular-nums text-muted-foreground", centre.tone)}>{centre.sub}</span>
              </div>
            </div>

            {/* THE LEGEND — every value in text, each bucket's share as a slim
                glowing bar on one scale. Pointing at a row lifts its slice. */}
            <ul className="grid gap-1.5">
              {b.buckets.map((x) => (
                <LegendRow
                  key={x.key}
                  color={COLOR[x.key]}
                  label={x.label}
                  pct={x.pct}
                  amount={x.amount}
                  maxPct={maxPct}
                  lifted={active === x.key}
                  dim={!!active && active !== x.key}
                  onPoint={(on) => setActive(on ? x.key : null)}
                />
              ))}
              <LegendRow
                color={COLOR.profit}
                label={loss ? "Net Loss" : "Net Profit"}
                pct={b.profitPct}
                amount={b.profit}
                maxPct={maxPct}
                danger={loss}
                lifted={active === "profit"}
                dim={!!active && active !== "profit"}
                onPoint={(on) => setActive(on && !loss ? "profit" : null)}
              />
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function LegendRow({
  color,
  label,
  pct,
  amount,
  maxPct,
  danger = false,
  lifted = false,
  dim = false,
  onPoint,
}: {
  color: string;
  label: string;
  pct: Fig;
  amount: Fig;
  maxPct: number;
  danger?: boolean;
  lifted?: boolean;
  dim?: boolean;
  onPoint?: (on: boolean) => void;
}) {
  const refused = isRefusal(amount) ? amount.refused : isRefusal(pct) ? pct.refused : null;
  const width = typeof pct === "number" && pct > 0 ? `${Math.min(100, (pct / maxPct) * 100)}%` : "0%";
  return (
    <li
      className={cn(
        "grid cursor-default grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 rounded-xl px-2.5 py-[7px] transition-[opacity,background] duration-200",
        dim && "opacity-45",
      )}
      style={{ background: lifted ? "var(--glass-strong)" : "var(--glass-row)", border: "1px solid var(--glass-edge)" }}
      onPointerEnter={() => onPoint?.(true)}
      onPointerLeave={() => onPoint?.(false)}
    >
      <span className="size-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} aria-hidden />
      <Truncated className={cn("text-[13px] font-medium", danger && "font-semibold text-danger")}>
        {danger ? `▼ ${label}` : label}
      </Truncated>
      {refused ? (
        <span className="text-right text-xs text-warning">{refused}</span>
      ) : (
        <span className={cn("text-right text-[13px] font-bold tabular-nums", danger && "text-danger")}>
          {pctText(pct)}
        </span>
      )}
      {!refused && (
        <>
          <span aria-hidden />
          <span className="h-1 overflow-hidden rounded-full" style={{ background: "var(--glass-track)" }} aria-hidden>
            <span
              className="viz-grow block h-full rounded-full"
              style={{ width, background: color, boxShadow: `0 0 6px ${color}` }}
            />
          </span>
          <span className="text-right text-[11px] tabular-nums text-muted-foreground">{moneyText(amount)}</span>
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
