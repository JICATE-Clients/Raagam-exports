"use client";

/**
 * "Is a full-page record editor on screen right now?"
 *
 * The app shell keeps a 224px sidebar beside every route. That is right for a
 * list, and wrong for a document editor: the editor already carries its own
 * section rail, so the operator ends up with two vertical navigations and a
 * form squeezed between them (client 2026-08-10). While one is open the sidebar
 * stands down and the editor gets the full width.
 *
 * WHY A MODULE COUNTER AND NOT A CONTEXT PROVIDER. The shape is copied
 * deliberately from `lib/reload-guard.ts`, which answers the same kind of
 * question ("is anything busy?") for a consumer that is nowhere near the
 * component that knows the answer. A provider would have to wrap the layout AND
 * be threaded past the server/client boundary that `app/(app)/layout.tsx` sits
 * on; a module counter is read by anyone who imports it.
 *
 * COUNTED, NOT A BOOLEAN, for the reason the reload guard is: two editors can
 * legitimately overlap for a frame during a route change, and a plain flag
 * would be cleared by the first one to unmount, leaving the sidebar back while
 * the second editor is still on screen.
 *
 * REGISTRATION IS AN EFFECT WITH A CLEANUP, which is what makes this safe to
 * put in a shared shell. AGENTS.md records the opposite: an ungated `dirty`
 * flag feeding `useUnsavedGuard` pinned the PWA auto-update off for a whole
 * session because nothing ever released it. Here an unmount — including one
 * caused by an error boundary — releases the count, so the sidebar cannot get
 * stuck hidden.
 */

import { useEffect, useSyncExternalStore } from "react";

let openCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Declare that a full-page editor is on screen. Called by `MasterFullScreen`
 * for its page mount only — an overlay sits ON TOP of the shell, so the sidebar
 * behind it is already covered and hiding it would just make the scrim jump.
 */
export function useEditorPresence(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    openCount += 1;
    emit();
    return () => {
      openCount = Math.max(0, openCount - 1);
      emit();
    };
  }, [open]);
}

/**
 * Read it. `useSyncExternalStore` rather than `useState` + an effect so the
 * shell re-renders in the same commit the editor mounts in — an effect-based
 * read would paint the sidebar for one frame before removing it.
 *
 * The server snapshot is `false`: the shell renders on the server, where no
 * editor can be mounted, and returning anything else would hydrate a sidebar
 * that disagrees with the markup.
 */
export function useEditorOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => openCount > 0,
    () => false,
  );
}
