"use client";

import { useEffect, useEffectEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * `?draft=<po import id>` → `onDraft(id)`, then the param is stripped — the
 * buyer-PO sibling of `useOpenIntent` (`?open=`) and `useCreateIntent`
 * (`?new=1`), and built the same way so the three behave alike: fire once per
 * arrival, then `router.replace` so a refresh does not fire it again.
 *
 * Used by Order Entry to open a NEW order pre-filled from a reviewed buyer PO
 * (doc/order/digitalisation-plan.md §2). It opens a form; it saves nothing.
 */
export function useDraftIntent(onDraft: (id: string) => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fire = useEffectEvent(onDraft);

  useEffect(() => {
    const id = params.get("draft");
    if (!id) return;
    fire(id);
    const next = new URLSearchParams(params.toString());
    next.delete("draft");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);
}
