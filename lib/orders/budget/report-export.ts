/**
 * Budget Statement — PDF (download or print) and Excel.
 *
 * Browser-only (blob downloads, `window.open`), so call from a `"use client"`
 * island. Handed the SAME `OrderBudgetReport` the page renders, so the page,
 * the paper and the spreadsheet cannot disagree.
 *
 * IN THE SHEET FORMAT (user 2026-09-29: "this is okay apply it" — the approved
 * "Raagam Budget Statement" mockup), portrait A4: masthead with the RE No and
 * status, the order's facts, the RESULT first (net profit, sales value, total
 * cost, cost per garment), where the cost goes as one bar to scale, the
 * quantity as a sum, then one card per cost group — value, share and Rs / pc in
 * its header; each Cost Head's lines and subtotal inside (the legacy's
 * "… CONTRIBUTION ( 34.67 % ) RS. 82.84 PER GARMENT" figures, unchanged) — the
 * summary, the amendment when there is one, and the signatures. Every figure
 * of the legacy statement is kept. Blocks from `../report-pdf-kit.ts`; display
 * decisions from `./sheet-format.ts`, which the screen reads too. Money prints
 * "Rs" — the PDF's standard fonts have no ₹ glyph.
 *
 * The Excel keeps the legacy's flat shape (raw digits, so it sums).
 */
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import {
  BRAND,
  CONTINUED_TOP,
  ROW_STRIPE,
  cardTableHead,
  cardTableStyles,
  drawCardHeader,
  drawOrderFacts,
  drawQtyEquation,
  drawSheetLabel,
  drawSheetMasthead,
  drawSummaryTiles,
  paintRow,
  rgb,
  roomFor,
} from "@/lib/orders/report-pdf-kit";
import type { Fig, OrderBudgetReport } from "./report";
import { contributionText, inr, isFigRefusal, qtyCell } from "./report-format";
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
} from "./sheet-format";

export type PdfOutput = "download" | "print";

const figText = (v: Fig, dp: number) => (isFigRefusal(v) ? v.refused : v.toFixed(dp));
const ccyText = (v: string | { refused: string }) => (typeof v === "string" ? v : v.refused);

