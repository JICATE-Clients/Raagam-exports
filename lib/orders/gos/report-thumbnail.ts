import type { ReportStyleImage, ReportStyleImages } from "./style-images";

/**
 * THE STYLE PICTURE AT THE TOP-LEFT OF A REPORT'S HEADER (2026-09-26) — one
 * rule for the Garment Order Sheet and the Fabric BOM reports, on screen and
 * on paper.
 *
 * Client-safe on purpose (types only from `./style-images`): the PDF
 * exporters run in the browser and pick the same picture the page did.
 *
 * ## WHICH PICTURE
 *
 * Only a picture the operator ticked "Print on reports" — the groups come from
 * `getReportStyleImages`, which never returns anything else, and nothing here
 * reaches past them to a cover or a first sketch (that file's header says why).
 *
 * - A report about ONE style takes that style's first ticked picture; failing
 *   that, the first picture filed against the ORDER (no style). Never a
 *   different style's picture — on a one-style document that would label it
 *   with a garment it does not describe.
 * - Otherwise the first group's first picture.
 *
 * ## NOT FROZEN
 *
 * The URL is signed for an hour, so the thumbnail is always loaded BESIDE the
 * report payload (which V_final freezes) and picked at render time — never
 * stored in it.
 */
export function pickReportThumbnail(
  images: ReportStyleImages | { failed: string } | null | undefined,
  styleRef?: string | null,
): ReportStyleImage | null {
  if (!images || "failed" in images || images.length === 0) return null;
  const ref = styleRef?.trim();
  if (ref) {
    const own = images.find((g) => g.styleRef != null && g.styleRef.trim() === ref);
    const order = images.find((g) => g.styleRef == null);
    return own?.images[0] ?? order?.images[0] ?? null;
  }
  return images[0]?.images[0] ?? null;
}

/**
 * The groups WITHOUT the header's picture — so the one thumbnailed at the top
 * does not print a second time in the per-style block below. Every other
 * ticked picture still prints; a group left empty is dropped rather than
 * drawn as a titled strip with nothing in it.
 */
export function withoutThumbnail(
  images: ReportStyleImages | { failed: string },
  thumb: ReportStyleImage | null,
): ReportStyleImages | { failed: string } {
  if (!thumb || "failed" in images) return images;
  return images
    .map((g) => ({ ...g, images: g.images.filter((i) => i.url !== thumb.url) }))
    .filter((g) => g.images.length > 0);
}
