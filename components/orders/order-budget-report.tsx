"use client";

import { Fragment } from "react";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import type { BudgetGroupHead, Fig, OrderBudgetReport } from "@/lib/orders/budget/report";
import { inr, isFigRefusal, qtyCell } from "@/lib/orders/budget/report-format";
import { exportOrderBudgetCsv, exportOrderBudgetPdf } from "@/lib/orders/budget/report-export";
import {
  PROFIT_TONE,
  costSegments,
  groupTone,
  headIsOwnRow,
  lineFlag,
  money,
  qtyText,
  quantitySum,
  shareText,
} from "@/lib/orders/budget/sheet-format";
import {
  OrderFacts,
  QtyEquation,
  ReportTable,
  SectionCard,
  SheetLabel,
  SheetMasthead,
  SignOff,
  SummaryTiles,
  Td,
  Th,
  stripeRow,
  totalRowStyle,
  type StageStyle,
} from "@/components/orders/report-kit";

/**
 * Orders ▸ <RE> ▸ Budget Statement (client 2026-09-23) — every figure of the
 * legacy RP "BUDGET STATEMENT": the order's facts, the per-style quantities,
 * every Group Head · Cost Head · line with its Qty, UOM, Rate and Value, each
 * Cost Head's and Group Head's contribution (value, share of the total
 * expenses, cost per garment on the Cut Qty), the Income / Expenses / Profit
 * figures and the signatures.
 *
 * IN THE SHEET FORMAT (user 2026-09-29: "this is okay apply it" — the approved
 * "Raagam Budget Statement" mockup): masthead, the order's facts, the RESULT
 * first (net profit, sales value, total cost, cost per garment), where the cost
 * goes as one bar to scale, the quantity as a sum, then one card per cost group
 * whose header carries the group's value, share and ₹ / pc; inside, each Cost
 * Head's lines and its subtotal with the same share figures the legacy printed
 * as "… CONTRIBUTION ( 34.67 % ) RS. 82.84 PER GARMENT". Money in Indian
 * grouping. The display decisions live in `lib/orders/budget/sheet-format.ts`,
 * which the PDF reads too.
 *
 * It renders `getOrderBudgetReport`'s object and nothing else; the PDF and the
 * spreadsheet are handed the same object, so page, paper and Excel agree.
 */
