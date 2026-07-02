"use client";

import { useEffect, useState } from "react";
import { Download, Plus, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "raagam-pwa-install-dismissed";

/**
 * App-wide install affordance. On Android/Chrome it surfaces the native install
 * flow via `beforeinstallprompt`; on iOS Safari (no such event) it shows the
 * manual "Add to Home Screen" hint. Hidden once installed/standalone or after
 * the user dismisses it (persisted in localStorage).
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [standalone, setStandalone] = useState(true); // assume hidden until checked
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as { standalone?: boolean }).standalone === true,
    );
    setIsIOS(
      /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase()) &&
        !("MSStream" in window),
    );
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setDeferred(null);
    else dismiss();
  }

  if (standalone || dismissed) return null;
  if (!deferred && !isIOS) return null; // nothing to offer (e.g. desktop w/o event)

  return (
    <div className="fixed inset-x-3 bottom-24 z-30 mx-auto max-w-sm rounded-2xl border border-border bg-surface p-3.5 shadow-2xl md:bottom-4 md:left-4 md:right-auto md:mx-0">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
          R
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground">Install Raagam ERP</p>
          {isIOS && !deferred ? (
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
              Tap the <span className="font-medium">Share</span> button, then
              <span className="font-medium"> Add to Home Screen</span>
              <Plus className="inline h-3.5 w-3.5 align-text-bottom" />.
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
              Add it to your home screen for quick, full-screen access.
            </p>
          )}
          {deferred && (
            <button
              type="button"
              onClick={install}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground active:scale-95"
            >
              <Download className="h-4 w-4" />
              Install
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-surface-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
