"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, RotateCcw, Shirt, ZoomIn, ZoomOut } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { useSignedUrl } from "@/components/ui/sketch-thumbnail";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  coverOf,
  isImageFile,
  styleGalleries,
  type GalleryFile,
  type StyleGallery,
} from "@/lib/orders/amendments/style-gallery";

/**
 * THE ORDER ENTRY LISTING'S THUMBNAIL COLUMN (user, 2026-09-23: "Style
 * Thumbnail Attachments" — the list shows each order's picture so a
 * merchandiser finds an order by what it LOOKS like, not only by its RE No).
 *
 * Three layers, each one gesture deeper:
 *
 * - **The cell** — a 48px cover (`coverOf`: the starred Primary, else the
 *   first Sketch picture, else the first picture) with a `+N` badge for the
 *   other pictures. No picture → a Shirt placeholder, which is NOT a button:
 *   there is nothing behind it to open, and a Tab stop that does nothing is a
 *   stop the operator has to learn to skip. A PDF-only order shows the
 *   placeholder too — a tech pack is a document, never a thumbnail.
 * - **The hover gallery** — after 350ms (the same delay as `Tooltip` /
 *   `Truncated`, so the list has one hover rhythm) a popover of every picture,
 *   grouped by style with a style pill per group once there is more than one
 *   style (`styleGalleries`). MOUSE ONLY, deliberately: it is a preview, the
 *   lightbox behind the click carries every picture with prev/next, so the
 *   keyboard and touch paths lose nothing by skipping it — and a popover that
 *   opened on focus would sit over the next row every time Tab passed by.
 * - **The lightbox** — a `Sheet`, not a hand-rolled overlay, for the reason
 *   `SketchThumbnail` records: `Sheet` registers with the reload guard, traps
 *   focus and unwinds on Escape. Zoom (buttons, wheel, double-click), pan by
 *   drag, prev/next (buttons and ← →), and a download through a short signed
 *   URL. The popover is NOT a dialog and carries no `role="dialog"` — like a
 *   tooltip it must never register with `lib/reload-guard.ts`, or hovering a
 *   cell would hold off the silent auto-update.
 *
 * The cell reads the listing row's `files` as they already arrive —
 * `getAmendments()` embeds them — so the column costs no query, only one
 * signature per visible cover.
 */

const BUCKET = "garment-order-docs";
/** Same as `Tooltip` / `Truncated`. */
const HOVER_DELAY_MS = 350;
/** Grace for the pointer to cross the gap from the cell into the popover. */
const LEAVE_GRACE_MS = 150;
/** A download needs the link only for the moment the browser follows it. */
const DOWNLOAD_TTL_S = 60;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

