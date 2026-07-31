"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cycleTab, focusField, focusFirstField, focusLastField } from "@/lib/focus";
import { useRegisterShortcut } from "@/lib/shortcuts";
import { useModalGuard, confirmDiscard, hasOpenModalInDom } from "@/lib/reload-guard";

/**
 * The COMPLEX-tier editor surface: a full-screen takeover with a left section
 * rail (horizontal chip strip on mobile), sticky identity header and a
 * Cancel / [Save as Draft] / Save footer. Extracted from
 * customer-master-screen.tsx — section-SWITCHING (one section rendered at a
 * time), not scroll-spy, which is the proven UX there.
 *
 * Deliberately NOT portaled and fixed at z-[80]: nested picker Sheets keep
 * their default zIndexBase=90 and stack above it, exactly as customer/vendor
 * already rely on.
 *
 * Escape closes this surface. It deliberately did NOT, on the grounds that
 * "closing a dirty 30-field form must be an explicit ✕ / Cancel" — a sound
 * objection to an Escape that discarded work silently, which is the only kind
 * that existed at the time. Escape now asks first (`confirmDiscard`), so the
 * objection is answered rather than overruled, and Escape can mean the same
 * thing here as everywhere else in the app (client 2026-07-27).
 */
export type FullScreenSection = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Completion dot on the rail ("has data"). */
  done?: boolean;
  /** Rendered only while this section is active. */
  content: ReactNode;
};

/** The rail's section buttons, in order. */
function railButtons(rail: HTMLElement | null): HTMLElement[] {
  return rail ? Array.from(rail.querySelectorAll<HTMLElement>("[data-section-key]")) : [];
}

