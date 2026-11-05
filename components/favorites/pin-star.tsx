"use client";

import { usePathname } from "next/navigation";
import { Star } from "lucide-react";
import { useFavoritesApi } from "./favorites-provider";
import { cn } from "@/lib/utils";

/**
 * ☆ IN THE TOP BAR — pin the screen you are on to Home (0812).
 *
 * In the bar rather than in `PageHeader`, because PageHeader draws nothing visible on most
 * pages (user 2026-10-01, "remove the page heading from everywhere"), so a star there would
 * have nowhere to sit. The bar is on every screen already. Hidden where there is nothing to
 * pin: Home itself, a hub of cards, a record page that is not a screen of its own.
 */
export function PinStar() {
  const pathname = usePathname();
  const fav = useFavoritesApi();
  if (!fav || !pathname || !fav.canPinPath(pathname)) return null;
  const on = fav.isPinnedPath(pathname);
  const label = on ? "Remove from Home favourites" : "Pin to Home favourites";
  // button-shape: exempt -- a lone on/off star in the top bar, sized with the bell beside it
  return (
    <button
      type="button"
      onClick={() => void fav.toggleScreen(pathname)}
      disabled={fav.pending}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cn(
        "hidden size-9 place-items-center rounded-control text-muted-foreground hover:bg-surface-muted md:grid",
        on && "text-[#d99a06]",
      )}
    >
      <Star className="h-[18px] w-[18px]" fill={on ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}
