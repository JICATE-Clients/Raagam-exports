import type { ReportStyleImage } from "@/lib/orders/gos/style-images";

/**
 * THE STYLE PICTURE AT THE TOP-LEFT OF A REPORT'S HEADER (2026-09-26) — the
 * Garment Order Sheet and the Fabric BOM reports, beside their order facts.
 * Which picture is `pickReportThumbnail`'s rule; this only draws it.
 *
 * A fixed 80 x 80 box, the picture fitted inside it (`object-contain`), so a
 * tall sketch and a wide photo take the same room and the facts beside them
 * never jump. The CALLER renders nothing when there is no picture — an empty
 * frame on paper reads as a picture that failed to print.
 *
 * No hooks, no state: safe inside a server component (the GOS) and a client
 * one (the Fabric BOM reports sheet) alike.
 */
export function ReportThumbnail({ image }: { image: ReportStyleImage }) {
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden border border-border bg-white">
      {/* A plain <img>: a short-lived signed Storage URL, which next/image
          would need configuring for; one small, fixed-size image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.fileName || "Style picture"} className="max-h-full max-w-full object-contain" />
    </div>
  );
}
