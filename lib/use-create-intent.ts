"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Opens a create form when the URL carries `?new=1`.
 *
 * The mobile "peek sheet" nav's ＋ button links to `${section}?new=1&a=<action>`.
 * A create form calls `useCreateIntent(() => setOpen(true))`; when the param is
 * present the callback fires and the `new`/`a` params are stripped via
 * `router.replace` (no history entry) so the form doesn't re-open on refresh or
 * back, and normal open/close still works. Fires on both initial load and
 * in-page navigations that add the param (e.g. tapping ＋ while already here).
 */
export function useCreateIntent(onNew: () => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const cb = useRef(onNew);
  cb.current = onNew;

  useEffect(() => {
    if (params.get("new") !== "1") return;
    cb.current();
    const next = new URLSearchParams(params.toString());
    next.delete("new");
    next.delete("a");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);
}
