/**
 * Client-side PDF export for a `ReportConfig`, using jsPDF + jspdf-autotable.
 * Browser-only (uses `document`/blob download) — call from a "use client" component.
 *
 * jspdf-autotable v5 uses the functional form `autoTable(doc, options)` rather than
 * the older `doc.autoTable(...)` prototype patch.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { reportFilename, reportMatrix, type ReportConfig } from "./types";

export function exportPdf<T>(config: ReportConfig<T>): void {
  const { headers, rows } = reportMatrix(config);

  // Landscape suits wide ERP tables; A4 default.
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const marginX = 40;

  doc.setFontSize(14);
  doc.text(config.title, marginX, 40);

  let startY = 56;
  if (config.subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(config.subtitle, marginX, startY);
    doc.setTextColor(0);
    startY += 16;
  }

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((cell) => String(cell))),
    startY,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [79, 70, 229], textColor: 255 }, // brand indigo
    alternateRowStyles: { fillColor: [246, 247, 249] },
    // Right-align numeric columns to match the on-screen table.
    columnStyles: Object.fromEntries(
      config.columns.map((c, i) => [i, { halign: c.isNumeric ? "right" : c.align ?? "left" }]),
    ),
  });

  doc.save(reportFilename(config.title, "pdf"));
}