export function MasterFullScreen({
  open,
  onClose,
  modeLabel,
  header,
  sections,
  initialSection,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  /** Thin top strip, e.g. <>Editing <b>Acme</b></> — pair with the ✕ it renders. */
  modeLabel: ReactNode;
  header: {
    /** Defaults to an initials block derived from `initials`. */
    avatar?: ReactNode;
    /** Fallback text for the default avatar (e.g. "AC"). */
    initials?: string;
    title: ReactNode;
    /** Pills + unsaved marker etc., rendered inline after the title. */
    badges?: ReactNode;
    /** Muted meta line under the title (code · country · flags). */
    meta?: ReactNode;
    /** Right-hand header zone (e.g. customer's applicant chips). */
    right?: ReactNode;
  };
  sections: FullScreenSection[];
  initialSection?: string;
  footer: {
    /** Left status text; e.g. "Unsaved changes". */
    status?: ReactNode;
    onCancel: () => void;
    onSave: () => void;
    saveLabel: string;
    canSave: boolean;
    /** Renders a "Save as Draft" outline button when provided. */
    onSaveDraft?: () => void;
    draftLabel?: string;
    isPending?: boolean;
  };
}) {
  const firstKey = initialSection ?? sections[0]?.key ?? "";
  const [section, setSection] = useState(firstKey);
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Where the cursor lands after a section switch — see the Tab listener. */
  const landingRef = useRef<"first" | "last">("first");
  /** Last field focused inside this overlay; the Tab cycle resumes from it. */
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  // Latest sections/active key behind a ref, so the Tab listener registered on
  // open reads the current ones without re-subscribing on every render (the
  // `sections` array is a fresh literal at every consumer's render).
  const navRef = useRef({ sections, section });
  useEffect(() => {
    navRef.current = { sections, section };
  });

  // Hold off the silent PWA auto-reload while this editor is open. Required
  // explicitly: unlike Sheet, this overlay is a bare fixed-inset div with no
  // role="dialog", so reload-guard's DOM scan cannot see it.
  useModalGuard(open);

  // Re-open always lands on the initial section.
  useEffect(() => {
    if (open) setSection(firstKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Autofocus the active section's first field (checklist "Auto Focus") — on open
  // and whenever the section switches. Arriving BACKWARDS (Shift+Tab off the
  // first field of the section after this one) lands on the last field instead,
  // which is where native Shift+Tab would have gone had both panes been mounted.
  //
  // The timeout is load-bearing: a section switch re-mounts the content, so the
  // fields we are aiming at do not exist until after the commit.
  useEffect(() => {
    if (!open) return;
    const landing = landingRef.current;
    landingRef.current = "first";
    const id = window.setTimeout(() => {
      const moved =
        landing === "last" ? focusLastField(contentRef.current) : focusFirstField(contentRef.current);
      // A section with nothing focusable in it (a pure summary pane) would
      // otherwise strand the cursor on the node we just unmounted — i.e. on
      // <body>, where no key reaches the form at all. Fall back to the rail.
      if (!moved) {
        const btn = railButtons(railRef.current).find((el) => el.dataset.sectionKey === section);
        if (btn) focusField(btn);
      }
    }, 60);
    return () => window.clearTimeout(id);
  }, [open, section]);

  // Tab owns the overlay while it is open: the page behind is still mounted, so
  // native Tab walks straight out of the editor and into it. `cycleTab` (the same
  // trap components/ui/sheet.tsx uses) orders the cycle fields → footer → ✕, and
  // `onContentEdge` is where the sections join in — Tab off the LAST field of a
  // section opens the next one, Shift+Tab off the first goes back. Reaching the
  // next section used to need the mouse (client 2026-07-30).
  //
  // Tab still only MOVES: it never refuses because a required field is empty
  // (Enter/Ctrl+S are what validate) and it never changes a value.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      // Anything modal above us owns Tab, exactly as for Escape below: nested
      // picker Sheets stack over this surface and run their own trap.
      if (hasOpenModalInDom()) return;
      cycleTab(e, rootRef.current, {
        resumeFrom: lastFocusedRef.current,
        onContentEdge: (dir) => {
          const { sections: list, section: current } = navRef.current;
          const next = list.findIndex((s) => s.key === current) + dir;
          // Off the end of the last section: decline, and the cycle carries on
          // to the footer's Cancel/Save as it would on any other surface.
          if (next < 0 || next >= list.length) return false;
          landingRef.current = dir === 1 ? "first" : "last";
          setSection(list[next].key);
          return true;
        },
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Ctrl/⌘+S saves the open editor (checklist keyboard shortcut).
  useRegisterShortcut(
    "save",
    () => {
      if (!footer.isPending && footer.canSave) footer.onSave();
    },
    open,
  );

  // Latest onClose behind a stable ref, so the listener registered on open
  // doesn't capture a stale closure when the caller re-renders.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Escape closes the editor, asking first when there is unsaved work.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Anything modal ABOVE us owns Escape: nested picker Sheets stack over
      // this surface by design (see the zIndex note in the header comment), and
      // they are portaled to <body>, so they are not inside our subtree and
      // cannot shield us by containment alone. One Escape must close the picker,
      // not the whole 30-field form behind it.
      if (hasOpenModalInDom()) return;
      if (!confirmDiscard()) return;
      // Say we consumed it. Escape's last layer (keyboard-nav-provider, bound to
      // `window` so it runs after this) leaves the PAGE, and this surface is a
      // bare fixed-inset div that `hasOpenModalInDom` deliberately cannot see —
      // so preventDefault is the only thing that stops one press doing both.
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll behind the overlay (same behavior the customer editor had).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /**
   * The rail is an ARIA tablist with MANUAL activation: arrows move focus
   * between section items, Enter/Space (native, on a real <button>) switches.
   * Auto-activating on arrow would fire the autofocus effect above and yank the
   * cursor into the form mid-arrow, so the operator could never browse the rail.
   *
   * Both axes are handled because the rail is a vertical list on desktop and a
   * horizontal chip strip on mobile. Every branch preventDefaults, or the global
   * `arrowNavigate` would move spatially and take focus out of the rail.
   */
  function onRailKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.defaultPrevented) return;
    const items = railButtons(e.currentTarget);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i === -1 || !items.length) return;
    const last = items.length - 1;
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") next = Math.min(i + 1, last);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = Math.max(i - 1, 0);
    else return;
    e.preventDefault();
    focusField(items[next]);
  }

  if (!open) return null;

  const active = sections.find((s) => s.key === section) ?? sections[0];

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[80] flex flex-col bg-background"
      // Remember the last field focused in here, so the Tab cycle can resume
      // from it when a portal picker unmounts and strands focus on <body>.
      onFocusCapture={(e) => {
        if (e.target instanceof HTMLElement) lastFocusedRef.current = e.target;
      }}
    >
      {/* topbar */}
      <div
        className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5"
        // Tab order is fields → footer → ✕: the close button stays reachable by
        // keyboard but lands last, out of the typing path. See orderedFocusables.
        data-focus-region="header"
      >
        <div className="text-xs text-muted-foreground">{modeLabel}</div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* record header (sticky identity band) */}
      <div className="grid gap-3 border-b border-border bg-surface px-4 py-3 md:grid-cols-[1fr_auto] md:items-center md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {header.avatar ?? (
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-base font-bold text-primary">
              {header.initials ?? "—"}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[15px] font-bold tracking-tight text-foreground">
                {header.title}
              </span>
              {header.badges}
            </div>
            {header.meta && (
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {header.meta}
              </div>
            )}
          </div>
        </div>
        {header.right && <div className="flex flex-col gap-1.5 md:items-end">{header.right}</div>}
      </div>

      {/* body: rail + content */}
      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[228px_1fr]">
        <nav
          ref={railRef}
          role="tablist"
          // Vertical is the desktop truth (the mobile chip strip is horizontal,
          // but the layout is CSS-driven and reading it during render would risk
          // a hydration mismatch). The keydown handler serves both axes anyway.
          aria-orientation="vertical"
          onKeyDown={onRailKeyDown}
          // Chrome, not a field: it sorts with the ✕ at the end of the Tab cycle
          // rather than in the middle of data entry. Tab normally never needs it
          // at all now — Tab off a section's last field opens the next section.
          data-focus-region="header"
          className="flex gap-1 overflow-x-auto border-b border-border bg-surface-muted p-2 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3"
        >
          <span className="hidden px-2 pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground md:block">
            Sections
          </span>
          {sections.map((s) => {
            const isActive = section === s.key;
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                data-section-key={s.key}
                onClick={() => setSection(s.key)}
                aria-current={isActive}
                aria-selected={isActive}
                // Roving tab stop: the whole rail costs ONE Tab stop instead of
                // one per section. The inactive items stay reachable with the
                // arrow keys above (tabIndex={-1} blocks Tab, not .focus()).
                tabIndex={isActive ? 0 : -1}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-[13.5px] transition-colors md:w-full",
                  isActive
                    ? "border-border bg-surface font-semibold text-foreground shadow-sm"
                    : "border-transparent text-muted-foreground hover:bg-surface hover:text-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                <span className="flex-1 truncate whitespace-nowrap">{s.label}</span>
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full border",
                    s.done ? "border-accent bg-accent" : "border-border bg-transparent",
                  )}
                  aria-label={s.done ? "has data" : "empty"}
                />
              </button>
            );
          })}
        </nav>

        <div
          className="min-h-0 flex-1 overflow-y-auto"
          // Field navigation comes from keyboard-nav-provider.tsx; this pane is
          // the navigation boundary because it carries data-focus-scope.
          data-focus-scope
          // ...and the FIELD region of the Tab cycle. Its edges are where "the
          // last field of this section" is, which is what the Tab listener above
          // turns into a section switch.
          data-focus-region="content"
        >
          {/* max-w-3xl (768px) used to cap this pane, which made the whole layout
              contract unreachable here: SectionGrid only goes 2-up at @4xl = 896px,
              so a rail editor was locked into ONE narrow column by construction and
              a 51-field master had no choice but to scroll. 1180px matches
              doc/ui/LAYOUT.md §1. The rail beside this costs 228px, so at a
              1366-wide laptop the cap is not even reached (1366 − 228 − 48 padding
              = ~1090px of content); it only bites on wide monitors, where it stops
              fields stretching to absurd widths.

              `@container/editor` is the density container — see the twin comment in
              components/ui/sheet.tsx. */}
          <div ref={contentRef} className="@container/editor mx-auto w-full max-w-[1180px] px-4 py-5 md:px-6">
            {active?.content}
          </div>
        </div>
      </div>

      {/* sticky footer */}
      <div
        className="flex items-center gap-2 border-t border-border bg-surface px-4 py-3 md:px-6"
        // Tabbed after the fields, before the ✕. Note this does NOT change what
        // Enter does: `submitSurface` is handed the nav SCOPE (the content pane),
        // which does not contain this footer, so Enter still saves through the
        // registered "save" shortcut exactly as before.
        data-focus-region="footer"
      >
        {footer.status && <span className="text-xs text-muted-foreground">{footer.status}</span>}
        <div className="flex-1" />
        <Button variant="outline" size="md" onClick={footer.onCancel}>
          Cancel
        </Button>
        {footer.onSaveDraft && (
          <Button
            variant="outline"
            size="md"
            disabled={footer.isPending || !footer.canSave}
            onClick={footer.onSaveDraft}
          >
            {footer.draftLabel ?? "Save as Draft"}
          </Button>
        )}
        <Button size="md" disabled={footer.isPending || !footer.canSave} onClick={footer.onSave}>
          {footer.isPending ? "Saving…" : footer.saveLabel}
        </Button>
      </div>
    </div>
  );
}

