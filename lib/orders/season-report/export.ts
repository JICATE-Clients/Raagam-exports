import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  BRAND,
  cardTableHead,
  cardTableStyles,
  drawCardHeader,
  drawSheetLabel,
  drawSheetMasthead,
  drawSummaryTiles,
  paintRow,
  roomFor,
} from "@/lib/orders/report-pdf-kit";
import { finishPdf, openPrintTab, type PdfOutput } from "@/lib/orders/fabric-bom/reports-export";
import { fitLogo, loadLetterheadImage, type LetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import { daysUntil, totalsOf } from "./derive";
import { FULFILMENT_LABEL, type SeasonDetail, type SeasonOrder } from "./types";

/**
 * Season Report ▸ PDF — the Summary or the Detailed format as a document.
 *
 * It is drawn from the SAME rows the screen shows (the screen hands over what it
 * is displaying, after the Shipped / Pending boxes), so a printed report can
 * never contain an order the reader had just filtered out. Print and Download
 * make the one PDF, like every other order report (no Excel: a spreadsheet can
 * be edited and circulated with the figures changed).
 */

const M = 28;

function dueWords(o: SeasonOrder, today: string): string {
  if (o.fulfilment === "shipped") return "Delivered";
  if (!o.deliveryDate) return "";
  const d = daysUntil(o.deliveryDate, today);
  return d < 0 ? `${-d}d late` : d === 0 ? "due today" : `in ${d}d`;
}

export async function exportSeasonReportPdf(opts: {
  mode: "summary" | "detailed";
  label: string;
  company: string | null;
  today: string;
  orders: SeasonOrder[];
  details: ReadonlyMap<string, SeasonDetail>;
  output?: PdfOutput;
}): Promise<void> {
  const { mode, label, company, today, orders, details } = opts;
  const tab = openPrintTab(opts.output ?? "download");
  const t = totalsOf(orders);

  // Pictures only for the Summary (the Detailed matrices are the point there).
  const thumbs = new Map<string, LetterheadImage>();
  if (mode === "summary") {
    const got = await Promise.all(
      orders.map(async (o) => [o.salesOrderId, o.thumbnail ? await loadLetterheadImage(o.thumbnail).catch(() => null) : null] as const),
    );
    for (const [id, img] of got) if (img) thumbs.set(id, img);
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const RIGHT = doc.internal.pageSize.getWidth() - M;

  let y = drawSheetMasthead(doc, {
    company,
    kind: mode === "summary" ? "Season Report · Summary" : "Season Report · Detailed",
    reNo: label,
    meta: `${t.orders} order${t.orders === 1 ? "" : "s"} · as of ${fmtDate(today)}`,
  });
  y = drawSheetLabel(doc, M, y + 2, "This season");
  y = drawSummaryTiles(
    doc,
    y,
    [
      { label: "Orders", value: String(t.orders), note: `${t.customers} buyer${t.customers === 1 ? "" : "s"}`, tone: BRAND },
      { label: "Pieces committed", value: fmtNumber(t.qty), unit: "pcs", tone: BRAND },
      { label: "Shipped", value: fmtNumber(t.shippedQty), unit: "pcs", note: `${t.shippedPct}% of pieces`, tone: BRAND },
      { label: "Balance to ship", value: fmtNumber(t.balanceQty), unit: "pcs", note: t.late + t.atRisk ? `${t.late} late · ${t.atRisk} at risk` : "none late or at risk", tone: BRAND },
    ],
    M,
  );

  if (mode === "summary") {
    y = roomFor(doc, y, 90, 40);
    const start = drawCardHeader(doc, M, y + 4, RIGHT - M, BRAND, "Orders in the season", fmtNumber(t.qty), "Pieces");
    const body = orders.map((o) => [
      "",
      o.reNo ?? "—",
      o.customer ?? "—",
      o.deliveryDate ? `${fmtDate(o.deliveryDate)}${dueWords(o, today) ? `\n${dueWords(o, today)}` : ""}` : "—",
      fmtNumber(o.qty),
      fmtNumber(o.shippedQty),
      fmtNumber(o.balanceQty),
      `${FULFILMENT_LABEL[o.fulfilment]}${o.riskLevel === "late" || o.riskLevel === "at_risk" ? `\n${o.riskLabel}` : ""}`,
    ]);
    body.push(["", `TOTAL · ${t.orders} orders`, "", "", fmtNumber(t.qty), fmtNumber(t.shippedQty), fmtNumber(t.balanceQty), ""]);
    const last = new Set([body.length - 1]);
    autoTable(doc, {
      head: [["Style", "Order / Ref No", "Buyer", "Delivery", "Total Qty", "Shipped", "Balance", "Status"]],
      body,
      startY: start,
      margin: { left: M, right: M },
      styles: { ...cardTableStyles(), minCellHeight: 30, valign: "middle" },
      headStyles: cardTableHead(),
      theme: "plain",
      columnStyles: { 0: { cellWidth: 40 }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
      didParseCell: (d) => paintRow(d, { tone: BRAND, totals: last }),
      didDrawCell: (d) => {
        if (d.section !== "body" || d.column.index !== 0) return;
        const o = orders[d.row.index];
        const img = o ? thumbs.get(o.salesOrderId) : undefined;
        if (!img) return;
        const f = fitLogo(img, 28, 24);
        doc.addImage(img.dataUrl, "PNG", d.cell.x + 5 + (28 - f.w) / 2, d.cell.y + 3 + (24 - f.h) / 2, f.w, f.h);
      },
    });
  } else {
    for (const o of orders) {
      const d = details.get(o.salesOrderId);
      y = roomFor(doc, finalY(doc, y), 110, 40);
      y = drawCardHeader(doc, M, y + 8, RIGHT - M, BRAND, `${o.reNo ?? "—"}  ·  ${o.customer ?? "—"}`, fmtNumber(o.qty), "Pieces");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.4);
      doc.setTextColor(60);
      const facts = [
        FULFILMENT_LABEL[o.fulfilment],
        o.deliveryDate ? `Delivery ${fmtDate(o.deliveryDate)} (${dueWords(o, today)})` : null,
        o.poNo ? `PO ${o.poNo}` : null,
        `Shipped ${fmtNumber(o.shippedQty)} · Balance ${fmtNumber(o.balanceQty)}`,
      ].filter(Boolean);
      doc.text(facts.join("   ·   "), M + 7, y + 11);
      y += 16;

      if (!d || d.styles.length === 0) {
        doc.text(d ? "This order has no style entered yet." : "Colour and size breakdown not loaded.", M + 7, y + 8);
        y += 14;
      }
      for (const s of d?.styles ?? []) {
        y = roomFor(doc, y, 70, 40);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.6);
        doc.setTextColor(30);
        doc.text(
          [s.styleRef, s.description, s.articleNo ? `Art ${s.articleNo}` : null].filter(Boolean).join("  ·  "),
          M + 7,
          y + 9,
        );
        doc.setTextColor(0);
        if (s.refused) {
          doc.setFont("helvetica", "normal");
          doc.text(s.refused, M + 7, y + 21);
          y += 28;
          continue;
        }
        const rows = s.rows.map((r) => [r.combo || "—", ...r.cells.map((c) => (c == null ? "·" : fmtNumber(c))), fmtNumber(r.total)]);
        rows.push(["TOTAL", ...s.columnTotals.map((c) => fmtNumber(c)), fmtNumber(s.total)]);
        const cols: Record<number, { halign: "right" }> = {};
        for (let i = 1; i <= s.columns.length + 1; i++) cols[i] = { halign: "right" };
        autoTable(doc, {
          head: [["Combo / Colour", ...s.columns, "Total"]],
          body: rows,
          startY: y + 13,
          margin: { left: M, right: M },
          styles: cardTableStyles(),
          headStyles: cardTableHead(),
          theme: "plain",
          columnStyles: cols,
          didParseCell: (c) => paintRow(c, { tone: BRAND, totals: new Set([rows.length - 1]) }),
        });
        y = finalY(doc, y) + 4;
      }

      const f = o.fabric;
      const kg = (v: number | null) => (v == null ? "—" : `${fmtNumber(v)} kg`);
      y = roomFor(doc, y, 20, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(60);
      doc.text(
        `Fabric — required ${kg(f.requiredKg)}   received ${kg(f.receivedKg)}   balance to receive ${kg(f.balanceKg)}${f.note ? `   (${f.note})` : ""}`,
        M + 7,
        y + 8,
      );
      doc.setTextColor(0);
      y += 14;
    }
  }

  // Page numbers at the foot, like every order sheet.
  const pages = doc.getNumberOfPages();
  const H = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(110);
    doc.text(`Season Report · ${label} · printed ${fmtDate(today)}`, M, H - 18);
    doc.text(`Page ${p} / ${pages}`, RIGHT, H - 18, { align: "right" });
  }

  finishPdf(doc, `season-report_${label.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all"}_${mode}.pdf`, opts.output ?? "download", tab);
}

/** Where autoTable stopped, else the fallback. */
function finalY(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return last ? Math.max(fallback, last.finalY) : fallback;
}
