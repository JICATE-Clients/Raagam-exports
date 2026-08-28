"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
 * What `document.body` looked like before the outermost sheet locked it.
 * `null` while nothing is locked. See `lockBodyScroll`.
 */
let bodyLockRestore: { overflow: string; paddingRight: string } | null = null;

/**
 * THE PAGE BEHIND A SHEET MUST NOT JUMP SIDEWAYS WHEN IT OPENS
 * (client 2026-08-28: "in that process screen, the back screen goes to the
 * right").
 *
 * `overflow: hidden` on the body removes the vertical scrollbar, the viewport
 * gains its width — ~15px on Windows Chrome — and everything in normal flow
 * slides right by that much. On close it snaps back. It has been there since the
 * scroll lock was written and it is every dialog in the app, not this one.
 *
 * The fix is to hold the space the scrollbar was occupying: pad the body by
 * exactly the width that vanished.
 *
 * Three things this has to get right, and each is a way to write the fix so that
 * it does nothing or makes matters worse:
 *
 * - **MEASURE BEFORE LOCKING.** After `overflow: hidden` the scrollbar is
 *   already gone, so `window.innerWidth` and `documentElement.clientWidth` are
 *   equal and the gap reads 0. The measurement is the first statement below for
 *   that reason, not for tidiness.
 * - **ONLY THE OUTERMOST SHEET.** `openSheetCount` already ref-counts nesting,
 *   and these two guard on it: a picker opening over an entity editor must not
 *   add a second 15px. Setting `overflow: hidden` twice is harmless, which is
 *   why the old code could get away with doing it per sheet — padding is not,
 *   and a nested sheet would in any case measure a gap of 0 (the scrollbar is
 *   gone by then) and write `paddingRight: 0`, undoing the outer sheet's
 *   compensation. Both failures are avoided by never running for a nested sheet.
 * - **RESTORE WHAT WAS THERE, NOT `""`.** The old code blanked `overflow`
 *   unconditionally, and that is a real bug rather than a style point:
 *   `MasterFullScreen`, `vendor-master-screen` and `search-palette` each lock
 *   the body too, and each already captures-and-restores. A Sheet opened inside
 *   a MasterFullScreen overlay therefore **unlocked the page on close while the
 *   overlay was still open**. Capturing is the same cost and matches the three
 *   call sites that were already doing it.
 *
 * WHAT THIS DOES NOT REACH: anything `position: fixed`. A fixed element is laid
 * out against the viewport, not the body, so body padding cannot hold it — and
 * because the viewport is what got wider, a RIGHT-anchored fixed element moves
 * right by the same ~15px. In this app that is the toast stack
 * (`components/ui/toast.tsx`, `fixed bottom-4 right-4`) and the floating
 * bug-reporter button, which is an external SDK and not ours to lay out. Fixing
 * those needs `scrollbar-gutter: stable` on `html` in `app/globals.css`, which
 * reserves the gutter permanently and makes the whole class of shift impossible
 * — a global change to every page in the app, so it is named here rather than
 * smuggled in beside a dialog fix.
 */
function lockBodyScroll() {
  if (openSheetCount > 0) return; // an outer sheet already owns the lock
  const body = document.body;
  // First statement on purpose — see above.
  const gap = window.innerWidth - document.documentElement.clientWidth;
  bodyLockRestore = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  body.style.overflow = "hidden";
  // `> 0` guards the overlay-scrollbar case (macOS, most touch devices), where
  // nothing is reclaimed and padding would be a 0px no-op at best.
  if (gap > 0) body.style.paddingRight = `${gap}px`;
}

/** Undo `lockBodyScroll`, but only once the LAST sheet has gone. */
function unlockBodyScroll() {
  if (openSheetCount > 0) return; // a still-open outer sheet needs the lock
  const body = document.body;
  body.style.overflow = bodyLockRestore?.overflow ?? "";
  body.style.paddingRight = bodyLockRestore?.paddingRight ?? "";
  bodyLockRestore = null;
}

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
 * WHERE A CONTAINED DIALOG CAME FROM — the point it grows out of and collapses
 * back into. Either a rect measured at the moment of the click, or a ref to the
 * element that is still on screen.
 *
 * PREFER THE RECT. A trigger that lives in a `ChildGrid` cell is re-rendered
 * every keystroke on the row and can be unmounted entirely while the dialog it
 * opened is still up — a ref then resolves to `null` and the dialog silently
 * goes back to scaling from its own centre. `getBoundingClientRect()` taken in
 * the click handler is a value, not a live reference, and cannot go stale in a
 * way that matters: the trigger is behind a scrim and nothing can scroll it.
 */
