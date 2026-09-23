import type { ReportStyleImage } from "@/lib/orders/gos/style-images";

/**
 * A "Style images" strip on the Garment Order Sheet — the pictures ticked
 * "Print on reports" for one style (user, 2026-09-23).
 *
 * A server component like the rest of the sheet: the URLs arrive signed, so
 * there is nothing to fetch and nothing to hydrate.
 *
 * ## SIZED IN MILLIMETRES, BECAUSE IT IS PAPER
 *
 * A fixed 38mm tall box, width following the picture (`object-contain`, never
 * cropped — a cropped sketch hides the pocket someone is looking for). Four
 * fit across A4 with room to spare, so a style's strip is one band and the
 * matrix below it does not get pushed onto the next page by a stray fifth.
 * `gos-keep` keeps a strip whole across a page break; a picture split between
 * two sheets is two useless halves.
 */
export function GosStyleImages({
  images,
  title = "Style images",
}: {
  images: readonly ReportStyleImage[];
  title?: string;
}) {
  if (images.length === 0) return null;
  return (
    <div className="gos-keep mb-3">
      <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--gos-muted)]">
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {images.map((img, i) => (
          <figure key={i} className="border border-[var(--gos-rule)] p-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL
                into a private bucket; next/image would proxy and cache it past
                the signature's lifetime, and a document wants the plain element. */}
            <img
              src={img.url}
              alt={img.fileName || "Style image"}
              className="h-[38mm] w-auto max-w-[45mm] object-contain"
            />
          </figure>
        ))}
      </div>
    </div>
  );
}
