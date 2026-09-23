/**
 * THE STYLE GALLERY — which pictures an order holds, per style, and which one
 * is its cover (user, 2026-09-23: "Style Thumbnail Attachments in Order Entry"
 * + the Order Entry listing's thumbnail column).
 *
 * ONE DECLARATION, THREE READERS: the editor's attachment tiles (the ⭐ Primary
 * toggle), the listing's thumbnail cell (+N badge, hover gallery, lightbox) and
 * the order reports (`print_on_report`). Each asked the same two questions —
 * "is this file a picture?" and "which picture is the cover?" — and three
 * answers would be three chances to disagree about a PDF tech pack or a style
 * with no star.
 *
 * NO NEW TABLE. The spec named `order_style_attachments`; this app already has
 * it as `garment_order_amendment_files` (0416) with `style_ref_no` (0479) —
 * the PRIVATE `garment-order-docs` bucket, `storage_path` never a URL, keyed to
 * a style by its TEXT reference because `writeChildren` re-mints every style
 * uuid on save. The two flags are columns on that table.
 *
 * Typed on a MINIMAL shape so every reader — the form's `AttachmentRow`, the
 * list's `AmendmentFile` — passes its own rows unchanged.
 */

export type GalleryFile = {
  file_name?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  doc_kind?: string | null;
  style_ref_no?: string | null;
  /** The style's cover picture — at most one per style. */
  is_primary?: boolean | null;
  /** Printed on the order's reports. */
  print_on_report?: boolean | null;
};

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

/** A picture `<img>` can paint — by MIME first, the file name as the fallback
 *  (older rows were written with an empty `mime_type`). A PDF tech pack is a
 *  document, never a thumbnail. */
export function isImageFile(f: GalleryFile): boolean {
  if (!f.storage_path) return false;
  const mime = (f.mime_type ?? "").toLowerCase();
  if (mime) return mime.startsWith("image/");
  return IMAGE_EXT.test(f.file_name ?? f.storage_path);
}

/**
 * THE COVER OF A SET OF FILES: the one starred Primary; failing that the
 * first picture filed as a Sketch; failing that the first picture. Never a
 * document. The fallback is what keeps every order that predates the star
 * showing its drawing instead of a blank tile — the header's `sketchPath`
 * already reads "the first sketch", so this agrees with it.
 */
export function coverOf<F extends GalleryFile>(files: readonly F[]): F | null {
  const images = files.filter(isImageFile);
  return (
    images.find((f) => f.is_primary) ??
    images.find((f) => f.doc_kind === "sketch") ??
    images[0] ??
    null
  );
}

export type StyleGallery<F> = {
  /** Null = files filed against the ORDER rather than a style. */
  styleRef: string | null;
  images: F[];
  cover: F | null;
};

/**
 * The order's pictures grouped by style, in the order the styles first appear
 * among the files, the order-level group last. Only pictures — documents are
 * not a gallery. A group's `cover` is `coverOf` its own images, so a two-style
 * set (Top + Bottom) has a cover each.
 */
export function styleGalleries<F extends GalleryFile>(files: readonly F[]): StyleGallery<F>[] {
  const groups = new Map<string, F[]>();
  for (const f of files) {
    if (!isImageFile(f)) continue;
    const key = f.style_ref_no?.trim() || "";
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  const out: StyleGallery<F>[] = [];
  for (const [key, images] of groups) {
    if (key) out.push({ styleRef: key, images, cover: coverOf(images) });
  }
  const orderLevel = groups.get("");
  if (orderLevel) out.push({ styleRef: null, images: orderLevel, cover: coverOf(orderLevel) });
  return out;
}

/**
 * ONE STAR PER STYLE — what the save path writes. The last star set on a
 * style wins (that is the one the operator just clicked); every other file of
 * that style is cleared. A star on a non-picture is dropped: a PDF cannot be
 * a cover. Pure, so `scripts/` vectors can hold it.
 */
export function normalizePrimary<F extends GalleryFile>(files: readonly F[]): F[] {
  const winner = new Map<string, number>();
  files.forEach((f, i) => {
    if (f.is_primary && isImageFile(f)) winner.set(f.style_ref_no?.trim() || "", i);
  });
  return files.map((f, i) => {
    const want = winner.get(f.style_ref_no?.trim() || "") === i;
    return !!f.is_primary === want ? f : { ...f, is_primary: want };
  });
}
