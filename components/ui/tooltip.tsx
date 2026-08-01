"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Hover/focus label for a control whose own text the operator cannot read —
 * either because it has none (an icon-only button) or because it has too much
 * (a value clipped by its field). Icon-only buttons relied on the native
 * `title=` attribute, and a native tooltip is slow (~1s, not configurable),
 * unstyled, and never appears for keyboard users at all.
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
 * A second pass in a layout effect keeps the bubble on screen. An icon label is
 * six characters wide and always fitted; a truncated VALUE does not, so the
 * bubble now clamps horizontally against the viewport and flips to the other
 * side of the trigger rather than sliding off the top. Both need the bubble's
 * rendered size, which is why they cannot happen in `place()`.
 *
 * TOUCH IS OPT-IN (`touch`), and off by default. It used to be refused outright
 * because "a tap would show a bubble that nothing can dismiss, and this ships
 * as an installed PWA" — a real objection, so the touch path answers it rather
 * than ignoring it: the bubble opens only on a deliberate press-and-hold, and
 * it closes on the next tap anywhere, on any scroll, and on a timer. The hold
 * also swallows the click it would otherwise have produced, so pressing a
 * picker to read its value does not also open the picker. Icon buttons pass
 * nothing and keep the old hover-only behaviour exactly; the mobile surfaces
 * render `MobileCardList` with real text labels instead.
 */

/** Sits above `DropdownMenu` (150) and any stacked `Sheet` (base 90, +10/level). */
const Z_INDEX = 400;
const DELAY_MS = 350;
/** Space between the trigger and the bubble, and between the bubble and the viewport edge. */
const GAP = 6;
const EDGE = 8;

// ---------------------------------------------------------------------------
// Touch policy. These four are the whole gesture; tune them here.
//
// HOLD_MS is the trade-off: shorter fires while an operator is scrolling a long
// picker list, longer reads as "nothing happened" to someone who does not know
// the gesture exists. MOVE_SLOP is what separates a press from the start of a
// scroll. SWALLOW_TAP keeps a read from becoming an edit — hold to see the
// value, tap again to actually open the control. AUTO_HIDE_MS is the backstop
// for the dismissal problem above: on a shop-floor tablet a bubble left sitting
// over the next control is worse than one that leaves early.
// ---------------------------------------------------------------------------
const HOLD_MS = 450;
const MOVE_SLOP = 8;
const SWALLOW_TAP = true;
const AUTO_HIDE_MS = 4000;

/** `useLayoutEffect` warns when a client component is server-rendered. */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Placement = { top: number; left: number; side: "top" | "bottom" };