export function StyleThumbnailCell<F extends GalleryFile>({ files }: { files: readonly F[] }) {
  const images = files.filter(isImageFile);
  const cover = coverOf(images);
  const groups = styleGalleries(images);
  /* THE LIGHTBOX WALKS THE GALLERY'S ORDER, not the row's: style by style, the
     order-level pictures last — so ▶ from the popover's last Top picture goes
     on to the first Bottom one, the same order the operator just saw. */
  const ordered = groups.flatMap((g) => g.images);

  const [lightboxAt, setLightboxAt] = useState<number | null>(null);
  const [popover, setPopover] = useState<DOMRect | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cellRef = useRef<HTMLButtonElement>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = closeTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  // A popover anchored to a row that scrolls away would float free of it —
  // same rule `Tooltip` keeps: scroll or resize dismisses rather than chases.
  useEffect(() => {
    if (!popover) return;
    const hide = () => setPopover(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [popover]);

  if (!cover) {
    return (
      <span
        className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-border text-muted-foreground"
        role="img"
        aria-label="No style picture"
        title="No style picture"
      >
        <Shirt className="h-5 w-5" aria-hidden />
      </span>
    );
  }

  const enter = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimers();
    if (popover) return;
    openTimer.current = setTimeout(() => {
      const r = cellRef.current?.getBoundingClientRect();
      if (r) setPopover(r);
    }, HOVER_DELAY_MS);
  };
  const leave = () => {
    clearTimers();
    closeTimer.current = setTimeout(() => setPopover(null), LEAVE_GRACE_MS);
  };
  const openAt = (file: F) => {
    clearTimers();
    setPopover(null);
    setLightboxAt(Math.max(0, ordered.indexOf(file)));
  };

  const extra = ordered.length - 1;
  const label = `Open the style pictures (${ordered.length})`;

  return (
    <>
      <button
        ref={cellRef}
        type="button"
        onClick={() => openAt(cover)}
        onPointerEnter={enter}
        onPointerLeave={leave}
        aria-label={label}
        className="relative block h-12 w-12 shrink-0 overflow-hidden rounded border border-border bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CoverImage path={cover.storage_path ?? null} alt={cover.file_name ?? "Style picture"} />
        {extra > 0 && (
          <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-foreground/75 px-1 text-[10px] font-semibold leading-4 text-background tabular-nums">
            +{extra}
          </span>
        )}
      </button>

      {popover &&
        typeof document !== "undefined" &&
        createPortal(
          <HoverGallery
            anchor={popover}
            groups={groups}
            cover={cover}
            onPick={openAt}
            onEnter={clearTimers}
            onLeave={leave}
          />,
          document.body,
        )}

      {lightboxAt != null && (
        <Lightbox images={ordered} start={lightboxAt} onClose={() => setLightboxAt(null)} />
      )}
    </>
  );
}

/** The cell's own picture. A picture that will not paint (an expired
 *  signature, a deleted object) falls back to the Shirt rather than a broken
 *  image — the button stays, since the lightbox may still reach the others. */
function CoverImage({
  path,
  alt,
  fit = "cover",
}: {
  path: string | null;
  alt: string;
  /** `cover` crops the 48px cell; `contain` shows a preview whole. */
  fit?: "cover" | "contain";
}) {
  const { url, broken, onBroken } = useSignedUrl(BUCKET, path);
  if (!url || broken) {
    return (
      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
        <Shirt className="h-5 w-5" aria-hidden />
      </span>
    );
  }
  // A signed URL from a private bucket cannot go through next/image's loader
  // (see sketch-thumbnail.tsx).
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see above.
    <img
      src={url}
      alt={alt}
      className={cn("h-full w-full", fit === "contain" ? "object-contain" : "object-cover")}
      onError={onBroken}
    />
  );
}

const POPOVER_W = 296;
/** Pills + the 224px stage + the counter — what the bottom clamp keeps on screen. */
const POPOVER_H = 290;
const EDGE = 8;

/**
 * THE HOVER PREVIEW IS A CAROUSEL (user, 2026-09-23: "also apply carousel in
 * listing hover gallery") — one picture large, ‹ › at its edges, "2 / 3"
 * beneath, wrapping round; the same shape the Order Entry Files cell uses, so
 * the two previews of one order's pictures read alike. A grid of 64px tiles
 * told the operator how MANY pictures there were and let them see none of
 * them; this is a preview, so the picture is the point.
 *
 * - Opens on the order's cover — the picture the 48px cell was already
 *   showing, so the popover grows out of what the pointer was on.
 * - A style pill (only once there is more than one style) switches the
 *   carousel to that style's pictures, starting on ITS cover (`coverOf`).
 * - Clicking the large picture opens the lightbox AT that picture.
 * - Mouse-only like before: the arrows are `tabIndex={-1}`, and ← → are
 *   listened for ONLY while the pointer is inside the popover — a list page
 *   with the popover closed, or merely open under a pointer that has left,
 *   keeps its arrows untouched.
 *
 * Mounted fresh on every open (the cell renders it only while open), so the
 * starting slide is plain initial state — no effect resets it.
 */
