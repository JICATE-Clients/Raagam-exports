"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  orderedFocusables,
  enterAdvance,
  focusFirstField,
  arrowOpensPicker,
  arrowNavigate,
} from "@/lib/focus";
import { useRegisterShortcut } from "@/lib/shortcuts";

// Ref-counts open Sheets so a nested Sheet's cleanup doesn't clear the scroll
// lock a still-open outer Sheet depends on (e.g. a field picker inside an
// entity editor).
let openSheetCount = 0;

// Stack of open Sheets' close handlers — only the topmost sheet responds to
// Escape/Tab, so one Escape closes one nested sheet at a time instead of the
// whole stack, and the focus trap belongs to the sheet actually on top.
const sheetStack: (() => void)[] = [];

/**
 * True when focus sits inside a modal layer that is NOT `root` — typically a
 * dialog picker portaled to <body> from inside this sheet. Such a layer owns
 * Escape and Tab for as long as it is up, so the sheet underneath must stand
 * down even though it is still the topmost entry on `sheetStack`.
 */
function inForeignModal(root: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  const modal = active.closest<HTMLElement>('[role="dialog"], [aria-modal="true"]');
  return !!modal && modal !== root && !root?.contains(modal);
}

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
  headerActions,
  zIndexBase = 90,
  fullScreen = true,
  size = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Compact action buttons rendered in the header, left of the ✕ close button
   *  with a divider (planned layout 2026-07-23: picker CRUD lives here as
   *  icon buttons, not in the footer). */
  headerActions?: ReactNode;
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

  // The dialog container of whichever variant is rendered — the boundary for
  // the focus trap and Enter-advance below.
  const containerRef = useRef<HTMLDivElement>(null);
  // The footer button row — Ctrl+S "clicks" its last enabled button (Save is
  // conventionally last, after Cancel / Save-as-Draft).
  const footerRef = useRef<HTMLDivElement>(null);
  // Latest onClose behind a stable ref, so the stack entry registered on open
  // keeps its position even when the caller passes a new closure each render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  // The last field the user was actually on inside this sheet. If focus is ever
  // orphaned to <body> (a dialog picker closing, a control that blurs itself),
  // Tab resumes from here instead of restarting at the top of the form.
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  // Whatever was focused *before* this sheet opened — restored on close, so
  // dismissing a nested picker returns the cursor to the trigger that opened it.
  const openerRef = useRef<HTMLElement | null>(null);

  // Ctrl/⌘+S saves the open editor by activating the primary footer button.
  // Only the full-screen entity editors (size="lg") opt in — nested pickers /
  // small config dialogs (size="sm") keep browser Ctrl+S. Topmost registration
  // wins, so an inner sheet doesn't steal Save from... well, it IS the one the
  // user sees, which is correct.
  useRegisterShortcut(
    "save",
    () => {
      // The primary action is the LAST footer button by position (Cancel →
      // Save). Deliberately not "last ENABLED button": when Save is disabled by
      // a validation error that resolved to Cancel, so Ctrl+S silently
      // discarded the form (client 2026-07-25). A disabled primary means the
      // form isn't saveable — do nothing.
      const btns = footerRef.current?.querySelectorAll<HTMLButtonElement>("button");
      const primary = btns?.[btns.length - 1];
      if (primary && !primary.disabled) primary.click();
    },
    open && !!footer && size !== "sm",
  );

  // Autofocus the first data field on open, so the cursor is ready to type
  // (checklist "Auto Focus").
  //
  // This used to skip size="sm", on the theory that pickers autofocus their own
  // search box. They do not: a Sheet renders its children UNCONDITIONALLY (the
  // closed state is just opacity-0 + inert), so a child's `autoFocus` fires once
  // at mount — while the sheet is still closed — and never again on open. Focus
  // therefore stayed on the trigger button OUTSIDE the dialog, and since a
  // picker binds its ↑/↓/Enter handler to the list container, none of those keys
  // reached it: the list could only be driven with the mouse (client
  // 2026-07-25). Portal-based pickers were unaffected because they mount their
  // content on open, which is why this only bit the Sheet-based ones.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => focusFirstField(containerRef.current), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Remember who opened us so the cursor can go home on close. Anything
    // already inside this sheet is not an opener — it unmounts with us, and
    // focusing a detached node silently sends focus to <body>.
    const opener = document.activeElement;
    openerRef.current =
      opener instanceof HTMLElement && !containerRef.current?.contains(opener) ? opener : null;
    // A fresh closure per open cycle doubles as this sheet's stack identity.
    const entry = () => onCloseRef.current();
    sheetStack.push(entry);
    const onKey = (e: KeyboardEvent) => {
      if (sheetStack[sheetStack.length - 1] !== entry) return; // only the topmost sheet responds
      // Most dialog pickers (components/masters/*-picker.tsx) createPortal
      // straight to <body>, so their DOM is NOT inside this sheet's container
      // and they never join sheetStack — this listener stays "topmost" while
      // one is open on top of us. Without this guard Escape closed the whole
      // editor instead of the picker, and Tab moved focus through the form
      // behind the scrim. Anything wearing its own dialog role owns its keys.
      if (inForeignModal(containerRef.current)) return;
      if (e.key === "Escape") {
        // A control that already consumed Escape (an open Combobox list, an
        // open DropdownMenu) must not also close the editor. React's delegated
        // listener runs on `document` too and fires BEFORE this one, so its
        // preventDefault is visible here — but its stopPropagation is not, as
        // both listeners sit on the same node.
        if (e.defaultPrevented) return;
        entry();
      } else if (e.key === "Tab") {
        // Focus trap. We drive the WHOLE cycle rather than only guarding the
        // two edges: the cycle is region-ordered (fields → footer → ✕) while
        // native Tab is DOM-ordered (✕ → fields → footer), so edge-only
        // trapping compared the wrong elements and let Tab off Save escape the
        // dialog entirely. Owning every Tab keeps the visible order and the
        // trap boundary as one and the same thing.
        const root = containerRef.current;
        if (!root) return;
        const items = orderedFocusables(root);
        if (!items.length) return;
        const active = document.activeElement;
        const inside = active instanceof HTMLElement && root.contains(active);

        // When focus is orphaned (a picker unmounted, a control blurred
        // itself) resume from the field the user last stood on instead of
        // restarting at the top of the form.
        const from = inside ? (active as HTMLElement) : lastFocusedRef.current;
        const idx = from ? items.indexOf(from) : -1;

        e.preventDefault();
        if (idx === -1) {
          (e.shiftKey ? items[items.length - 1] : items[0]).focus();
          return;
        }
        const next = e.shiftKey ? idx - 1 : idx + 1;
        items[(next + items.length) % items.length].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    openSheetCount += 1;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = sheetStack.lastIndexOf(entry);
      if (i !== -1) sheetStack.splice(i, 1);
      openSheetCount = Math.max(0, openSheetCount - 1);
      if (openSheetCount === 0) document.body.style.overflow = "";
      // Hand focus back to the opener (e.g. the picker trigger button), but only
      // if nothing else has claimed it in the meantime.
      const home = openerRef.current;
      const active = document.activeElement;
      if (home && home.isConnected && (!active || active === document.body)) {
        home.focus();
      }
      lastFocusedRef.current = null;
    };
  }, [open]);

  /** Remember the last real field focused inside this sheet (see the trap). */
  const onFocusCapture = (e: React.FocusEvent<HTMLElement>) => {
    const t = e.target;
    if (t instanceof HTMLElement) lastFocusedRef.current = t;
  };

  /**
   * The one form-level key contract, in priority order — shared with the
   * full-screen editor via lib/focus so the two surfaces cannot drift:
   *   ↓/↑ on a picker  → open its dialog
   *   ↓/↑ otherwise    → previous / next field
   *   Enter            → next field
   * Controls that own a key (open list, grid, textarea, native select) consume
   * it before any of this runs.
   */
  const onEnterAdvance = (e: React.KeyboardEvent) => {
    if (arrowOpensPicker(e)) return;
    if (arrowNavigate(e, containerRef.current)) return;
    enterAdvance(e, containerRef.current);
  };

  if (!mounted) return null;

  return createPortal(
    // `inert` (not just aria-hidden) while closed: the closed state is only
    // opacity-0 + pointer-events-none, and `focusablesIn`'s `offsetParent`
    // check does NOT exclude an opacity-0 element — so every field of every
    // closed Sheet stayed in the page's tab order. Tabbing off the last control
    // of a page walked into an invisible form.
    <div aria-hidden={!open} inert={!open}>
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
              ref={containerRef}
              role="dialog"
              aria-modal="true"
              onFocusCapture={onFocusCapture}
              className={cn(
                "flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl transition-all duration-200 ease-out",
                open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
              )}
            >
              {/* header */}
              <div data-focus-region="header" className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
                <div className="flex shrink-0 items-center gap-1">
                  {headerActions}
                  {headerActions && <div className="mx-1 h-5 w-px bg-border" />}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4 shrink-0" />
                  </button>
                </div>
              </div>
              {/* content — the one scroll */}
              <div data-focus-region="content" className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5" onKeyDown={onEnterAdvance}>
                {children}
              </div>
              {/* footer */}
              {footer && (
                <div data-focus-region="footer" ref={footerRef} className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
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
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            onFocusCapture={onFocusCapture}
            style={{ zIndex: zIndexBase + 1 }}
            className={cn(
              "fixed inset-0 flex flex-col bg-surface transition-all duration-200 ease-out",
              open ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
            )}
          >
            {/* header */}
            <div data-focus-region="header" className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-8">
              <h2 className="truncate text-base font-semibold text-foreground md:text-lg">{title}</h2>
              <div className="flex shrink-0 items-center gap-1">
                {headerActions}
                {headerActions && <div className="mx-1 h-5 w-px bg-border" />}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                >
                  <X className="h-4 w-4 shrink-0" />
                </button>
              </div>
            </div>
            {/* content — the one scroll */}
            <div data-focus-region="content" className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6" onKeyDown={onEnterAdvance}>
              <div className="mx-auto w-full max-w-5xl">{children}</div>
            </div>
            {/* footer */}
            {footer && (
              <div data-focus-region="footer" className="shrink-0 border-t border-border bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-8 md:pb-3">
                <div ref={footerRef} className="mx-auto flex w-full max-w-5xl items-center justify-end gap-2">{footer}</div>
              </div>
            )}
          </div>
        )
      ) : (
        /* compact slide-over (nested pickers / small dialogs) — bottom sheet on
           mobile, right drawer ≥md */
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          onFocusCapture={onFocusCapture}
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
          <div data-focus-region="header" className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
            <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              {headerActions && <div className="mx-1 h-5 w-px bg-border" />}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                <X className="h-4 w-4 shrink-0" />
              </button>
            </div>
          </div>
          <div data-focus-region="content" className="flex-1 overflow-y-auto px-5 pb-4" onKeyDown={onEnterAdvance}>
            {children}
          </div>
          {footer && (
            <div data-focus-region="footer" ref={footerRef} className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
              {footer}
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
