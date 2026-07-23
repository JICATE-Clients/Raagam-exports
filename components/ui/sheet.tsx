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
  fullScreen = true,
  size = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  zIndexBase?: number;
  /** Render as a modal editor surface instead of the right/bottom slide-over.
   *  **Defaults to true.** With `size="lg"` (entity editors) this is a **true
   *  full-screen page** — the client asked for the whole viewport so long forms
   *  spread out instead of scrolling inside a cramped box (update.md #10, client
   *  message 2026-07-23 #9). With `size="sm"` (nested pickers / small config
   *  dialogs) it stays a centred dialog box on the scrim. The slide-over remains
   *  available via `fullScreen={false}` but is currently unused. */
  fullScreen?: boolean;
  /** "lg" = full-screen entity editor; "sm" = centred max-w-md dialog
   *  (nested pickers / small config dialogs). */
  size?: "sm" | "lg";
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
          "fixed inset-0 bg-black/50 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      {fullScreen ? (
        size === "sm" ? (
          /* centered dialog box — nested pickers / small config dialogs. A
             contained box on the scrim; scrolls internally when long. */
          <div
            className="pointer-events-none fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: zIndexBase + 1 }}
          >
            <div
              role="dialog"
              aria-modal="true"
              className={cn(
                "flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl transition-all duration-200 ease-out",
                open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
              )}
            >
              {/* header */}
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                >
                  ✕
                </button>
              </div>
              {/* content — the one scroll */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5">{children}</div>
              {/* footer */}
              {footer && (
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
                  {footer}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* true full-screen editor — entity forms occupy the whole viewport so
             long forms spread out instead of scrolling inside a cramped box
             (client 2026-07-23 #9). Content is centred at a readable width;
             header/footer stay pinned while only the body scrolls. */
          <div
            role="dialog"
            aria-modal="true"
            style={{ zIndex: zIndexBase + 1 }}
            className={cn(
              "fixed inset-0 flex flex-col bg-surface transition-all duration-200 ease-out",
              open ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
            )}
          >
            {/* header */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-8">
              <h2 className="truncate text-base font-semibold text-foreground md:text-lg">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>
            {/* content — the one scroll */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
              <div className="mx-auto w-full max-w-5xl">{children}</div>
            </div>
            {/* footer */}
            {footer && (
              <div className="shrink-0 border-t border-border bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-8 md:pb-3">
                <div className="mx-auto flex w-full max-w-5xl items-center justify-end gap-2">{footer}</div>
              </div>
            )}
          </div>
        )
      ) : (
        /* compact slide-over (nested pickers / small dialogs) — bottom sheet on
           mobile, right drawer ≥md */
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
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border md:hidden" />
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
            <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
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
      )}
    </div>,
    document.body,
  );
}
