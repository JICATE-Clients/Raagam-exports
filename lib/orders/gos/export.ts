/**
 * Garment Order Sheet — PDF (download or print) and Excel.
 *
 * Browser-only (blob downloads, `window.open`, canvas), so call from a
 * `"use client"` island. Handed the SAME `GosSheet` the page renders, so the
 * page, the paper and the spreadsheet cannot disagree.
 *
 * The order documents' frame (client 2026-09-23: "follow our new format") —
 * green rule, logo, company + registered address, blue title — with the RE
 * Number printed large under the title: 500+ people track work by it, and a
 * sheet found face-down on a table has to be identifiable from arm's length.
 */
import { jsPDF } from "jspdf";
import autoTable, { type CellInput, type RowInput } from "jspdf-autotable";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import type { ReportStyleImages } from "./style-images";
import { isRefusal, type GosSheet, type GosStyle } from "./types";
import type { DocLetterhead } from "./letterhead";
import {
  CONSTRUCTION_ONLY,
  DASH,
  gosColourText,
  gosGsmText,
  gosHeaderColumns,
  gosStyleFacts,
  gosStyleTitle,
  txt,
} from "./format";

export type PdfOutput = "download" | "print";

function stem(s: GosSheet): string {
  const key = (s.header.reNumber || "order").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Garment-Order-Sheet_${key}`;
}

const num = (v: number | null) => (v === null ? DASH : fmtNumber(v));

function matrixBody(style: GosStyle): { head: string[]; body: RowInput[]; foot: string[] } | null {
  if (isRefusal(style.matrix)) return null;
  const m = style.matrix;
  return {
    head: ["Colour", ...m.columns.map((c) => c.label), "Total"],
    body: m.rows.map((r) => [`${r.combo}${r.undeclared ? " (not on Combos)" : ""}`, ...r.cells.map(num), fmtNumber(r.total)]),
    foot: ["Total", ...m.columnTotals.map((t) => fmtNumber(t)), fmtNumber(m.total)],
  };
}

function componentBody(style: GosStyle): { head: string[]; body: RowInput[] } | null {
  if (style.coordinates.length === 0) return null;
  const cols = 3 + style.colourways.length;
  const body: RowInput[] = [];
  for (const block of style.coordinates) {
    body.push([{ content: block.coordinate.toUpperCase(), colSpan: cols, styles: { fontStyle: "bold", fillColor: [246, 247, 249] } }]);
    for (const p of block.panels) {
      const row: CellInput[] = [txt(p.component), txt(p.structure), gosGsmText(p), ...p.colours.map(gosColourText)];
      body.push(row);
    }
  }
  return { head: ["Component", "Structure", "GSM", ...style.colourways], body };
}

export async function exportGosPdf(
  sheet: GosSheet,
  company: DocLetterhead,
  images: ReportStyleImages | { failed: string },
  output: PdfOutput = "download",
): Promise<void> {
  /* THE TAB OPENS BEFORE ANY AWAIT — a popup opened after one is no longer
     "in response to the click" and the browser blocks it. */
  const tab = output === "print" ? window.open("", "_blank") : null;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 30;
  const h = sheet.header;

  doc.setFillColor(133, 194, 39);
  doc.rect(M, 24, W - 2 * M, 3, "F");

  let x = M;
  const logo = await loadLetterheadImage(company.logo);
  if (logo) {
    const { w, h: lh } = fitLogo(logo, 100, 34);
    doc.addImage(logo.dataUrl, "PNG", M, 36, w, lh);
    x = M + w + 12;
  }
  doc.setTextColor(22, 24, 29);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text((company.name ?? "RAAGAM EXPORTS").toUpperCase(), x, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(91, 100, 114);
  const contact = [company.unit, company.address, company.gstin ? `GSTIN ${company.gstin}` : null]
    .filter(Boolean)
    .join("  ·  ");
  if (contact) doc.text(contact, x, 62, { maxWidth: W - x - 190 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(3, 123, 184);
  doc.text("GARMENT ORDER SHEET", W - M, 46, { align: "right" });
  doc.setFont("courier", "bold");
  doc.setFontSize(15);
  doc.setTextColor(22, 24, 29);
  doc.text(txt(h.reNumber), W - M, 64, { align: "right" });
  let top = 76;
  if (h.isDraft) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(179, 38, 30);
    doc.text("DRAFT — NOT CONFIRMED", W - M, 76, { align: "right" });
    top = 82;
  }

  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(1.2);
  doc.line(M, top, W - M, top);

  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const grid = {
    margin: { left: M, right: M },
    theme: "grid" as const,
    styles: { fontSize: 7.5, cellPadding: 2.5, textColor: 20, lineColor: 190, lineWidth: 0.4 },
    headStyles: { fillColor: [235, 237, 240] as [number, number, number], textColor: 20, fontStyle: "bold" as const },
    footStyles: { fillColor: [246, 247, 249] as [number, number, number], textColor: 20, fontStyle: "bold" as const },
  };
  const heading = (t: string, gap = 12) => {
    let y = lastY() + gap;
    if (y > H - 90) {
      doc.addPage();
      y = 40;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(22, 24, 29);
    doc.text(t.toUpperCase(), M, y);
    return y + 4;
  };

  // THE BOXED HEADER — four label/value column pairs, read down.
  const cols = gosHeaderColumns(sheet);
  const depth = Math.max(...cols.map((c) => c.length));
  const headerBody: string[][] = [];
  for (let i = 0; i < depth; i++) headerBody.push(cols.flatMap((c) => c[i] ?? ["", ""]));
  autoTable(doc, {
    ...grid,
    body: headerBody,
    startY: top + 8,
    columnStyles: { 0: { textColor: 110 }, 2: { textColor: 110 }, 4: { textColor: 110 }, 6: { textColor: 110 }, 1: { fontStyle: "bold" }, 3: { fontStyle: "bold" }, 5: { fontStyle: "bold" }, 7: { fontStyle: "bold" } },
  });

  const groups = "failed" in images ? [] : images;
  const styleRefs = new Set(sheet.styles.map((st) => st.styleRef?.trim()).filter(Boolean));
  const imagesOf = (ref: string | null | undefined) =>
    groups.find((g) => g.styleRef != null && g.styleRef === ref?.trim())?.images ?? [];

  /** A strip of pictures, 4 across, each fitted into a 110 x 100 pt box. */
  const drawImages = async (urls: string[], title: string) => {
    if (urls.length === 0) return;
    const loaded = (await Promise.all(urls.map((u) => loadLetterheadImage(u)))).filter((i) => i != null);
    let y = heading(title);
    if (loaded.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text("(pictures could not be loaded into the PDF — see the sheet on screen)", M, y + 8);
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY = y + 10;
      return;
    }
    const boxW = 110;
    const boxH = 100;
    if (y + boxH > H - 50) {
      doc.addPage();
      y = 40;
    }
    let cx = M;
    for (const img of loaded) {
      if (cx + boxW > W - M) {
        cx = M;
        y += boxH + 6;
        if (y + boxH > H - 50) {
          doc.addPage();
          y = 40;
        }
      }
      const { w, h: ih } = fitLogo(img, boxW - 6, boxH - 6);
      doc.setDrawColor(200);
      doc.setLineWidth(0.4);
      doc.rect(cx, y + 2, boxW, boxH);
      doc.addImage(img.dataUrl, "PNG", cx + (boxW - w) / 2, y + 2 + (boxH - ih) / 2, w, ih);
      cx += boxW + 6;
    }
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY = y + boxH + 2;
  };

  for (const g of groups.filter((g) => g.styleRef == null || !styleRefs.has(g.styleRef))) {
    await drawImages(
      g.images.map((i) => i.url),
      g.styleRef == null ? "Order images" : `Style images · ${g.styleRef}`,
    );
  }

  // DESTINATIONS — only when the order ships to more than one.
  if (sheet.destinations.length > 1) {
    autoTable(doc, {
      ...grid,
      head: [["Destination", "Customer PO", "Delivery", "Earlier shipment", "Qty"]],
      body: sheet.destinations.map((d) => [txt(d.label), txt(d.poNo), fmtDate(d.deliveryDate), fmtDate(d.earlierShipmentDate), fmtNumber(d.qty)]),
      startY: heading("Destinations"),
      columnStyles: { 4: { halign: "right" } },
    });
  }

  for (const style of sheet.styles) {
    // THE STYLE BANNER + its facts.
    autoTable(doc, {
      ...grid,
      body: [
        [
          { content: gosStyleTitle(style), colSpan: 4, styles: { fontStyle: "bold", fontSize: 9, fillColor: [246, 247, 249] } },
          { content: `PO Qty ${fmtNumber(style.poQty)}`, colSpan: 2, styles: { fontStyle: "bold", halign: "right", fontSize: 9, fillColor: [246, 247, 249] } },
        ],
        gosStyleFacts(style).slice(0, 3).flat(),
        [...gosStyleFacts(style).slice(3).flat(), "", ""],
        ...(style.coordinateWarning
          ? [[{ content: style.coordinateWarning, colSpan: 6, styles: { fontStyle: "bold", textColor: [179, 38, 30] } } as CellInput]]
          : []),
      ],
      startY: lastY() + 16,
      columnStyles: { 0: { textColor: 110 }, 2: { textColor: 110 }, 4: { textColor: 110 } },
    });

    await drawImages(imagesOf(style.styleRef).map((i) => i.url), "Style images");

    const mx = matrixBody(style);
    const my = heading("Size-wise and colour-wise break-up", 10);
    if (mx) {
      const numeric: Record<number, { halign: "right" }> = {};
      for (let i = 1; i < mx.head.length; i++) numeric[i] = { halign: "right" };
      autoTable(doc, { ...grid, head: [mx.head], body: mx.body, foot: [mx.foot], startY: my, columnStyles: numeric, showFoot: "lastPage" });
    } else {
      autoTable(doc, { ...grid, body: [[isRefusal(style.matrix) ? style.matrix.refused : ""]], startY: my, styles: { ...grid.styles, fontStyle: "bold" } });
    }

    const cb = componentBody(style);
    const cy = heading("Components", 10);
    if (cb) {
      autoTable(doc, { ...grid, head: [cb.head], body: cb.body, startY: cy, columnStyles: { 2: { halign: "right" } } });
    } else {
      autoTable(doc, {
        ...grid,
        body: [["No components are declared for this style — the Combos tab has no structure detail."]],
        startY: cy,
        styles: { ...grid.styles, fontStyle: "bold" },
      });
    }
  }

  // PIECES THAT LANDED NOWHERE ARE PRINTED, NOT DROPPED.
  if (sheet.orphans.length > 0) {
    autoTable(doc, {
      ...grid,
      head: [["Style ref (not declared)", "Colour", "Qty"]],
      body: sheet.orphans.map((o) => [o.ref, o.combo, fmtNumber(o.qty)]),
      startY: heading("Quantities not shown above — correct the order before cutting", 16),
      columnStyles: { 2: { halign: "right" } },
    });
  }

  // THE FOOT — order total, the construction-only line, the signatures.
  let fy = lastY() + 16;
  if (fy > H - 110) {
    doc.addPage();
    fy = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(20);
  doc.text(
    `Order total ${fmtNumber(sheet.grandTotal)} pcs · ${sheet.styles.length} style${sheet.styles.length === 1 ? "" : "s"}`,
    M,
    fy,
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(91, 100, 114);
  doc.text(CONSTRUCTION_ONLY, M, fy + 12, { maxWidth: W - 2 * M });

  const sy = fy + 64;
  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(0.6);
  doc.line(M, sy + 4, W - M, sy + 4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(20);
  doc.text("Prepared By", M, sy);
  doc.text("Checked By", W / 2, sy, { align: "center" });
  doc.text("Approved By", W - M, sy, { align: "right" });

  const printed = `Printed ${fmtDateTime(sheet.printedAt)}`;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(`${txt(h.reNumber)}  ·  ${printed}`, M, H - 18);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 18, { align: "right" });
  }

  if (output === "print" && tab && !tab.closed) {
    doc.autoPrint();
    tab.location.href = doc.output("bloburl").toString();
    return;
  }
  // A blocked print tab falls back to the download.
  doc.save(`${stem(sheet)}.pdf`);
}

/** Excel as a CSV — header facts, then each style's break-up and components. */
export function exportGosCsv(sheet: GosSheet): void {
  const lines: string[][] = [["Garment Order Sheet", txt(sheet.header.reNumber)], []];
  for (const col of gosHeaderColumns(sheet)) for (const [k, v] of col) lines.push([k, v]);
  if (sheet.destinations.length > 1) {
    lines.push([], ["Destination", "Customer PO", "Delivery", "Earlier shipment", "Qty"]);
    for (const d of sheet.destinations) lines.push([txt(d.label), txt(d.poNo), fmtDate(d.deliveryDate), fmtDate(d.earlierShipmentDate), String(d.qty)]);
  }
  for (const style of sheet.styles) {
    lines.push([], [gosStyleTitle(style), `PO Qty ${style.poQty}`], ...gosStyleFacts(style).map(([k, v]) => [k, v]));
    if (isRefusal(style.matrix)) {
      lines.push([style.matrix.refused]);
    } else {
      const m = style.matrix;
      /* Bare digits — a grouped "1,200" is a string to Excel and would not sum. */
      lines.push([], ["Colour", ...m.columns.map((c) => c.label), "Total"]);
      for (const r of m.rows) lines.push([r.combo, ...r.cells.map((v) => (v === null ? DASH : String(v))), String(r.total)]);
      lines.push(["Total", ...m.columnTotals.map(String), String(m.total)]);
    }
    if (style.coordinates.length) {
      lines.push([], ["Component", "Structure", "GSM", ...style.colourways]);
      for (const block of style.coordinates) {
        lines.push([block.coordinate]);
        for (const p of block.panels) lines.push([txt(p.component), txt(p.structure), gosGsmText(p), ...p.colours.map((c) => gosColourText(c).replace("\n", " / "))]);
      }
    }
  }
  if (sheet.orphans.length) {
    lines.push([], ["Quantities not shown above"], ["Style ref", "Colour", "Qty"]);
    for (const o of sheet.orphans) lines.push([o.ref, o.combo, String(o.qty)]);
  }
  lines.push([], ["Order total", String(sheet.grandTotal)], [CONSTRUCTION_ONLY]);

  const csv = lines
    .map((line) => line.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","))
    .join("\n");
  // The BOM prefix keeps Excel reading UTF-8 and not a leading `=` as a formula.
  const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem(sheet)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
