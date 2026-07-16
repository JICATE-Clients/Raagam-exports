"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Ref-counts open Sheets so a nested Sheet's cleanup doesn't clear the scroll
// lock a still-open outer Sheet depends on (e.g. a field picker inside an
// entity editor).
let openSheetCount = 0;

/**
 * Responsive editor surface: a right-hand slide-over on desktop (≥md), a
 * bottom sheet on mobile. Portal + scrim + body-scroll-lock + Escape-to-close.
 * The one editor primitive for master/detail forms across modules. Sheets can
 * nest (e.g. a picker Sheet opened from within an entity editor Sheet) — pass
 * a higher `zIndexBase` on the inner one so it reliably stacks above the outer.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  zIndexBase = 90,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  zIndexBase?: number;
}) {
  // Portal targets document.body, which doesn't exist during SSR. Render nothing
  // until mounted so the server and first client render agree (no hydration gap).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    openSheetCount += 1;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      openSheetCount = Math.max(0, openSheetCount - 1);
      if (openSheetCount === 0) document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div aria-hidden={!open}>
      {/* scrim */}
      <div
        onClick={onClose}
        style={{ zIndex: zIndexBase }}
        className={cn(
          "fixed inset-0 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      {/* panel: bottom sheet on mobile, right drawer ≥md */}
      <div
        role="dialog"
        aria-modal="true"
        style={{ zIndex: zIndexBase + 1 }}
        className={cn(
          "fixed flex flex-col bg-surface shadow-lg transition-transform duration-200 ease-out",
          "inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl border-t border-border",
          "md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-none md:w-[420px] md:max-w-[92vw] md:rounded-none md:border-l md:border-t-0",
          open
            ? "translate-y-0 md:translate-x-0 md:translate-y-0"
            : "translate-y-full md:translate-x-full md:translate-y-0",
        )}
      >
        {/* mobile drag handle */}
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border md:hidden" />
        <div className="flex shrink-0 items-center justify-between px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
