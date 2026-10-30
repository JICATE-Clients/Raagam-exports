"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** How often the figures re-read themselves (user 2026-10-28: "every minute"). */
const EVERY_MS = 60_000;

/**
 * LIVE FIGURES — re-runs the page's server components every minute while the
 * tab is visible, so the dashboard left open on a factory screen stays true.
 *
 * `router.refresh()`, not a reload: it refetches the RSC payload and swaps it
 * in, so the scroll position and any open `<details>` survive, and the
 * `<Suspense>` boundaries keep showing the old figures until the new ones land
 * rather than flashing skeletons every minute. It is therefore not something
 * `lib/reload-guard.ts` needs to hold off.
 *
 * Three things it deliberately does NOT do:
 * - refresh a hidden tab — fifteen idle tabs would be fifteen full dashboard
 *   query fans every minute; it catches up once on return instead;
 * - refresh while the operator is typing a custom date — the swap would not
 *   lose the value, but a re-render under the caret is still a jolt;
 * - show anything. It drew "Live · updated 10:00" and a refresh button until
 *   2026-10-30 (user: "just need to work, no need this UI") — the refresh is
 *   the feature, the label was not.
 */
export function AutoRefresh() {
  const router = useRouter();
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
    const refresh = (force = false) => {
      if (document.visibilityState !== "visible") return;
      if (!force && Date.now() - last.current < EVERY_MS - 1_000) return;
      const a = document.activeElement;
      if (!force && a instanceof HTMLElement && a.matches("input, select, textarea")) return;
      last.current = Date.now();
      router.refresh();
    };
    const id = window.setInterval(() => refresh(), EVERY_MS);
    const onVisible = () => refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
