import ExcelJS from "exceljs";

/**
 * Client-side spreadsheet parsing for import. Reads `.xlsx` via ExcelJS and
 * `.csv` via a small built-in parser (avoids a new dependency). Returns the
 * header row plus data rows keyed by header, ready for `coerceRow`.
 */
export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

/** Minimal RFC-4180-ish CSV parser: handles quotes, escaped quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  // Trailing cell/row (files without a final newline).
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Build header-keyed row objects from a matrix whose first row is headers. */
function matrixToSheet(matrix: string[][]): ParsedSheet {
  if (matrix.length === 0) return { headers: [], rows: [] };
  const headers = matrix[0].map((h) => h.trim());
  const rows = matrix.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").toString().trim();
    });
    return obj;
  });
  return { headers, rows };
}

async function parseXlsx(file: File): Promise<ParsedSheet> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const matrix: string[][] = [];
  sheet.eachRow((row) => {
    const values = row.values as unknown[]; // 1-indexed; [0] is empty
    const cells: string[] = [];
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      cells.push(v == null ? "" : String(v));
    }
    matrix.push(cells);
  });
  return matrixToSheet(matrix);
}

export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    return matrixToSheet(parseCsv(await file.text()));
  }
  if (name.endsWith(".xlsx")) {
    return parseXlsx(file);
  }
  throw new Error("Unsupported file type — upload a .xlsx or .csv file.");
}
