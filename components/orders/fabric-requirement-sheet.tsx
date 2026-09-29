import { DocumentPrintStyles } from "./document-print-styles";
import { CadPendingBadge } from "@/components/orders/cad/cad-pending-badge";
import { ReportThumbnail } from "@/components/orders/report-thumbnail";
import type { ReportStyleImage } from "@/lib/orders/gos/style-images";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
/* THE YARN & FABRIC REQUIREMENT'S LOOK (2026-09-29) — the shared screen kit,
   the twin of the `report-pdf-kit.ts` the PDF draws with. */
import {
  BRAND,
  SectionBar,
  STAGE_STYLES,
  Swatch,
  Th,
  stripeRow,
  totalRowStyle,
  type StageStyle,
} from "@/components/orders/report-kit";
import type { ClothPurchaseLine } from "@/lib/orders/fabric-bom/reports";
import {
  fabricConsumptionLabel,
  fabricRequirementSheetRows,
  fabricRequirementSummary,
  fabricSheetQty,
  totalIsPartial,
  yarnSheetRows,
  type FabricSheetRow,
} from "@/lib/orders/fabric-requirement/sheet";
import type { FabricRequirementSheetData } from "@/lib/orders/fabric-requirement/service";

/**
 * The Fabric Requirement Sheet.
 *
 * The companion to the Accessories Requirement, and it reads the same way on
 * purpose — same letterhead, same fact strip, same derivation band, same
 * signature block — so someone who knows one knows the other. What differs is
 * only what fabric actually needs: a STYLE band instead of an item category, an
 * entry header carrying the structure and the garment components the cloth is
 * cut into, and a consumption column that states grams-per-garment plus the
 * cutting buffer rather than a ratio.
 *
 * ## THE MEDIUM DECIDES, NOT THE OPERATOR
 *
 * This colour view IS the document — the app is digital-first and this is a
 * route on the record, not a preview of a piece of paper. Since 2026-09-29 it
 * wears the Yarn & Fabric Requirement's look (user: "another reports also need
 * to look like yarn fabric requirement"): filled section bars in their tone,
 * striped rows, tinted totals — and the PDF draws the SAME look with
 * `report-pdf-kit.ts`, so screen, print and PDF are one document. Print keeps
 * the colour (`DocumentPrintStyles` sets `print-color-adjust: exact`): every
 * fill is a pale tint under near-black ink, safe on a mono laser, so there is
 * still no ink-safe toggle and nothing an operator can get wrong.
 *
 * ## SERVER COMPONENT
 *
 * No state, no effects, no `"use client"`. The toolbar that owns the three
 * exports is a client island beside it — this is the document, and a document
 * that re-renders is a document that can differ from the one that was signed.
 */
