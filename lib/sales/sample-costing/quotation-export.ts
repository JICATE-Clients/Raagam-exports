/**
 * Sample Costing — the buyer's QUOTATION sheet as a PDF (spec §5.1: "Generates
 * official PDF quotation sheet for buyer transmission").
 *
 * Browser-only (jsPDF, blob download, `window.open`) — call from the screen.
 * The order documents' frame (report-pdf-kit: masthead, facts, tiles, cards),
 * so a quotation looks like every other document Raagam sends out.
 *
 * PRICES ONLY. This sheet goes to the buyer: it prints the quoted price per
 * piece and size and the set price — never the fabric rates, CMT, margin
 * or wastage behind them. The cost breakdown stays on the screen. A piece with
 * no quoted price prints its calculated price, rounded to the cent, because a
 * quotation with a blank price is not a quotation; Submit is where an unquoted
 * sheet is noticed, not here.
 */
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { fmtDate } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import {
  BRAND,
  cardTableHead,
  cardTableStyles,
  drawCardHeader,
  drawOrderFacts,
  drawSheetLabel,
  drawSheetMasthead,
  drawSummaryTiles,
  paintRow,
  rgb,
} from "@/lib/orders/report-pdf-kit";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import type { CostingSummary } from "./calc";

export type QuotationSheet = {
  costingNo: string | null;
  revision: string;
  date: string | null;
  customer: string | null;
  enquiryNo: string | null;
  sampleNo: string | null;
  style: string | null;
  description: string | null;
  season: string | null;
  currency: string | null;
  shipMode: string | null;
  isSet: boolean;
  pieceName: (key: string) => string;
  sizeName: (size: string | null) => string;
  summary: CostingSummary;
  approved: boolean;
};

const price = (v: number | null, ccy: string | null) => (v == null ? "—" : `${ccy ?? ""} ${v.toFixed(2)}`.trim());
/** The price the buyer is offered: the quoted one, else the calculated one. */
const offered = (quoted: number | null, calc: number | null) => quoted ?? (calc == null ? null : Math.round(calc * 100) / 100);

export async function exportQuotationPdf(
  q: QuotationSheet,
  company: DocLetterhead,
  output: "download" | "print" = "download",
): Promise<void> {
  // The tab opens before any await, or the browser blocks it as a popup.
  const tab = output === "print" ? window.open("", "_blank") : null;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 30;
  const CW = W - 2 * M;

  const logo = await loadLetterheadImage(company.logo);
  const fitted = logo ? fitLogo(logo, 96, 32) : null;
  let y = drawSheetMasthead(doc, {
    company: company.name,
    unit: company.unit,
    logo: logo && fitted ? { dataUrl: logo.dataUrl, w: fitted.w, h: fitted.h } : null,
    kind: "Price Quotation",
    reNo: [q.costingNo, q.revision].filter(Boolean).join(" · "),
    meta: q.date ? `Dated ${fmtDate(q.date)}` : null,
    status: q.approved ? "Approved" : null,
    margin: M,
  });

  y = drawOrderFacts(
    doc,
    y,
    [
      { label: "Customer", value: q.customer },
      { label: "Enquiry No", value: q.enquiryNo },
      { label: "Sample No", value: q.sampleNo },
      { label: "Style", value: q.style },
      { label: "Description", value: q.description },
      { label: "Season", value: q.season },
      { label: "Currency", value: q.currency },
      { label: "Shipment", value: q.shipMode },
    ],
    { margin: M, cols: 4 },
  );

  const groups = q.summary.groups;
  y = drawSheetLabel(doc, M, y + 6, q.isSet ? "Set price" : "Price");
  y = drawSummaryTiles(
    doc,
    y,
    groups.map((g) => ({
      label: groups.length > 1 ? q.sizeName(g.size) : q.isSet ? "Quoted set price" : "Quoted price",
      value: price(
        g.pieces.every((p) => offered(p.quoted, p.calc) != null)
          ? g.pieces.reduce((t, p) => t + (offered(p.quoted, p.calc) ?? 0), 0)
          : null,
        q.currency,
      ),
      unit: q.isSet ? "per set" : "per piece",
      tone: BRAND,
    })),
    M,
  );

  const top = drawCardHeader(doc, M, y + 12, CW, BRAND, q.isSet ? "Price by piece" : "Price by size");
  const body: RowInput[] = groups.flatMap((g) => [
    ...g.pieces.map((p) => [q.pieceName(p.pieceKey), q.sizeName(g.size), price(offered(p.quoted, p.calc), q.currency)]),
    ...(q.isSet
      ? [
          [
            "Set total",
            q.sizeName(g.size),
            price(
              g.pieces.every((p) => offered(p.quoted, p.calc) != null)
                ? g.pieces.reduce((t, p) => t + (offered(p.quoted, p.calc) ?? 0), 0)
                : null,
              q.currency,
            ),
          ],
        ]
      : []),
  ]);
  const totals = new Set<number>();
  if (q.isSet) {
    let i = 0;
    for (const g of groups) {
      i += g.pieces.length;
      totals.add(i);
      i += 1;
    }
  }
  autoTable(doc, {
    startY: top,
    margin: { left: M, right: M, top: 40 },
    theme: "plain",
    styles: cardTableStyles(),
    headStyles: cardTableHead(),
    head: [["Piece", "Size", `Price (${q.currency ?? ""})`]],
    body,
    columnStyles: { 2: { halign: "right" } },
    didParseCell: (d) => {
      paintRow(d as Parameters<typeof paintRow>[0], { tone: BRAND, totals });
      if (d.section === "body" && totals.has(d.row.index)) d.cell.styles.fontStyle = "bold";
    },
  });

  const end = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...rgb("#5b6472"));
  doc.text(
    "Prices are per piece unless stated, valid for the quantities and specification of this sample, subject to final order confirmation.",
    M,
    end + 18,
    { maxWidth: CW },
  );
  doc.setTextColor(0);

  const stem = `Quotation_${(q.costingNo ?? "costing").replace(/[^A-Za-z0-9]+/g, "-")}_${q.revision.replace(/\s+/g, "")}`;
  if (output === "print" && tab) {
    tab.location.href = String(doc.output("bloburl"));
  } else {
    doc.save(`${stem}.pdf`);
  }
}
