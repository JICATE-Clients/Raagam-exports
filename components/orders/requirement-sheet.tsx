import { DocumentPrintStyles } from "./document-print-styles";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import {
  requirementRows,
  requirementSummary,
  sheetQty,
  type SheetRow,
} from "@/lib/orders/requirement/sheet";
import type { RequirementSheetData } from "@/lib/orders/requirement/service";

/**
 * The Accessories Requirement Sheet.
 *
 * Rebuilt from the printed original (Format.pdf, 22-08-2026): the same sections,
 * the same column names and the same figures, so a supplier who knows the legacy
 * sheet reads this one without being told. What is new is hierarchy — item
 * category as a grouping band rather than a repeated cell, size rows indented
 * under their parent with the total inverted, every figure in a mono face so the
 * columns align, and the quantity derivation stated once instead of implied by
 * four header numbers.
 *
 * ## THE MEDIUM DECIDES, NOT THE OPERATOR
 *
 * This colour view IS the document — the app is digital-first and this is a tab
 * on the record, not a preview of a piece of paper. Print and PDF switch
 * themselves to the ink-safe layout (`.req-*` rules in `DocumentPrintStyles`,
 * and the jspdf routine draws its own mono table), so there is no toggle, no
 * setting, and nothing an operator can get wrong. A sheet handed to a supplier
 * on a mono laser must not depend on somebody having remembered.
 *
 * ## SERVER COMPONENT
 *
 * No state, no effects, no `"use client"`. The toolbar that owns the three
 * exports is a client island beside it — this is the document, and a document
 * that re-renders is a document that can differ from the one that was signed.
 */
