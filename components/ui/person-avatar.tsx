"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { loadPersonPhotos } from "@/lib/hr/person-photos";

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
 */
export function PersonAvatar({
  name,
  photoUrl,
  person,
  className,
}: {
  name: string | null | undefined;
  photoUrl?: string | null;
  /** "staff:<id>" / "worker:<id>" — looked up when `photoUrl` is not given. */
  person?: string | null;
  className?: string;
}) {
  const photos = usePersonPhotos(!photoUrl && !!person);
  const url = photoUrl ?? (person ? photos[person] : undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const box = cn(
    "grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    className,
  );
  if (url && failed !== url) {
    return (
      <span aria-hidden className={box}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL, as photo-upload.tsx draws it. */}
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(url)} />
      </span>
    );
  }
  return (
    <span aria-hidden className={box}>
      {initialsOf(name)}
    </span>
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
