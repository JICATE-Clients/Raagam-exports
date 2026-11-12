"use client";

import { useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { loadPersonPhotos } from "@/lib/hr/person-photos";
import { useModalGuard } from "@/lib/reload-guard";

/**
 * A PERSON'S FACE BESIDE THEIR NAME (user 2026-11-06: "wherever we pick the
 * name it should come with the profile picture they already attached").
 *
 * The photo is `staff.photo_url` / `workers.photo_url` (0557) — a public URL in
 * the `employee-photos` bucket, written by `PhotoUpload` on the person's Detail
 * tab. Pass it as `photoUrl` where the row already carries it, or pass the
 * person as `person` ("staff:<id>" / "worker:<id>", Time Off's personKey) and
 * the circle looks it up in one map, read once per browser session
 * (`loadPersonPhotos`) and shared by every circle on every screen. No photo, or
 * one that no longer loads, is the initials in the same circle.
 *
 * Size it with `className` (`h-7 w-7 text-[10px]`); the default is 32px.
 *
 * A PHOTO OPENS BIGGER ON CLICK (user 2026-11-10: "if someone clicks the image
 * it should show lil bit pop up bigger"). One card over a dim backdrop; any
 * click or Esc closes it. The click stops at the circle, so a row it sits in
 * is not opened as well. Initials have nothing bigger to show and stay inert.
 * A picker's option row passes `zoom={false}`: there a click means "pick".
 */
export function PersonAvatar({
  name,
  photoUrl,
  person,
  className,
  zoom = true,
}: {
  name: string | null | undefined;
  photoUrl?: string | null;
  /** "staff:<id>" / "worker:<id>" — looked up when `photoUrl` is not given. */
  person?: string | null;
  className?: string;
  /** Click opens the photo bigger. Off inside a picker's option row. */
  zoom?: boolean;
}) {
  const photos = usePersonPhotos(!photoUrl && !!person);
  const url = photoUrl ?? (person ? photos[person] : undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);
  const box = cn(
    "grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    className,
  );
  if (url && failed !== url) {
    // eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL, as photo-upload.tsx draws it.
    const img = <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(url)} />;
    if (!zoom) {
      return (
        <span aria-hidden className={box}>
          {img}
        </span>
      );
    }
    return (
      <>
        {/* A span, not a <button>: the circle often sits inside a row's link or button. */}
        <span
          role="button"
          aria-label={`View the photo of ${name ?? "this person"}`}
          tabIndex={-1}
          className={cn(box, "cursor-zoom-in")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPeek(true);
          }}
        >
          {img}
        </span>
        {peek && <PhotoPeek src={url} name={name} onClose={() => setPeek(false)} />}
      </>
    );
  }
  return (
    <span aria-hidden className={box}>
      {initialsOf(name)}
    </span>
  );
}

function PhotoPeek({ src, name, onClose }: { src: string; name: string | null | undefined; onClose: () => void }) {
  // A hand-rolled overlay declares itself to the reload guard (AGENTS.md).
  useModalGuard(true);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  // React bubbles a portal's events to the circle's parents, so every click
  // stops here — the row behind must not open as the card closes.
  function close(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }
  const label = (name ?? "").split(/ \(| · /)[0];
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label ? `Photo of ${label}` : "Photo"}
      className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/50 p-4"
      onClick={close}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <figure className="w-72 max-w-full overflow-hidden rounded-2xl bg-surface shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL. */}
        <img src={src} alt={label} className="aspect-square w-full object-cover" />
        {label && <figcaption className="break-words px-3 py-2 text-center text-sm font-medium">{label}</figcaption>}
      </figure>
    </div>,
    document.body,
  );
}

/** "staff:<id>" from a row carrying staff_id / worker_id; null when it has neither. */
export function personKeyOf(r: { staff_id?: string | null; worker_id?: string | null }): string | null {
  return r.staff_id ? `staff:${r.staff_id}` : r.worker_id ? `worker:${r.worker_id}` : null;
}

export function initialsOf(name: string | null | undefined): string {
  // A picker label carries more than the name — "NAME (CODE) · Worker".
  return (name ?? "")
    .split(/ \(| · /)[0]
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/* ── The one photo map, shared by every circle ──────────────────────────── */

const EMPTY: Record<string, string> = {};
let photos: Record<string, string> = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function ensureLoaded(): void {
  if (loading) return;
  loading = loadPersonPhotos()
    .then((p) => {
      photos = p;
      for (const l of listeners) l();
    })
    .catch(() => {
      loading = null; // try again on the next circle that asks
    });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function usePersonPhotos(wanted: boolean): Record<string, string> {
  useEffect(() => {
    if (wanted) ensureLoaded();
  }, [wanted]);
  return useSyncExternalStore(subscribe, () => photos, () => EMPTY);
}

/**
 * A NAME WITH ITS FACE — the cell every HR list uses for a person. `children`
 * replaces the plain name where the name is a link or carries a second line.
 */
export function PersonCell({
  name,
  person,
  photoUrl,
  children,
  className,
}: {
  name: string | null | undefined;
  person?: string | null;
  photoUrl?: string | null;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <PersonAvatar name={name} person={person} photoUrl={photoUrl} className="h-7 w-7 text-[10px]" />
      <span className="min-w-0">{children ?? <span className="text-sm">{name}</span>}</span>
    </span>
  );
}
