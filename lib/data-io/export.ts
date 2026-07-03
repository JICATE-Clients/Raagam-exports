import ExcelJS from "exceljs";
import { downloadBlob } from "./download";
import type { IoEntity, IoField } from "./entities";

/**
 * Client-side export + blank-template generation for a data-io entity.
 * Reuses the ExcelJS workbook + brand-indigo header styling from
 * `lib/reports/export-excel.ts`, and the shared `downloadBlob` helper.
 */

export type ExportFormat = "xlsx" | "csv";

/** Row keys never worth exporting (surrogate ids, FK ids, audit timestamps). */
function isNoiseKey(key: string): boolean {
  return (
    key === "id" ||
    key.endsWith("_id") ||
    key === "created_at" ||
    key === "updated_at" ||
    key === "created_by" ||
    key === "updated_by"
  );
}

/** "invoice_no" → "Invoice No", "poValue" → "Po Value". */
function titleCase(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Columns to export: the entity's curated `fields` when present, else derived
 * from the first row's keys (export-only transactional docs ship an empty
 * `fields`). Booleans/numbers get their `kind` so cells serialise correctly.
 */
function exportFields(
  entity: IoEntity,
  rows: Record<string, unknown>[],
): IoField[] {
  if (entity.fields.length > 0) return entity.fields;
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first)
    .filter((key) => !isNoiseKey(key))
    .map((key) => {
      const v = first[key];
      const kind: IoField["kind"] =
        typeof v === "boolean" ? "boolean" : typeof v === "number" ? "number" : "string";
      return { key, header: titleCase(key), kind };
    });
}

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Export-safe cell: booleans → Yes/No, null → "", numbers stay numeric. */
function cellValue(field: IoField, row: Record<string, unknown>): string | number {
  const raw = row[field.key];
  if (raw == null) return "";
  if (field.kind === "boolean") return raw ? "Yes" : "No";
  if (field.kind === "number") return typeof raw === "number" ? raw : Number(raw) || 0;
  return String(raw);
}

function timestamp(): string {
  // ISO date only — locale-independent, safe in filenames.
  return new Date().toISOString().slice(0, 10);
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(
  fields: IoField[],
  rows: Record<string, unknown>[],
): Blob {
  const headerLine = fields.map((f) => csvEscape(f.header)).join(",");
  const bodyLines = rows.map((row) =>
    fields.map((f) => csvEscape(cellValue(f, row))).join(","),
  );
  const csv = [headerLine, ...bodyLines].join("\r\n");
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

async function toXlsx(
  entity: IoEntity,
  fields: IoField[],
  rows: Record<string, unknown>[],
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(entity.label.slice(0, 31) || "Data");

  const header = sheet.addRow(fields.map((f) => f.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };
  });

  for (const row of rows) {
    sheet.addRow(fields.map((f) => cellValue(f, row)));
  }

  fields.forEach((f, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = Math.max(12, f.header.length + 2);
    if (f.kind === "number") column.alignment = { horizontal: "right" };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

export async function exportEntity(
  entity: IoEntity,
  rows: Record<string, unknown>[],
  format: ExportFormat,
): Promise<void> {
  const fields = exportFields(entity, rows);
  const filename = `${entity.key}-${timestamp()}.${format}`;
  const blob =
    format === "csv" ? toCsv(fields, rows) : await toXlsx(entity, fields, rows);
  downloadBlob(blob, filename);
}

/** Download an empty sheet containing only the header row (an import template). */
export async function downloadTemplate(
  entity: IoEntity,
  format: ExportFormat = "xlsx",
): Promise<void> {
  const filename = `${entity.key}-template.${format}`;
  const blob =
    format === "csv" ? toCsv(entity.fields, []) : await toXlsx(entity, entity.fields, []);
  downloadBlob(blob, filename);
}
