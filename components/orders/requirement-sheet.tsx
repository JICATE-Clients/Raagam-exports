import { DocumentPrintStyles } from "./document-print-styles";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { isReportRefusal } from "@/lib/orders/fabric-bom/report-refusal";
import { ACCESSORY_COLUMNS, accessoryQty, accessoryRows } from "@/lib/orders/requirement/sheet";
import type { RequirementSheetData } from "@/lib/orders/requirement/service";
import { STAGE_STRIPE, STAGE_STYLES } from "@/lib/orders/fabric-bom/report-colours";
import { BRAND } from "@/lib/orders/report-pdf-kit";
import { SectionBar, Swatch, stripeRow } from "@/components/orders/report-kit";

/**
 * THE ACCESSORIES REQUIREMENT, ON SCREEN, IN THE RP PRINTOUT'S LAYOUT (client
 * 2026-09-24, "Accessories Requirement.pdf").
 *
 * The same document the PDF draws (`exportAccessoriesRequirementPdf`), so what
 * the operator checks here is what the supplier is sent:
 *
 *   - the centred company and title;
 *   - Customer and the Delivery window;
 *   - RE No · Order No · Style Ref No · Style · Excess% · Unit under a
 *     Quantity block — Order · Excess · Approval · Rej.Allow · Cut. The header
 *     is the Yarn & Fabric Requirement's own (`loadMaterialBomDocHeader`), so
 *     the two documents never disagree about an order's quantities;
 *   - TRIMS PURCHASE — Category · Item · Color · Specification · UOM · Item
 *     Size · Qty · Consumption, the category written once over its items;
 *   - Prepared By / Checked By / Approved By.
 *
 * The printout's SQ No / SQ Description and its "SQ" column are the standing
 * 2026-09-23 decision: gone, and the column reads Cut. "SC No" reads RE No.
 *
 * A server component with nothing to hydrate; the three buttons above it are
 * `RequirementToolbar`.
 *
 * THE YARN & FABRIC LOOK (user 2026-09-29): the four-stage stripe over the
 * letterhead, the RE No and Cut cells tinted as the PDF tints them, and TRIMS
 * PURCHASE as a filled `SectionBar` over a table headed in the same tone with
 * striped rows — the same section the PDF draws with `report-pdf-kit.ts`.
 */
