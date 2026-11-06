import Link from "next/link";
import { Truncated } from "@/components/ui/truncated";
import { MOOD_COLOUR } from "@/components/viz/kit";
import { cn } from "@/lib/utils";
import { CELL_MOOD, STEP_LABEL, isReady, type ReadyRow, type StepKey } from "@/lib/overview/planning";
import { relDays } from "@/lib/overview/words";

/**
 * "IS EACH ORDER READY TO BUY?" — the readiness grid (overview plan, new picture).
 *
 * One row per order on the books (buyer first, RE No under it, rule 5), one cell per planning
 * step. A cell is a word, never colour alone: Done (green) · Draft / With the MD (amber) ·
 * Recalculate (red, the order moved under the plan) · Not started (dashed). The row's last
 * column says "Ready" when both plans are done and the budget is approved — the question the
 * page is asking. Rows are ordered by delivery date, so the order shipping soonest is on top.
 */
export function ReadinessGrid({ rows, steps, todayIso }: { rows: ReadyRow[]; steps: StepKey[]; todayIso: string }) {
  if (!rows.length) return <p className="px-3.5 py-3 text-sm text-muted-foreground">No order is on the books.</p>;
  const cols = `minmax(0,13rem) repeat(${steps.length}, minmax(6.5rem,1fr)) 5.5rem`;
  return (
    <div className="overflow-x-auto px-3.5 py-3">
      <div role="table" aria-label="Planning readiness per order" className="min-w-[44rem] space-y-1">
        <div role="row" className="grid items-end gap-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" style={{ gridTemplateColumns: cols }}>
          <span role="columnheader">Order</span>
          {steps.map((k) => (
            <span key={k} role="columnheader">
              {STEP_LABEL[k]}
            </span>
          ))}
          <span role="columnheader" className="text-right">
            To buy
          </span>
        </div>
        {rows.map((r) => {
          const ready = isReady(r);
          return (
            <div key={r.orderId} role="row" className="grid items-center gap-1.5 border-t border-dashed border-border pt-1" style={{ gridTemplateColumns: cols }}>
              <div role="cell" className="min-w-0">
                <Link href={`/orders/garment-orders?open=${r.orderId}`} className="block hover:text-primary hover:underline">
                  <Truncated text={r.buyer} className="block text-[12.5px] font-semibold" />
                </Link>
                <span className="block text-[11px] text-muted-foreground">
                  {r.reNo}
                  {r.deliveryDate ? ` · ships ${relDays(r.deliveryDate, todayIso)}` : ""}
                </span>
              </div>
              {steps.map((k) => {
                const c = r.cells[k];
                const colour = MOOD_COLOUR[CELL_MOOD[c.state]];
                const body = (
                  <span
                    className={cn(
                      "flex h-7 items-center justify-center rounded-md px-1.5 text-[11.5px] font-semibold",
                      c.state === "none" || c.state === "na" ? "border border-dashed border-border-strong text-muted-foreground" : "border",
                    )}
                    style={
                      c.state === "none" || c.state === "na"
                        ? undefined
                        : { borderColor: colour, color: colour, background: `color-mix(in srgb, ${colour} 10%, transparent)`, boxShadow: `0 0 10px -6px ${colour}` }
                    }
                    title={`${STEP_LABEL[k]} · ${c.word}`}
                  >
                    {c.word}
                  </span>
                );
                return (
                  <div role="cell" key={k} className="min-w-0">
                    {c.href ? (
                      <Link href={c.href} className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </div>
                );
              })}
              <div role="cell" className={cn("text-right text-[12px] font-semibold", ready ? "text-success" : "text-muted-foreground")}>
                {ready ? "Ready" : "Not yet"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
