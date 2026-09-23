"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * AN EDITOR HOSTED INSIDE THE AMENDMENT WORKSPACE (user 2026-09-23: "no more
 * need to go to Order Entry — the update should happen in the amendment").
 *
 * Order Entry, the two BOMs and the Budget are list-plus-editor screens. Under
 * `/orders/order-amendments/<entry>/<module>` the same component is rendered
 * EMBEDDED: it opens the one record on arrival, never shows its list, and when
 * the editor closes — Save or Cancel, both end in `setMode("list")` — it goes
 * back to the amendment instead of to the list. One behaviour, one hook, four
 * screens; no editor is copied.
 *
 * `open` runs once, from an effect event (the `useOpenIntent` shape), so the
 * screen's own open handler sets its state exactly as a click would.
 */
export type EmbedTarget = {
  /** The record to open — a garment order id, or a budget id for the budget. */
  id: string;
  /** Where Save / Cancel return to. */
  returnHref: string;
};

export function useEmbeddedEditor(opts: {
  embed: EmbedTarget | null | undefined;
  mode: "list" | "edit";
  open: (id: string) => void;
}): void {
  const router = useRouter();
  const opened = useRef(false);
  const doOpen = useEffectEvent(opts.open);
  const id = opts.embed?.id ?? null;
  const back = opts.embed?.returnHref ?? null;
  const { mode } = opts;

  useEffect(() => {
    if (!id || !back) return;
    if (mode === "edit") {
      opened.current = true;
      return;
    }
    if (!opened.current) {
      doOpen(id);
      return;
    }
    router.push(back);
  }, [id, back, mode, router]);
}