function HoverGallery<F extends GalleryFile>({
  anchor,
  groups,
  cover,
  onPick,
  onEnter,
  onLeave,
}: {
  anchor: DOMRect;
  groups: StyleGallery<F>[];
  /** The cell's cover — where the carousel opens. */
  cover: F;
  onPick: (f: F) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const startGroup = Math.max(
    0,
    groups.findIndex((g) => g.images.includes(cover)),
  );
  const [gi, setGi] = useState(startGroup);
  const [at, setAt] = useState(() =>
    Math.max(0, groups[startGroup]?.images.indexOf(cover) ?? 0),
  );
  const [hovered, setHovered] = useState(false);

  const group = groups[gi] ?? groups[0];
  const n = group?.images.length ?? 0;
  const file = group?.images[Math.min(at, n - 1)];

  useEffect(() => {
    if (!hovered || n < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowLeft") setAt((i) => (i - 1 + n) % n);
      else if (e.key === "ArrowRight") setAt((i) => (i + 1) % n);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hovered, n]);

  if (!group || !file) return null;

  const many = groups.length > 1;
  const pickGroup = (i: number) => {
    const g = groups[i];
    setGi(i);
    setAt(Math.max(0, g.cover ? g.images.indexOf(g.cover) : 0));
  };
  const step = (d: number) => setAt((i) => (i + d + n) % n);

  // Right of the cell (the thumbnail is the FIRST column, so there is always
  // room there); clamped so a cell near the bottom still shows its preview.
  const left = Math.min(anchor.right + EDGE, window.innerWidth - POPOVER_W - EDGE);
  const top = Math.max(EDGE, Math.min(anchor.top, window.innerHeight - POPOVER_H - EDGE));
  const arrow =
    "absolute top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 text-foreground shadow hover:bg-background";

  return (
    <div
      onPointerEnter={() => {
        setHovered(true);
        onEnter();
      }}
      onPointerLeave={() => {
        setHovered(false);
        onLeave();
      }}
      style={{ position: "fixed", left, top, width: POPOVER_W, zIndex: 150 }}
      className="rounded-md border border-border bg-background p-2 shadow-lg"
    >
      {many && (
        <div className="mb-2 flex flex-wrap gap-1">
          {groups.map((g, i) => (
            <button
              key={g.styleRef ?? ""}
              type="button"
              tabIndex={-1}
              onClick={() => pickGroup(i)}
              aria-pressed={i === gi}
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                i === gi ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
              )}
            >
              {g.styleRef ?? "ORDER"}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onPick(file)}
          aria-label={`Open ${file.file_name ?? "picture"}`}
          className="block h-56 w-full overflow-hidden rounded bg-surface-muted cursor-zoom-in"
        >
          <CoverImage
            key={file.storage_path}
            path={file.storage_path ?? null}
            alt={file.file_name ?? "Style picture"}
            fit="contain"
          />
        </button>
        {n > 1 && (
          <>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => step(-1)}
              aria-label="Previous picture"
              className={cn(arrow, "left-1")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => step(1)}
              aria-label="Next picture"
              className={cn(arrow, "right-1")}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="mt-1 text-center text-xs text-muted-foreground tabular-nums">
          {Math.min(at, n - 1) + 1} / {n}
        </div>
      )}
    </div>
  );
}

function Lightbox<F extends GalleryFile>({
  images,
  start,
  onClose,
}: {
  images: readonly F[];
  start: number;
  onClose: () => void;
}) {
  const [at, setAt] = useState(start);
  const n = images.length;
  const file = images[at];
  const step = (d: number) => setAt((i) => (i + d + n) % n);
  const manyStyles =
    new Set(images.map((f) => f.style_ref_no?.trim() || "")).size > 1;

  // ← → walk the pictures. Nothing here is a field, so the keyboard contract
  // has no claim on the arrows inside this sheet; a field-like target is left
  // alone all the same, in case a future header control is one.
  useEffect(() => {
    if (n < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") setAt((i) => (i - 1 + n) % n);
      else if (e.key === "ArrowRight") setAt((i) => (i + 1) % n);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [n]);

  const [downloadError, setDownloadError] = useState<string | null>(null);

  /* THE STRIP FOLLOWS THE CURRENT PICTURE. ‹ › and ← → move `at` without the
     strip being touched, so the active thumb has to be brought into view here —
     "nearest" on both axes, so a thumb already visible does not jolt the strip
     and the Sheet body is not scrolled vertically to reach it. */
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    thumbRefs.current[at]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [at]);
  const download = async () => {
    if (!file?.storage_path) return;
    setDownloadError(null);
    const { data, error } = await createClient()
      .storage.from(BUCKET)
      .createSignedUrl(file.storage_path, DOWNLOAD_TTL_S, {
        download: file.file_name || true,
      });
    if (error || !data?.signedUrl) {
      setDownloadError(error?.message ?? "Could not download the file.");
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const title = [file?.style_ref_no?.trim() || null, file?.file_name || "Style picture"]
    .filter(Boolean)
    .join(" · ");

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      size="md"
      maxWidthClass="max-w-4xl"
      headerActions={
        <button
          type="button"
          onClick={() => void download()}
          aria-label="Download this picture"
          title="Download"
          className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <Download className="h-4 w-4" />
        </button>
      }
    >
      {/* Keyed by path: a new picture is a new viewer, so zoom and pan reset
          by remounting instead of by a setState in an effect. */}
      <ZoomViewer key={file?.storage_path ?? at} file={file} />
      {/* THE THUMBNAIL STRIP (user, 2026-09-23: "also make the lightbox show
          thumbnails strip below"). Same order ‹ › walks — style by style — with
          a style label where a new style begins once there is more than one.
          It scrolls sideways INSIDE itself: this is a viewer, and a strip that
          widened the dialog would scroll the page instead. Hidden for a single
          picture, where it would be one thumb of the picture already shown. */}
      {n > 1 && (
        <div className="mt-3 flex items-end gap-1.5 overflow-x-auto p-1">
          {images.map((f, i) => {
            const ref = f.style_ref_no?.trim() || null;
            const prev = i > 0 ? images[i - 1].style_ref_no?.trim() || null : undefined;
            const startsStyle = manyStyles && ref !== prev;
            return (
              <div key={f.storage_path ?? i} className="flex shrink-0 items-end gap-1.5">
                {startsStyle && (
                  <span
                    className={cn(
                      "self-stretch border-l border-border pl-1.5 text-[10px] font-semibold text-muted-foreground [writing-mode:vertical-rl] rotate-180",
                      i === 0 && "border-l-0 pl-0",
                    )}
                  >
                    {ref ?? "ORDER"}
                  </span>
                )}
                <button
                  ref={(el) => {
                    thumbRefs.current[i] = el;
                  }}
                  type="button"
                  onClick={() => setAt(i)}
                  aria-label={f.file_name ?? "Style picture"}
                  aria-current={i === at ? "true" : undefined}
                  className={cn(
                    "h-14 w-14 overflow-hidden rounded border bg-surface-muted",
                    i === at
                      ? "border-primary ring-2 ring-primary"
                      : "border-border opacity-70 hover:opacity-100",
                  )}
                >
                  <CoverImage
                    path={f.storage_path ?? null}
                    alt={f.file_name ?? "Style picture"}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={n < 2}
          aria-label="Previous picture"
          className="inline-flex h-9 w-9 items-center justify-center rounded border border-border disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {at + 1} / {n}
          {downloadError && <span className="ml-3 text-destructive">{downloadError}</span>}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={n < 2}
          aria-label="Next picture"
          className="inline-flex h-9 w-9 items-center justify-center rounded border border-border disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </Sheet>
  );
}

function ZoomViewer({ file }: { file: GalleryFile | undefined }) {
  const { url, broken, onBroken } = useSignedUrl(BUCKET, file?.storage_path ?? null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const setZoomTo = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    setZoom(next);
    if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
  };

  /* WHEEL ZOOM NEEDS A NON-PASSIVE LISTENER. React attaches `onWheel` passive,
     so its preventDefault is ignored and the Sheet body would scroll under the
     zoom. Functional updates, so the listener never reads a stale zoom. */
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom === 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x) / zoom, y: d.py + (e.clientY - d.y) / zoom });
  };
  const up = () => {
    drag.current = null;
  };

  return (
    <div>
      <div
        ref={frameRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => setZoomTo(zoom > 1 ? 1 : 2)}
        className={cn(
          "flex h-[65vh] items-center justify-center overflow-hidden rounded bg-surface-muted select-none touch-none",
          zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
        )}
      >
        {url && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- see CoverImage.
          <img
            src={url}
            alt={file?.file_name ?? "Style picture"}
            draggable={false}
            onError={onBroken}
            style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` }}
            className="max-h-full max-w-full object-contain transition-transform duration-75"
          />
        ) : (
          <span className="text-sm text-muted-foreground">
            {broken ? "This picture could not be loaded." : "Loading…"}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => setZoomTo(zoom / 1.5)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-border disabled:opacity-40"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-12 text-center text-xs text-muted-foreground tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoomTo(zoom * 1.5)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-border disabled:opacity-40"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setZoomTo(1)}
          disabled={zoom === 1}
          aria-label="Reset zoom"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-border disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
