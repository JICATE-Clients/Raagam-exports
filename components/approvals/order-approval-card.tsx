"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { OrderFullDataSheet } from "@/components/approvals/order-full-data-sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { BudgetBreakdownChart } from "@/components/orders/budget-breakdown-chart";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isRefusal, type Refusal } from "@/lib/orders/budget/totals";
import {
  MARGIN_TARGET_PCT,
  perPiece,
  varianceRows,
  type VarianceRow,
} from "@/lib/orders/budget/breakdown";
import type { OrderApprovalCard as Card } from "@/lib/approvals/order-approval-cards";

/**
 * THE MD'S APPROVAL CARD (client 2026-09-29, "MD Approval Screen in Mobile
 * View") — one order, everything needed to decide it, and the decision.
 *
 * Top to bottom, the wireframe's order:
 *   1. the ORDER: RE No and its version (V0 for a first budget, the REV entry
 *      and Rev #n for a revision), customer, style, quantity, earliest ship
 *      date, merchandiser, and who submitted it how long ago;
 *   2. where the sales go (`BudgetBreakdownChart`, share bar only) and the net
 *      margin against the 15% line, with its value per piece;
 *   3. on a revision, V0 against the proposal PER PIECE SOLD, row by row;
 *   4. the decision — `actions` (the caller's `ApprovalActionBar rework`) and
 *      "View full sheet".
 *
 * Everything is read off one `OrderApprovalCard` from `loadOrderApprovalCards`
 * — the figures AS SUBMITTED. The card computes nothing but per-piece division.
 *
 * ## TIME IS A PROP
 *
 * "Waiting 10 min" comes from the caller (the queue row's `waiting_hours`,
 * answered in SQL). A card that read `Date.now()` in render would be refused by
 * the React Compiler and would take the phone's clock as the truth.
 *
 * ## NO NUMBER IS A ZERO IT DOES NOT KNOW
 *
 * A refusal prints its reason, in the value's place — an MD must never approve
 * a "₹0.00/pc" that was really "no order quantity".
 */
