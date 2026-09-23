/**
 * Budget Statement — PDF (download or print) and Excel.
 *
 * Browser-only (blob downloads, `window.open`), so call from a `"use client"`
 * island. Handed the SAME `OrderBudgetReport` the page renders, so the page,
 * the paper and the spreadsheet cannot disagree.
 *
 * THE LEGACY RP "BUDGET STATEMENT", portrait A4: the boxed header, the
 * Quantity table, one Group Head · Cost Head · Particulars · Qty · UOM · Rate ·
 * Value table with its CONTRIBUTION lines, the summary boxes and the
 * signatures — inside the order documents' letterhead (green rule, blue title).
 */
import { jsPDF } from "jspdf";
import autoTable, { type CellInput, type RowInput } from "jspdf-autotable";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import type { BudgetGroupHead, Fig, OrderBudgetReport } from "./report";
import { contributionText, inr, isFigRefusal, plain2, qty3, qtyCell } from "./report-format";

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

const QTY_HEAD = ["RE No", "Order No", "Style Ref No", "Style", "Unit", "Order", "Excess", "Approval", "Rej.Allow", "Cut Qty"];

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

const valueText = (v: Fig | null) => (v == null ? "" : isFigRefusal(v) ? v.refused : plain2(v));

/** The statement's rows for the PDF — Group Head and Cost Head cells span
 *  their rows, and the CONTRIBUTION lines are merged across, as the legacy
 *  prints them. */
