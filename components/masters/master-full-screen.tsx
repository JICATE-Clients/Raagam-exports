"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";
import {
  focusField,
  focusFirstField,
  focusLastField,
  registerContentEdge,
} from "@/lib/focus";
import { useRegisterShortcut } from "@/lib/shortcuts";
import {
  useModalGuard,
  useUnsavedGuard,
  confirmDiscard,
  hasOpenModalInDom,
} from "@/lib/reload-guard";

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
  /**
   * BLOCKING problems in this section — a red count on the rail, replacing the
   * `done` dot, and where `goToSection(key, "problem")` steers.
   *
   * It exists because only ONE section is mounted at a time, which makes a
   * blocked Save unexplainable without it: `customer-master-screen.tsx:1649`
   * and `vendor-master-screen.tsx:2240` both read
   *   canSave: !!form.name.trim() && !gstDupError && !nameDupError
   * where those two errors render in two DIFFERENT sections. An operator on
   * Identity with a colliding GST number on General sees a dead Save button, no
   * error anywhere on screen, and — until `goToSection` below — no way for the
   * screen to take them there even if it knew.
   *
   * A COUNT, not a dot: on a ten-section document a dot says "something is
   * wrong here" and a count says how much is left, which is the difference
   * between one trip to the section and three.
   *
   * Blocking only. Derive it from `blockingBySection` in `lib/screens/validity.ts`
   * so that a red badge and a cursor that will not leave a field always mean the
   * same thing — an advisory that deadened a section would teach the operator to
   * distrust both.
   */
  problems?: number;
  /** Rendered only while this section is active. */
  content: ReactNode;
};

/**
 * Where the cursor lands after a section switch.
 *
 * `"problem"` and `{fieldId}` are consulted only AFTER the target section has
 * mounted — which is the whole reason validity is computed from state rather
 * than read off the DOM. A blank mandatory field on an inactive section has no
 * node, so it carries no `data-required-empty` for a query to find.
 */
type Landing = "first" | "last" | "problem" | { fieldId: string };

export type MasterFullScreenHandle = {
  /**
   * Switch section and place the cursor. The API this surface has never had:
   * `section` is local `useState` with no way in from a parent, so a screen that
   * knew which section held the error still could not go there.
   *
   * `"problem"` targets the first field carrying `data-dup-error`, then
   * `data-required-empty` — duplicate first, the same precedence `holdReason()`
   * in `keyboard-nav-provider.tsx` already applies, because "already exists" is
   * the more useful thing to say. The operator therefore lands on a field that
   * is ALREADY holding, and the existing cursor hold takes over: the reveal and
   * the hold are the same mechanism seen from opposite ends.
   */
  goToSection: (key: string, land?: Landing) => void;
};

/** The rail's section buttons, in order. */
function railButtons(rail: HTMLElement | null): HTMLElement[] {
  return rail ? Array.from(rail.querySelectorAll<HTMLElement>("[data-section-key]")) : [];
}

