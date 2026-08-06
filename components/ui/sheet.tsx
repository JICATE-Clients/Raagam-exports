"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { RequiredScope } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { focusFirstField, focusField } from "@/lib/focus";
import { useRegisterShortcut } from "@/lib/shortcuts";
import { useModalGuard, confirmDiscard } from "@/lib/reload-guard";

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

  // Hold off the silent PWA auto-reload while an editor is open — see
  // lib/reload-guard.ts. One line here covers every Sheet in the app.
  useModalGuard(open);

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
      // TAB IS NOT HANDLED HERE ANY MORE (2026-08-04). It used to run `cycleTab`
      // on this container, which made this one of only two surfaces in the app
      // where Tab was ordered at all — and it cycled every focusable, so it
      // stopped on the ✕ and on Save/Cancel while the arrows and Enter stepped
      // over them. Both halves are now `cycleTab` called from
      // components/shell/keyboard-nav-provider.tsx: this dialog is a
      // `[role="dialog"]`, so the provider already resolves it as the scope and
      // as an editor surface, and the trap comes with it. A second copy here
      // would silently claim the key back — the provider bails on
      // `defaultPrevented`.
      if (e.key === "Escape") {
        // A control that already consumed Escape (an open Combobox list, an
        // open DropdownMenu) must not also close the editor. React's delegated
        // listener runs on `document` too and fires BEFORE this one, so its
        // preventDefault is visible here — but its stopPropagation is not, as
        // both listeners sit on the same node.
        if (e.defaultPrevented) return;
        if (!confirmDiscard()) return;
        // Say we consumed it. Escape's last layer (keyboard-nav-provider, bound
        // to `window` so it runs after this) leaves the PAGE, so an editor that
        // closes silently would also navigate the operator away.
        e.preventDefault();
        entry();
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
        focusField(home); // caret at the end when the opener is a text field
      }
    };
  }, [open]);

  // A per-sheet "last focused field" ref used to live here, so the Tab trap could
  // resume after a portal picker unmounted and stranded the cursor on <body>.
  // `rememberFocus` / `restoreFocusIfLost` (lib/focus.ts), fed by one `focusin`
  // listener in the keyboard provider, is the app-wide version of exactly that,
  // and the provider calls it before every Tab. One history, every surface.

  // Field navigation (Tab / Enter / ↑ / ↓) is NOT wired here any more — it comes
  // from components/shell/keyboard-nav-provider.tsx, which drives every surface
  // in the app from one listener. This dialog is a `[role="dialog"]`, so the
  // provider already treats it as the navigation boundary. What stays below is
  // overlay-specific: the focus trap, Escape, and autofocus on open.

  if (!mounted) return null;

  return createPortal(
    /**
     * A SHEET STARTS WITH A CLEAN REQUIRED SCOPE.
     *
     * `RequiredScope` is React context, so it follows the RENDER tree, not the
     * DOM — and a quick-create sheet is rendered by the picker that opened it.
     * Put that picker in a mandatory child-grid cell (`ChildGrid` wraps every
     * cell in a `RequiredScope`) and every empty field INSIDE the sheet
     * inherited "required", stamped `data-required-empty`, and held the cursor:
     * on New Yarn, opened from Fabric ▸ Composition ▸ Yarn *, the optional
     * Purity refused to let Tab past and announced "Yarn is required."
     * (client 2026-08-06).
     *
     * Resetting here rather than in each sheet is the point — the leak is a
     * property of nesting a surface inside a field, not of any one sheet. A
     * sheet's own `<Field required>` / `RequiredScope` still work normally:
     * they provide their own context below this one.
     */
    <RequiredScope required={false} label={null}>
      {/* `inert` (not just aria-hidden) while closed: the closed state is only
          opacity-0 + pointer-events-none, and `focusablesIn`'s `offsetParent`
          check does NOT exclude an opacity-0 element — so every field of every
          closed Sheet stayed in the page's tab order. Tabbing off the last
          control of a page walked into an invisible form. */}
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
              <div data-focus-region="content" className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5">
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
            {/* content — the one scroll, and the footer rides INSIDE it (below) */}
            <div data-focus-region="content" className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 md:px-8 md:pt-6">
              {/* `@container/editor` is the density container: the compact control
                  sizes in input/select/combobox/label and the tighter gaps in
                  DetailSection all key off `@2xl/editor:`. Being a CONTAINER query
                  and not a `md:` breakpoint is what keeps compact desktop-only for
                  free — this wrapper is ~1180px in a full-screen editor but only
                  ~440px inside a nested picker at the same viewport, and mobile
                  never reaches the 672px threshold, so touch targets stay 36px.
                  1180px matches doc/ui/LAYOUT.md §1 and the signed-off mockups in
                  doc/ui/New Material Fabric - Organized Layout.html; at max-w-5xl
                  (1024px) it was already above SectionGrid's 896px 2-up threshold,
                  but the mockup's two ~560px columns need the extra 156px. */}
              <div className="@container/editor mx-auto w-full max-w-[1180px]">{children}</div>
              {/* THE ACTION BAR MEETS THE FORM.
                  It used to be a SIBLING of this scroll pane, and the pane is
                  `flex-1` — so it stretched to the whole viewport whatever the
                  record's height and pushed Save/Cancel to the bottom edge
                  regardless. On a short record that left ~400px of white between
                  the last field and the buttons, and the client read them as
                  orphaned (2026-08-04). Legacy puts them directly under the grid
                  with empty window below, which is what this restores.

                  `sticky bottom-0` gives both behaviours from one rule: with a
                  short form the pane does not overflow, sticky stays inert, and
                  the bar sits in normal flow under the last field; with a long
                  one (Material, Customer, Vendor) it pins to the bottom exactly
                  as before while the fields scroll beneath it. `bg-surface` is
                  what stops them showing through once pinned, and `-mx`/`px`
                  re-bleed the band to the pane's full width after this element
                  inherited the pane's padding.

                  Still carries its own `data-focus-region="footer"`, and nesting
                  costs the keyboard nothing: `regionOf` resolves by `closest()`
                  so Tab still steps over these buttons, `submitTargetOf` finds
                  them with a descendant `querySelector`, and Ctrl+S goes through
                  `footerRef`. It also stays OUTSIDE `@container/editor` above —
                  LAYOUT.md §10 — which is what keeps Save/Cancel at `h-9` while
                  every field beside them compacts to `h-8`. */}
              {footer && (
                <div
                  data-focus-region="footer"
                  className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-border bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:-mx-8 md:mt-6 md:px-8 md:pb-3"
                >
                  {/* same cap as the content above, so Save/Cancel stay aligned with
                      the right edge of the form rather than the viewport. */}
                  <div ref={footerRef} className="mx-auto flex w-full max-w-[1180px] items-center justify-end gap-2">{footer}</div>
                </div>
              )}
            </div>
          </div>
        )
      ) : (
        /* compact slide-over (nested pickers / small dialogs) — bottom sheet on
           mobile, right drawer ≥md */
        <div
          ref={containerRef}
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
          <div data-focus-region="content" className="flex-1 overflow-y-auto px-5 pb-4">
            {children}
          </div>
          {footer && (
            <div data-focus-region="footer" ref={footerRef} className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
              {footer}
            </div>
          )}
        </div>
      )}
      </div>
    </RequiredScope>,
    document.body,
  );
}
