"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

/**
 * A value the operator can still read after the layout has cut it off.
 *
 * `truncate` alone is a dead end: the `…` says text is missing and nothing gets
 * it back. Every clipped VALUE — a picker's selected label, a mobile card's
 * title, a row summary — goes through here instead, so pointing at it (or
 * pressing and holding on touch) shows the whole thing.
 *
 * Chrome and navigation labels are deliberately NOT in scope. Truncating a nav
 * item is a layout decision, not lost data, and the full text is reachable by
 * opening the thing. See `doc/ui/LAYOUT.md` §13.
 */

/**
 * Is this element's content wider than the box drawn for it?
 *
 * Works on a `<span>` and on an `<input>` alike, which matters because the
 * pickers' closed trigger is a real input (`data-picker.tsx`) — and an input is
 * the worse case, since it clips with no ellipsis at all and gives the operator
 * no hint that anything is missing.
 *
 * Pass the text as `watch`: a value swapped inside a fixed-width box changes
 * nothing the ResizeObserver can see.
 */
export function useOverflow<T extends HTMLElement>(watch?: unknown) {
  const ref = useRef<T | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  /** What the element actually renders — the bubble's label when none is given. */
  const [textContent, setTextContent] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const measure = () => {
      const now = ref.current;
      if (!live || !now) return;
      // +1 for sub-pixel rounding: `scrollWidth` rounds up, so a value that in
      // fact fits can read as 1px over. A bubble on a value with nothing hidden
      // is worse than no bubble at all.
      setOverflowing(now.scrollWidth > now.clientWidth + 1);
      setTextContent(now.textContent ?? "");
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Content can change without the box changing size, and the two cases need
    // different observers: rendered text is a DOM mutation, but an `<input>`'s
    // value is a property no observer sees — those callers pass `watch`.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    // A webfont that lands after hydration re-lays out the text without
    // resizing the box, so neither observer fires and a long value would
    // silently lose its bubble for the life of the page.
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      live = false;
      ro.disconnect();
      mo.disconnect();
    };
  }, [watch]);

  return { ref, overflowing, textContent };
}

export function Truncated({
  text,
  className,
  children,
  side,
  touch = true,
}: {
  /**
   * The complete value. Rendered unless `children` overrides, and used as the
   * bubble's label. OPTIONAL: with `children` and no `text`, the label is read
   * back off the rendered element, which is what lets this wrap the many call
   * sites whose content is a `ReactNode` rather than a string — a mobile card's
   * `title(r)`, a grid's `rowSummary(row, i)`, an editor's `header.title`.
   *
   * Pass it explicitly whenever the children are more than one text node: the
   * read-back concatenates without separators, so a label and its sublabel
   * would run together in the bubble.
   */
  text?: string;
  /** Layout and type classes — these land on the wrapper, as they did before. */
  className?: string;
  /** For rows that decorate the label (a picker row's sublabel). `text` still fills the bubble. */
  children?: ReactNode;
  side?: "top" | "bottom";
  /**
   * Press-and-hold on touch. Off for anything that commits on `mousedown`
   * rather than `click` — a picker's option rows do, so the hold would show the
   * bubble AND pick the row, and swallowing the click cannot undo that. Those
   * rows let the text wrap on touch instead.
   */
  touch?: boolean;
}) {
  const { ref, overflowing, textContent } = useOverflow<HTMLSpanElement>(text);
  const label = text ?? textContent;

  // The wrapper is always the Tooltip, even when the value fits. Rendering the
  // span bare and only wrapping it once it overflows would remount the very
  // element being measured and move `className` onto a different box — the
  // measurement would then flip, unflip, and never settle.
  return (
    <Tooltip
      label={label}
      touch={touch}
      side={side}
      disabled={!overflowing || !label}
      className={cn("block min-w-0", className)}
    >
      <span ref={ref} className="block w-full truncate">
        {children ?? text}
      </span>
    </Tooltip>
  );
}
