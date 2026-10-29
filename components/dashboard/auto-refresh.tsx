"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

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
 * - keep its own clock. `asOf` is the server's render time, so "Updated" is
 *   when the numbers were actually read, never when the browser last ticked.
 */
export function AutoRefresh({ asOf }: { asOf: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
    const refresh = (force = false) => {
      if (document.visibilityState !== "visible") return;
      if (!force && Date.now() - last.current < EVERY_MS - 1_000) return;
      const a = document.activeElement;
      if (!force && a instanceof HTMLElement && a.matches("input, select, textarea")) return;
      last.current = Date.now();
      start(() => router.refresh());
    };
    const id = window.setInterval(() => refresh(), EVERY_MS);
    const onVisible = () => refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      <span>
        Live · updated <span className="tabular-nums">{asOf}</span>
      </span>
      <button
        type="button"
        onClick={() => {
          last.current = Date.now();
          start(() => router.refresh());
        }}
        aria-label="Refresh the dashboard now"
        title="Refresh now"
        className="grid size-7 place-items-center rounded-control text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RefreshCw className={cn("size-3.5", pending && "motion-safe:animate-spin")} />
      </button>
    </span>
  );
}
