import { z } from "zod";

/**
 * Upload buyer PO → pre-filled draft (doc/order/digitalisation-plan.md §2, 0669).
 *
 * TWO SHAPES, and they are kept apart on purpose:
 *
 *  - `poDraftSchema` is what the MODEL is asked to return. It speaks the
 *    buyer's words — a customer NAME, a size LABEL, a currency as printed —
 *    because the model has never seen our masters and must not guess an id.
 *    It is also the structured-output schema sent to the API, so it stays
 *    inside what structured outputs accept: plain objects, arrays, strings,
 *    numbers and nulls; no min/max, no formats, no unions.
 *
 *  - `PoImportStored` is what `order_po_imports.extracted` holds: that draft
 *    (as the reviewer last edited it) PLUS the reviewer's own choices of
 *    master rows — the customer, the currency and a size-label → size id map.
 *    A choice the reviewer made is never overwritten by re-matching; matching
 *    only fills what nobody has decided yet.
 *
 * Client-safe and pure: the review screen, the server and
 * `scripts/check-po-import-match.mts` all read this one file.
 */

export const poDraftHeaderSchema = z.object({
  /** The buyer / customer as named on the PO. */
  customer_name: z.string().nullable(),
  /** The buyer's PO number, exactly as printed (case kept — po_ref). */
  po_no: z.string().nullable(),
  /** YYYY-MM-DD, or null when absent / unreadable. */
  po_date: z.string().nullable(),
  /** The PO-level delivery / ship date, YYYY-MM-DD. */
  delivery_date: z.string().nullable(),
  /** ISO 4217 code when the PO makes it clear (USD, EUR, GBP, INR …). */
  currency: z.string().nullable(),
  season: z.string().nullable(),
  ship_mode: z.string().nullable(),
  /** Destination country as named on the PO. */
  country: z.string().nullable(),
});
export type PoDraftHeader = z.infer<typeof poDraftHeaderSchema>;

export const poDraftSizeSchema = z.object({
  /** The size label as printed: S, M, XL, 2XL, 32, 6-7Y … */
  size: z.string(),
  /** Pieces ordered in this size. */
  qty: z.number(),
});
export type PoDraftSize = z.infer<typeof poDraftSizeSchema>;

export const poDraftLineSchema = z.object({
  /** The buyer's style / article reference. */
  style_ref_no: z.string().nullable(),
  description: z.string().nullable(),
  /** The colour / colourway as printed. */
  colour: z.string().nullable(),
  sizes: z.array(poDraftSizeSchema),
  /** Price per piece in the PO's currency. */
  unit_price: z.number().nullable(),
  /** A line-level delivery date when the PO gives one, YYYY-MM-DD. */
  delivery_date: z.string().nullable(),
});
export type PoDraftLine = z.infer<typeof poDraftLineSchema>;

export const poDraftSchema = z.object({
  header: poDraftHeaderSchema,
  lines: z.array(poDraftLineSchema),
  /** The PO's OWN grand total quantity, as printed — never computed. */
  stated_total_qty: z.number().nullable(),
  /** The PO's OWN grand total value, as printed — never computed. */
  stated_total_value: z.number().nullable(),
  /**
   * Paths the model was unsure about, e.g. "header.po_date", "lines.2.colour",
   * "lines.0.sizes". The review screen paints these amber.
   */
  uncertain: z.array(z.string()),
  /** Anything the reader should know (a page it could not read, a table it skipped). */
  notes: z.string().nullable(),
});
export type PoDraft = z.infer<typeof poDraftSchema>;

/** `order_po_imports.extracted`. */
export const poImportStoredSchema = z.object({
  draft: poDraftSchema,
  /** Reviewer's (or the matcher's accepted) choice; null = not decided. */
  customer_id: z.string().nullable(),
  currency_code: z.string().nullable(),
  country_id: z.string().nullable(),
  /** Size LABEL (as printed, upper-cased) → config_lookups size id, or null. */
  size_map: z.record(z.string(), z.string().nullable()),
  /** Style ref (styleKey) → garment_styles id, or null. */
  style_map: z.record(z.string(), z.string().nullable()),
});
export type PoImportStored = z.infer<typeof poImportStoredSchema>;

export type PoImportStatus = "uploaded" | "extracted" | "failed" | "used";

export type PoImportRow = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  status: PoImportStatus;
  extracted: PoImportStored | null;
  error: string | null;
  created_at: string;
};

/** The bucket, and the folder every import lives under. */
export const PO_IMPORT_BUCKET = "garment-order-docs";
export const PO_IMPORT_PREFIX = "po-imports";

/** What can be uploaded. Excel and CSV are read as text; PDF and images as documents. */
export const PO_IMPORT_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,.xlsx,.csv";

/** 15 MB — well under the API's 32 MB request ceiling once base64-encoded. */
export const PO_IMPORT_MAX_BYTES = 15 * 1024 * 1024;

export type PoFileKind = "pdf" | "image" | "xlsx" | "csv";

/** Which reader a file goes to, by type first and extension second. */
export function poFileKind(fileName: string, mime: string | null): PoFileKind | null {
  const m = (mime ?? "").toLowerCase();
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (m.includes("spreadsheetml") || ext === "xlsx") return "xlsx";
  if (m === "text/csv" || ext === "csv") return "csv";
  return null;
}

/** Where a new import's file goes: `po-imports/<importId>/<uuid>.<ext>`. */
export function poImportPath(importId: string, fileId: string, fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${PO_IMPORT_PREFIX}/${importId}/${fileId}.${ext}`;
}

/** The path the server will accept for an import — nothing outside its own folder. */
export function isPoImportPath(importId: string, path: string): boolean {
  return path.startsWith(`${PO_IMPORT_PREFIX}/${importId}/`) && !path.includes("..");
}