export function Tooltip({
  label,
  children,
  side = "top",
  className,
  touch = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  /**
   * Classes for the wrapper span. It defaults to `inline-flex`, which is right
   * for an icon button and wrong for a field: wrapping a full-width control in
   * an inline box collapses it and breaks the one-width-per-field rule in
   * `doc/ui/LAYOUT.md` §7. A field passes `block w-full`.
   */
  className?: string;
  /** Enable press-and-hold on touch. See the touch policy block above. */
  touch?: boolean;
  /**
   * Keep the wrapper and its layout, draw nothing. For `Truncated`, whose value
   * only sometimes has anything hidden: dropping the wrapper when it fits would
   * move the layout classes onto a different element and remount the span being
   * measured, so the measurement would flip back and forth forever.
   */
  disabled?: boolean;
}) {
  const [pos, setPos] = useState<Placement | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The trigger's rect at open time — the flip below re-derives `top` from it. */
  const anchor = useRef<DOMRect | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const byTouch = useRef(false);
  const swallow = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (hold.current) {
      clearTimeout(hold.current);
      hold.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clear();
    byTouch.current = false;
    pressAt.current = null;
    setPos(null);
  }, [clear]);

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    anchor.current = r;
    // Horizontally centred on the trigger; the bubble itself pulls back by half
    // its own width via translateX(-50%), so its width need not be known here.
    // The layout effect below corrects both axes once it can be measured.
    setPos({
      top: side === "top" ? r.top - GAP : r.bottom + GAP,
      left: r.left + r.width / 2,
      side,
    });
  }, [side]);

  const show = useCallback(() => {
    if (disabled) return;
    clear();
    timer.current = setTimeout(place, DELAY_MS);
  }, [clear, place, disabled]);

  // A value can grow past its field, or shrink back inside it, without the
  // wrapper unmounting — so a bubble already open has to be taken down.
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  // Second pass: nudge the measured bubble inside the viewport. Runs before
  // paint, so the corrected position is the only one drawn. It settles after one
  // correction — clamping does not change the bubble's size, so the next run
  // computes the same numbers and the guard below stops the loop.
  useIsoLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const r = anchor.current;
    if (!pos || !bubble || !r) return;
    const w = bubble.offsetWidth;
    const h = bubble.offsetHeight;

    const half = w / 2;
    const min = EDGE + half;
    const max = window.innerWidth - EDGE - half;
    // A bubble wider than the viewport cannot satisfy both edges; centre it.
    const left = min > max ? window.innerWidth / 2 : Math.min(Math.max(pos.left, min), max);

    // A long value wraps to several lines, so the bubble can be tall enough to
    // leave the viewport. Flip to the other side — but only away from the
    // requested side, never back, or the two branches would trade places
    // forever when neither fits.
    let next = pos.side;
    if (next === side) {
      if (side === "top" && r.top - GAP - h < EDGE) next = "bottom";
      else if (side === "bottom" && r.bottom + GAP + h > window.innerHeight - EDGE) next = "top";
    }

    if (Math.abs(left - pos.left) > 0.5 || next !== pos.side) {
      setPos({ top: next === "top" ? r.top - GAP : r.bottom + GAP, left, side: next });
    }
  }, [pos, side]);

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

  // The dismissal contract for a press-and-hold bubble: it has no pointer to
  // leave, so the next tap anywhere and a plain timer are what close it.
  // Capture phase, so a control that stops propagation cannot strand it.
  useEffect(() => {
    if (!pos || !byTouch.current) return;
    const t = setTimeout(hide, AUTO_HIDE_MS);
    document.addEventListener("pointerdown", hide, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", hide, true);
    };
  }, [pos, hide]);

  useEffect(() => clear, [clear]);

  return (
    <span
      ref={wrapRef}
      className={cn("inline-flex", className)}
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return;
        show();
      }}
      onPointerLeave={hide}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") {
          // A mouse click means the operator is acting on the control, not
          // reading it — get out of the way.
          hide();
          return;
        }
        if (!touch || disabled) return;
        pressAt.current = { x: e.clientX, y: e.clientY };
        clear();
        hold.current = setTimeout(() => {
          byTouch.current = true;
          swallow.current = SWALLOW_TAP;
          place();
        }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        // Past the slop this is a scroll, not a press.
        if (e.pointerType !== "touch" || !pressAt.current) return;
        const dx = Math.abs(e.clientX - pressAt.current.x);
        const dy = Math.abs(e.clientY - pressAt.current.y);
        if (dx > MOVE_SLOP || dy > MOVE_SLOP) clear();
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onClickCapture={(e) => {
        // Fires after the pointerup that ended a completed hold. Swallowing it
        // is what keeps "press to read the value" from also opening the picker.
        if (!swallow.current) return;
        swallow.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
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
            ref={bubbleRef}
            aria-hidden="true"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: Z_INDEX,
              transform: `translate(-50%, ${pos.side === "top" ? "-100%" : "0"})`,
            }}
            // No `whitespace-nowrap`: a clipped value is exactly the case where
            // the bubble has to wrap rather than run off the screen. Short icon
            // labels still sit on one line — the box shrinks to its content.
            className="pointer-events-none max-w-[min(90vw,28rem)] break-words rounded-md bg-foreground px-2 py-1 text-xs font-medium text-surface shadow-md"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
