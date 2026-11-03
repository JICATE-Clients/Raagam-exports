"use client";

import { createContext, useContext, type ReactNode } from "react";
import { initials } from "./message-body";

/**
 * userId → HR photo URL, for the people who have one (lib/comms/photos.ts).
 * Provided once by CommsShell; a person absent from it shows their initials.
 */
const PhotosContext = createContext<Record<string, string>>({});

export function PhotosProvider({ photos, children }: { photos: Record<string, string>; children: ReactNode }) {
  return <PhotosContext.Provider value={photos}>{children}</PhotosContext.Provider>;
}

/** The person's HR photo URL, or null (no record, no photo, or not a person). */
export function useUserPhoto(userId: string | null | undefined): string | null {
  const photos = useContext(PhotosContext);
  return (userId && photos[userId]) || null;
}

/** The photo, filling its round avatar box. */
export function PhotoImg({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL.
    <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
  );
}

/** What goes INSIDE a round avatar box: the HR photo, else the initials. The box needs `overflow-hidden`. */
export function Face({ userId, name }: { userId: string | null | undefined; name: string | null | undefined }) {
  const src = useUserPhoto(userId);
  return src ? <PhotoImg src={src} /> : <>{initials(name ?? "")}</>;
}