function statementRows(groups: readonly BudgetGroupHead[]): RowInput[] {
  const rows: RowInput[] = [];
  for (const g of groups) {
    const span = g.heads.reduce((n, hd) => n + hd.lines.length + 1, 0);
    g.heads.forEach((hd, hi) => {
      hd.lines.forEach((l, li) => {
        const row: CellInput[] = [];
        if (hi === 0 && li === 0) row.push({ content: g.label, rowSpan: span, styles: { valign: "top" } });
        if (li === 0) row.push({ content: hd.label, rowSpan: hd.lines.length, styles: { valign: "top" } });
        row.push(
          `${l.particulars}${l.foc ? "  (FOC)" : ""}`,
          isFigRefusal(l.qty) ? l.qty.refused : qty3(l.qty),
          l.uom ?? "",
          l.rate,
          valueText(l.value),
        );
        rows.push(row);
      });
      rows.push([
        { content: contributionText(hd.label, hd), colSpan: 5, styles: { fontStyle: "bold", fontSize: 6.5 } },
        { content: inr(hd.value), styles: { fontStyle: "bold", halign: "right", fontSize: 6.5 } },
      ]);
    });
    rows.push([
      { content: contributionText(g.label, g), colSpan: 6, styles: { fontStyle: "bold", fontSize: 8.5, fillColor: [246, 247, 249] } },
      { content: inr(g.value), styles: { fontStyle: "bold", halign: "right", fontSize: 8.5, fillColor: [246, 247, 249] } },
    ]);
  }
  return rows;
}

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
  const M = 30;
  const c = r.company;
  const b = r.budget;

  doc.setFillColor(133, 194, 39);
  doc.rect(M, 24, W - 2 * M, 3, "F");

  let x = M;
  const logo = await loadLetterheadImage(c.logo);
  if (logo) {
    const { w, h: lh } = fitLogo(logo, 100, 34);
    doc.addImage(logo.dataUrl, "PNG", M, 36, w, lh);
    x = M + w + 12;
  }
  doc.setTextColor(22, 24, 29);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text((c.name ?? "RAAGAM EXPORTS").toUpperCase(), x, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(91, 100, 114);
  const contact = [c.address, c.gstin ? `GSTIN ${c.gstin}` : null].filter(Boolean).join("  ·  ");
  if (contact) doc.text(contact, x, 62, { maxWidth: W - x - 160 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(3, 123, 184);
  doc.text("BUDGET STATEMENT", W - M, 50, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(91, 100, 114);
  doc.text([b.code ? `Budget ${b.code}` : null, b.statusText].filter(Boolean).join(" · "), W - M, 62, { align: "right" });

  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(1.2);
  doc.line(M, 76, W - M, 76);

  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const grid = {
    margin: { left: M, right: M },
    theme: "grid" as const,
    styles: { fontSize: 7, cellPadding: 2.5, textColor: 20, lineColor: 170, lineWidth: 0.4 },
    headStyles: { fillColor: [235, 237, 240] as [number, number, number], textColor: 20, fontStyle: "bold" as const },
  };

  // THE BOXED HEADER — four label/value column pairs, read down.
  const cols = headerColumns(r);
  const depth = Math.max(...cols.map((col) => col.length));
  const headerBody: string[][] = [];
  for (let i = 0; i < depth; i++) headerBody.push(cols.flatMap((col) => col[i] ?? ["", ""]));
  autoTable(doc, {
    ...grid,
    body: headerBody,
    startY: 84,
    styles: { ...grid.styles, fontSize: 7.5 },
    columnStyles: {
      0: { fontStyle: "bold" },
      2: { fontStyle: "bold" },
      4: { fontStyle: "bold" },
      6: { fontStyle: "bold" },
      7: { halign: "right" },
    },
  });

  // THE QUANTITY TABLE.
  autoTable(doc, {
    ...grid,
    head: [
      [
        { content: "RE No", rowSpan: 2 },
        { content: "Order No", rowSpan: 2 },
        { content: "Style Ref No", rowSpan: 2 },
        { content: "Style", rowSpan: 2 },
        { content: "Unit", rowSpan: 2 },
        { content: "Quantity", colSpan: 5, styles: { halign: "center" } },
      ],
      ["Order", "Excess", "Approval", "Rej.Allow", "Cut Qty"],
    ],
    body: qtyRows(r),
    startY: lastY() + 6,
    columnStyles: { 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right", fontStyle: "bold" } },
  });

  let y = lastY() + 8;
  if (r.unratedNotice) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(179, 38, 30);
    const lines = doc.splitTextToSize(r.unratedNotice, W - 2 * M) as string[];
    doc.text(lines, M, y + 6);
    y += 6 + lines.length * 9;
    doc.setTextColor(20);
  }

  // THE STATEMENT.
  autoTable(doc, {
    ...grid,
    head: [STATEMENT_HEAD],
    body: statementRows([...r.groups, ...(r.income ? [r.income] : [])]),
    startY: y,
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 78 },
      3: { halign: "right", cellWidth: 48 },
      4: { cellWidth: 30 },
      5: { halign: "right", cellWidth: 42 },
      6: { halign: "right", cellWidth: 58 },
    },
  });

  // THE SUMMARY BOXES — label, value, label, value … as the legacy's foot.
  const pairs = summaryPairs(r);
  autoTable(doc, {
    ...grid,
    body: [pairs.slice(0, 4).flat(), ["", "", ...pairs.slice(4).flat(), "", ""]],
    startY: lastY() + 8,
    styles: { ...grid.styles, fontSize: 8, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" }, 3: { halign: "right" }, 5: { halign: "right" }, 7: { halign: "right" } },
  });

  if (showAmendment && r.amendment) {
    autoTable(doc, {
      ...grid,
      head: [[`Amendment${r.amendment.entryNo ? ` ${r.amendment.entryNo}` : ""} — Figure`, "Approved", "Proposed", "Variance"]],
      body: amendmentRows(r),
      startY: lastY() + 10,
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    });
  }

  // SIGNATURES — the names over the lines, then the end mark.
  let sy = lastY() + 50;
  if (sy > H - 50) {
    doc.addPage();
    sy = 90;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(60);
  if (b.preparedBy) doc.text(b.preparedBy, M, sy - 4);
  if (b.approvedBy) doc.text(b.approvedBy, W - M, sy - 4, { align: "right" });
  doc.setDrawColor(22, 24, 29);
  doc.setLineWidth(0.6);
  doc.line(M, sy + 10, W - M, sy + 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(20);
  doc.text("Prepared By", M, sy + 7);
  doc.text("Checked By", W / 2, sy + 7, { align: "center" });
  doc.text("Approved By", W - M, sy + 7, { align: "right" });
  doc.text("<< End Of Report >>", W - M, sy + 24, { align: "right" });

  const printed = `Report Printed Date & Time: ${fmtDateTime(new Date().toISOString())}`;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(printed, M, H - 18);
    doc.text(`Page : ${p}/${pages}`, W - M, H - 18, { align: "right" });
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
