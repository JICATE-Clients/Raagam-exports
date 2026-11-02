"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the server-rendered page every `seconds` while the tab is visible,
 * and once on return to it. A hidden tab costs nothing — the same rule Live
 * Punches follows for its device poll.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const id = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return null;
}
