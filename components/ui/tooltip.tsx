"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Hover/focus label for a control that carries no visible text — which, until
 * now, the app had no way to draw. Icon-only buttons relied on the native
 * `title=` attribute (`data-picker.tsx:544`, `mobile-card-list.tsx:86`), and a
 * native tooltip is slow (~1s, not configurable), unstyled, and never appears
 * for keyboard users at all.
 *
 * THE LABEL HERE IS DECORATIVE. The bubble is `aria-hidden` and the wrapper
 * adds no ARIA of its own, because the control inside is already required to
 * carry its own `aria-label` — a tooltip that doubles as the accessible name
 * disappears for anyone who reaches the button by keyboard on a browser that
 * suppresses hover. Keep both; they are not the same channel.
 *
 * Portaled with fixed positioning measured from the trigger, for the same
 * reason `DropdownMenu` is: a row control lives inside `DataTable`'s
 * `overflow-x-auto`, which would clip an absolutely-positioned bubble.
 *
 * Touch is excluded on purpose (`pointerType === "touch"`): a tap would show a
 * bubble that nothing can dismiss, and this ships as an installed PWA. The
 * mobile surfaces render `MobileCardList` with real text labels instead.
 */

/** Sits above `DropdownMenu` (150) and any stacked `Sheet` (base 90, +10/level). */
const Z_INDEX = 400;
const DELAY_MS = 350;

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clear();
    setPos(null);
  }, [clear]);

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Horizontally centred on the trigger; the bubble itself pulls back by half
    // its own width via translateX(-50%), so its width need not be known here.
    setPos({
      top: side === "top" ? r.top - 6 : r.bottom + 6,
      left: r.left + r.width / 2,
    });
  }, [side]);

  const show = useCallback(() => {
    clear();
    timer.current = setTimeout(place, DELAY_MS);
  }, [clear, place]);

  // A tooltip anchored to a row that scrolls away would float free of it, so any
  // scroll or resize dismisses rather than chases. Esc dismisses too — the
  // bubble can otherwise outlive interest in it when focus arrived by keyboard.
  useEffect(() => {
    if (!pos) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [pos, hide]);

  useEffect(() => clear, [clear]);

  return (
    <span
      ref={wrapRef}
      className="inline-flex"
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return;
        show();
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
    >
      {children}
      {pos &&
        createPortal(
          <span
            aria-hidden="true"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: Z_INDEX,
              transform: `translate(-50%, ${side === "top" ? "-100%" : "0"})`,
            }}
            className="pointer-events-none whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-surface shadow-md"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