export function OrderBudgetReportView({
  data,
  showAmendment = true,
}: {
  data: OrderBudgetReport;
  /** Off when printing the frozen approved copy — its comparison was taken at
   *  raise, when approved and proposed were the same budget. */
  showAmendment?: boolean;
}) {
  const b = data.budget;
  const h = data.header;
  const sm = data.summary;
  const amendment = showAmendment ? data.amendment : null;
  const segments = costSegments(data);
  const qty = quantitySum(data);
  const mine = data.quantities.filter((q) => q.reNo === h.reNo);
  const first = mine[0] ?? data.quantities[0];
  const styles = [...new Set(mine.map((q) => q.styleRefNo).filter(Boolean))];
  const ccy = typeof h.currency === "string" ? h.currency : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Button variant="outline" size="md" onClick={() => exportOrderBudgetCsv(data, showAmendment)}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
          Excel
        </Button>
        <Button variant="outline" size="md" onClick={() => exportOrderBudgetPdf(data, "print", showAmendment)}>
          <Printer className="h-4 w-4" aria-hidden />
          Print
        </Button>
        <Button size="md" onClick={() => exportOrderBudgetPdf(data, "download", showAmendment)}>
          <Download className="h-4 w-4" aria-hidden />
          Download PDF
        </Button>
      </div>

      <div>
        <SheetMasthead
          company={{ name: data.company.name, logo: data.company.logo }}
          kind="Budget Statement"
          reNo={h.reNo}
          meta={[b.code ? `Budget ${b.code}` : null, b.date ? fmtDate(b.date) : null].filter(Boolean).join(" · ")}
          status={b.statusText}
        />
        <OrderFacts
          facts={[
            { label: "Customer", value: h.customer },
            {
              label: "Order No · Style",
              value: [first?.orderNo, styles.length > 1 ? `${styles.length} styles` : first?.styleRefNo]
                .filter(Boolean)
                .join(" · "),
              sub: styles.length > 1 ? null : first?.style,
              mono: true,
            },
            {
              label: "Earlier Shipment",
              value: h.earlierShipment ? fmtDate(h.earlierShipment) : null,
              sub:
                h.deliveryFrom
                  ? h.deliveryTo && h.deliveryTo !== h.deliveryFrom
                    ? `Delivery ${fmtDate(h.deliveryFrom)} – ${fmtDate(h.deliveryTo)}`
                    : `Delivery ${fmtDate(h.deliveryFrom)}`
                  : null,
              mono: true,
            },
            {
              label: "Price",
              value: `${ccy ?? ""} ${figText(h.avgPrice, 3)} × ${figText(h.exRate, 4)}`.trim(),
              sub: typeof h.currency === "string" ? "per piece · exchange rate" : h.currency.refused,
              mono: true,
            },
            ...(h.otherReNos.length ? [{ label: "Also covers", value: h.otherReNos.join(", "), mono: true }] : []),
          ]}
        />
      </div>

      {/* SUPPRESSION (client 2026-09-21) — said once, above the figures it withholds. */}
      {data.unratedNotice && (
        <div className="rounded-lg border border-[#f3c9c5] bg-[#fdf3f2] px-4 py-2.5 text-[12.5px] font-medium text-[#b3261e]">
          {data.unratedNotice}
        </div>
      )}

      {/* THE RESULT, FIRST. */}
      <div>
        <SheetLabel>Result</SheetLabel>
        <SummaryTiles
          tiles={[
            {
              label: "Net profit",
              value: isFigRefusal(sm.profitPct) ? "—" : `${sm.profitPct.toFixed(2)}%`,
              note: isFigRefusal(sm.netProfit)
                ? sm.netProfit.refused
                : [money(sm.netProfit), isFigRefusal(sm.profitPerGarment) ? null : `₹ ${sm.profitPerGarment.toFixed(2)} per garment`]
                    .filter(Boolean)
                    .join(" · "),
              tone: PROFIT_TONE,
            },
            { label: "Sales value", value: money(h.salesValue), note: salesNote(data) },
            {
              label: "Total cost",
              value: money(sm.totalExpenses),
              note:
                !isFigRefusal(sm.totalExpenses) && !isFigRefusal(h.salesValue) && h.salesValue > 0
                  ? `${((sm.totalExpenses / h.salesValue) * 100).toFixed(2)}% of sales`
                  : undefined,
            },
            {
              label: "Cost per garment",
              value: money(sm.costPerGarment),
              note: isFigRefusal(data.cutQty) ? undefined : `on ${qtyCell(data.cutQty)} cut pcs`,
            },
          ]}
        />
      </div>

      {/* WHERE THE COST GOES — one bar, each group's width its share of the total. */}
      {segments.length > 0 && (
        <div>
          <SheetLabel>Where the cost goes</SheetLabel>
          <div
            className="flex h-3.5 overflow-hidden rounded border border-border"
            role="img"
            aria-label={segments.map((s) => `${s.label} ${s.pct.toFixed(2)}%`).join(", ")}
          >
            {segments.map((s) => (
              <span key={s.key} style={{ width: `${s.pct}%`, background: s.tone.rule }} />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {segments.map((s) => (
              <div key={s.key} className="grid grid-cols-[10px_1fr_auto] items-baseline gap-x-2">
                <span className="h-2.5 w-2.5 self-center rounded-[2px]" style={{ background: s.tone.rule }} />
                <span className="text-[12px] font-semibold">{s.label}</span>
                <span className="text-right font-mono text-[12px] tabular-nums">{money(s.value)}</span>
                <span className="col-span-2 col-start-2 font-mono text-[11px] text-[#7b8594]">{s.share}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* THE QUANTITY, AS THE SUM IT IS — and the per-style table when the
          budget covers more than one style. */}
      <div>
        <SheetLabel>Quantity</SheetLabel>
        <QtyEquation
          terms={[
            { label: "Order", value: qtyCell(qty.order) || "0" },
            { label: "Excess", value: qtyCell(qty.excess) || "0" },
            { label: "Approval", value: qtyCell(qty.approval) || "0" },
            { label: "Rej. Allow", value: qtyCell(qty.rejection) || "0" },
          ]}
          result={{ label: "Cut Qty", value: isFigRefusal(qty.cut) ? "—" : qtyCell(qty.cut), note: isFigRefusal(qty.cut) ? qty.cut.refused : null }}
        />
        {data.quantities.length > 1 && (
          <div className="mt-3">
            <SectionCard title="Quantity by style">
              <ReportTable bare>
                <thead>
                  <tr>
                    <Th>RE No</Th>
                    <Th>Order No</Th>
                    <Th>Style</Th>
                    <Th>Description</Th>
                    <Th>Unit</Th>
                    <Th right>Order</Th>
                    <Th right>Excess</Th>
                    <Th right>Approval</Th>
                    <Th right>Rej.Allow</Th>
                    <Th right>Cut Qty</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.quantities.map((q, i) => (
                    <tr key={`${q.reNo}-${q.styleRefNo}-${i}`} style={stripeRow(i)}>
                      <Td mono>{q.reNo ?? "—"}</Td>
                      <Td mono>{q.orderNo ?? "—"}</Td>
                      <Td mono>{q.styleRefNo ?? "—"}</Td>
                      <Td>{q.style ?? ""}</Td>
                      <Td>{q.unit ?? ""}</Td>
                      <Td right mono>{qtyCell(q.order)}</Td>
                      <Td right mono>{qtyCell(q.excess)}</Td>
                      <Td right mono>{qtyCell(q.approval)}</Td>
                      <Td right mono>{qtyCell(q.rejection)}</Td>
                      <Td right mono className="font-semibold">
                        {isFigRefusal(q.cut) ? <Muted>{q.cut.refused}</Muted> : qtyCell(q.cut)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </ReportTable>
            </SectionCard>
          </div>
        )}
      </div>

      {/* ONE CARD PER COST GROUP — the report's own groups, in its order. */}
      {[...data.groups, ...(data.income ? [data.income] : [])].map((g) => (
        <GroupCard key={g.key} g={g} />
      ))}

      {/* THE SUMMARY. */}
      <div>
        <SheetLabel>Summary</SheetLabel>
        <div className="grid grid-cols-[1fr_auto] overflow-hidden rounded-lg border border-border bg-white text-[12.5px]">
          <SumRow label="Total income" v={sm.totalIncome} />
          <SumRow label="Total expenses" v={sm.totalExpenses} />
          <SumRow label="Cost per garment" v={sm.costPerGarment} strong />
          <SumRow label="Profit per garment" v={sm.profitPerGarment} />
          <div className="border-t border-[#cfe7a9] bg-[#eef7df] px-3.5 py-2 font-bold text-[#3f6a0d]">
            Net profit{isFigRefusal(sm.profitPct) ? "" : ` · ${sm.profitPct.toFixed(2)}%`}
          </div>
          <div className="border-t border-[#cfe7a9] bg-[#eef7df] px-3.5 py-2 text-right font-mono font-bold tabular-nums text-[#3f6a0d]">
            {isFigRefusal(sm.netProfit) ? <Muted>{sm.netProfit.refused}</Muted> : money(sm.netProfit)}
          </div>
        </div>
      </div>

      {/* AMENDMENT — approved vs proposed, while the RE is amending (spec §5). */}
      {amendment && (
        <SectionCard title={`Amendment${amendment.entryNo ? ` ${amendment.entryNo}` : ""} — Approved vs Proposed`}>
          <ReportTable bare>
            <thead>
              <tr>
                <Th>Figure</Th>
                <Th right>Approved</Th>
                <Th right>Proposed</Th>
                <Th right>Variance</Th>
              </tr>
            </thead>
            <tbody>
              <tr style={stripeRow(0)}>
                <Td className="font-semibold">Margin %</Td>
                <Td right mono className="font-semibold">{figText(amendment.margin.original, 2)}</Td>
                <Td right mono className="font-semibold">{figText(amendment.margin.amended, 2)}</Td>
                <Td right mono className="font-semibold">{figText(amendment.margin.delta, 2)}</Td>
              </tr>
              {amendment.rows.map((r, i) => (
                <tr key={r.key} style={stripeRow(i + 1)}>
                  <Td>{r.label}</Td>
                  <Td right mono>{r.kind === "percent" ? figText(r.baseline, 2) : inr(r.baseline)}</Td>
                  <Td right mono>{r.kind === "percent" ? figText(r.current, 2) : inr(r.current)}</Td>
                  <Td right mono>{r.kind === "percent" ? figText(r.variance, 2) : inr(r.variance)}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </SectionCard>
      )}

      <div className="rounded-lg border border-border bg-white px-5 pb-3 pt-2">
        <SignOff names={{ prepared: b.preparedBy, approved: b.approvedBy }} />
        <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-[11px] text-[#7b8594]">
          <span>
            {[h.reNo, "Budget Statement", b.code ? `Budget ${b.code}` : null].filter(Boolean).join(" · ")}
          </span>
          <span className="font-semibold">End of report</span>
        </div>
      </div>
    </div>
  );
}

/** "5,000 pcs × USD 4.000 × 84.0000" — how the sales value was reached, when the
 *  parts are all known; nothing when they are not. */
function salesNote(d: OrderBudgetReport): string | undefined {
  const h = d.header;
  const order = d.quantities.reduce((s, q) => s + (q.order ?? 0), 0);
  if (!order || isFigRefusal(h.avgPrice) || isFigRefusal(h.exRate) || typeof h.currency !== "string") return undefined;
  return `${order.toLocaleString("en-IN")} pcs × ${h.currency} ${h.avgPrice.toFixed(3)} × ${h.exRate.toFixed(4)}`;
}

/** A cost group as a card: its value, share and ₹ / pc in the header; each Cost
 *  Head's lines and subtotal inside. A Cost Head of one line is that one row —
 *  its share figures under its name — rather than a line plus a subtotal
 *  repeating it. */
function GroupCard({ g }: { g: BudgetGroupHead }) {
  const tone = groupTone(g.key);
  const ownRows = headIsOwnRow(g);
  let stripe = 0;
  return (
    <SectionCard
      tone={tone}
      title={
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: tone.rule }} />
          {g.label}
        </span>
      }
      totalLabel={shareText(g)}
      total={money(g.value)}
    >
      <ReportTable bare>
        <thead>
          <tr>
            <Th>Particulars</Th>
            <Th right>Qty</Th>
            <Th>UOM</Th>
            <Th right>Rate</Th>
            <Th right>Value ₹</Th>
          </tr>
        </thead>
        <tbody>
          {g.heads.map((hd, hi) => {
            const single = ownRows && hd.lines.length === 1;
            return (
              <Fragment key={`${hd.label}-${hi}`}>
                {ownRows && (
                  <tr>
                    <td
                      colSpan={5}
                      className="border-b border-border bg-white px-2 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.05em]"
                      style={{ color: tone.ink }}
                    >
                      {hd.label}
                      {/* A one-line head: its share figures here, no subtotal row repeating the line. */}
                      {single && shareText(hd) && (
                        <span className="ml-2 font-mono font-medium normal-case tracking-normal opacity-85">· {shareText(hd)}</span>
                      )}
                    </td>
                  </tr>
                )}
                {hd.lines.map((l, li) => {
                  const flag = lineFlag(l);
                  return (
                    <tr key={li} style={stripeRow(stripe++)}>
                      <Td>
                        {l.particulars || "—"}
                        {flag && <Flag text={flag} foc={l.foc} />}
                      </Td>
                      <Td right mono>{isFigRefusal(l.qty) ? <Muted>{l.qty.refused}</Muted> : qtyText(l.qty)}</Td>
                      <Td>{l.uom ?? ""}</Td>
                      <Td right mono>{l.rate}</Td>
                      <Td right mono>{l.value == null ? "" : isFigRefusal(l.value) ? <Muted>{l.value.refused}</Muted> : inr(l.value)}</Td>
                    </tr>
                  );
                })}
                {ownRows && !single && (
                  <tr className="font-semibold" style={totalRowStyle(tone)}>
                    <Td colSpan={4}>
                      {hd.label}
                      {shareText(hd) && <span className="ml-1.5 font-mono text-[11.5px] font-medium opacity-85">· {shareText(hd)}</span>}
                    </Td>
                    <Td right mono className="font-semibold">{figValue(hd.value)}</Td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </ReportTable>
    </SectionCard>
  );
}

function Flag({ text, foc }: { text: string; foc: boolean }) {
  const look: StageStyle = foc ? PROFIT_TONE : { label: "", tint: "#e6f3fb", rule: "#037bb8", ink: "#024f78" };
  return (
    <span
      className="ml-1.5 inline-block rounded-[3px] px-1.5 py-px align-[1px] text-[9.5px] font-bold tracking-[.08em]"
      style={{ background: look.tint, color: look.ink }}
    >
      {text}
    </span>
  );
}

function SumRow({ label, v, strong }: { label: string; v: Fig; strong?: boolean }) {
  return (
    <>
      <div className={`border-b border-[#eef1f4] px-3.5 py-2 ${strong ? "font-bold" : ""}`}>{label}</div>
      <div className={`border-b border-[#eef1f4] px-3.5 py-2 text-right font-mono tabular-nums ${strong ? "font-bold" : ""}`}>
        {isFigRefusal(v) ? <Muted>{v.refused}</Muted> : money(v)}
      </div>
    </>
  );
}

function figValue(v: Fig) {
  return isFigRefusal(v) ? <Muted>{v.refused}</Muted> : inr(v);
}

function figText(v: Fig, dp: number): string {
  return isFigRefusal(v) ? v.refused : v.toFixed(dp);
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="font-normal text-muted-foreground">{children}</span>;
}
