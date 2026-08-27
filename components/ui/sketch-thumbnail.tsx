"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

/**
 * A SIGNED URL FOR ONE PRIVATE-BUCKET OBJECT, safe to hand straight to `<img>`.
 *
 * ## THE SIGNED URL IS THE WHOLE PROBLEM
 *
 * The bucket is PRIVATE (0416), so an `<img src>` needs a signed URL, and a
 * signed URL EXPIRES. `file-attachments.tsx` signs for 60 seconds, which is
 * right for its job — a click that opens a tab immediately — and wrong for a
 * picture that sits on screen for as long as the operator has the order open.
 *
 * So this signs for an hour and RE-SIGNS when the path changes. It does not
 * refresh on a timer: an order open for more than an hour is a tab someone left
 * behind, the image failing to paint costs a reload, and a background interval
 * firing forever on every order screen costs more. `broken` is what catches the
 * expired case — the caller hides rather than showing a broken image.
 *
 * The URL is never stored anywhere. `storage_path` is the column, and 0416 says
 * why: a stored URL gives a row that reads correctly today and 404s next week.
 *
 * ## IT IS A HOOK BECAUSE TWO PLACES NOW NEED IT
 *
 * `SketchThumbnail` below, and the per-file thumbnail in `file-attachments.tsx`.
 * Two copies of the rules above would be two chances to pick a different TTL or
 * to drop the path-pairing — the same argument `LABEL_METRICS` makes in
 * `label.tsx`. A component cannot be shared here because the two render nothing
 * alike; the SIGNING is the shared part, so the signing is what is extracted.
 */
export function useSignedUrl(bucket: string, path: string | null) {
  /**
   * THE SIGNED URL, PAIRED WITH THE PATH IT WAS SIGNED FOR.
   *
   * Not a bare string. Signing is async, so between a new `path` arriving and
   * its URL coming back, a bare `url` still holds the PREVIOUS object — and the
   * caller would show the old drawing beside the new order for as long as the
   * round trip takes. Carrying the path with it makes that unrepresentable:
   * `url` below is null until the two agree.
   *
   * It also removes the synchronous `setUrl(null)` that used to clear it, which
   * was a `set-state-in-effect` — a setState during commit scheduling a second
   * render for something the render could derive.
   */
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null);
  /**
   * WHICH PATH FAILED, not whether one did.
   *
   * A boolean would have to be reset when `path` changes, and resetting it in
   * the effect is a `set-state-in-effect` — a synchronous setState during the
   * commit that schedules a second render for a value the render could have
   * derived. Storing the failed path instead makes `broken` a comparison, so a
   * new object clears the flag by arriving.
   */
  const [brokenPath, setBrokenPath] = useState<string | null>(null);

  useEffect(() => {
    // NOTHING TO SIGN, NOTHING TO CLEAR. Callers already render nothing on a
    // missing path, so writing state here would be a second way to say it —
    // and a synchronous one, inside an effect, which is what
    // `react-hooks/set-state-in-effect` exists to stop.
    if (!path) return;

    /* CANCELLED ON UNMOUNT AND ON A PATH CHANGE. Two signatures can be in
       flight when the operator swaps the file, and without this the SLOWER
       one wins whichever path it was for — the caller would settle on the
       previous object. */
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      if (!cancelled && data?.signedUrl) setSigned({ path, url: data.signedUrl });
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket, path]);

  return {
    /** Only once the signature matches the path being asked about — see `signed`. */
    url: signed && signed.path === path ? signed.url : null,
    broken: !!path && brokenPath === path,
    /** Hand to `<img onError>`. Records WHICH path failed, never a bare flag. */
    onBroken: () => setBrokenPath(path),
  };
}