export function MasterFullScreen({
  ref,
  mount = "overlay",
  dirty = false,
  open,
  onClose,
  modeLabel,
  header,
  sections,
  initialSection,
  footer,
}: {
  ref?: Ref<MasterFullScreenHandle>;
  /**
   * WHERE THIS SURFACE IS MOUNTED. Same rail, same header, same footer, same
   * keyboard — two hosts.
   *
   * `"overlay"` (default) — a `fixed inset-0` takeover above a list. Every
   * existing caller is this, and nothing about it changes.
   *
   * `"page"` — the editor IS the route (`/orders/amendments/[id]`), sitting in
   * normal flow under the app chrome. This is what a DOCUMENT needs: a
   * shareable link, a working browser Back, and a screen that survives a
   * refresh. It is also the only way a rail editor can replace a page-level top
   * tab strip without eating the sidebar.
   *
   * What must NOT differ is the content pane: it carries `data-focus-scope` and
   * `data-focus-region="content"` in both, so `isEditorScope()` is true either
   * way. That marker is precisely the one AGENTS.md records ~51 page-level
   * editors as missing (`--check tab-page-form`), and a page mount here cannot
   * be missing it because it is not conditional on the mount.
   */
  mount?: "overlay" | "page";
  /**
   * Unsaved work. PAGE MOUNT ONLY, and required there.
   *
   * A page mount cannot use `useModalGuard`: that blocks the silent PWA
   * auto-update for as long as the surface is mounted, and on a route that is
   * forever — the same failure AGENTS.md records for an ungated tooltip flag
   * ("permanently blocks the silent auto-update on that route"). An overlay is
   * transient and modal; a page is neither. So a page gates the reload on real
   * dirtiness instead.
   */
  dirty?: boolean;
  /** Always true on a page mount — the route IS the editor. */
  open: boolean;
  onClose: () => void;
  /** Thin top strip, e.g. <>Editing <b>Acme</b></> — pair with the ✕ it renders. */
  modeLabel: ReactNode;
  /**
   * The sticky identity band. OPTIONAL — omit it and the band is not rendered.
   *
   * An overlay needs it: it covers the whole screen, so without it there is
   * nothing on screen naming the record being edited. A PAGE mount usually does
   * not, because the route already carries a `PageHeader` above it, and two
   * title bands stacked is the same record announced twice.
   */
  header?: {
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
    /**
     * "The record is complete." When this is false AND `onBlockedSave` is
     * supplied, Save stays CLICKABLE — see `onBlockedSave`.
     */
    canSave: boolean;
    /**
     * Called instead of `onSave` when `canSave` is false. Supply it and Save
     * stops being disabled and starts being informative: the screen toasts the
     * reason and calls `goToSection(problem.section, "problem")`.
     *
     * KEEPING THE BUTTON ENABLED IS NOT COSMETIC. `submitTargetOf`
     * (`lib/focus.ts`) resolves the surface's primary action to the footer's
     * last NON-disabled button. Disable Save and Enter-off-the-last-field and
     * Ctrl+S both fall through to "Save as Draft" or Cancel — which is the
     * 2026-07-25 bug where Ctrl+S resolved to Cancel. Enabled, all three entry
     * points route here and do the same thing.
     *
     * Omit it and the button behaves exactly as it always has: disabled.
     */
    onBlockedSave?: () => void;
    /** Renders a "Save as Draft" outline button when provided. */
    onSaveDraft?: () => void;
    draftLabel?: string;
    isPending?: boolean;
    /** Between the status text and Cancel — e.g. a "3 to fix" summary that
     *  re-fires the reveal. Chrome, so Tab steps over it and the mouse reaches it. */
    extra?: ReactNode;
  };
}) {
  const firstKey = initialSection ?? sections[0]?.key ?? "";
  const [section, setSection] = useState(firstKey);
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The scrolling pane that carries `data-focus-scope` — i.e. the element a
  // field's navigation scope resolves to. `contentRef` is the inner width-capped
  // div and is a DESCENDANT of it, which is the wrong end for a lookup that walks
  // upwards, so the section hand-off has to be keyed on this one.
  const paneRef = useRef<HTMLDivElement>(null);
  /** Where the cursor lands after a section switch — see `onContentEdge`. */
  const landingRef = useRef<Landing>("first");
  // Latest sections/active key behind a ref, so `onContentEdge` (registered once
  // per open) reads the current ones without re-subscribing on every render (the
  // `sections` array is a fresh literal at every consumer's render).
  const navRef = useRef({ sections, section });
  useEffect(() => {
    navRef.current = { sections, section };
  });

  // Hold off the silent PWA auto-reload while this editor is open. Required
  // explicitly: unlike Sheet, this overlay is a bare fixed-inset div with no
  // role="dialog", so reload-guard's DOM scan cannot see it.
  //
  // OVERLAY ONLY — see the `dirty` prop. A modal guard on a route never lifts,
  // so the page would never receive a deploy.
  useModalGuard(open && mount === "overlay");

  // The page mount's counterpart: gate on real unsaved work, and include
  // `isPending` — a reload landing mid-server-action loses the success toast and
  // leaves the operator unsure whether the save committed (AGENTS.md, STANDING).
  useUnsavedGuard(mount === "page" && (dirty || !!footer.isPending));

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
  const land = useCallback(() => {
    const landing = landingRef.current;
    landingRef.current = "first";
    const pane = contentRef.current;
    let moved = false;

    // A named field wins outright — it is the only landing that can promise the
    // cursor reaches the control the message is about, rather than the first
    // marked one in the section.
    if (typeof landing === "object") {
      const el = pane?.querySelector<HTMLElement>(`#${CSS.escape(landing.fieldId)}`);
      if (el) {
        focusField(el);
        moved = true;
      }
    } else if (landing === "problem") {
      // The two markers the holds already use. Duplicate first, the same
      // precedence `holdReason()` applies for a field that is somehow both.
      const el =
        pane?.querySelector<HTMLElement>("[data-dup-error]") ??
        pane?.querySelector<HTMLElement>("[data-required-empty]");
      if (el) {
        focusField(el);
        moved = true;
      }
    }

    // Both targeted landings fall back rather than stranding the cursor: a
    // problem the screen knows about may not have painted its marker yet.
    if (!moved) {
      moved = landing === "last" ? focusLastField(pane) : focusFirstField(pane);
    }
    // A section with nothing focusable in it (a pure summary pane) would
    // otherwise strand the cursor on the node we just unmounted — i.e. on
    // <body>, where no key reaches the form at all. Fall back to the rail.
    if (!moved) {
      const btn = railButtons(railRef.current).find(
        (el) => el.dataset.sectionKey === navRef.current.section,
      );
      if (btn) focusField(btn);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(land, 60);
    return () => window.clearTimeout(id);
  }, [open, section, land]);

  useImperativeHandle(
    ref,
    () => ({
      goToSection(key, landing = "first") {
        landingRef.current = landing;
        // Already on that section: no state change means no effect, so nothing
        // would move. `setTimeout(0)` rather than a direct call because the
        // caller is usually reacting to values that changed in this same commit
        // — a just-appeared duplicate error has no marker in the DOM until
        // React has painted it.
        if (key === navRef.current.section) {
          window.setTimeout(land, 0);
          return;
        }
        setSection(key);
      },
    }),
    [land],
  );

  /**
   * MOVING PAST THE LAST FIELD OF A SECTION OPENS THE NEXT SECTION — Tab off the
   * last field goes forward, Shift+Tab off the first goes back. Only one section
   * is mounted at a time, so "the next field" lives in a pane that does not exist
   * yet; reaching it used to need the mouse (client 2026-07-30).
   *
   * BOTH forward keys need it, and neither can be handed it directly any more —
   * they are both delivered by the global listener. So it is published ONCE, to
   * lib/focus.ts, by the effect underneath; `cycleTab` and `enterAdvances` each
   * look it up through `registerContentEdge`. One callback, one registry, so the
   * two can never disagree about where a section ends. If they did, Enter off the
   * last field of Identity would save a record that has not reached Address yet,
   * which is the exact premature save Enter-advance exists to remove (client
   * 2026-07-31).
   */
  const onContentEdge = useCallback((dir: 1 | -1) => {
    const { sections: list, section: current } = navRef.current;
    const next = list.findIndex((s) => s.key === current) + dir;
    // Off the end of the last section: decline. Tab wraps to the section's first
    // field as it would on any other surface, and Enter saves.
    if (next < 0 || next >= list.length) return false;
    landingRef.current = dir === 1 ? "first" : "last";
    setSection(list[next].key);
    return true;
  }, []);

  // Publish the hand-off for the global Enter handler. Keyed on the pane
  // carrying `data-focus-scope`, because that is the element a field's scope
  // resolves to and the one lib/focus.ts walks up from.
  useEffect(() => {
    if (!open) return;
    return registerContentEdge(paneRef.current, onContentEdge);
  }, [open, onContentEdge]);

  // TAB IS NOT HANDLED HERE ANY MORE (2026-08-04). A local listener used to run
  // `cycleTab` over this whole overlay — fields, then the footer, then the ✕ —
  // which made Tab stop on buttons that the arrows and Enter both step over, and
  // made this one of only two surfaces in the app where Tab was ordered at all.
  //
  // Both halves moved to components/shell/keyboard-nav-provider.tsx. The content
  // pane below carries `data-focus-scope`, so the provider resolves it as this
  // editor's scope and as an editor surface, and cycles the SECTION's fields
  // inside it. The section hand-off still comes from `onContentEdge` above — but
  // through `registerContentEdge` alone now, which is what both forward keys read,
  // so Tab and Enter can no longer hold separate copies of where a section ends.
  //
  // Nothing else about Tab changed: it never changes a value, it never refuses
  // because a required field is empty (Enter/Ctrl+S are what validate), and it has
  // exactly ONE refusal — a field showing a live "already exists" duplicate holds
  // the cursor until the value is edited (client 2026-07-31). That guard runs on
  // `window` in the capture phase and stops propagation, so the provider never
  // sees the key, which is also what stops a held Tab from switching section out
  // from under the message.

  /**
   * ONE resolution of "save" for all three entry points: the footer button,
   * Ctrl/⌘+S, and Enter off the last field of the last section (which arrives
   * here because `submitTargetOf` picks the footer's last NON-disabled button).
   *
   * They must not be able to disagree, and they used to. With Ctrl+S carrying
   * its own `canSave` guard and the button carrying `disabled`, a blocked save
   * was two separate silences for two separate reasons — and if the button was
   * disabled, Enter and Ctrl+S resolved to whatever button was last instead.
   */
  const blocked = !footer.canSave && !!footer.onBlockedSave;
  const fireSave = () => {
    if (footer.isPending) return;
    if (footer.canSave) footer.onSave();
    else footer.onBlockedSave?.();
  };

  // Ctrl/⌘+S saves the open editor (checklist keyboard shortcut).
  useRegisterShortcut("save", fireSave, open);

  // Latest onClose behind a stable ref, so the listener registered on open
  // doesn't capture a stale closure when the caller re-renders.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Escape closes the editor, asking first when there is unsaved work.
  //
  // OVERLAY ONLY, and the omission on a page mount is deliberate rather than an
  // oversight. The provider's window-bound last layer already does
  // `hasOpenModalInDom()` → `confirmDiscard()` → `router.back()`, which is the
  // correct bottom rung of "Escape unwinds one layer per press, down to leaving
  // the page". A second listener here would ask the discard question twice, and
  // the `preventDefault()` below would stop the page ever being left at all.
  useEffect(() => {
    if (!open || mount !== "overlay") return;
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
  }, [open, mount]);

  // Lock body scroll behind the overlay (same behavior the customer editor had).
  //
  // OVERLAY ONLY. On a page mount the editor IS the document flow, so locking
  // `body.overflow` would freeze the very page it is rendered on.
  useEffect(() => {
    if (!open || mount !== "overlay") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, mount]);

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

  const overlay = mount === "overlay";
  const active = sections.find((s) => s.key === section) ?? sections[0];

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex flex-col bg-background",
        overlay
          ? "fixed inset-0 z-[80]"
          : /**
             * FILLS ITS SCROLLPORT, rather than sizing to its content.
             *
             * `min-h-[70vh]` was the first cut and it left a dead strip of page
             * below the footer: `sticky bottom-0` can only reach the bottom of
             * its own container, so a container that stops short of the
             * scrollport parks the Save button halfway up the screen with
             * nothing under it (client 2026-08-10).
             *
             * `flex-1 min-h-0` works because the app shell gives it a definite
             * height to divide: `app/(app)/layout.tsx` renders
             * `<main className="flex-1 overflow-y-auto">` inside a
             * `<div className="flex h-screen">`. The host screen's root must be
             * `flex h-full flex-col` for this to resolve — that is the one thing
             * a page mount asks of its caller.
             *
             * `min-h-0` is not optional: a flex item's default `min-height:auto`
             * refuses to shrink below its content, so without it a long record
             * pushes the footer back off the bottom and the gap returns.
             */
            "min-h-0 flex-1 overflow-hidden rounded-lg border border-border",
      )}
    >
      {/* topbar — OVERLAY ONLY. A route already has browser Back, a breadcrumb
          and the app chrome above it, so a second ✕ is chrome for nothing; the
          page's own header owns "← Back to list". */}
      {overlay && (
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
      )}

      {/* record header (sticky identity band) — omitted entirely when the host
          route already names the record. See the `header` prop. */}
      {header && (
        <div className="grid gap-3 border-b border-border bg-surface px-4 py-3 md:grid-cols-[1fr_auto] md:items-center md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {header.avatar ?? (
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-base font-bold text-primary">
                {header.initials ?? "—"}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Truncated className="text-[15px] font-bold tracking-tight text-foreground">
                  {header.title}
                </Truncated>
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
      )}

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
                {/* truncate-reveal: exempt -- rail chrome, not a value. The
                    vocabulary is fixed and short, and clicking the step shows
                    the section whose heading names it again in full. */}
                <span className="flex-1 truncate whitespace-nowrap">{s.label}</span>
                {/* The count REPLACES the done dot rather than sitting beside
                    it: a section with blocking problems is not "done", and two
                    indicators on a 228px rail item is where the label starts
                    truncating.

                    `bg-danger-soft text-danger` is the app's existing danger
                    badge idiom (status-pill.tsx), and it is the theme-safe one —
                    there is no `--danger-foreground` token, so a filled
                    `bg-danger` would need hardcoded white text and `--danger`
                    inverts to a LIGHT red in dark mode.

                    The aria-label rides inside the button, so the rail item's
                    accessible name becomes "Identity 2 problems" — the count is
                    announced with the section rather than as loose chrome. */}
                {s.problems ? (
                  <span
                    className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-danger-soft px-1 text-[10px] font-bold leading-none text-danger"
                    aria-label={`${s.problems} problem${s.problems === 1 ? "" : "s"}`}
                  >
                    {s.problems}
                  </span>
                ) : (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full border",
                      s.done ? "border-accent bg-accent" : "border-border bg-transparent",
                    )}
                    aria-label={s.done ? "has data" : "empty"}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div
          ref={paneRef}
          // IDENTICAL ACROSS BOTH MOUNTS, including the scroller. The pane owns
          // its own scrollbar either way, which is what pins the footer to the
          // bottom of the surface instead of to the end of the content.
          //
          // `data-focus-scope` is what makes `isEditorScope()` true and what
          // `registerContentEdge` keys the section hand-off on, so those two
          // attributes especially must never become conditional on the mount.
          className="min-h-0 flex-1 overflow-y-auto"
          // Field navigation comes from keyboard-nav-provider.tsx; this pane is
          // the navigation boundary because it carries data-focus-scope.
          data-focus-scope
          // ...and the FIELD region of the Tab cycle. Its edges are where "the
          // last field of this section" is, which is what BOTH forward keys turn
          // into a section switch — Tab through the listener above, Enter through
          // the hand-off this pane is registered under.
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

      {/* sticky footer. On a page mount it sticks to the bottom of the viewport
          while the document scrolls behind it, with the safe-area inset Sheet
          already worked out — a short record must not leave the buttons
          orphaned halfway up (client 2026-08-04). */}
      <div
        className={cn(
          "flex items-center gap-2 border-t border-border bg-surface px-4 py-3 md:px-6",
          /**
           * NO SPECIAL RIGHT GUTTER, and that is a consequence of the root above
           * filling its scrollport rather than a separate decision.
           *
           * `app/globals.css` (its `@media (min-width: 768px)` block) already
           * lifts the Bug Reporter's floating trigger to `bottom: 4.5rem`
           * because "every full-screen master editor and every Sheet drawer's
           * sticky footer places its primary Save button in the same
           * bottom-right corner as the SDK's desktop default".
           *
           * That lift assumes the footer sits at the VIEWPORT bottom. While the
           * page mount was `min-h-[70vh]` its footer sat higher, the lifted
           * trigger landed on top of Save, and this carried a ~96px gutter to
           * dodge it. Now that both mounts end at the same place, the gutter was
           * papering over the geometry rather than the geometry being right —
           * one rule in globals.css covers both surfaces again.
           */
          !overlay && "sticky bottom-0 z-10 pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        )}
        // Tabbed after the fields, before the ✕. Note this does NOT change what
        // Enter does: `submitSurface` is handed the nav SCOPE (the content pane),
        // which does not contain this footer, so Enter still saves through the
        // registered "save" shortcut exactly as before.
        data-focus-region="footer"
      >
        {footer.status && <span className="text-xs text-muted-foreground">{footer.status}</span>}
        <div className="flex-1" />
        {footer.extra}
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
        {/* Dimmed but ENABLED while blocked, and deliberately NOT `aria-disabled`
            — it does something when clicked (reveals the first problem), and
            telling a screen reader it is unavailable would be a lie about a
            control that acts. The reason is announced by the screen's toast in
            `onBlockedSave`.

            Staying undisabled is also load-bearing for the keyboard:
            `submitTargetOf` takes the footer's last non-disabled button, so a
            disabled Save silently hands Enter and Ctrl+S to "Save as Draft". */}
        <Button
          size="md"
          disabled={footer.isPending || (!footer.canSave && !blocked)}
          data-blocked={blocked || undefined}
          className={cn(blocked && "opacity-60")}
          onClick={fireSave}
        >
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
        {/* truncate-reveal: exempt -- truncates ONLY at @2xl, where the hint
            shares a line with the title; below that it wraps and reads in full.
            Routing it through <Truncated> would truncate it at every size and
            hide text that is visible today. */}
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
