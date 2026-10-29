"use client";

import { createContext, useContext } from "react";

/**
 * "Change" on the person's newest answer (user 2026-10-28, chat mock-up
 * https://claude.ai/artifact/EZKFpQXtQgxeJFnB4EtKDy). The chat provides the
 * one undo it has; every `Me` bubble draws the button and CSS shows it only
 * on the LAST one (see `Me` in assist.tsx), so the bubbles need no prop and no
 * knowledge of which of them is newest.
 *
 * Its own client module because assist.tsx is also imported by server pages
 * (`AssistLayout`), where `createContext` is refused.
 */
export const AssistBackContext = createContext<(() => void) | null>(null);

export function MeChange() {
  const back = useContext(AssistBackContext);
  if (!back) return null;
  return (
    // button-shape: exempt -- a small text chip inside a chat bubble, not an action button
    <button
      type="button"
      onClick={back}
      className="assist-change hidden flex-none rounded-md bg-white/20 px-1.5 py-0.5 text-xs font-semibold text-white/90 hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-white"
    >
      Change
    </button>
  );
}
