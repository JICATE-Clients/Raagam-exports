"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { hasOpenModalInDom, isBusy, subscribeBusy } from "@/lib/reload-guard";

/**
 * Opens a create form when the URL carries `?new=1`.
 *
 * The mobile "peek sheet" nav's ＋ button links to `${section}?new=1&a=<action>`.
 * A create form calls `useCreateIntent(() => setOpen(true))`; when the param is
 * present the callback fires and the `new`/`a` params are stripped via
 * `router.replace` (no history entry) so the form doesn't re-open on refresh or
 * back, and normal open/close still works. Fires on both initial load and
 * in-page navigations that add the param (e.g. tapping ＋ while already here).
 *
 * ## `&back=<path>` — RETURN WHERE THE PERSON CAME FROM (0812, Home Favourites)
 *
 * A Favourites tile opens `/hr/time-off/leave?new=1&back=/`: the form, then — once it is
 * saved or cancelled — Home again, not the leave LIST the form happened to sit on. The client
 * asked for "zero menu diving"; landing on a list after every save is menu diving backwards.
 *
 * Done HERE, once, so every screen that already answers `?new=1` (~40) gets it without being
 * edited. It watches the same signal the silent auto-reload does (`lib/reload-guard.ts`): every
 * form surface — `Sheet`, `MasterFullScreen`, any `useModalGuard` overlay — holds the page busy
 * while open. So: wait to SEE the form open, then return when nothing holds the page any more.
 * A form that never opens (no permission, a list with nothing to add) is given 2 s and then
 * forgotten — the person stays where they are rather than being bounced on a timer.
 *
 * Only a same-app path is honoured (`/…`, never `//host`), so the param cannot send anyone off-site.
 */
export function useCreateIntent(onNew: () => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const cb = useRef(onNew);
  /** Tears down a running "return when the form closes" watch. */
  const stopWatch = useRef<(() => void) | null>(null);

  // The latest callback, kept outside render (a ref written during render is refused by the
  // React Compiler). Declared first, so it has run before the intent effect below reads it.
  useEffect(() => {
    cb.current = onNew;
  });

  // Unmounting (navigating away by hand) ends any watch — never push someone back later.
  useEffect(() => () => stopWatch.current?.(), []);

  useEffect(() => {
    if (params.get("new") !== "1") return;
    cb.current();
    const back = params.get("back");
    if (back && back.startsWith("/") && !back.startsWith("//")) {
      stopWatch.current?.();
      stopWatch.current = returnWhenFormCloses(() => router.push(back));
    }
    const next = new URLSearchParams(params.toString());
    next.delete("new");
    next.delete("a");
    next.delete("back");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);
}

/**
 * Wait to see a form open, then call `go` once nothing holds the page. Returns the teardown.
 * A plain function, not an effect: the intent effect re-runs when `router.replace` strips the
 * params, and a cleanup tied to it would cancel the watch the moment it started.
 */
function returnWhenFormCloses(go: () => void): () => void {
  const open = () => isBusy() || hasOpenModalInDom();
  let seen = false;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    window.clearInterval(poll);
    window.clearTimeout(giveUp);
  };
  const check = () => {
    if (stopped) return;
    if (open()) seen = true;
    else if (seen) {
      stop();
      go();
    }
  };
  const unsubscribe = subscribeBusy(check);
  // The form mounts a frame or two after `onNew`; look for it until it shows.
  const poll = window.setInterval(check, 150);
  const giveUp = window.setTimeout(() => {
    if (!seen) stop();
  }, 2000);
  return stop;
}
