/**
 * Vectors for `lib/orders/amendments/style-gallery.ts` — which of an order's
 * files are pictures, which picture is a style's cover, and one star per
 * style (0621, user, 2026-09-23).
 *
 *   npm run check:style-gallery
 *
 * ## WHY IT HAS A SUITE
 *
 * Three readers — the editor's ⭐ toggle, the listing's thumbnail cell and the
 * reports' "Style images" strip — ask this file the same questions. A wrong
 * answer here is not one broken screen, it is three that agree with each other,
 * which is the kind nobody reports. And the two fallbacks in `coverOf` are what
 * EVERY order saved before 0621 depends on: none of them has a star, so an
 * implementation that read only `is_primary` would blank every thumbnail in the
 * listing and pass any test written against new data.
 *
 * Pure module, no aliases, so it runs under plain Node.
 */
import {
  coverOf,
  isImageFile,
  normalizePrimary,
  styleGalleries,
  type GalleryFile,
} from "../lib/orders/amendments/style-gallery.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

const img = (path: string, over: Partial<GalleryFile> = {}): GalleryFile => ({
  file_name: path,
  storage_path: path,
  mime_type: "image/jpeg",
  doc_kind: "approval",
  style_ref_no: "ST-1",
  ...over,
});
const pdf = (path: string, over: Partial<GalleryFile> = {}): GalleryFile =>
  img(path, { mime_type: "application/pdf", ...over });
const paths = (fs: readonly (GalleryFile | null)[]) => fs.map((f) => f?.storage_path ?? null);

// ---------------------------------------------------------------------------
// 1. isImageFile — MIME first, file name only when MIME is empty
// ---------------------------------------------------------------------------

check("a jpeg is a picture", isImageFile(img("a.jpg")), true);
check("a PDF is not — a tech pack is a document", isImageFile(pdf("a.pdf")), false);
check("no path is no picture — nothing to sign", isImageFile(img("", { storage_path: "" })), false);
check("an empty MIME falls back to the extension", isImageFile(img("a.PNG", { mime_type: "" })), true);
check(
  "…and a stated MIME wins over a misleading name",
  isImageFile(img("scan.jpg", { mime_type: "application/pdf" })),
  false,
);

// ---------------------------------------------------------------------------
// 2. coverOf — star, else first sketch picture, else first picture, never a PDF
// ---------------------------------------------------------------------------

check(
  "the starred picture is the cover, wherever it sits",
  coverOf([img("a.jpg", { doc_kind: "sketch" }), img("b.jpg", { is_primary: true })])?.storage_path,
  "b.jpg",
);
// THE ONE EVERY EXISTING ORDER DEPENDS ON: no star anywhere.
check(
  "no star → the first SKETCH picture, not merely the first picture",
  coverOf([img("a.jpg"), img("b.jpg", { doc_kind: "sketch" })])?.storage_path,
  "b.jpg",
);
check("no star, no sketch → the first picture", coverOf([img("a.jpg"), img("b.jpg")])?.storage_path, "a.jpg");
check(
  "a sketch filed as a PDF is skipped — the cover must be paintable",
  coverOf([pdf("s.pdf", { doc_kind: "sketch" }), img("b.jpg")])?.storage_path,
  "b.jpg",
);
check("a star on a PDF is ignored", coverOf([pdf("s.pdf", { is_primary: true }), img("b.jpg")])?.storage_path, "b.jpg");
check("documents only → no cover (the placeholder, never a PDF tile)", coverOf([pdf("a.pdf")]), null);
check("nothing → no cover", coverOf([]), null);

// ---------------------------------------------------------------------------
// 3. styleGalleries — per style, first-appearance order, order level last
// ---------------------------------------------------------------------------

const set = [
  img("o.jpg", { style_ref_no: null }),
  img("t1.jpg", { style_ref_no: "TOP" }),
  pdf("t.pdf", { style_ref_no: "TOP" }),
  img("b1.jpg", { style_ref_no: "BOTTOM", doc_kind: "sketch" }),
  img("t2.jpg", { style_ref_no: "TOP", is_primary: true }),
];
check(
  "grouped by style in first-appearance order, the ORDER-level group last",
  styleGalleries(set).map((g) => g.styleRef),
  ["TOP", "BOTTOM", null],
);
check(
  "each group holds only its pictures — the PDF is not in the gallery",
  styleGalleries(set).map((g) => paths(g.images)),
  [["t1.jpg", "t2.jpg"], ["b1.jpg"], ["o.jpg"]],
);
check(
  "each group has its OWN cover (Top's star, Bottom's sketch)",
  styleGalleries(set).map((g) => g.cover?.storage_path ?? null),
  ["t2.jpg", "b1.jpg", "o.jpg"],
);
check(
  "a blank style ref is the order level, not a style named \"\"",
  styleGalleries([img("a.jpg", { style_ref_no: "  " })]).map((g) => g.styleRef),
  [null],
);
check("documents only → no gallery at all", styleGalleries([pdf("a.pdf")]), []);

// ---------------------------------------------------------------------------
// 4. normalizePrimary — one star per style, last one wins, never on a PDF
// ---------------------------------------------------------------------------

const stars = (fs: readonly GalleryFile[]) => normalizePrimary(fs).map((f) => !!f.is_primary);

check(
  "the LAST star on a style wins — the one the operator just clicked",
  stars([img("a.jpg", { is_primary: true }), img("b.jpg", { is_primary: true })]),
  [false, true],
);
check(
  "one star per style, not per order",
  stars([img("a.jpg", { is_primary: true }), img("b.jpg", { style_ref_no: "ST-2", is_primary: true })]),
  [true, true],
);
check(
  "the order level (null) is ONE group, matching the index's coalesce",
  stars([img("a.jpg", { style_ref_no: null, is_primary: true }), img("b.jpg", { style_ref_no: "", is_primary: true })]),
  [false, true],
);
check(
  "a star on a PDF is dropped, and does not unseat a picture's star",
  stars([img("a.jpg", { is_primary: true }), pdf("b.pdf", { is_primary: true })]),
  [true, false],
);
check("no star stays no star — nothing is promoted", stars([img("a.jpg"), img("b.jpg")]), [false, false]);
{
  const input = [img("a.jpg", { is_primary: true }), img("b.jpg")];
  const out = normalizePrimary(input);
  check("an unchanged row is returned as the SAME object", [out[0] === input[0], out[1] === input[1]], [true, true]);
}
check(
  "print_on_report is not touched",
  normalizePrimary([img("a.jpg", { print_on_report: true, is_primary: true }), img("b.jpg", { is_primary: true, print_on_report: true })]).map(
    (f) => f.print_on_report,
  ),
  [true, true],
);

console.log(failed === 0 ? "\nOK — every style gallery vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
