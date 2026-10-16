"use client";

import { useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, type LucideIcon } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";

/**
 * "Download ▾" — EVERY FILE A SCREEN CAN GIVE YOU, BEHIND ONE BUTTON (user
 * 2026-10-16: "the download option now separate Excel, PDF — group it into a
 * download option dropdown … and globally fix").
 *
 * Report and document screens drew Excel and Download PDF as two buttons each,
 * eight times over, beside Print — three buttons where the operator thinks of
 * two jobs (keep a copy · put it on paper). The listings' toolbar already
 * answered it with a hand-rolled Download menu (`data-io-toolbar.tsx`), so that
 * is the shape, drawn once here.
 *
 * PRINT IS NOT A DOWNLOAD and stays its own button beside this one.
 *
 * ONE FORMAT, NO MENU: a screen that offers only a PDF keeps a plain "Download
 * PDF" — a menu holding one item is a click that chooses nothing.
 *
 * BUSY IS THE MENU'S OWN. A format's `run` may return a promise (a PDF is built
 * in the browser); while it is in flight the trigger reads "Building…" and is
 * disabled, so a second click cannot start a second file. Errors stay with the
 * caller, which already toasts them.
 */
export type DownloadFormat = {
  label: string;
  icon?: LucideIcon;
  run: () => void | Promise<unknown>;
  disabled?: boolean;
};

/** The two formats every report offers, worded and iconed once. */
export const asPdf = (run: DownloadFormat["run"], disabled?: boolean): DownloadFormat => ({ label: "PDF", icon: FileText, run, disabled });
export const asExcel = (run: DownloadFormat["run"], disabled?: boolean): DownloadFormat => ({ label: "Excel", icon: FileSpreadsheet, run, disabled });

export function DownloadMenu({
  formats,
  variant = "outline",
  size = "md",
  disabled = false,
  busyLabel = "Building…",
}: {
  formats: DownloadFormat[];
  /** `primary` where downloading is the screen's next step (an order document). */
  variant?: "primary" | "outline";
  size?: "sm" | "md";
  disabled?: boolean;
  busyLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const live = formats.filter(Boolean);
  if (!live.length) return null;

  const go = (f: DownloadFormat) => {
    const out = f.run();
    if (out && typeof (out as Promise<unknown>).then === "function") {
      setBusy(true);
      void (out as Promise<unknown>).catch(() => undefined).finally(() => setBusy(false));
    }
  };
  const off = disabled || busy;

  if (live.length === 1) {
    const f = live[0];
    return (
      <Button variant={variant} size={size} disabled={off || f.disabled} onClick={() => go(f)}>
        <Download className="h-4 w-4" aria-hidden />
        {busy ? busyLabel : `Download ${f.label}`}
      </Button>
    );
  }

  /* DropdownMenu's trigger cannot be disabled, so a disabled menu is drawn as
     the same button, greyed — it stays where it was, saying it is there. */
  if (off) {
    return (
      <Button variant={variant} size={size} disabled>
        <Download className="h-4 w-4" aria-hidden />
        {busy ? busyLabel : "Download"}
        <ChevronDown className="h-4 w-4" aria-hidden />
      </Button>
    );
  }
  return (
    <DropdownMenu
      label="Download"
      align="right"
      triggerClassName={buttonClasses({ variant, size })}
      trigger={
        <>
          <Download aria-hidden />
          Download
          <ChevronDown aria-hidden />
        </>
      }
      items={live.map((f) => ({ label: f.label, icon: f.icon, disabled: f.disabled, onClick: () => go(f) }))}
    />
  );
}
