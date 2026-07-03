/**
 * Client-side Excel (.xlsx) export for a `ReportConfig`, using ExcelJS.
 * Browser-only — builds the workbook in memory and triggers a blob download,
 * reusing the `URL.createObjectURL` pattern from the Tally download button.
 */
import ExcelJS from "exceljs";
import { reportFilename, type ReportConfig } from "./types";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Excel sheet names cap at 31 chars and forbid : \ / ? * [ ]. */
function sheetName(title: string): string {
  return (title.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31)) || "Report";
}

export async function exportExcel<T>(config: ReportConfig<T>): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName(config.title));

  // Header row — bold on the brand indigo fill.
  const header = sheet.addRow(config.columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };
  });

  // Data rows — keep numerics as real numbers so Excel can sum/sort them.
  for (const row of config.rows) {
    sheet.addRow(config.columns.map((c) => c.value(row)));
  }

  // Right-align numeric columns and give every column a sensible width.
  config.columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = Math.max(12, c.header.length + 2);
    if (c.isNumeric) column.alignment = { horizontal: "right" };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = reportFilename(config.title, "xlsx");
  anchor.click();
  URL.revokeObjectURL(url);
}
