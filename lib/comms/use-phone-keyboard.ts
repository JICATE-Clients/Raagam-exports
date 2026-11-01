"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * ## A PHONE CHAT FOLLOWS THE ON-SCREEN KEYBOARD (user 2026-10-31, Pulse)
 *
 * A phone's keyboard does not shrink the page — iOS Safari never does, and
 * Chrome on Android has not by default since 108 (`interactive-widget` =
 * resizes-visual). It only shrinks the VISUAL viewport, so the app shell stayed
 * a full screen tall, the keyboard covered the message box, and the browser
 * panned the whole page upward to reveal the caret — taking the conversation's
 * header and its back arrow off the top of the screen.
 *
 * So while a conversation is open this publishes the visual viewport's height
 * as `--vvh` on <html>, and globals.css ("PHONE CHAT") sizes the shell to it on
 * a phone: the composer then sits directly on the keyboard and the header stays
 * put. Scoped to the conversation screen rather than set app-wide through the
 * viewport meta, because `resizes-content` would lift every screen's fixed
 * bottom tab bar onto the keyboard and only Chrome honours it anyway.
 *
 * A pinch-zoom also shrinks the visual viewport; that is not a keyboard, so the
 * variable is withdrawn while zoomed and the shell keeps its normal height.
 */
export function usePhoneKeyboardViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (vv.scale > 1.01) {
          root.style.removeProperty("--vvh");
          root.removeAttribute("data-kb-open");
          return;
        }
        root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
        root.toggleAttribute("data-kb-open", window.innerHeight - vv.height > 120);
        // iOS pans the document to bring the caret into view; the shell now
        // fits above the keyboard, so put the page back where it belongs.
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      });
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.style.removeProperty("--vvh");
      root.removeAttribute("data-kb-open");
    };
  }, []);
}

const TOUCH = "(pointer: coarse) and (max-width: 767px)";

function subscribeTouch(onChange: () => void): () => void {
  const mq = window.matchMedia(TOUCH);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * A phone with an on-screen keyboard: no Shift key to make a new line with, and
 * opening a chat should not throw the keyboard over the messages.
 */
export function useTouchPhone(): boolean {
  return useSyncExternalStore(
    subscribeTouch,
    () => window.matchMedia(TOUCH).matches,
    () => false,
  );
}
