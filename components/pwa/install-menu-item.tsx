"use client";

import { CheckCircle2, Download } from "lucide-react";
import { promptInstall, requestHint, usePwaInstall } from "@/lib/pwa/install";
import { cn } from "@/lib/utils";

/**
 * "Install app" as a row in the profile menu (client, 2026-09-22): the MD and
 * managers want to install Raagam as an app from the place they already look,
 * not from a toast they may have dismissed weeks ago.
 *
 * Four states, and the row is NEVER absent — a menu entry that appears only on
 * some devices reads as broken on the others:
 *   • inside the installed app         → "App installed", inert
 *   • Chrome/Edge holding the prompt   → "Install app", opens the native dialog
 *   • iOS Safari (no prompt exists)    → "Install app", brings back the toast
 *                                        with the Share → Add to Home Screen hint
 *   • anything else (desktop Firefox,  → "Install app", disabled, with the reason
 *     or Chrome that already installed
 *     it but is running in a tab)
 *
 * Device notifications are deliberately NOT requested here after an install.
 * Stacking a permission dialog straight on top of the install dialog is how a
 * permission gets denied for good, and the bell menu already owns that toggle
 * (`components/pwa/push-toggle.tsx`) with the server-side subscription it needs.
 */
export function InstallMenuItem({ onDone }: { onDone?: () => void }) {
  const { standalone, installed, canPrompt, ios } = usePwaInstall();

  const rowClass = cn(
    "flex w-full items-center gap-2 rounded px-3 py-2 text-sm",
    "text-foreground hover:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent",
  );

  if (standalone || installed) {
    return (
      <button type="button" disabled className={cn(rowClass, "text-muted-foreground")}>
        <CheckCircle2 className="h-4 w-4 text-success" /> App installed
      </button>
    );
  }

  if (canPrompt || ios) {
    return (
      <button
        type="button"
        onClick={async () => {
          if (canPrompt) await promptInstall();
          else requestHint();
          onDone?.();
        }}
        className={rowClass}
      >
        <Download className="h-4 w-4" /> Install app
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled
      title="This browser is not offering to install it — it may already be installed, or use Chrome / Edge."
      className={cn(rowClass, "text-muted-foreground opacity-70")}
    >
      <Download className="h-4 w-4" />
      <span className="flex flex-col items-start leading-tight">
        Install app
        <span className="text-[11px]">Not offered by this browser</span>
      </span>
    </button>
  );
}
