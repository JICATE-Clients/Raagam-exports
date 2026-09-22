"use client";

import { useEffect, useEffectEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Open ONE RECORD from a link — `?open=<id>` — the sibling of `useCreateIntent`
 * (`?new=1`), same shape and same reasons.
 *
 * Built for the Internal Work Order screen's "Open Fabric BOM" (2026-09-19): a
 * Yarn or Fabric IWO is planned on `/orders/iwo-fabric-bom`, and the link lands
 * the operator IN that work order's BOM rather than on a list they then have to
 * search. Generic because nothing about it is IWO-specific.
 *
 * THE CALLBACK IS AN EFFECT EVENT (React 19.2's `useEffectEvent`), so a screen
 * can hand in a function that sets state, the effect always calls the LATEST
 * one, and nothing writes a ref during render (`react-hooks/refs` refuses
 * that — `useCreateIntent` still does it and fails the rule). It runs once per
 * link: the parameter is stripped from the URL straight after, so a refresh
 * cannot re-open a record the operator has since closed.
 *
 * The callback decides what an unknown id means — usually nothing, because the
 * record is not in the list this unit can see.
 */
export function useOpenIntent(onOpen: (id: string) => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const open = useEffectEvent(onOpen);

  useEffect(() => {
    const id = params.get("open");
    if (!id) return;
    open(id);
    const next = new URLSearchParams(params.toString());
    next.delete("open");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);
}