export function RequirementSheetDocument({ data }: { data: RequirementSheetData }) {
  const rows = requirementRows(data.rows, data.names);
  const summary = requirementSummary(rows);

  return (
    <>
      <DocumentPrintStyles scope="req" />
      <article className="req-sheet mx-auto max-w-[1100px] overflow-hidden rounded-md border border-border bg-white text-[#16181d] shadow-sm">
        {/* Identity band. The green stripe is the ONE place brand green is spent
            on this document; everything else that carries colour is the primary
            blue, so the sheet reads as one thing rather than a palette. */}
        <div className="grid grid-cols-[6px_1fr]">
          <div className="req-stripe bg-[#85c227]" />
          <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#16181d] px-5 py-4">
            <div>
              <div className="text-[21px] font-bold tracking-wide">
                {data.company.name ?? "RAAGAM EXPORTS"}
              </div>
              <div className="max-w-[46ch] text-[11.5px] leading-relaxed text-[#5b6472]">
                {data.company.address}
                {data.company.gstin ? ` · GSTIN ${data.company.gstin}` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[15px] font-bold uppercase tracking-[.14em] text-[#037bb8]">
                Accessories Requirement
              </div>
              <div className="font-mono text-[13px]">{data.bom.code ?? "—"}</div>
              <div className="font-mono text-[11px] text-[#8b95a3]">
                {data.bom.amendmentNo != null ? `Amendment ${data.bom.amendmentNo}` : ""}
              </div>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] border-b border-border">
          <Fact label="Customer" value={data.order.customer} />
          <Fact label="SC No" value={data.order.scNo} mono />
          <Fact label="Order No" value={data.order.orderNo} mono />
          <Fact label="Order Dt" value={fmtDate(data.order.orderDate)} mono />
          <Fact label="Delivery Dt" value={fmtDate(data.order.deliveryDate)} mono />
          <Fact label="BOM Dt" value={fmtDate(data.bom.amendDate)} mono />
        </dl>

        {/* THE DERIVATION, STATED ONCE. The legacy sheet printed four header
            numbers and left the reader to work out which of them the trims were
            actually bought against. This says it. */}
        <div className="req-keep flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[#f1f3f5] px-5 py-2.5 font-mono text-[12.5px]">
          <span className="font-semibold text-[#037bb8]">
            {data.bom.computedForQty != null ? fmtNumber(data.bom.computedForQty) : "—"}
          </span>
          <span className="text-[#8b95a3]">pcs planned</span>
          {data.order.excessPct != null && (
            <>
              <span className="text-[#8b95a3]">· buyer excess</span>
              <span>{data.order.excessPct}%</span>
            </>
          )}
          <span className="ml-auto font-sans text-[11.5px] text-[#5b6472]">
            Rejection allowance is shown on the order and <b>not</b> bought — a garment cut and
            scrapped has eaten its cloth, not its trims.
          </span>
        </div>

        <section>
          <div className="flex items-baseline gap-3 border-b border-border bg-[#eaf7fd] px-5 py-2">
            <h2 className="m-0 text-[12.5px] font-bold uppercase tracking-[.14em] text-[#037bb8]">
              Trims Purchase
            </h2>
            <span className="ml-auto font-mono text-[11px] text-[#5b6472]">
              {summary.items} item{summary.items === 1 ? "" : "s"} · {summary.categories} categor
              {summary.categories === 1 ? "y" : "ies"}
              {summary.split ? ` · ${summary.split} size-split` : ""}
            </span>
          </div>
          <div className="req-scroll">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Colour</Th>
                  <Th>UOM</Th>
                  <Th>Size</Th>
                  <Th right>Qty</Th>
                  <Th>Consumption</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.key} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-cols-3 border-t-2 border-[#16181d]">
          {["Prepared By", "Checked By", "Approved By"].map((s) => (
            <div key={s} className="border-r border-border px-5 pb-3 pt-8 text-center last:border-r-0">
              <span className="block border-t border-[#9aa4b2] pt-2 text-[11px] font-semibold uppercase tracking-[.1em] text-[#5b6472]">
                {s}
              </span>
            </div>
          ))}
        </div>

        {/* WHEN THE FIGURES WERE STORED, not when the page was opened. A sheet
            that dated itself "now" would look current while printing a
            requirement computed against an order that has since moved. */}
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-border px-5 py-2 font-mono text-[10.5px] text-[#8b95a3]">
          <span>
            Requirement stored {data.bom.computedAt ? fmtDateTime(data.bom.computedAt) : "—"}
          </span>
          <span>Raagam Exports · Accessories Requirement</span>
        </div>
      </article>
    </>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="border-b border-r border-border px-5 py-2 last:border-r-0">
      <dt className="mb-px text-[10.5px] font-semibold uppercase tracking-[.1em] text-[#8b95a3]">
        {label}
      </dt>
      <dd className={`m-0 font-medium ${mono ? "font-mono text-[13px]" : "text-[14px]"}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-[#9aa4b2] bg-[#f1f3f5] px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em] text-[#5b6472] ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

/**
 * One row of the document, by kind.
 *
 * A REFUSAL PRINTS ITS SENTENCE IN THE QTY CELL, never a blank and never a zero.
 * This is the engine's standing rule and a document is the worst place to break
 * it: 0 on a printed requirement reads as "none needed", which is the one answer
 * a trim requirement never intends, and the sheet is what a purchase order is
 * written from.
 */
function Row({ row }: { row: SheetRow }) {
  if (row.kind === "category") {
    return (
      <tr>
        <td
          colSpan={6}
          className="border-b border-[#9aa4b2] bg-white px-2.5 pb-1.5 pt-3 text-[11.5px] font-bold uppercase tracking-[.1em]"
        >
          {row.label}
        </td>
      </tr>
    );
  }

  if (row.kind === "total") {
    return (
      <tr className="req-keep">
        <td
          colSpan={4}
          className="border-b border-[#9aa4b2] bg-[#eef8de] px-2.5 py-1.5 font-semibold text-[#547b19]"
        >
          {row.label}
        </td>
        <td className="border-b border-[#9aa4b2] bg-[#eef8de] px-2.5 py-1.5 text-right font-mono font-semibold tabular-nums text-[#547b19]">
          {sheetQty(row.qty, row.decimals)}
        </td>
        <td className="border-b border-[#9aa4b2] bg-[#eef8de]" />
      </tr>
    );
  }

  if (row.kind === "size") {
    return (
      <tr>
        <td colSpan={3} className="border-b border-border px-2.5 py-1.5" />
        <td className="border-b border-border px-2.5 py-1.5 text-[12.5px] text-[#5b6472]">
          {row.size}
        </td>
        <Qty qty={row.qty} refusal={row.refusal} decimals={row.decimals} muted />
        <td className="border-b border-border px-2.5 py-1.5 font-mono text-[12.5px] text-[#5b6472]">
          {row.consumption}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="border-b border-border px-2.5 py-1.5 align-top">
        <span className="font-medium">{row.head}</span>
        {row.spec && <span className="block text-[12px] text-[#5b6472]">{row.spec}</span>}
      </td>
      <td className="border-b border-border px-2.5 py-1.5">{row.colour || "—"}</td>
      <td className="border-b border-border px-2.5 py-1.5">{row.uom || "—"}</td>
      <td className="border-b border-border px-2.5 py-1.5">—</td>
      {row.split ? (
        <td className="border-b border-border px-2.5 py-1.5 text-right text-[12px] text-[#8b95a3]">
          per size
        </td>
      ) : (
        <Qty qty={row.qty} refusal={row.refusal} decimals={row.decimals} />
      )}
      <td className="border-b border-border px-2.5 py-1.5 font-mono text-[12.5px]">
        {row.consumption}
      </td>
    </tr>
  );
}

function Qty({
  qty,
  refusal,
  decimals,
  muted,
}: {
  qty: number | null;
  refusal: string | null;
  decimals: number | null;
  muted?: boolean;
}) {
  if (qty == null && refusal) {
    return (
      <td className="border-b border-border px-2.5 py-1.5 text-right text-[11.5px] text-[#b91c1c]">
        {refusal}
      </td>
    );
  }
  return (
    <td
      className={`border-b border-border px-2.5 py-1.5 text-right font-mono tabular-nums ${
        muted ? "text-[12.5px] text-[#5b6472]" : "font-medium"
      }`}
    >
      {sheetQty(qty, decimals)}
    </td>
  );
}
