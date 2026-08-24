"use client";

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";

/**
 * The style sketch, small in a page header and full size on click.
 *
 * Production and planning read the drawing while filling Combos or Sizes, and
 * the sketch lives on the Order Info section — so without this they navigate
 * back, look, and navigate forward again for every glance.
 *
 * ## THE SIGNED URL IS THE WHOLE PROBLEM
 *
 * The bucket is PRIVATE (0416), so an `<img src>` needs a signed URL, and a
 * signed URL EXPIRES. `file-attachments.tsx` signs for 60 seconds, which is
 * right for its job — a click that opens a tab immediately — and wrong for
 * this one, which sits on screen for as long as the operator has the order
 * open.
 *
 * So this signs for an hour and RE-SIGNS when the path changes. It does not
 * refresh on a timer: an order open for more than an hour is a tab someone left
 * behind, the thumbnail failing to paint costs a reload, and a background
 * interval firing forever on every order screen costs more. `onError` is what
 * catches the expired case — the thumbnail hides rather than showing a broken
 * image.
 *
 * The URL is never stored anywhere. `storage_path` is the column, and 0416 says
 * why: a stored URL gives a row that reads correctly today and 404s next week.
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
}: {
  bucket: string;
  /** Path INSIDE the bucket. Null renders nothing at all. */
  path: string | null;
  alt?: string;
}) {
  /**
   * THE SIGNED URL, PAIRED WITH THE PATH IT WAS SIGNED FOR.
   *
   * Not a bare string. Signing is async, so between a new `path` arriving and
   * its URL coming back, a bare `url` still holds the PREVIOUS sketch — and the
   * header would show the old drawing beside the new order for as long as the
   * round trip takes. Carrying the path with it makes that unrepresentable:
   * `url` below is null until the two agree.
   *
   * It also removes the synchronous `setUrl(null)` that used to clear it, which
   * was a `set-state-in-effect` — a setState during commit scheduling a second
   * render for something the render could derive.
   */
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null);
  const [open, setOpen] = useState(false);
  /**
   * WHICH PATH FAILED, not whether one did.
   *
   * A boolean would have to be reset when `path` changes, and resetting it in
   * the effect is a `set-state-in-effect` — a synchronous setState during the
   * commit that schedules a second render for a value the render could have
   * derived. Storing the failed path instead makes `broken` a comparison, so a
   * new sketch clears the flag by arriving.
   */
  const [brokenPath, setBrokenPath] = useState<string | null>(null);
  const broken = !!path && brokenPath === path;

  useEffect(() => {
    // NOTHING TO SIGN, NOTHING TO CLEAR. The render below already returns null
    // on a missing path, so writing state here would be a second way to say it —
    // and a synchronous one, inside an effect, which is what
    // `react-hooks/set-state-in-effect` exists to stop.
    if (!path) return;

    /* CANCELLED ON UNMOUNT AND ON A PATH CHANGE. Two signatures can be in
       flight when the operator swaps the sketch, and without this the SLOWER
       one wins whichever path it was for — the header would settle on the
       previous drawing. */
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

  /** Only once the signature matches the path being asked about — see `signed`. */
  const url = signed && signed.path === path ? signed.url : null;

  // NOTHING RATHER THAN A PLACEHOLDER. This sits in a header strip beside the
  // record's title and its balance figure; an empty frame there would be a
  // fourth thing competing for one line and saying nothing.
  if (!path || !url || broken) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open the style sketch"
        aria-label="Open the style sketch"
        className="group relative h-8 w-8 shrink-0 overflow-hidden rounded border border-border bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL
            from a private bucket is not a static asset and cannot be optimised
            by next/image without routing the credentials through the loader. */}
        <img
          src={url}
          alt={alt}
          className="h-full w-full object-cover transition-transform group-hover:scale-110"
          onError={() => setBrokenPath(path)}
        />
        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-foreground/40 group-hover:flex">
          <ImageIcon className="h-3.5 w-3.5 text-white" />
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={alt} size="sm" fullScreen={false}>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- see above. */}
          <img
            src={url}
            alt={alt}
            className="max-h-[70vh] w-auto max-w-full rounded object-contain"
            onError={() => setBrokenPath(path)}
          />
        </div>
      </Sheet>
    </>
  );
}
