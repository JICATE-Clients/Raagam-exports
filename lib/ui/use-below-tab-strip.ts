"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * THE APP'S NAVIGATION BAR STAYS ON SCREEN ABOVE EVERY FULL-SCREEN EDITOR
 * (user 2026-10-12, screenshot 120127: "global aa ellam sub field kullaume
 * intha navigation field theriyanum"). The open-tabs strip — ‹ ›, the
 * "Consignee · 17 open ▾" switcher, Recent — is the operator's way between
 * screens, and a `fixed inset-0` editor drew over it the moment + Add or a
 * record was opened.
 *
 * One measurement for every overlay that covers the window (`MasterFullScreen`
 * mount="overlay", `Sheet` size="lg"), so a third one is a call, not a copy.
 * It writes `--below-strip-top` / `--below-strip-left` on each element; the
 * element reads them in `md:top-[var(--below-strip-top,0px)]
 * md:left-[var(--below-strip-left,0px)]`. `md:` only — on a phone the strip is
 * hidden under an editor and the editor stays a full-screen takeover.
 *
 * Measured RELATIVE to wherever the box currently sits (its position minus the
 * offset already applied), because what `inset-0` resolves against depends on
 * the theme: a glass appearance puts `backdrop-filter` on the work panel, which
 * becomes the containing block; otherwise it is the viewport. One sum, both.
 *
 * A ResizeObserver on the strip re-measures when the sidebar stands down for an
 * editor (the strip widening is what announces it), plus window resize.
 */
export function useBelowTabStrip(refs: RefObject<HTMLElement | null>[], active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    const strip = document.querySelector<HTMLElement>("[data-tab-strip]");
    const els = refs.map((r) => r.current).filter((e): e is HTMLElement => !!e);
    if (!strip || els.length === 0) return;
    const measure = () => {
      const s = strip.getBoundingClientRect();
      for (const el of els) {
        // A hidden strip (phone, or a route that renders none) measures 0×0.
        if (s.height === 0) {
          el.style.removeProperty("--below-strip-top");
          el.style.removeProperty("--below-strip-left");
          continue;
        }
        const applied = (name: string) => parseFloat(el.style.getPropertyValue(name)) || 0;
        // `offsetTop`, not the rect: it ignores transforms, and Sheet opens with
        // a `translate-y-3` slide that a rect read at open time would bake in.
        // Offsets are relative to `offsetParent` when there is one (a glass
        // theme's work panel), else to the page — bring both to the viewport.
        const p = el.offsetParent as HTMLElement | null;
        const pr = p?.getBoundingClientRect();
        const baseTop = pr && p ? pr.top + p.clientTop : 0;
        const baseLeft = pr && p ? pr.left + p.clientLeft : 0;
        const originTop = baseTop + el.offsetTop - applied("--below-strip-top");
        const originLeft = baseLeft + el.offsetLeft - applied("--below-strip-left");
        el.style.setProperty("--below-strip-top", `${Math.max(0, s.bottom - originTop)}px`);
        el.style.setProperty("--below-strip-left", `${Math.max(0, s.left - originLeft)}px`);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // `refs` is a fresh array each render; the elements behind it are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