export type SheetOrigin =
  | DOMRect
  | { left: number; top: number; width: number; height: number }
  | RefObject<HTMLElement | null>;

/** Viewport-space centre of a `SheetOrigin`, or null when it resolves to nothing. */
function originCentre(origin: SheetOrigin | null | undefined): { x: number; y: number } | null {
  if (!origin) return null;
  const rect = "current" in origin ? origin.current?.getBoundingClientRect() : origin;
  if (!rect) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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
  fullBleed = false,
  origin,
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
   *  (nested pickers / small config dialogs); "md" = the SAME contained dialog
   *  at max-w-6xl, for a surface that holds a real grid.
   *
   *  ## WHY "md" EXISTS AND IS NOT "sm WITH A WIDER CLASS"
   *
   *  Style Process was `size="lg"` + `fullBleed` — a true full-screen page over
   *  the amendment behind it — and the client asked for it back inside a
   *  container ("smaller containerized modals to prevent full-screen context
   *  loss", 2026-08-28). `sm` had already been tried for it on 2026-08-12 and
   *  FAILED, and the reason is the number worth writing down here rather than
   *  rediscovering a third time: `max-w-md` is 448px, minus this branch's `px-5`
   *  leaves ~408px of content, and `ChildGrid`'s responsive table only appears
   *  from `@lg` — which is **512px of container, not 1024** (see `tableFrom` in
   *  child-grid.tsx). The grid fell to stacked cards and lost its column
   *  headers. It missed by ~104px, which is exactly why it looked like it should
   *  have worked.
   *
   *  The Style Process grid declares 12+16+12+20rem of columns plus ~80px of
   *  chrome = ~1040px before the table would scroll sideways, which operator
   *  rule 4 forbids. `max-w-6xl` (1152px) − `px-5` = 1112px of content clears
   *  it, and on a 1366px laptop still leaves ~107px of the screen behind it down
   *  each side. THAT is the difference being bought: a box on a scrim rather
   *  than a `fixed inset-0` covering the app chrome.
   *
   *  ## IT REUSES THE CONTAINED BRANCH, DELIBERATELY
   *
   *  The branch below selects on `size !== "lg"`, so "md" is the same DOM as
   *  "sm" with one width class different. A third hand-written branch would be
   *  a third place for `role="dialog"`, `data-focus-region` and the focus trap
   *  to drift apart, and those three are what `isEditorScope`, Tab's wrap and
   *  Escape's one-layer-per-press all read.
   *
   *  Ctrl+S needs no change: its gate is already `size !== "sm"`, so "md" keeps
   *  the save shortcut while nested pickers keep the browser's. */
  size?: "sm" | "md" | "lg";
  /**
   * DROP THE 1180px READING WIDTH and let the content use the whole pane
   * (client 2026-08-18, on Combos ▸ Structure Details: "make this screen full
   * width instead of those left right gap").
   *
   * OPT-IN, because the cap is not an accident. 1180px is LAYOUT.md §1 and the
   * signed-off mockups, and it is what keeps a two-column entity form readable
   * instead of stretching a Name field across 1900px. Every other full-screen
   * Sheet still gets it.
   *
   * What earns the exception here is the SHAPE OF THE CONTENT. Structure Details
   * is a WIDE GRID — six columns per structure (Structure, Composition, Gsm,
   * Tolerance, Gsm Range, Fabric Type) with a components grid nested under each
   * — not prose and not a form column. Capping a grid at a reading width does
   * not make it readable, it just squeezes six pickers and leaves ~220px of
   * white down each side of the screen the operator is trying to fill in.
   *
   * BOTH WRAPPERS MOVE TOGETHER. The footer carries the same `max-w-[1180px]`
   * so that Save/Done line up with the form's right edge; widening one alone
   * would leave the buttons floating short of the content they belong to.
   *
   * The pane's own `px-4 md:px-8` stays either way — full width is not the same
   * as touching the glass, and 32px is what keeps the first field off the edge.
   */
  fullBleed?: boolean;
  /**
   * GROW OUT OF THE THING THAT OPENED THIS — the trigger's rect (or a ref to
   * it), which becomes the panel's `transform-origin`.
   *
   * ## Why it exists (client 2026-08-28)
   *
   * The client saw a navigation pattern where the ACTIVE rail row and the
   * content pane beside it are drawn as ONE CONTINUOUS SHAPE — the selected
   * pill flows into the panel with a concave join, so there is no seam. A
   * shared edge is proof of parentage: the panel cannot be mistaken for
   * something that arrived from elsewhere. They asked whether the Style Process
   * dialog could connect to its trigger the same way.
   *
   * **IT CANNOT, AND THAT IS STRUCTURAL RATHER THAN A MATTER OF EFFORT.** Three
   * reasons, each sufficient on its own:
   *
   * - **It is on another plane.** The dialog is portaled to `<body>` and sits
   *   above a `fixed inset-0` scrim. A join needs the two shapes to share a
   *   coordinate space and a paint order; here one is deliberately floating
   *   over the other, dimmed.
   * - **It covers its own trigger.** The Process button lives in a grid cell in
   *   the middle of the screen, and an `md` dialog is ~1112px wide and centred
   *   — it lands ON the button it grew from. There is no edge left to join to.
   * - **Centred is position-independent.** Every row's dialog opens at the
   *   viewport centre, so the surface says nothing about WHICH row opened it.
   *   That is the whole thing a join communicates, and it is exactly what a
   *   centred box discards.
   *
   * **So the MOTION is the substitute.** The panel cannot share an edge with
   * its trigger, but it can come FROM it: scaling out of that point and
   * collapsing back into it carries the same "this belongs to that row" without
   * needing the two to touch. The rail join itself went where it genuinely fits
   * — `components/masters/master-full-screen.tsx`, which has a real rail and a
   * real pane beside it.
   *
   * ## What it does, and what it deliberately does not
   *
   * OPTIONAL AND BACKWARD-COMPATIBLE. Every existing `sm`/`md` sheet passes
   * nothing and keeps scaling from its own centre exactly as before — this adds
   * one CSS property and no behaviour.
   *
   * CONTAINED BRANCH ONLY (`size !== "lg"`). That is the only variant whose
   * open transition is a SCALE, so it is the only one a `transform-origin` can
   * mean anything to: the full-screen branch translates 12px and the slide-over
   * slides in from an edge, and both of those already say where they came from.
   *
   * NOTHING THE KEYBOARD READS IS TOUCHED. No change to `size`, to the focus
   * trap, to `useModalGuard`, to `role="dialog"` / `aria-modal`, or to any
   * `data-focus-region` — `transform-origin` is paint, and `lib/focus.ts` reads
   * markers and geometry, not transforms.
   *
   * UNDER `prefers-reduced-motion` NO ORIGIN IS SET AT ALL. `app/globals.css`
   * already clamps every transition in the app to 0.01ms for those users, so
   * the panel simply appears; deriving an origin for an animation that does not
   * run would be dead arithmetic on the keystroke path.
   */
  origin?: SheetOrigin | null;
  /*
   * A RAIL JOIN WAS BUILT HERE AND WITHDRAWN ON 2026-08-28. Read this before
   * building a fourth one.
   *
   * The client's reference is a navigation rail whose ACTIVE item and content
   * panel are drawn as ONE continuous shape — a shared edge is proof of
   * parentage, where a title can only assert it. Asked for between this dialog
   * and the tab it opens from, it was attempted three times in one day:
   *
   *  1. ON THE SECTION RAIL (`09384bb`) — the active rail item joined the
   *     content pane. The wrong target: the client meant this dialog, not the
   *     pane. Reverted (`5b2eec3`), along with the pane's `bg-surface`, which
   *     existed only to give that join something to be visible against.
   *  2. ANCHORED TO THE TRIGGER CELL — the panel hung off a ~180px grid cell,
   *     which shoved a ~1150px box to the viewport edge and put Done under the
   *     floating bug-reporter button. Rejected on sight.
   *  3. JOINED TO THE ACTIVE SECTION TAB (`1012920`) — the panel took the pane's
   *     box, the scrim's `left` started at the pane so the rail stayed lit, and a
   *     tab bridged the two. It worked, and it lit the ENTIRE rail rather than
   *     the one joined tab.
   *
   * WHAT (3) WOULD HAVE COST TO FINISH, measured rather than guessed:
   *
   *  - `box-shadow: 0 0 0 100vmax` cannot punch the hole on its own. The scrim
   *    carries `onClick={onClose}` and a box-shadow region is NEVER hit-testable
   *    — hit testing uses the border box. It needs four rect divs around the
   *    hole, each dimmed and each carrying the close handler.
   *  - Raising the tab's z-index instead is not general. `MasterFullScreen`'s
   *    DEFAULT `mount="overlay"` root is `fixed inset-0 z-[80]`, a stacking
   *    context — nothing inside can paint above this scrim. It would work only
   *    for `mount="page"` and silently do nothing everywhere else.
   *  - The rail was left CLICKABLE, and `joinBox` never re-measured on a section
   *    change, so switching section behind the open dialog left the tab pointing
   *    at a stale position.
   *
   * AND (3) WAS NEVER FULLY WORKING WHEN IT WAS JUDGED — found in review after
   * the withdrawal, and the single most useful thing to know before trying
   * again. `openerRef.current` is assigned in a PASSIVE effect; the join
   * measured in a LAYOUT effect. React runs every layout effect before any
   * passive effect in the same commit, so on the commit where `open` flips
   * true the measurement read `openerRef.current` as null on the first ever
   * open, or the opener from the PREVIOUS open on every one after — and with
   * deps `[open, joinRail]` nothing ever re-measured. So the first open drew no
   * join at all, and later opens drew one from a stale opener that happened to
   * resolve to the same pane. Hook PHASE ordering, not declaration order, is
   * what broke it: a layout effect cannot read state a passive effect writes in
   * the same commit. Capture the opener at layout time, or thread it in as a
   * prop rather than sniffing `document.activeElement`.
   *
   * THE CLIENT'S DECISION: leave it centred, no further integration with the
   * side section. That is why this is a comment and not a prop.
   *
   * `09384bb` holds the geometry if it is ever revisited — the 13px overhang
   * (the rail's own `p-3` plus `border-r`), the 23px compensating padding that
   * keeps labels from re-truncating, and the 8px radial-gradient fillets,
   * including why the cut must be `var(--surface-muted)` and never
   * `transparent`, which fringes dark on antialiased pixels.
   *
   * AND THE LESSON THAT OUTLIVES ALL THREE: the geometry was never what failed.
   * Attempt 1 was arithmetically exact and read as nothing, because the two
   * halves it joined were a 2% fill step apart. A join is only a join when both
   * halves share a fill and the ground differs.
   */
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
    // Lock BEFORE the increment and unlock AFTER the decrement, so both run
    // exactly on the 0→1 and 1→0 transitions — the guard inside each reads
    // `openSheetCount`, so the order of these two lines is what makes a nested
    // sheet a no-op rather than a second 15px of padding.
    lockBodyScroll();
    openSheetCount += 1;
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = sheetStack.lastIndexOf(entry);
      if (i !== -1) sheetStack.splice(i, 1);
      openSheetCount = Math.max(0, openSheetCount - 1);
      unlockBodyScroll();
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

  /**
   * THE ORIGIN IS DERIVED WITHOUT MEASURING THE PANEL, and that is what makes
   * it exact on the FIRST painted frame rather than one frame late.
   *
   * The obvious implementation — measure the panel in an effect, then set the
   * origin — cannot work here: `useEffect` runs after the browser has already
   * painted the opening transition's first frame, so the panel starts scaling
   * from its centre and snaps to the real origin a frame later. Reading the
   * panel's box during that frame is also wrong, because it is mid-transform
   * and `getBoundingClientRect()` reports the TRANSFORMED box.
   *
   * Neither problem arises if the panel is never measured. The contained branch
   * centres its panel in the viewport (`flex items-center justify-center` with
   * symmetric padding), so the panel's own centre IS the viewport centre — and
   * `transform-origin` accepts `calc()`, so the point can be expressed as "the
   * panel's centre, shifted by the trigger's offset from the viewport centre".
   * Percentages resolve against the panel; the pixel term needs only the
   * trigger's rect and `window.innerWidth/Height`, both of which are known here
   * during render.
   *
   * IT FOLLOWS THAT THIS IS TIED TO THE CENTRING. If the contained branch ever
   * stops centring its panel, the `50%` term stops naming the panel's layout
   * centre and every origin lands off by the difference. Degrading safely is
   * cheap: an unresolvable origin yields `undefined`, and `undefined` is the
   * behaviour every sheet had before this prop existed.
   *
   * `window` is safe below the `mounted` guard above — this whole component
   * renders null until it has mounted on the client.
   */
  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const centre = reducedMotion ? null : originCentre(origin);
  const transformOrigin = centre
    ? `calc(50% + ${Math.round(centre.x - window.innerWidth / 2)}px) calc(50% + ${Math.round(
        centre.y - window.innerHeight / 2,
      )}px)`
    : undefined;

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
        size !== "lg" ? (
          /* centered dialog box — nested pickers and small config dialogs
             ("sm"), and grid-bearing editors that must not cover the screen
             behind them ("md"). A contained box on the scrim; scrolls
             internally when long. */
          <div
            className="pointer-events-none fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: zIndexBase + 1 }}
          >
            <div
              ref={containerRef}
              role="dialog"
              aria-modal="true"
              /* `undefined` when no origin was supplied (or under reduced
                 motion), which leaves the CSS default `50% 50%` — i.e. exactly
                 what every contained sheet did before this prop existed. See
                 the `origin` prop. */
              style={{ transformOrigin }}
              className={cn(
                "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl transition-all duration-200 ease-out",
                size === "md" ? "max-w-6xl" : "max-w-md",
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
              {/* content — the one scroll.

                  `@container/editor` is the DENSITY container — the compact
                  control sizes in input/select/combobox/label and the tighter
                  gaps in DetailSection all key off `@2xl/editor:`. The full-
                  screen branch has always had it; this branch had none, so a
                  sheet moved here from "lg" would silently un-compact its
                  fields, undoing the client's own 2026-08-20 "fields size look
                  too large, make it compact".

                  ADDING IT IS INERT FOR EVERY EXISTING "sm" SHEET, and that is
                  measured rather than hoped: the `@2xl/editor:` threshold is
                  672px and an `sm` pane is ~408px, so nothing there crosses it.
                  An "md" pane is ~1112px and does — which is the point.

                  THAT INERTNESS DEPENDS ON 672px BEING THE ONLY THRESHOLD IN
                  USE, and at the time of writing it is: every editor-container
                  variant in the repo — 35 of them across 19 files — is the 2xl
                  one. Nothing keys off a smaller container width.

                  THE LOAD-BEARING HALF IS "ONE VARIANT", NOT THE NUMBER. The
                  count was reported as 97, then 61, then 60, then 35 by three
                  readers, and the conclusion was identical at every one of
                  them. Quote it as: one variant in use, 35 occurrences with
                  comments stripped (60 raw).

                  ON THIS REPO, SEARCH WITH `git grep`, NEVER `grep -r`. A
                  recursive grep from the root walks `.claude/worktrees` — a
                  complete gitignored second checkout — which contributed 37 of
                  that 97, i.e. the same code counted twice. Nothing in the
                  normal workflow hints at it: the directory is invisible to
                  `git status` and to `git ls-files`, and `--include` does not
                  help. Only rooting the search in git does, which both
                  `git grep` and `git ls-files` do for free. Comments are the
                  second inflation, and this block is itself an instance —
                  which is why it names no smaller variant literally.

                  **The day someone adds a threshold below ~408px, every "sm"
                  sheet in the app starts matching it** — nested pickers and small config dialogs
                  included — and this paragraph stops being true without
                  anything in this file changing.

                  To re-check, grep the repo for editor-container variants —
                  BUT STRIP COMMENTS FIRST, or exclude this file. This
                  paragraph deliberately does not spell the smaller variants
                  out, because writing them here would put them in the grep's
                  own output and make the check report a problem it created.
                  That is the trap `check:nav-paths` records for the ▸ glyph:
                  most uses of it in this repo are comments describing what
                  something USED to say, so it strips comments before scanning.

                  The stronger form of the same fact, and the reason it is safe
                  today rather than merely unlikely: `Sheet` portals to
                  `<body>`, so these children had no `@container/editor`
                  ancestor AT ALL before this wrapper existed. Their
                  `@2xl/editor:` classes previously matched no container and now
                  match one that is too small. Identical rendering, different
                  reason — which is why the check is a grep and not a screenshot. */}
              <div data-focus-region="content" className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5">
                <div className="@container/editor mx-auto w-full">{children}</div>
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
              {/* `fullBleed` drops the cap — see the prop. `@container/editor`
                  stays either way: it is the DENSITY container, and its
                  `@2xl/editor:` threshold is 672px, so a wider pane is still
                  compact. */}
              <div
                className={cn(
                  "@container/editor mx-auto w-full",
                  fullBleed ? "max-w-none" : "max-w-[1180px]",
                )}
              >
                {children}
              </div>
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
                  {/* Same cap as the content above, and it has to move WITH it —
                      a footer left at 1180px puts Done short of the form's right
                      edge. See the `fullBleed` prop. */}
                  <div
                    ref={footerRef}
                    className={cn(
                      "mx-auto flex w-full items-center justify-end gap-2",
                      fullBleed ? "max-w-none" : "max-w-[1180px]",
                    )}
                  >
                    {footer}
                  </div>
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