/**
 * The style sketch — small in a page header, and large in the Order Info corner.
 *
 * Production and planning read the drawing while filling Combos or Sizes, and
 * the sketch lives on the Order Info section — so without this they navigate
 * back, look, and navigate forward again for every glance.
 *
 * ## TWO SIZES, AND THEY CROP DIFFERENTLY ON PURPOSE
 *
 * `sm` (the default) is the 32px chip in `PageHeader`'s action strip, beside the
 * record title. At that size a drawing is an identifier rather than something
 * read, so `object-cover` fills the square and the crop costs nothing.
 *
 * `lg` is the ~144px tile in the Order Info header's right-hand corner (client
 * 2026-08-26, screenshot 2497: "why we hat remaining space … for diplayin gthat
 * image"). There the sketch is meant to be LOOKED AT while the order is typed,
 * so it is `object-contain` on a muted ground — letterboxed, whole. Cropping a
 * sketch to a tidy rectangle hides the half the operator wanted.
 *
 * The width comes from the CALLER, not from here: the corner is 144px because
 * that is what header line 2 leaves, and that arithmetic belongs to the screen.
 * `lg` only fixes the ASPECT (4:3) and the fit.
 *
 * ## THE LIGHTBOX IS A `Sheet`, NOT A HAND-ROLLED OVERLAY
 *
 * A bare `fixed inset-0` div would need `useModalGuard` registered by hand — the
 * reload guard's DOM scan only sees `role="dialog"` / `aria-modal`, so an
 * unregistered overlay lets a silent auto-update reload the page underneath an
 * operator who is looking at it. `Sheet` brings the guard, the focus trap, the
 * scrim and Escape with it, and `size="sm"` is the centred dialog it already
 * documents for exactly this shape.
 */
export function SketchThumbnail({
  bucket,
  path,
  alt = "Style sketch",
  size = "sm",
  fallback = null,
}: {
  bucket: string;
  /** Path INSIDE the bucket. Null renders `fallback`. */
  path: string | null;
  alt?: string;
  /** `sm` — a 32px chip. `lg` — a 4:3 tile filling the width the caller gives it. */
  size?: "sm" | "lg";
  /**
   * WHAT TO DRAW WHEN THERE IS NO PICTURE — no path, no signature yet, or a
   * signature that has expired. Default null, which is the page-header contract
   * below and the standing rule that an unfilled field shows nothing.
   *
   * It exists because the ATTACHMENTS column cannot use that default: a file
   * that renders as nothing is a file the operator cannot open or remove. It
   * passes the same chip it draws for a PDF, so a picture that will not paint
   * degrades into the row every other attachment already has rather than
   * vanishing. The caller decides; this component only knows whether it has an
   * image to show.
   */
  fallback?: ReactNode;
}) {
  const { url, broken, onBroken } = useSignedUrl(bucket, path);
  const [open, setOpen] = useState(false);

  // NOTHING RATHER THAN A PLACEHOLDER, unless the caller supplies one. At `sm`
  // this sits in a header strip beside the record's title and its balance
  // figure, where an empty frame would be a fourth thing competing for one line
  // and saying nothing.
  if (!path || !url || broken) return <>{fallback}</>;

  const large = size === "lg";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open the style sketch"
        aria-label="Open the style sketch"
        className={cn(
          "group relative shrink-0 overflow-hidden rounded border border-border bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          large ? "block aspect-[4/3] w-full" : "h-8 w-8",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL
            from a private bucket is not a static asset and cannot be optimised
            by next/image without routing the credentials through the loader. */}
        <img
          src={url}
          alt={alt}
          className={cn(
            "h-full w-full",
            // See the note above: a 32px chip is an identifier and crops; a
            // corner tile is meant to be read and must not.
            large ? "object-contain" : "object-cover transition-transform group-hover:scale-110",
          )}
          onError={onBroken}
        />
        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-foreground/40 group-hover:flex">
          <ImageIcon className={large ? "h-5 w-5 text-white" : "h-3.5 w-3.5 text-white"} />
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={alt} size="sm" fullScreen={false}>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- see above. */}
          <img
            src={url}
            alt={alt}
            className="max-h-[70vh] w-auto max-w-full rounded object-contain"
            onError={onBroken}
          />
        </div>
      </Sheet>
    </>
  );
}
