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
  /** The style line this document belongs to (0479). Null = the order's own. */
  style_ref_no?: string | null;
};

export type FileRow = {
  doc_kind: AttachmentKind | null;
  file_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  style_ref_no: string | null;
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
 * has none. `uq_goa_files_path` keys on the path for the same reason. A
 * file whose kind is unset is still the file.
 *
 * ## `liveStyleKeys` — AN UNMATCHED REFERENCE IS DEMOTED, NEVER DROPPED
 *
 * From 2026-08-31 a document belongs to a style line (0479). The five per-style
 * normalizers in `actions.ts` DROP a child whose style is not among the ones
 * this save is writing. **This one does not, and the divergence is deliberate.**
 *
 * A size whose style vanished is a size with no meaning, and deleting the row
 * costs nothing. A file whose style ref was retyped or removed still has an
 * OBJECT sitting in the `garment-order-docs` bucket, and this row is the only
 * thing that references it — drop the row and those bytes are orphaned, with
 * nothing left on any screen to reach them by or delete them with. So the
 * reference is set to null and the row is kept, which demotes the document to
 * an order-level one: still visible in the header's attachment corner, still
 * removable, still re-filable.
 *
 * **Do not "fix" this into consistency with its siblings** — it is the second
 * rule in this file that differs from them on purpose, and 0479's header states
 * the same reasoning from the schema side.
 *
 * A row with NO style to begin with is untouched by all of this: null means
 * "filed against the ORDER", which is a real state and is what every row saved
 * before 0479 is.
 *
 * The keys are compared through the caller's own `styleKey` (trim + upper) —
 * passed in as a SET rather than re-derived here, so this function and
 * `normalizeStyleSizes` beside it cannot answer "which styles is this save
 * writing?" two different ways.
 *
 * ## `sno` STAYS ONE SEQUENCE ACROSS THE WHOLE ORDER
 *
 * The five per-style normalizers number within their style. This one does not,
 * because its rows are not all under a style: an order-level document has no
 * bucket to be the nth of, and inventing one would mean two numbering schemes
 * in one table distinguished only by a null. Nothing keys on this value —
 * uniqueness is `(amendment_id, storage_path)` (0416, left alone by 0479) — so one honest sequence
 * beats two clever ones.
 */
export function normalizeFileRows(
  files: readonly FileRowInput[],
  liveStyleKeys?: ReadonlySet<string>,
): FileRow[] {
  return files
    .map((r) => ({
      doc_kind: r.doc_kind ?? null,
      file_name: clean(r.file_name),
      storage_path: clean(r.storage_path),
      mime_type: clean(r.mime_type),
      size_bytes: r.size_bytes ?? null,
      style_ref_no: clean(r.style_ref_no),
    }))
    .filter((r) => !!r.storage_path)
    /* `liveStyleKeys` is optional so the vectors can exercise the row shape
       without standing up a style list. An ABSENT set means "do not resolve
       references at all"; an EMPTY set means "this order has no styles", and
       every style-filed document is then correctly demoted to order-level. The
       two are not the same answer, so they are not the same value.

       NOTE THIS IS A `map`, NOT A `filter` — the row count is unchanged by this
       pass, by design. See the header: dropping the row orphans the bucket
       object it is the only reference to. */
    .map((r) =>
      !liveStyleKeys ||
      !r.style_ref_no ||
      liveStyleKeys.has(r.style_ref_no.trim().toUpperCase())
        ? r
        : { ...r, style_ref_no: null },
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}
