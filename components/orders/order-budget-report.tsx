"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import type { BudgetGroupHead, Fig, OrderBudgetReport } from "@/lib/orders/budget/report";
import { contributionText, inr, isFigRefusal, plain2, qty3, qtyCell } from "@/lib/orders/budget/report-format";
import { exportOrderBudgetCsv, exportOrderBudgetPdf } from "@/lib/orders/budget/report-export";

/**
 * Orders ▸ <RE> ▸ Budget Statement (client 2026-09-23) — the legacy RP
 * "BUDGET STATEMENT" printout, in the order documents' letterhead.
 *
 * THE LEGACY'S BODY, LINE FOR LINE: the boxed header (RE No, Customer,
 * Delivery window, Avg Price, Currency, Ex-Rate, Sales Value), the Quantity
 * table (Order · Excess · Approval · Rej.Allow · Cut Qty per style), one
 * `Group Head · Cost Head · Particulars · Qty · UOM · Rate · Value` table with
 * a CONTRIBUTION line under every Cost Head and every Group Head, the
 * Income / Expenses / Profit boxes and the signatures. "SQ" is retired
 * (client 2026-09-23): legacy's SQ No and SQ Qty read RE No and Cut Qty.
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
  const c = data.company;
  const b = data.budget;
  const h = data.header;
  const contact = [c.address, c.gstin ? `GSTIN ${c.gstin}` : null].filter(Boolean).join("  ·  ");
  const amendment = showAmendment ? data.amendment : null;
  const sm = data.summary;

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
        {/* THE LETTERHEAD — green rule, dark rule, blue title: the family frame. */}
        <div className="overflow-hidden rounded-t-md border border-b-0 border-border bg-white">
          <div className="h-[3px] bg-[#85c227]" />
          <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#16181d] px-5 py-3">
            <div className="flex min-w-0 items-center gap-4">
              {c.logo && (
                // A plain <img>: a stored data URL or an external Company
                // Profile URL, which next/image would need configuring for.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logo} alt={c.name ?? "Company logo"} className="h-12 w-auto shrink-0 object-contain" />
              )}
              <div className="min-w-0">
                <div className="text-[16px] font-bold uppercase tracking-wide text-[#16181d]">
                  {c.name ?? "RAAGAM EXPORTS"}
                </div>
                {contact && <div className="mt-0.5 text-[11.5px] text-[#5b6472]">{contact}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[12.5px] font-bold uppercase tracking-[.12em] text-[#037bb8]">Budget Statement</div>
              <div className="font-mono text-[12px] text-[#5b6472]">
                {[b.code ? `Budget ${b.code}` : null, b.statusText].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        </div>

        {/* THE LEGACY'S BOXED HEADER — four columns, read DOWN each one. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 border border-t-0 border-border bg-white px-5 py-2.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Fact label="RE No" value={h.reNo} mono />
            {h.otherReNos.length > 0 && <Fact label="Also covers" value={h.otherReNos.join(", ")} mono />}
          </div>
          <div className="space-y-1">
            <Fact label="Customer" value={h.customer} />
            <Fact label="Delivery window" value={`${fmtDate(h.deliveryFrom)}  To: ${fmtDate(h.deliveryTo)}`} mono />
          </div>
          <div className="space-y-1">
            <Fact label="Avg Price" value={figText(h.avgPrice, 3)} mono />
            <Fact label="Currency" value={typeof h.currency === "string" ? h.currency : h.currency.refused} />
          </div>
          <div className="space-y-1">
            <Fact label="Ex-Rate" value={figText(h.exRate, 4)} mono />
            <Fact label="Sales Value" value={inr(h.salesValue)} mono />
          </div>
        </div>

        {/* THE QUANTITY TABLE — one row per style of every order covered. */}
        <div className="overflow-x-auto border border-t-0 border-border bg-white">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead>
              <tr>
                <Th rowSpan={2}>RE No</Th>
                <Th rowSpan={2}>Order No</Th>
                <Th rowSpan={2}>Style Ref No</Th>
                <Th rowSpan={2}>Style</Th>
                <Th rowSpan={2}>Unit</Th>
                <Th colSpan={5} center>
                  Quantity
                </Th>
              </tr>
              <tr>
                <Th right>Order</Th>
                <Th right>Excess</Th>
                <Th right>Approval</Th>
                <Th right>Rej.Allow</Th>
                <Th right>Cut Qty</Th>
              </tr>
            </thead>
            <tbody>
              {data.quantities.map((q, i) => (
                <tr key={`${q.reNo}-${q.styleRefNo}-${i}`}>
                  <Td mono>{q.reNo ?? "—"}</Td>
                  <Td mono>{q.orderNo ?? "—"}</Td>
                  <Td mono>{q.styleRefNo ?? "—"}</Td>
                  <Td>{q.style ?? ""}</Td>
                  <Td>{q.unit ?? ""}</Td>
                  <Td right>{qtyCell(q.order)}</Td>
                  <Td right>{qtyCell(q.excess)}</Td>
                  <Td right>{qtyCell(q.approval)}</Td>
                  <Td right>{qtyCell(q.rejection)}</Td>
                  <Td right bold>
                    {isFigRefusal(q.cut) ? <Muted>{q.cut.refused}</Muted> : qtyCell(q.cut)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* SUPPRESSION (client 2026-09-21) — said once, above the figures it withholds. */}
        {data.unratedNotice && (
          <div className="border border-t-0 border-border bg-[#fdf3f2] px-5 py-2 text-[12px] text-[#b3261e]">
            {data.unratedNotice}
          </div>
        )}

        {/* THE STATEMENT — Group Head · Cost Head · Particulars · Qty · UOM · Rate · Value. */}
        <div className="mt-3 overflow-x-auto border border-border bg-white">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead>
              <tr>
                <Th>Group Head</Th>
                <Th>Cost Head</Th>
                <Th>Particulars</Th>
                <Th right>Qty</Th>
                <Th>UOM</Th>
                <Th right>Rate</Th>
                <Th right>Value</Th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <GroupRows key={g.key} g={g} />
              ))}
              {data.income && <GroupRows g={data.income} />}
            </tbody>
          </table>
        </div>

        {/* THE LEGACY'S SUMMARY BOXES. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 border border-t-0 border-border bg-white px-5 py-3 text-[12.5px] md:grid-cols-4">
          <SumBox label="Total Income" v={sm.totalIncome} />
          <SumBox label="Total Expenses" v={sm.totalExpenses} />
          <SumBox label="Net Profit" v={sm.netProfit} />
          <SumBox label="Profit %" v={sm.profitPct} />
          <span className="hidden md:block" />
          <SumBox label="Cost Per Garment" v={sm.costPerGarment} />
          <SumBox label="Profit Per Garment" v={sm.profitPerGarment} />
        </div>

        {/* AMENDMENT — approved vs proposed, while the RE is amending (spec §5). */}
        {amendment && (
          <div className="border border-t-0 border-border bg-white px-5 py-3">
            <div className="text-[11.5px] font-bold uppercase tracking-[.12em] text-[#16181d]">
              Amendment{amendment.entryNo ? ` ${amendment.entryNo}` : ""} — Approved vs Proposed
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-[12px]">
                <thead>
                  <tr>
                    <Th>Figure</Th>
                    <Th right>Approved</Th>
                    <Th right>Proposed</Th>
                    <Th right>Variance</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td bold>Margin %</Td>
                    <Td right bold>{figText(amendment.margin.original, 2)}</Td>
                    <Td right bold>{figText(amendment.margin.amended, 2)}</Td>
                    <Td right bold>{figText(amendment.margin.delta, 2)}</Td>
                  </tr>
                  {amendment.rows.map((r) => (
                    <tr key={r.key}>
                      <Td>{r.label}</Td>
                      <Td right>{r.kind === "percent" ? figText(r.baseline, 2) : inr(r.baseline)}</Td>
                      <Td right>{r.kind === "percent" ? figText(r.current, 2) : inr(r.current)}</Td>
                      <Td right>{r.kind === "percent" ? figText(r.variance, 2) : inr(r.variance)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SIGNATURES — the names over the lines, as the legacy prints them. */}
        <div className="grid grid-cols-3 gap-4 rounded-b-md border border-t-0 border-border bg-white px-5 pb-3 pt-10 text-[12px]">
          <Signature name={b.preparedBy} label="Prepared By" />
          <Signature name={null} label="Checked By" align="center" />
          <Signature name={b.approvedBy} label="Approved By" align="right" />
          <div className="col-span-3 text-right text-[11px] font-semibold text-[#5b6472]">&lt;&lt; End Of Report &gt;&gt;</div>
        </div>
      </div>
    </div>
  );
}

function GroupRows({ g }: { g: BudgetGroupHead }) {
  /* The Group Head cell spans every row of the group except the group's own
     contribution line, which runs the full width — the legacy's layout. */
  const span = g.heads.reduce((n, hd) => n + hd.lines.length + 1, 0);
  return (
    <>
      {g.heads.map((hd, hi) => (
        <HeadRows key={`${hd.label}-${hi}`} hd={hd} group={hi === 0 ? { label: g.label, span } : null} />
      ))}
      <tr className="bg-[#f6f7f9]">
        <td colSpan={6} className="border border-border px-2 py-1 text-[12.5px] font-bold">
          {contributionText(g.label, g)}
        </td>
        <td className="border border-border px-2 py-1 text-right text-[12.5px] font-bold tabular-nums">{figValue(g.value)}</td>
      </tr>
    </>
  );
}

function HeadRows({
  hd,
  group,
}: {
  hd: BudgetGroupHead["heads"][number];
  group: { label: string; span: number } | null;
}) {
  return (
    <>
      {hd.lines.map((l, li) => (
        <tr key={li}>
          {li === 0 && group && (
            <td rowSpan={group.span} className="border border-border px-2 py-1 align-top font-medium">
              {group.label}
            </td>
          )}
          {li === 0 && (
            <td rowSpan={hd.lines.length} className="border border-border px-2 py-1 align-top">
              {hd.label}
            </td>
          )}
          <Td>
            {l.particulars}
            {l.foc && <span className="ml-1 text-[11px] font-semibold text-[#5b6472]">FOC</span>}
          </Td>
          <Td right>{isFigRefusal(l.qty) ? <Muted>{l.qty.refused}</Muted> : qty3(l.qty)}</Td>
          <Td>{l.uom ?? ""}</Td>
          <Td right>{l.rate}</Td>
          <Td right>{isFigRefusal(l.value) ? <Muted>{l.value.refused}</Muted> : plain2(l.value)}</Td>
        </tr>
      ))}
      <tr>
        <td colSpan={5} className="border border-border px-2 py-0.5 text-[10.5px] font-bold">
          {contributionText(hd.label, hd)}
        </td>
        <td className="border border-border px-2 py-0.5 text-right text-[11px] font-bold tabular-nums">{figValue(hd.value)}</td>
      </tr>
    </>
  );
}

function figValue(v: Fig) {
  return isFigRefusal(v) ? <Muted>{v.refused}</Muted> : inr(v);
}

function figText(v: Fig, dp: number): string {
  return isFigRefusal(v) ? v.refused : v.toFixed(dp);
}

function SumBox({ label, v }: { label: string; v: Fig }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-semibold">{label}</span>
      <span className="min-w-28 border border-[#16181d] px-2 py-1 text-right font-semibold tabular-nums">
        {isFigRefusal(v) ? <Muted>{v.refused}</Muted> : label === "Profit %" ? v.toFixed(2) : inr(v)}
      </span>
    </div>
  );
}

function Signature({ name, label, align }: { name: string | null; label: string; align?: "center" | "right" }) {
  const a = align === "center" ? "text-center" : align === "right" ? "text-right" : "";
  return (
    <div className={a}>
      <div className="min-h-4 text-[11.5px] text-[#5b6472]">{name ?? ""}</div>
      <div className="border-t border-[#16181d] pt-1 font-semibold">{label}</div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <span className="shrink-0 text-[#8b95a3]">{label}:</span>
      <span className={cn("min-w-0 font-semibold", mono && "tabular-nums")}>{value || "—"}</span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="font-normal text-muted-foreground">{children}</span>;
}

function Th({
  children,
  right,
  center,
  rowSpan,
  colSpan,
}: {
  children: React.ReactNode;
  right?: boolean;
  center?: boolean;
  rowSpan?: number;
  colSpan?: number;
}) {
  return (
    <th
      rowSpan={rowSpan}
      colSpan={colSpan}
      className={cn(
        "border border-border bg-[#f6f7f9] px-2 py-1 font-semibold text-[#5b6472]",
        right ? "text-right" : center ? "text-center" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, right, mono, bold }: { children: React.ReactNode; right?: boolean; mono?: boolean; bold?: boolean }) {
  return (
    <td
      className={cn(
        "border border-border px-2 py-1",
        right && "text-right tabular-nums",
        mono && "font-mono",
        bold && "font-semibold",
      )}
    >
      {children}
    </td>
  );
}
