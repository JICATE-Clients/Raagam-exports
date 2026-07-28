"use client";

import { useEffect, useRef, type RefObject } from "react";
import { focusFirstField, focusField } from "@/lib/focus";

/**
 * The three things every modal owes the keyboard: focus moves INTO it on open,
 * Escape closes it, and focus goes back where it came from on close.
 *
 * `components/ui/sheet.tsx` does this itself. Several overlays predate it and
 * hand-rolled the markup without the behaviour — an audit found four
 * (`import-dialog`, `search-palette`, the mobile-nav search sheet, and
 * `approve-amendment-screen`'s DecisionModal). Symptom is always the same: the
 * dialog opens with focus still on the button behind it, so the first keystroke
 * goes nowhere and Escape does nothing.
 *
 * This is a hook rather than four copies deliberately — the same shape was
 * hand-copied fifteen times for picker list navigation and every copy drifted.
 *
 * Escape is a `document` listener that respects `defaultPrevented`, so a control
 * that already consumed the key (an open Combobox list, a palette input) still
 * wins. React 19 attaches its delegated listeners to `document` too, so a React
 * `stopPropagation()` cannot stop this — only `preventDefault` is visible here.
 */
export function useOverlayFocus(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
) {
  // Latest onClose behind a ref so the listener registered on open never goes
  // stale against a caller that passes a new closure each render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    // Whatever was focused before we opened — usually the trigger button.
    const opener = document.activeElement;
    const home = opener instanceof HTMLElement ? opener : null;

    // Deferred: the panel may not be laid out (or may still be `inert`) on the
    // tick the effect runs, and focusFirstField filters on offsetParent.
    const id = window.setTimeout(() => focusFirstField(panelRef.current), 30);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKey);
      // Only reclaim focus if nothing else has taken it — otherwise closing one
      // overlay would steal the cursor from whatever opened next.
      const active = document.activeElement;
      if (home && home.isConnected && (!active || active === document.body)) {
        focusField(home); // caret at the end when the opener is a text field
      }
    };
  }, [open, panelRef]);
}