/** A titled content block inside the editor's content pane. */
export function SectionBody({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div>
      {/* Title and hint stack on mobile but sit on ONE line in a desktop editor:
          54px of heading chrome (20 title + 2 + 16 hint + 16 margin) became ~32px.
          Worth it because under the section rail this heading is the most
          redundant thing on screen — the rail already names the active section
          two inches to the left — yet dropping it outright would cost the hint,
          which is the only place a section explains itself. */}
      <div className="mb-4 @2xl/editor:mb-3 @2xl/editor:flex @2xl/editor:items-baseline @2xl/editor:gap-2">
        <h2 className="text-[15px] font-bold tracking-tight text-foreground @2xl/editor:shrink-0">{title}</h2>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground @2xl/editor:mt-0 @2xl/editor:truncate">{hint}</p>
      </div>
      {/* Space the section's cards apart. A section often holds more than one
          `DetailSection` — Address + Communication, Currencies + Shipping —
          and two bordered cards as direct siblings meet flush, reading as one
          card with a rule through it (found on applicant/notify/courier after
          their rail conversion, 2026-07-29).
          Costs nothing where a section has a single child: `space-y` sets a top
          margin on every child EXCEPT the first, so one child is untouched. That
          is why this is safe to put here rather than at each call site, and why
          the screens that already wrap their own cards do not double up. */}
      <div className="space-y-4">{children}</div>
    </div>
  );
}
