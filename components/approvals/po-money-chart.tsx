"use client";

import { useState } from "react";
import { GlassRing, LegendRow } from "@/components/orders/budget-breakdown-chart";
import { RingMeter } from "@/components/approvals/approvals-phone-view";
import { Truncated } from "@/components/ui/truncated";
import { fmtFixed } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PoApprovalCard } from "@/lib/approvals/po-approval-cards";

/**
 * A PO IN THE DECISION SHEET, DRAWN THE WAY ITS DESKTOP PAGE DRAWS IT
 * (`purchase/po-approval/po-approval-overview.tsx`): four tiles, the last a ring
 * of how far over budget, then the GLASS RING of where the PO's money goes —
 * the budget page's own `GlassRing` + `LegendRow`, so the phone and the desktop
 * draw alike.
 *
 * The ring splits what the PO card already carries as numbers — goods (taxable)
 * and GST — and nothing it would have to guess. Budget figures appear only when
 * the reader may see them (`overCount` null otherwise, spec point 7); the meter
 * then says "—" rather than drawing a zero.
 */
const TILE = "min-w-0 rounded-xl border border-border bg-surface px-3 py-2";

export function PoMoneyChart({ card: c }: { card: PoApprovalCard }) {
  const [active, setActive] = useState<string | null>(null);
  const known = c.overCount != null && c.overPct != null;
  const over = known && (c.profitHit ?? 0) > 0;
  const money = (v: number) => `${c.currency} ${fmtFixed(v, 2)}`;
  const base = c.taxableValue + c.gstValue;
  const slices = [
    { key: "goods", label: c.lineCount === 1 ? "Goods (1 line)" : `Goods (${c.lineCount} lines)`, amount: c.taxableValue, color: "var(--viz-1)" },
    { key: "gst", label: "GST", amount: c.gstValue, color: "var(--viz-4)" },
  ].filter((s) => s.amount > 0);
  const picked = slices.find((s) => s.key === active);
  const pct = (v: number) => (base > 0 ? (v / base) * 100 : 0);

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2">
        <div className={TILE}>
          <dt className="text-[11px] font-semibold text-muted-foreground">PO value</dt>
          <dd><Truncated text={c.total} className="block text-base font-bold tabular-nums" /></dd>
          <dd className="text-[11px] text-muted-foreground">incl. GST</dd>
        </div>
        <div className={TILE}>
          <dt className="text-[11px] font-semibold text-muted-foreground">Goods</dt>
          <dd><Truncated text={c.taxable} className="block text-base font-bold tabular-nums" /></dd>
          <dd className="text-[11px] text-muted-foreground">{c.lineCount} line{c.lineCount === 1 ? "" : "s"}</dd>
        </div>
        <div className={TILE}>
          <dt className="text-[11px] font-semibold text-muted-foreground">Profit impact</dt>
          <dd className={cn("text-base font-bold tabular-nums", over ? "text-danger" : known ? "text-success" : "text-muted-foreground")}>
            {!known ? "—" : over ? `−₹ ${fmtFixed(c.profitHit ?? 0, 2)}` : "None"}
          </dd>
          <dd className="text-[11px] text-muted-foreground">{!known ? "budget not visible" : "order net profit"}</dd>
        </div>
        <div className={cn(TILE, "flex items-center gap-2")}>
          <RingMeter pct={over ? (c.overPct ?? 0) : known ? 50 : 0} max={50} tone={over ? "danger" : "success"} size={40} />
          <div className="min-w-0">
            <dt className="text-[11px] font-semibold text-muted-foreground">Over budget</dt>
            <dd className={cn("text-base font-bold tabular-nums", !known ? "text-muted-foreground" : over ? "text-danger" : "text-success")}>
              {!known ? "—" : over ? `${fmtFixed(c.overPct ?? 0, 1)}%` : "Within"}
            </dd>
            <dd className="text-[11px] text-muted-foreground">
              {!known ? "no budget figure" : over ? `${c.overCount} line${c.overCount === 1 ? "" : "s"}` : "every budgeted line"}
            </dd>
          </div>
        </div>
      </dl>

      {/* Rupee POs only: `LegendRow` prints its amounts in ₹, and an import PO's
          figures are in its own currency — a "₹" on dollars is a wrong number. */}
      {slices.length > 0 && c.currency === "₹" && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Where the PO money goes</p>
          <div className="flex justify-center">
            <GlassRing
              slices={slices.map((s) => ({ key: s.key, amount: s.amount, color: s.color }))}
              base={base}
              active={active}
              onHover={setActive}
              onPick={(k) => setActive((a) => (a === k ? null : k))}
              className="size-[11rem]"
              centre={
                picked
                  ? { label: picked.label, value: `${fmtFixed(pct(picked.amount), 1)}%`, sub: money(picked.amount) }
                  : { label: "PO value", value: c.total.replace(/\.\d+$/, ""), sub: `${c.lineCount} line${c.lineCount === 1 ? "" : "s"}` }
              }
            />
          </div>
          <ul className="mt-2 space-y-0.5">
            {slices.map((s) => (
              <LegendRow
                key={s.key}
                color={s.color}
                label={s.label}
                pct={pct(s.amount)}
                amount={s.amount}
                maxPct={100}
                lifted={active === s.key}
                dim={!!active && active !== s.key}
                onPick={() => setActive((a) => (a === s.key ? null : s.key))}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
