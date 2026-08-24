/**
 * The attached documents, as rows to write (0416).
 *
 * ## WHY THIS IS NOT IN `actions.ts` BESIDE ITS ELEVEN SIBLINGS
 *
 * That file is `"use server"`, so nothing in it can be imported by a vector —
 * a server-action module may only export async functions. Every other child
 * normalizer therefore has no test at all, and this one has a rule the others
 * do not, which is exactly the kind that gets "corrected" into a bug.
 *
 * Same call `orderSalesValue` makes in `lib/orders/budget/totals.ts`: the
 * arithmetic can live anywhere, so it lives where it can be proved.
 */

import type { AttachmentKind } from "@/components/ui/file-attachments";

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** One row as the form holds it, before it is written. */
export type FileRowInput = {
  doc_kind: AttachmentKind | null;
  file_name?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
};

export type FileRow = {
  doc_kind: AttachmentKind | null;
  file_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sno: number;
};

/**
 * ## `storage_path` IS THE ROW'S IDENTITY, AND THAT DIFFERS FROM EVERY SIBLING
 *
 * The other eleven normalizers keep a row if ANY answer is filled — a
 * half-typed row is work in progress and dropping it would delete what the
 * operator entered. This one tests `storage_path` alone, because a row here
 * does not describe something typed: it describes a FILE, and the upload
 * happens the moment that file is chosen. `storage_path` is what the upload
 * returns.
 *
 * So a row carrying a `doc_kind` and no path is not half-answered — it is a row
 * whose upload failed. Writing it puts a document in the grid that resolves to
 * nothing when production clicks it, months later, looking for the buyer's
 * order sheet. **Do not "fix" this filter to match its siblings.**
 *
 * ## `doc_kind` IS NOT REQUIRED
 *
 * The operator picks it after the file lands, so a just-uploaded row genuinely
 * has none. `uq_goa_files_path` keys on the path for the same reason. A file
 * whose kind is unset is still the file.
 */
export function normalizeFileRows(files: readonly FileRowInput[]): FileRow[] {
  return files
    .map((r) => ({
      doc_kind: r.doc_kind ?? null,
      file_name: clean(r.file_name),
      storage_path: clean(r.storage_path),
      mime_type: clean(r.mime_type),
      size_bytes: r.size_bytes ?? null,
    }))
    .filter((r) => !!r.storage_path)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}
