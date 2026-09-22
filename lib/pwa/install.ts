"use client";

import { useSyncExternalStore } from "react";

/**
 * ONE CAPTURE OF `beforeinstallprompt`, READ BY TWO SURFACES.
 *
 * Chrome fires `beforeinstallprompt` once, early, and only the listener that
 * was registered by then ever holds the event. The floating install toast
 * (`components/pwa/install-prompt.tsx`) is mounted in the root layout so it
 * caught it — and once the operator dismissed the toast there was no way back
 * to installing (client, 2026-09-22: the MD wants "Install app" in the profile
 * menu). A menu row cannot listen for itself: the menu body only exists while
 * the menu is open, long after the event has fired.
 *
 * So the event lives HERE, in module state, captured the moment this module is
 * first imported on the client (the root layout imports the toast, which
 * imports this, so that is page load). Both surfaces read the same snapshot
 * through `usePwaInstall()`, which is what makes them agree: install from the
 * toast and the menu row flips to "installed"; dismiss the toast and the menu
 * row can bring it back.
 *
 * `useSyncExternalStore` rather than `useState` + effects because the state is
 * genuinely external to any one component and must survive that component
 * unmounting — exactly the menu-row case.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PwaInstallState {
  /** Running inside the installed app (standalone window / home-screen). */
  standalone: boolean;
  /** `appinstalled` fired this session — installed, even though this tab is still a browser tab. */
  installed: boolean;
  /** Chrome/Edge handed us the deferred prompt: a native install dialog is one call away. */
  canPrompt: boolean;
  /** iOS Safari: no event exists; the only route is Share → Add to Home Screen. */
  ios: boolean;
  /** The operator asked to see the install hint (toast) again from the menu. */
  hintRequested: boolean;
}

const DISMISS_KEY = "raagam-pwa-install-dismissed";

let deferred: BeforeInstallPromptEvent | null = null;
let state: PwaInstallState = {
  standalone: false,
  installed: false,
  canPrompt: false,
  ios: false,
  hintRequested: false,
};
// Server snapshot: nothing is knowable, and it must be a stable reference or
// `useSyncExternalStore` re-renders forever.
const SERVER_STATE: PwaInstallState = { ...state };

const listeners = new Set<() => void>();
function set(patch: Partial<PwaInstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  state = {
    ...state,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true,
    ios:
      /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase()) &&
      !("MSStream" in window),
  };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ installed: true, canPrompt: false, hintRequested: false });
  });
}

export function usePwaInstall(): PwaInstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER_STATE,
  );
}

/** Open the native install dialog. Resolves to the operator's choice, or null when there is no prompt to show. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  if (!deferred) return null;
  const ev = deferred;
  deferred = null;
  set({ canPrompt: false });
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  if (outcome === "accepted") set({ installed: true, hintRequested: false });
  // A dismissed native dialog is a one-shot: Chrome will not re-fire the event
  // this session, so the row goes quiet until the next page load.
  return outcome;
}

/** The toast's own dismissal, persisted so it stays gone across loads. */
export function isHintDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
export function dismissHint() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* private mode — the toast simply comes back next load */
  }
  set({ hintRequested: false });
}
/** The menu row's way back: un-dismiss and show the toast (the iOS route, and the no-event fallback). */
export function requestHint() {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
  set({ hintRequested: true });
}