export function OrderApprovalCard({
  card,
  waited,
  overdue = false,
  actions,
  onOpenSheet,
  className,
}: {
  card: Card;
  /** "10 min", "3h", "2d 4h" — how long it has waited, from the queue row. */
  waited?: string | null;
  overdue?: boolean;
  /** The decision controls — `ApprovalActionBar` with `rework compact`. */
  actions?: ReactNode;
  /** "View full sheet" — the revision detail and the whole P&L. */
  onOpenSheet?: () => void;
  className?: string;
}) {
  const bd = card.breakdown;
  const rev = card.revision;
  /* "VIEW FULL ORDER DATA" (client 2026-09-30): the budget block opens the
     order's own reports, read-only (`OrderFullDataSheet`). Keyed on the RE's
     sales order — one budget is one order in practice. */
  const [fullOpen, setFullOpen] = useState(false);
  const salesOrderId = card.salesOrderIds[0] ?? null;
  const openFull = salesOrderId ? () => setFullOpen(true) : undefined;

  return (
    <article
      className={cn("space-y-3 rounded-lg border border-border bg-surface p-3.5 shadow-sm", className)}
      aria-label={`Approval — ${card.reNos.join(", ") || `budget ${card.budgetCode ?? ""}`}`}
    >
      {/* 1. THE ORDER */}
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold">
            {card.reNos.join(", ") || `Budget ${card.budgetCode ?? ""}`}
          </div>
          {card.customer && <Truncated className="text-sm font-medium">{card.customer}</Truncated>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill tone="info">
            {rev ? `${rev.entryNo ?? "Revision"}${rev.revNo ? ` · Rev #${rev.revNo}` : ""}` : "V0 · First budget"}
          </StatusPill>
          {overdue && <StatusPill tone="danger">Overdue</StatusPill>}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md bg-surface-muted p-2.5 text-xs">
        <Fact label="Style" value={card.styles} span />
        <Fact label="Qty" value={qtyText(card.orderQty, card.orderUnit)} />
        <Fact label="Earliest ship" value={card.earliestShipment ? fmtDate(card.earliestShipment) : null} />
        <Fact label="Merchandiser" value={card.merchandiser} span />
      </dl>
      <p className="text-xs text-muted-foreground">
        Submitted{card.submittedBy ? ` by ${card.submittedBy}` : ""}
        {waited ? ` · waiting ${waited}` : card.submittedAt ? ` · ${fmtDate(card.submittedAt)}` : ""}
      </p>

      {/* 2. WHERE THE SALES GO, AND THE MARGIN — the whole block opens the
          full order data (spec: "clicking anywhere on the Itemized Budget &
          Profit Margin card"). The click is on the container for the pointer;
          the real <button> at its foot is the keyboard and screen-reader way
          in, so the block is never mouse-only. */}
      <div
        className={cn("space-y-3 rounded-[24px]", openFull && "cursor-pointer transition-transform duration-200 hover:-translate-y-0.5")}
        onClick={openFull}
      >
        {!bd.ok ? (
          <p className="text-sm text-warning">Breakdown unavailable — {bd.refused}</p>
        ) : (
          <>
            <BudgetBreakdownChart current={bd.current} compare={false} />
            <MarginLine pct={bd.current.profitPct} perPc={perPiece(bd.current.profit, card.orderQty)} />
          </>
        )}
        {openFull && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openFull();
            }}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View full order data
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      {salesOrderId && fullOpen && (
        <OrderFullDataSheet
          open
          onClose={() => setFullOpen(false)}
          salesOrderId={salesOrderId}
          title={card.reNos.join(", ") || `Budget ${card.budgetCode ?? ""}`}
          revision={!!rev}
        />
      )}

      {/* 3. V0 vs PROPOSED, PER PIECE */}
      {bd.ok && bd.original && (
        <VarianceTable rows={varianceRows(bd.original, bd.current, card.v0Qty, card.orderQty)} revNo={rev?.revNo ?? null} />
      )}

      {/* 4. THE DECISION */}
      {(actions || onOpenSheet) && (
        <footer className="space-y-2 border-t border-border pt-3">
          {onOpenSheet && (
            <button
              type="button"
              onClick={onOpenSheet}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              View full sheet
            </button>
          )}
          {actions}
        </footer>
      )}
    </article>
  );
}

function Fact({ label, value, span = false }: { label: string; value: string | null; span?: boolean }) {
  return (
    <div className={cn("min-w-0", span && "col-span-2")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">
        {value ? <Truncated>{value}</Truncated> : <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function qtyText(qty: number | Refusal | null, unit: string | Refusal | null): string | null {
  if (qty == null) return null;
  if (isRefusal(qty)) return qty.refused;
  const u = unit && !isRefusal(unit) ? ` ${unit}` : "";
  return `${fmtNumber(qty)}${u}`;
}

const perPcText = (v: number | Refusal) => (isRefusal(v) ? v.refused : `${fmtMoney(v)}/pc`);

/**
 * NET MARGIN AGAINST THE LINE — green at or above `MARGIN_TARGET_PCT`, amber
 * below, and the words say which, so the colour is never the only carrier.
 */
function MarginLine({ pct, perPc }: { pct: number | Refusal; perPc: number | Refusal }) {
  if (isRefusal(pct)) {
    return <p className="text-sm text-warning">Net margin — {pct.refused}</p>;
  }
  const ok = pct >= MARGIN_TARGET_PCT;
  return (
    <p
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 rounded-md px-2.5 py-1.5 text-sm",
        ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
      )}
    >
      <span className="font-semibold">Net margin {pct.toFixed(1)}%</span>
      <span className="text-xs">{perPcText(perPc)}</span>
      <span className="ml-auto text-xs">
        {ok ? `At or above the ${MARGIN_TARGET_PCT}% line` : `Below the ${MARGIN_TARGET_PCT}% line`}
      </span>
    </p>
  );
}

/**
 * V0 (THE ORIGINAL APPROVAL) vs THE PROPOSAL, PER PIECE SOLD.
 *
 * A cost that rises is ▲ in the danger colour, one that falls is ▼ in the
 * success colour; the margin reads the other way round (up is good). The arrow
 * and its value are always printed, so the colour is never the only signal,
 * and the status colours are used for exactly that meaning here.
 */
function VarianceTable({ rows, revNo }: { rows: VarianceRow[]; revNo: number | null }) {
  const fmt = (r: VarianceRow, v: number | Refusal) =>
    isRefusal(v) ? "—" : r.kind === "margin" ? `${v.toFixed(1)}%` : fmtMoney(v);
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-xs">
        <caption className="bg-surface-muted px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Budget variance · per piece
        </caption>
        <thead className="bg-surface-muted text-muted-foreground">
          <tr>
            <th scope="col" className="px-2.5 py-1 text-left font-medium">Category</th>
            <th scope="col" className="px-2.5 py-1 text-right font-medium">V0</th>
            <th scope="col" className="px-2.5 py-1 text-right font-medium">
              {revNo ? `Rev #${revNo}` : "Proposed"}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const d = r.delta;
            const up = !isRefusal(d) && d > 0;
            const down = !isRefusal(d) && d < 0;
            // Cost up is bad; margin up is good.
            const bad = r.kind === "margin" ? down : up;
            const good = r.kind === "margin" ? up : down;
            return (
              <tr key={r.key} className={cn(r.kind !== "cost" && "bg-surface-muted font-semibold")}>
                <th scope="row" className="px-2.5 py-1.5 text-left font-normal">
                  {r.kind === "cost" ? r.label : <span className="font-semibold">{r.label}</span>}
                </th>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">{fmt(r, r.v0)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">
                  {fmt(r, r.now)}
                  {(up || down) && (
                    <span
                      className={cn("ml-1", bad && "text-danger", good && "text-success")}
                      title={`${up ? "Up" : "Down"} ${fmt(r, Math.abs(d as number))}`}
                    >
                      {up ? "▲" : "▼"}
                      <span className="sr-only">{up ? " up" : " down"}</span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