export function RequirementSheetDocument({ data }: { data: RequirementSheetData }) {
  const rows = accessoryRows(data.rows, data.names);
  /* A sheet frozen as V_final before 2026-09-24 carries no header — it still
     prints its body, and says why the band above is missing. */
  const h = data.header && !isReportRefusal(data.header) ? data.header : null;
  const q = h && !isReportRefusal(h.qty) ? h.qty : null;
  const withPct = (qty: number, pct: number | null) => (pct == null ? fmtNumber(qty) : `${fmtNumber(qty)} (${pct.toFixed(2)}%)`);

  return (
    <>
      <DocumentPrintStyles scope="req" />
      <article className="req-sheet mx-auto max-w-[1100px] overflow-hidden rounded-md border border-border bg-white px-6 pb-5 text-[12px] text-[#16181d] shadow-sm">
        {/* THE FOUR-STAGE STRIPE — the PDF's own top rule (`drawStageStripe`). */}
        <div className="-mx-6 mb-4 flex h-[4px]">
          {STAGE_STRIPE.map((c) => (
            <div key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        {/* THE CENTRED LETTERHEAD — company, unit, title — as the printout. */}
        <header className="text-center">
          <div className="text-[16px] font-bold uppercase tracking-wide">{data.company.name ?? h?.company.name ?? "RAAGAM EXPORTS"}</div>
          {h?.company.unit && <div className="text-[11px] font-semibold uppercase">{h.company.unit}</div>}
          {(h?.company.address ?? data.company.address) && (
            <div className="text-[11px] text-[#5b6472]">{h?.company.address ?? data.company.address}</div>
          )}
          <div className="mt-1 text-[14px] font-bold uppercase tracking-wide">Accessories Requirement</div>
        </header>

        <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10.5px] text-[#5b6472]">
          {/* WHEN THE FIGURES WERE STORED, not when the page was opened — the
              PDF prints its own print time; this page states the data's age. */}
          <span>Requirement stored: {data.bom.computedAt ? fmtDateTime(data.bom.computedAt) : "—"}</span>
          <span className="font-mono">{data.bom.code ?? ""}</span>
        </div>

        {!h && data.header && isReportRefusal(data.header) && (
          <p className="mt-2 rounded-sm bg-[#fdf1f1] px-3 py-2 text-[12px] font-medium text-destructive">{data.header.refused}</p>
        )}

        {/* CUSTOMER · DELIVERY WINDOW */}
        <table className="req-grid mt-1 w-full border-collapse">
          <tbody>
            <tr>
              <Cell>
                <b>Customer:</b> {h?.customer ?? data.order.customer ?? ""}
              </Cell>
              <Cell>
                <b>Delivery window From</b> {fmtDate(h?.deliveryFromDate ?? data.order.deliveryDate)}{" "}
                <b className="ml-3">To:</b> {fmtDate(h?.deliveryToDate ?? h?.deliveryFromDate ?? data.order.deliveryDate)}
              </Cell>
            </tr>
          </tbody>
        </table>

        {/* THE STYLE ROW UNDER THE QUANTITY BLOCK — Order + Excess + Approval
            + Rej.Allow = Cut, read as a sum. */}
        <table className="req-grid mt-1 w-full border-collapse">
          <thead>
            <tr>
              <Head rowSpan={2}>RE No.</Head>
              <Head rowSpan={2}>Order No.</Head>
              <Head rowSpan={2}>Style Ref No</Head>
              <Head rowSpan={2}>Style</Head>
              <Head rowSpan={2}>Excess%</Head>
              <Head rowSpan={2}>Unit</Head>
              <Head colSpan={5} center>
                Quantity
              </Head>
            </tr>
            <tr>
              <Head right>Order</Head>
              <Head right>Excess</Head>
              <Head right>Approval</Head>
              <Head right>Rej.Allow</Head>
              <Head right>Cut</Head>
            </tr>
          </thead>
          <tbody>
            <tr>
              {/* RE No and Cut — the two figures people look up first, tinted
                  as the PDF's header tints them. */}
              <Cell mono bold tint={STAGE_STYLES.dyed}>
                {h?.scNo ?? data.order.scNo ?? ""}
              </Cell>
              <Cell mono>{h?.orderNo ?? data.order.orderNo ?? ""}</Cell>
              <Cell mono>{h?.styleRefNo ?? ""}</Cell>
              <Cell>{h?.styleName ?? ""}</Cell>
              <Cell right>{h?.excessPct != null ? `${h.excessPct}` : ""}</Cell>
              <Cell>{q ? "PCS" : ""}</Cell>
              <Cell right>{q ? fmtNumber(q.orderQty) : ""}</Cell>
              <Cell right>{q ? fmtNumber(q.excessQty) : ""}</Cell>
              <Cell right>{q ? withPct(q.approvalQty, q.approvalPct) : ""}</Cell>
              <Cell right>{q ? withPct(q.rejectionQty, q.rejectionPct) : ""}</Cell>
              <Cell right bold tint={STAGE_STYLES.dyed}>
                {q ? fmtNumber(q.cutQty) : ""}
              </Cell>
            </tr>
          </tbody>
        </table>
        {h && isReportRefusal(h.qty) && <p className="mt-1 text-[11.5px] font-medium text-destructive">{h.qty.refused}</p>}

        {/* TRIMS PURCHASE */}
        <div className="mt-4">
          <SectionBar
            title="Trims Purchase"
            right={rows.length ? `${rows.length} item${rows.length === 1 ? "" : "s"}` : undefined}
          />
        </div>
        <div className="req-scroll">
          <table className="req-grid w-full border-collapse">
            <thead>
              <tr>
                {ACCESSORY_COLUMNS.map((c) => (
                  <Head key={c} right={c === "Qty"} tone>
                    {c}
                  </Head>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <Cell colSpan={ACCESSORY_COLUMNS.length}>No trims on this Material BOM.</Cell>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.key} style={stripeRow(i)}>
                  {/* The category, written once over its items, wears the
                      section's tone — the group's own heading cell. */}
                  {r.category != null && (
                    <Cell rowSpan={r.span} top bold tint={BRAND}>
                      {r.category}
                    </Cell>
                  )}
                  <Cell>{r.item}</Cell>
                  <Cell>
                    <Swatch name={r.colour} />
                    {r.colour ?? ""}
                  </Cell>
                  <Cell>{r.spec ?? ""}</Cell>
                  <Cell>{r.uom}</Cell>
                  <Cell>{r.size ?? ""}</Cell>
                  {r.qty == null ? (
                    <Cell danger>{r.refusal ?? "—"}</Cell>
                  ) : (
                    <Cell right mono>
                      {accessoryQty(r.qty)}
                    </Cell>
                  )}
                  <Cell>{r.consumption}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-12 flex justify-between border-b border-[#16181d] pb-1 text-[11px] font-bold">
          <span>Prepared By</span>
          <span>Checked By</span>
          <span>Approved By</span>
        </div>
      </article>
    </>
  );
}

function Head({
  children,
  rowSpan,
  colSpan,
  right,
  center,
  tone,
}: {
  children: React.ReactNode;
  rowSpan?: number;
  colSpan?: number;
  right?: boolean;
  center?: boolean;
  /** A section's table head — in the section's tint and ink (BRAND), the
   *  PDF's `toneHead`. Inline, because `document-print-styles`'
   *  `.req-sheet thead th` rule outranks a utility class. */
  tone?: boolean;
}) {
  return (
    <th
      rowSpan={rowSpan}
      colSpan={colSpan}
      style={tone ? { background: BRAND.tint, color: BRAND.ink } : undefined}
      className={`border border-[#9aa4b2] bg-[#d9dcdf] px-2 py-1 text-[11px] font-bold ${
        right ? "text-right" : center ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Cell({
  children,
  rowSpan,
  colSpan,
  right,
  mono,
  bold,
  top,
  danger,
  tint,
}: {
  children: React.ReactNode;
  rowSpan?: number;
  colSpan?: number;
  right?: boolean;
  mono?: boolean;
  bold?: boolean;
  top?: boolean;
  danger?: boolean;
  /** Paint the cell in a tone's tint and ink (a group heading, a key figure). */
  tint?: { tint: string; ink: string };
}) {
  return (
    <td
      rowSpan={rowSpan}
      colSpan={colSpan}
      style={tint ? { background: tint.tint, color: tint.ink } : undefined}
      className={[
        "border border-[#9aa4b2] px-2 py-1 text-[11.5px]",
        right ? "text-right" : "",
        mono ? "font-mono tabular-nums" : "",
        bold ? "font-bold" : "",
        top ? "align-top" : "",
        danger ? "text-[#b91c1c]" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}