function stem(r: OrderBudgetReport): string {
  const key = (r.header.reNo || r.budget.code || "budget").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Budget-Statement_${key}`;
}

/** Header facts, label → value, in the legacy's four columns (read down). */
function headerColumns(r: OrderBudgetReport): [string, string][][] {
  const h = r.header;
  return [
    [["RE No", h.reNo ?? "—"], ...(h.otherReNos.length ? [["Also covers", h.otherReNos.join(", ")] as [string, string]] : [])],
    [
      ["Customer", h.customer ?? "—"],
      ["Delivery window", `${fmtDate(h.deliveryFrom)}  To: ${fmtDate(h.deliveryTo)}`],
    ],
    [
      ["Avg Price", figText(h.avgPrice, 3)],
      ["Currency", ccyText(h.currency)],
    ],
    [
      ["Ex-Rate", figText(h.exRate, 4)],
      ["Sales Value", inr(h.salesValue)],
    ],
  ];
}

// "Style" / "Description", never "Style Ref No" (user 2026-09-29).
const QTY_HEAD = ["RE No", "Order No", "Style", "Description", "Unit", "Order", "Excess", "Approval", "Rej.Allow", "Cut Qty"];

function qtyRows(r: OrderBudgetReport): string[][] {
  return r.quantities.map((q) => [
    q.reNo ?? "—",
    q.orderNo ?? "—",
    q.styleRefNo ?? "—",
    q.style ?? "",
    q.unit ?? "",
    qtyCell(q.order),
    qtyCell(q.excess),
    qtyCell(q.approval),
    qtyCell(q.rejection),
    isFigRefusal(q.cut) ? q.cut.refused : qtyCell(q.cut),
  ]);
}

const STATEMENT_HEAD = ["Group Head", "Cost Head", "Particulars", "Qty", "UOM", "Rate", "Value"];

function summaryPairs(r: OrderBudgetReport): [string, string][] {
  const s = r.summary;
  return [
    ["Total Income", inr(s.totalIncome)],
    ["Total Expenses", inr(s.totalExpenses)],
    ["Net Profit", inr(s.netProfit)],
    ["Profit %", figText(s.profitPct, 2)],
    ["Cost Per Garment", inr(s.costPerGarment)],
    ["Profit Per Garment", inr(s.profitPerGarment)],
  ];
}

function amendmentRows(r: OrderBudgetReport): string[][] {
  const a = r.amendment;
  if (!a) return [];
  return [
    ["Margin %", figText(a.margin.original, 2), figText(a.margin.amended, 2), figText(a.margin.delta, 2)],
    ...a.rows.map((x) =>
      x.kind === "percent"
        ? [x.label, figText(x.baseline, 2), figText(x.current, 2), figText(x.variance, 2)]
        : [x.label, inr(x.baseline), inr(x.current), inr(x.variance)],
    ),
  ];
}

export async function exportOrderBudgetPdf(
  r: OrderBudgetReport,
  output: PdfOutput = "download",
  showAmendment = true,
): Promise<void> {
  /* THE TAB OPENS BEFORE ANY AWAIT — a popup opened after one is no longer
     "in response to the click" and the browser blocks it. */
  const tab = output === "print" ? window.open("", "_blank") : null;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  const CW = W - 2 * M;
  const c = r.company;
  const b = r.budget;
  const h = r.header;
  const sm = r.summary;
  /* THE PDF'S FONTS HAVE NO ₹ GLYPH — money prints "Rs" here, "₹" on screen. */
  const RS = "Rs";
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // ---- masthead + order facts ------------------------------------------
  const logo = await loadLetterheadImage(c.logo);
  const fitted = logo ? fitLogo(logo, 96, 32) : null;
  let y = drawSheetMasthead(doc, {
    company: c.name,
    logo: logo && fitted ? { dataUrl: logo.dataUrl, w: fitted.w, h: fitted.h } : null,
    kind: "Budget Statement",
    reNo: h.reNo,
    meta: [b.code ? `Budget ${b.code}` : null, `Printed ${fmtDateTime(new Date().toISOString())}`].filter(Boolean).join(" · "),
    status: b.statusText,
  });
  const mine = r.quantities.filter((q) => q.reNo === h.reNo);
  const first = mine[0] ?? r.quantities[0];
  const styles = [...new Set(mine.map((q) => q.styleRefNo).filter(Boolean))];
  const ccy = typeof h.currency === "string" ? h.currency : "";
  y = drawOrderFacts(
    doc,
    y,
    [
      { label: "Customer", value: h.customer },
      {
        label: "Order No · Style",
        value: [first?.orderNo, styles.length > 1 ? `${styles.length} styles` : first?.styleRefNo].filter(Boolean).join(" · "),
        sub: styles.length > 1 ? null : first?.style,
      },
      {
        label: "Earlier Shipment",
        value: h.earlierShipment ? fmtDate(h.earlierShipment) : null,
        sub: h.deliveryFrom
          ? h.deliveryTo && h.deliveryTo !== h.deliveryFrom
            ? `Delivery ${fmtDate(h.deliveryFrom)} - ${fmtDate(h.deliveryTo)}`
            : `Delivery ${fmtDate(h.deliveryFrom)}`
          : null,
      },
      {
        label: "Price",
        value: `${ccy} ${figText(h.avgPrice, 3)} x ${figText(h.exRate, 4)}`.trim(),
        sub: typeof h.currency === "string" ? "per piece · exchange rate" : h.currency.refused,
      },
      ...(h.otherReNos.length ? [{ label: "Also covers", value: h.otherReNos.join(", ") }] : []),
    ],
    { cols: 4 },
  );

  // ---- the unrated notice, where the figures it withholds begin ---------
  if (r.unratedNotice) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(179, 38, 30);
    const lines = doc.splitTextToSize(r.unratedNotice, CW - 16) as string[];
    doc.setFillColor(253, 243, 242);
    doc.roundedRect(M, y, CW, 8 + lines.length * 9, 3, 3, "F");
    doc.text(lines, M + 8, y + 11);
    y += 14 + lines.length * 9;
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
  }

  // ---- the result, first -------------------------------------------------
  y = drawSheetLabel(doc, M, y + 4, "Result");
  const salesNote = (() => {
    const order = r.quantities.reduce((s, q) => s + (q.order ?? 0), 0);
    if (!order || isFigRefusal(h.avgPrice) || isFigRefusal(h.exRate) || typeof h.currency !== "string") return null;
    return `${order.toLocaleString("en-IN")} pcs x ${h.currency} ${h.avgPrice.toFixed(3)} x ${h.exRate.toFixed(4)}`;
  })();
  y = drawSummaryTiles(doc, y, [
    {
      label: "Net profit",
      value: isFigRefusal(sm.profitPct) ? "—" : `${sm.profitPct.toFixed(2)}%`,
      note: isFigRefusal(sm.netProfit)
        ? sm.netProfit.refused
        : [money(sm.netProfit, RS), isFigRefusal(sm.profitPerGarment) ? null : `${RS} ${sm.profitPerGarment.toFixed(2)} per garment`]
            .filter(Boolean)
            .join(" · "),
      tone: PROFIT_TONE,
    },
    { label: "Sales value", value: money(h.salesValue, RS), note: salesNote },
    {
      label: "Total cost",
      value: money(sm.totalExpenses, RS),
      note:
        !isFigRefusal(sm.totalExpenses) && !isFigRefusal(h.salesValue) && h.salesValue > 0
          ? `${((sm.totalExpenses / h.salesValue) * 100).toFixed(2)}% of sales`
          : null,
    },
    {
      label: "Cost per garment",
      value: money(sm.costPerGarment, RS),
      note: isFigRefusal(r.cutQty) ? null : `on ${qtyCell(r.cutQty)} cut pcs`,
    },
  ]);

  // ---- where the cost goes: one bar to scale + a legend ------------------
  const segments = costSegments(r, RS);
  if (segments.length) {
    y = roomFor(doc, y, 80, 50);
    y = drawSheetLabel(doc, M, y + 4, "Where the cost goes");
    const barH = 9;
    let bx = M;
    for (const sg of segments) {
      const w = (CW * sg.pct) / 100;
      doc.setFillColor(...rgb(sg.tone.rule));
      doc.rect(bx, y, w, barH, "F");
      bx += w;
    }
    doc.setDrawColor(221, 226, 232);
    doc.setLineWidth(0.5);
    doc.roundedRect(M, y, CW, barH, 2, 2, "S");
    y += barH + 12;
    const colW = CW / 3;
    segments.forEach((sg, i) => {
      const lx = M + (i % 3) * colW;
      const ly = y + Math.floor(i / 3) * 22;
      doc.setFillColor(...rgb(sg.tone.rule));
      doc.roundedRect(lx, ly - 6, 6, 6, 1, 1, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      doc.setTextColor(23, 32, 43);
      doc.text(sg.label, lx + 10, ly);
      doc.setFont("courier", "bold");
      doc.text(money(sg.value, RS), lx + colW - 10, ly, { align: "right" });
      doc.setFont("courier", "normal");
      doc.setFontSize(6.4);
      doc.setTextColor(123, 133, 148);
      doc.text(sg.share, lx + 10, ly + 9);
    });
    y += Math.ceil(segments.length / 3) * 22 + 4;
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
  }

  // ---- the quantity, as the sum it is -------------------------------------
  y = roomFor(doc, y, 60, 50);
  y = drawSheetLabel(doc, M, y + 4, "Quantity");
  const q = quantitySum(r);
  y = drawQtyEquation(
    doc,
    y,
    [
      { label: "Order", value: qtyCell(q.order) || "0" },
      { label: "Excess", value: qtyCell(q.excess) || "0" },
      { label: "Approval", value: qtyCell(q.approval) || "0" },
      { label: "Rej. Allow", value: qtyCell(q.rejection) || "0" },
    ],
    { label: "Cut Qty", value: isFigRefusal(q.cut) ? "—" : qtyCell(q.cut), note: isFigRefusal(q.cut) ? q.cut.refused : null },
  );
  /* Several styles: the per-style breakdown the sum came from, as its own card. */
  if (r.quantities.length > 1) {
    y = roomFor(doc, y, 70, 50);
    const startY = drawCardHeader(doc, M, y, CW, BRAND, "Quantity by style");
    autoTable(doc, {
      head: [QTY_HEAD.map((t, i) => ({ content: t, styles: { halign: i >= 5 ? ("right" as const) : ("left" as const) } }))],
      body: qtyRows(r),
      startY,
      margin: { left: M, right: M, top: CONTINUED_TOP },
      theme: "plain",
      styles: cardTableStyles(),
      headStyles: cardTableHead(),
      columnStyles: { 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right", fontStyle: "bold" } },
      didParseCell: (d) => paintRow(d, { tone: BRAND }),
    });
    y = lastY() + 12;
  }

  // ---- one card per cost group ---------------------------------------------
  for (const g of [...r.groups, ...(r.income ? [r.income] : [])]) {
    const tone = groupTone(g.key);
    const ownRows = headIsOwnRow(g);
    type Kind = "head" | "line" | "sub";
    const kinds: Kind[] = [];
    const body: RowInput[] = [];
    let stripe = 0;
    const stripeOf: number[] = [];
    for (const hd of g.heads) {
      /* A Cost Head of ONE line: its heading row carries its share figures, and
         no subtotal repeats the line's own value. */
      const single = ownRows && hd.lines.length === 1;
      if (ownRows) {
        body.push([
          { content: [hd.label.toUpperCase(), single ? shareText(hd, RS) : null].filter(Boolean).join("   ·   "), colSpan: 5 },
        ]);
        kinds.push("head");
        stripeOf.push(-1);
      }
      for (const l of hd.lines) {
        const flag = lineFlag(l);
        const text = [l.particulars, flag ? `[${flag}]` : null].filter(Boolean).join("  ");
        body.push([
          text,
          isFigRefusal(l.qty) ? l.qty.refused : qtyText(l.qty),
          l.uom ?? "",
          l.rate,
          l.value == null ? "" : isFigRefusal(l.value) ? l.value.refused : inr(l.value),
        ]);
        kinds.push("line");
        stripeOf.push(stripe++);
      }
      if (ownRows && !single) {
        body.push([
          { content: [hd.label, shareText(hd, RS)].filter(Boolean).join("  ·  "), colSpan: 4 },
          isFigRefusal(hd.value) ? hd.value.refused : inr(hd.value),
        ]);
        kinds.push("sub");
        stripeOf.push(-1);
      }
    }
    y = roomFor(doc, y + 4, 80, 50);
    const startY = drawCardHeader(doc, M, y, CW, tone, g.label, money(g.value, RS), shareText(g, RS));
    autoTable(doc, {
      head: [["Particulars", "Qty", "UOM", "Rate", `Value ${RS}`].map((t, i) => ({ content: t, styles: { halign: i === 1 || i >= 3 ? ("right" as const) : ("left" as const) } }))],
      body,
      startY,
      margin: { left: M, right: M, top: CONTINUED_TOP },
      theme: "plain",
      styles: cardTableStyles(),
      headStyles: cardTableHead(),
      columnStyles: {
        1: { halign: "right", cellWidth: 58 },
        2: { cellWidth: 34 },
        3: { halign: "right", cellWidth: 62 },
        4: { halign: "right", cellWidth: 74 },
      },
      didParseCell: (d) => {
        if (d.section !== "body") return;
        const k = kinds[d.row.index];
        if (k === "head") {
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.fontSize = 6.4;
          d.cell.styles.textColor = rgb(tone.ink);
          d.cell.styles.cellPadding = { top: 6, right: 5, bottom: 2.5, left: 5 };
        } else if (k === "sub") {
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.fillColor = rgb(tone.tint);
          d.cell.styles.textColor = rgb(tone.ink);
        } else if (stripeOf[d.row.index] % 2 === 1) {
          d.cell.styles.fillColor = rgb(ROW_STRIPE);
        }
      },
    });
    y = lastY() + 10;
  }

  // ---- the summary ----------------------------------------------------------
  y = roomFor(doc, y, 90, 50);
  y = drawSheetLabel(doc, M, y + 4, "Summary");
  autoTable(doc, {
    body: [
      ["Total income", money(sm.totalIncome, RS)],
      ["Total expenses", money(sm.totalExpenses, RS)],
      ["Cost per garment", money(sm.costPerGarment, RS)],
      ["Profit per garment", money(sm.profitPerGarment, RS)],
      [`Net profit${isFigRefusal(sm.profitPct) ? "" : ` · ${sm.profitPct.toFixed(2)}%`}`, money(sm.netProfit, RS)],
    ],
    startY: y,
    margin: { left: M, right: M },
    theme: "plain",
    styles: { ...cardTableStyles(), fontSize: 8 },
    columnStyles: { 1: { halign: "right", font: "courier" } },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      if (d.row.index === 2) d.cell.styles.fontStyle = "bold";
      if (d.row.index === 4) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = rgb(PROFIT_TONE.tint);
        d.cell.styles.textColor = rgb(PROFIT_TONE.ink);
      }
    },
  });
  y = lastY() + 10;

  if (showAmendment && r.amendment) {
    y = roomFor(doc, y, 80, 50);
    const startY = drawCardHeader(
      doc,
      M,
      y,
      CW,
      BRAND,
      `Amendment${r.amendment.entryNo ? ` ${r.amendment.entryNo}` : ""} — Approved vs Proposed`,
    );
    autoTable(doc, {
      head: [["Figure", "Approved", "Proposed", "Variance"].map((t, i) => ({ content: t, styles: { halign: i ? ("right" as const) : ("left" as const) } }))],
      body: amendmentRows(r),
      startY,
      margin: { left: M, right: M, top: CONTINUED_TOP },
      theme: "plain",
      styles: cardTableStyles(),
      headStyles: cardTableHead(),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
      // Margin % leads, bold — the one figure the MD reads first.
      didParseCell: (d) => {
        paintRow(d, { tone: BRAND });
        if (d.section === "body" && d.row.index === 0) d.cell.styles.fontStyle = "bold";
      },
    });
    y = lastY() + 10;
  }

  // ---- signatures, then the end mark ----------------------------------------
  let sy = y + 44;
  if (sy > H - 50) {
    doc.addPage();
    sy = 110;
  }
  const third = CW / 3;
  const cells: [string, string | null][] = [
    ["Prepared By", b.preparedBy],
    ["Checked By", null],
    ["Approved By", b.approvedBy],
  ];
  cells.forEach(([label, name], i) => {
    const x = M + i * third;
    doc.setDrawColor(23, 32, 43);
    doc.setLineWidth(0.6);
    doc.line(x, sy, x + third - 18, sy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(23, 32, 43);
    doc.text(label, x, sy + 10);
    if (name) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      doc.setTextColor(123, 133, 148);
      doc.text(name, x, sy + 19);
    }
  });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(123, 133, 148);
  doc.text("End of report", W - M, sy + 32, { align: "right" });

  const foot = [h.reNo, "Budget Statement", b.code ? `Budget ${b.code}` : null].filter(Boolean).join(" · ");
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(foot, M, H - 18);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 18, { align: "right" });
  }

  if (output === "print" && tab && !tab.closed) {
    doc.autoPrint();
    tab.location.href = doc.output("bloburl").toString();
    return;
  }
  // A blocked print tab falls back to the download.
  doc.save(`${stem(r)}.pdf`);
}

/** Excel as a CSV — the header, the quantities, then the statement flat, one
 *  row per line with its Group Head and Cost Head repeated so it filters. */
export function exportOrderBudgetCsv(r: OrderBudgetReport, showAmendment = true): void {
  /* Bare digits — a grouped "6,22,446.87" is a string to Excel and would not sum. */
  const raw = (v: Fig | null) => (v == null ? "" : isFigRefusal(v) ? v.refused : String(v));
  const lines: string[][] = [["Budget Statement", r.budget.code ?? "", r.budget.statusText], []];
  for (const col of headerColumns(r)) for (const [k, v] of col) lines.push([k, v]);
  lines.push([], QTY_HEAD, ...qtyRows(r), []);
  if (r.unratedNotice) lines.push([r.unratedNotice], []);
  lines.push(STATEMENT_HEAD);
  for (const g of [...r.groups, ...(r.income ? [r.income] : [])]) {
    for (const hd of g.heads) {
      for (const l of hd.lines) {
        lines.push([g.label, hd.label, l.particulars + (l.foc ? " (FOC)" : ""), l.qty == null ? "" : raw(l.qty), l.uom ?? "", l.rate, raw(l.value)]);
      }
      lines.push(["", "", contributionText(hd.label, hd), "", "", "", raw(hd.value)]);
    }
    lines.push([contributionText(g.label, g), "", "", "", "", "", raw(g.value)]);
  }
  lines.push([], ...summaryPairs(r).map(([k]) => [k, raw(r.summary[summaryKey(k)])]));
  if (showAmendment && r.amendment) lines.push([], ["Figure", "Approved", "Proposed", "Variance"], ...amendmentRows(r));
  lines.push([], ["Prepared By", r.budget.preparedBy ?? "", "Approved By", r.budget.approvedBy ?? ""]);

  const csv = lines
    .map((line) => line.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","))
    .join("\n");
  // The BOM prefix keeps Excel reading UTF-8 and not a leading `=` as a formula.
  const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem(r)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function summaryKey(label: string): keyof OrderBudgetReport["summary"] {
  const map: Record<string, keyof OrderBudgetReport["summary"]> = {
    "Total Income": "totalIncome",
    "Total Expenses": "totalExpenses",
    "Net Profit": "netProfit",
    "Profit %": "profitPct",
    "Cost Per Garment": "costPerGarment",
    "Profit Per Garment": "profitPerGarment",
  };
  return map[label];
}
