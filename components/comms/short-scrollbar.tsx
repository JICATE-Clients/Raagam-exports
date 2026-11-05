"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * A SHORT SCROLLBAR HANDLE (user 2026-11-05, screenshot 151121 and the
 * "shorter scrollbar handle" artifact: "intha scroll bar hight a korai").
 *
 * The browser sizes a native handle to the share of the list on screen, and
 * no CSS caps it — so on Pulse's chat list, which is only a little longer than
 * its pane, the handle ran almost the full height. This draws its own: a 4px
 * rounded handle of a FIXED length, widening to 6px under the mouse, placed by
 * the scroll position. The target hides its native bar (`scrollbar-none`) and
 * keeps scrolling natively, so the wheel, touchpad, keyboard and screen readers
 * are untouched; this is only the picture of where you are, plus a drag.
 *
 * Draws nothing while the list fits. Positioned against the nearest
 * `relative` ancestor of the target. Writes styles straight to the DOM on
 * scroll — no React state, so scrolling never re-renders the list.
 * A touch screen (no hover, coarse pointer) has its own overlay bar; the rail
 * is hidden there.
 */
export function ShortScrollbar({ target, length = 56 }: { target: RefObject<HTMLElement | null>; length?: number }) {
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = target.current;
    const r = rail.current;
    const t = thumb.current;
    if (!el || !r || !t) return;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = el.scrollHeight - el.clientHeight;
        const on = max > 1;
        r.style.display = on ? "" : "none";
        if (!on) return;
        const room = Math.max(r.clientHeight - length, 0);
        t.style.transform = `translateY(${(el.scrollTop / max) * room}px)`;
      });
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    // The list's own size, and its content's: rows come and go on every refresh.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", sync);
      ro.disconnect();
      mo.disconnect();
    };
  }, [target, length]);

  function onThumbDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = target.current;
    const r = rail.current;
    if (!el || !r || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    handle.dataset.drag = "";
    const y0 = e.clientY;
    const s0 = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    const room = Math.max(r.clientHeight - length, 1);
    const move = (ev: PointerEvent) => {
      el.scrollTop = s0 + ((ev.clientY - y0) / room) * max;
    };
    const up = () => {
      delete handle.dataset.drag;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  // A click on the rail above or below the handle jumps a page, as a native bar does.
  function onRailDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = target.current;
    const t = thumb.current;
    if (!el || !t || e.target !== e.currentTarget || e.button !== 0) return;
    const above = e.clientY < t.getBoundingClientRect().top;
    el.scrollBy({ top: (above ? -1 : 1) * el.clientHeight * 0.9, behavior: "smooth" });
  }

  return (
    <div
      ref={rail}
      aria-hidden
      onPointerDown={onRailDown}
      className="group/rail absolute bottom-1.5 right-px top-1.5 z-10 w-2 [@media(hover:none)]:hidden"
    >
      <div
        ref={thumb}
        onPointerDown={onThumbDown}
        style={{ height: length }}
        className="absolute right-0.5 top-0 w-1 cursor-grab rounded-full bg-[color-mix(in_srgb,var(--muted-foreground)_55%,transparent)] transition-[width,right,background-color] duration-100 group-hover/rail:right-px group-hover/rail:w-1.5 group-hover/rail:bg-muted-foreground data-[drag]:right-px data-[drag]:w-1.5 data-[drag]:cursor-grabbing data-[drag]:bg-muted-foreground"
      />
    </div>
  );
}