export function FabricRequirementSheetDocument({
  data,
  cadPending = false,
  thumbnail = null,
}: {
  data: FabricRequirementSheetData;
  /** The order's CAD is not yet approved (0628) — stamp the sheet. Read live by the page. */
  cadPending?: boolean;
  /** The style picture at the facts' top-left (2026-09-26) — loaded by the page
   *  BESIDE the (possibly frozen) sheet, never inside it. Null → no column. */
  thumbnail?: ReportStyleImage | null;
}) {
  const rows = fabricRequirementSheetRows(data.rows, data.names);
  const yarns = yarnSheetRows(data.yarns, data.names);
  const summary = fabricRequirementSummary(rows);

  return (
    <>
      <DocumentPrintStyles scope="fab" />
      <article className="fab-sheet mx-auto max-w-[1200px] overflow-hidden rounded-md border border-border bg-white text-[#16181d] shadow-sm">
        {/* Identity band. The green stripe is the ONE place brand green is spent
            on this document; everything else that carries colour is the primary
            blue, so the sheet reads as one thing rather than a palette. */}
        <div className="grid grid-cols-[6px_1fr]">
          <div className="fab-stripe bg-[#85c227]" />
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
                Fabric Requirement
              </div>
              <div className="font-mono text-[13px]">{data.bom.code ?? "—"}</div>
            </div>
          </div>
        </div>
        {/* CAD PENDING (0628) — a bordered badge, not a watermark (cad-lifecycle/stamp.ts). */}
        {cadPending && (
          <div className="border-b border-border px-5 py-2">
            <CadPendingBadge />
          </div>
        )}

        {/* No picture → no left column at all; the facts take the full width. */}
        <div className="flex items-start gap-3 border-b border-border">
          {thumbnail && (
            <div className="py-2 pl-5">
              <ReportThumbnail image={thumbnail} />
            </div>
          )}
          <dl className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
            <Fact label="Customer" value={data.order.customer} />
            <Fact label="SC No" value={data.order.scNo} mono />
            <Fact label="Order No" value={data.order.orderNo} mono />
            <Fact label="Order Dt" value={fmtDate(data.order.orderDate)} mono />
            <Fact label="Delivery Dt" value={fmtDate(data.order.deliveryDate)} mono />
            <Fact label="BOM Dt" value={fmtDate(data.bom.bomDate)} mono />
          </dl>
        </div>

        {/* THE DERIVATION, STATED ONCE — and here it says the OPPOSITE of the
            accessories sheet, deliberately. Fabric carries the full target with
            the rejection allowance INCLUDED, because a garment scrapped during
            panel processing has already eaten its cloth; a trim on the same
            garment has not been used. That is the client's own distinction and
            the two documents must each say which side of it they are on, or a
            reader who knows one will assume the other. */}
        <div className="fab-keep flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[#f1f3f5] px-5 py-2.5 font-mono text-[12.5px]">
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
            Rejection allowance <b>is</b> bought here — a garment cut and scrapped has already eaten
            its cloth.
          </span>
        </div>

        <section>
          {/* THE FABRIC TABLE'S BAR — the app's blue: a fabric sheet spans every
              stage its cloths pass through, so no one stage owns it. The PDF
              draws the same bar with the same count. */}
          <SectionBar
            tone={BRAND}
            first
            title="Fabric Purchase"
            right={
              <>
                {summary.entries} entr{summary.entries === 1 ? "y" : "ies"} · {summary.styles} style
                {summary.styles === 1 ? "" : "s"} · {summary.slices} slice
                {summary.slices === 1 ? "" : "s"}
                {/* THE REFUSAL COUNT IS IN THE BAND, not only in the rows. This is
                    where a reader decides whether to trust the page, and three
                    unplannable slices further down are three they would otherwise
                    have to scroll to find. */}
                {summary.refused ? (
                  <span className="font-semibold text-[#b91c1c]"> · {summary.refused} unplanned</span>
                ) : null}
              </>
            }
          />
          <div className="fab-scroll">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <Th>Style / Fabric</Th>
                  <Th>Colour · Size</Th>
                  <Th right>Pcs</Th>
                  <Th>Consumption</Th>
                  <Th>UOM</Th>
                  <Th right>Qty</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Row key={r.key} row={r} stripe={i % 2 === 1} partial={r.kind === "total" && totalIsPartial(rows, r.key)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* THE YARN SECTION IS OMITTED WHEN THE BOM COMPUTED NONE, rather than
            printed empty. Cloth bought finished needs no yarn purchase, so an
            empty section headed "Yarn Purchase" would state a shortage that does
            not exist — and a section reading "none" is a claim this document is
            not in a position to make. The BOM's own Yarn Process tab is where an
            absent split is chased. */}
        {yarns.length > 0 && (
          <section>
            <SectionBar
              tone={STAGE_STYLES.yarn}
              title="Yarn Purchase"
              right={`${yarns.length} yarn${yarns.length === 1 ? "" : "s"}`}
            />
            <div className="fab-scroll">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <Th>Yarn</Th>
                    <Th>UOM</Th>
                    <Th right>Purchase Qty</Th>
                  </tr>
                </thead>
                <tbody>
                  {yarns.map((y, i) =>
                    y.kind !== "yarn" ? null : (
                      <tr key={y.key} style={stripeRow(i)}>
                        <td className="border-b border-border px-2.5 py-1.5 font-medium">{y.yarn}</td>
                        <td className="border-b border-border px-2.5 py-1.5">{y.uom || "—"}</td>
                        <Qty qty={y.qty} refusal={y.refusal} decimals={y.decimals} />
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* FABRIC PURCHASE (0564) — Default Rule 2's demand, and the reason
            the Yarn Purchase section above may legitimately be absent. A
            fabric bought as greige or dyed rolls buys no yarn; what it buys
            is roll WEIGHT, in the same kilograms the requirement above is
            stated in, grossed by the losses the factory still incurs after
            the roll lands. Omitted rather than drawn empty, for the same
            reason the yarn section is: a heading over nothing states a
            purchase that does not exist. */}
        {data.cloth.length > 0 && (
          <section>
            {/* Greige or dyed rolls — the bar wears the stage they are bought in
                (Dyed only when every line is), each Buying cell its own. */}
            <SectionBar
              tone={clothTone(data.cloth)}
              title="Fabric Purchase"
              right={`${data.cloth.length} line${data.cloth.length === 1 ? "" : "s"}`}
            />
            <div className="fab-scroll">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <Th>Fabric</Th>
                    <Th>Buying</Th>
                    <Th>Colour</Th>
                    <Th>UOM</Th>
                    <Th right>Net Wt</Th>
                    <Th right>Purchase Wt</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.cloth.map((l, i) => (
                    <tr key={`${l.fabricId}-${l.combo ?? ""}-${i}`} style={stripeRow(i)}>
                      <td className="border-b border-border px-2.5 py-1.5 font-medium">
                        {l.fabricName}
                        {l.component && (
                          <span className="ml-1 text-[11px] text-[#5b6472]">· {l.component}</span>
                        )}
                      </td>
                      <td
                        className="border-b border-border px-2.5 py-1.5 font-semibold"
                        style={{ background: lineTone(l).tint, color: lineTone(l).ink }}
                      >
                        {l.label}
                      </td>
                      <td className="border-b border-border px-2.5 py-1.5">
                        <Swatch name={l.combo} />
                        {l.combo ?? "—"}
                      </td>
                      <td className="border-b border-border px-2.5 py-1.5">{l.uomCode || "—"}</td>
                      <td className="border-b border-border px-2.5 py-1.5 text-right font-mono">
                        {fmtNumber(l.netWt)}
                      </td>
                      <td className="border-b border-border px-2.5 py-1.5 text-right font-mono font-semibold">
                        {fmtNumber(l.purchaseWt)}
                      </td>
                    </tr>
                  ))}
                  {/* A TOTAL ONLY WHERE THERE IS ONE — null the moment two
                      lines disagree on a unit, and a missing total is the
                      honest answer there rather than a sum of kilograms and
                      metres. */}
                  {data.clothTotal && (
                    <tr className="font-semibold" style={totalRowStyle(clothTone(data.cloth))}>
                      <td className="border-b border-border px-2.5 py-1.5" colSpan={4}>
                        Total Fabric Purchase Requirement
                        {data.clothTotal.uomCode ? ` (${data.clothTotal.uomCode})` : ""}
                      </td>
                      <td className="border-b border-border px-2.5 py-1.5" />
                      <td className="border-b border-border px-2.5 py-1.5 text-right font-mono">
                        {fmtNumber(data.clothTotal.qty)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

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
          <span>Raagam Exports · Fabric Requirement</span>
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

/** A bought roll's stage — greige unless it is bought dyed. */
function lineTone(l: ClothPurchaseLine): StageStyle {
  return l.source === "dyed_purchase" ? STAGE_STYLES.dyed : STAGE_STYLES.greige;
}

/** The Fabric Purchase section's tone — Dyed only when every line is. */
function clothTone(cloth: readonly ClothPurchaseLine[]): StageStyle {
  return cloth.length > 0 && cloth.every((l) => l.source === "dyed_purchase") ? STAGE_STYLES.dyed : STAGE_STYLES.greige;
}

/**
 * One row of the document, by kind.
 *
 * A REFUSAL PRINTS ITS SENTENCE IN THE QTY CELL, never a blank and never a zero.
 * This is the engine's standing rule and a document is the worst place to break
 * it: 0 on a printed fabric requirement reads as "none needed", which for the
 * largest line in the order is the most expensive possible silent answer, and
 * this sheet is what a fabric purchase order is written from.
 */
function Row({ row, partial, stripe: striped }: { row: FabricSheetRow; partial: boolean; stripe: boolean }) {
  if (row.kind === "style") {
    /* THE STYLE BAND in the section's tint — the PDF's style row, same colour. */
    return (
      <tr>
        <td
          colSpan={6}
          className="border-b border-[#9aa4b2] px-2.5 pb-1.5 pt-3 text-[11.5px] font-bold uppercase tracking-[.1em]"
          style={totalRowStyle(BRAND)}
        >
          {row.label}
        </td>
      </tr>
    );
  }

  if (row.kind === "entry") {
    return (
      <tr>
        <td colSpan={6} className="border-b border-border px-2.5 pb-1.5 pt-2.5 align-top">
          <span className="font-medium">{row.fabric}</span>
          {/* THE STRUCTURE AND COMPONENTS ARE WHAT TELL TWO ENTRIES APART. Two
              entries of one jersey — a body and a sleeve — are planned
              separately and would otherwise print as the same heading twice. */}
          {(row.structure || row.components || row.widthForm) && (
            <span className="block text-[12px] text-[#5b6472]">
              {[row.structure, row.components, row.widthForm].filter(Boolean).join("  ·  ")}
            </span>
          )}
        </td>
      </tr>
    );
  }

  if (row.kind === "total") {
    /* A TOTAL IN THE SECTION'S TINT (2026-09-29, the PDF's total row) — red
       still, when part of it could not be planned: that is a warning, and a
       warning does not take the section's colour. */
    const look = partial ? "bg-[#fdeaea] text-[#b91c1c]" : "";
    const toned = partial ? undefined : totalRowStyle(BRAND);
    return (
      <tr className="fab-keep">
        <td
          colSpan={4}
          className={`border-b border-[#9aa4b2] px-2.5 py-1.5 font-semibold ${look}`}
          style={toned}
        >
          {row.label}
          {/* A TOTAL OVER A REFUSED SLICE SAYS SO. Without this the figure looks
              complete while part of its cloth could not be worked out, and the
              purchase order written from it is short by exactly the runs nobody
              had checked. */}
          {partial && (
            <span className="ml-2 font-normal">— part of this fabric could not be planned</span>
          )}
        </td>
        <td className={`border-b border-[#9aa4b2] px-2.5 py-1.5 ${look}`} style={toned}>
          {row.uom || "—"}
        </td>
        <td
          className={`border-b border-[#9aa4b2] px-2.5 py-1.5 text-right font-mono font-semibold tabular-nums ${look}`}
          style={toned}
        >
          {fabricSheetQty(row.qty, row.decimals)}
        </td>
      </tr>
    );
  }

  if (row.kind === "slice") {
    return (
      <tr style={stripeRow(striped ? 1 : 0)}>
        <td className="border-b border-border px-2.5 py-1.5" />
        <td className="border-b border-border px-2.5 py-1.5 text-[12.5px] text-[#5b6472]">
          {/* The colourway's swatch — "WHITE · M" reads its colour half. */}
          <Swatch name={row.slice.split("·")[0]} />
          {row.slice}
        </td>
        <td className="border-b border-border px-2.5 py-1.5 text-right font-mono text-[12.5px] tabular-nums text-[#5b6472]">
          {row.pieces == null ? "—" : fmtNumber(row.pieces)}
        </td>
        <td className="border-b border-border px-2.5 py-1.5 font-mono text-[12.5px] text-[#5b6472]">
          {fabricConsumptionLabel(row.consumption, row.wastagePct, null, row.decimals)}
        </td>
        <td className="border-b border-border px-2.5 py-1.5" />
        <Qty qty={row.qty} refusal={row.refusal} decimals={row.decimals} muted />
      </tr>
    );
  }

  return null;
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
      {fabricSheetQty(qty, decimals)}
    </td>
  );
}
