/**
 * Shared focus helpers. The key-handling ones are driven from ONE place —
 * components/shell/keyboard-nav-provider.tsx — so every surface in the app gets
 * the same contract without per-screen wiring.
 *
 * That now includes Tab (2026-08-04). It was the last key still bound per
 * surface: `Sheet` and `MasterFullScreen` each ran `cycleTab` themselves and
 * nothing else ran it at all, so Tab was ordered on two surfaces, native on the
 * rest, and — because it walked every focusable rather than every field — landed
 * on buttons that ↑↓←→ and Enter both stepped over. Overlays still use the
 * autofocus and focus-return helpers here directly; those are genuinely overlay
 * lifecycle, not field navigation.
 */

/**
 * The slice of a keyboard event the navigation helpers actually read. Both a
 * React SyntheticEvent and a native KeyboardEvent satisfy it, so the same
 * functions serve a JSX `onKeyDown` and the global document listener.
 */
export type NavKeyEvent = {
  key: string;
  defaultPrevented: boolean;
  target: EventTarget | null;
  preventDefault(): void;
  /** Only `arrowOpensPicker` reads this — Alt+↓ is the in-grid way to open a list. */
  altKey?: boolean;
  /** Only `cycleTab` reads this — Shift+Tab walks the cycle backwards. */
  shiftKey?: boolean;
};

/**
 * NOTE the `:not([tabindex="-1"])` on every branch. The trailing
 * `[tabindex]:not([tabindex="-1"])` clause is a *separate* comma-branch, so it
 * only governs generic elements — without the per-branch guard,
 * `input:not([disabled])` still matched `<input tabindex="-1">` and every
 * skipTab / auto-generated field stayed an Enter-advance stop and a focus-trap
 * boundary. Native Tab skipped them; nothing else did.
 */
export const FOCUSABLE_SELECTOR =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus a field and put the caret at the END of its text.
 *
 * The caret position is not cosmetic: `atCaretEdge` gates ←/→ on it, so a field
 * focused with a bare `.focus()` lands the caret at 0 and → then has to walk the
 * whole value one character at a time before it will move to the next field.
 * That is precisely what "→ doesn't go to the next field" looked like — and note
 * it is DIRECTIONAL: ← worked from the same field, because caret 0 already is the
 * previous-edge (client 2026-07-28).
 *
 * Every path that moves focus programmatically must use this. It existed three
 * times over — inline in `arrowNavigate` and `focusFirstField`, and copied into
 * `child-grid.tsx` — and the one place that skipped it (Sheet's Tab trap) is the
 * one every masters editor tabs through.
 */
export function focusField(el: HTMLElement): boolean {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* number/email inputs reject selection ranges */
    }
  }
  /**
   * DID THE CURSOR ACTUALLY ARRIVE? (client 2026-08-19, reported twice: "tab is
   * moving to the first field again instead of the next section".)
   *
   * `.focus()` on an element the browser will not focus — display:none, an
   * unmounted node still held in a stale array, a collapsed accordion row, a
   * `visibility:hidden` cell — silently does NOTHING and leaves
   * `document.activeElement` on `<body>`. The caller then calls
   * `preventDefault()` believing it moved, so the key is spent; the cursor is
   * nowhere; and the provider's own `restoreFocusIfLost()` restarts the cycle at
   * the TOP of the form. That is the "Tab jumped back to the first field"
   * complaint, and it is why the code reads as correct — the DECISION was right
   * and the LANDING failed, which nothing checked.
   *
   * Returning the answer lets a caller decline the key instead of swallowing it,
   * so the contract's next rule gets a turn. `gridKeyNav` already reasons this
   * way for the arrows ("consume the key only once the destination actually took
   * focus"); this makes the same test available to every mover rather than
   * leaving each to remember it.
   *
   * The return value is additive — every existing `focusField(x)` statement
   * ignores it and behaves exactly as before.
   */
  return document.activeElement === el;
}

/**
 * Where the cursor has recently been, most recent first. Fed by the single
 * `focusin` listener in components/shell/keyboard-nav-provider.tsx.
 *
 * A HISTORY rather than one "last element outside an overlay", because "outside
 * an overlay" cannot be expressed as a selector here: `Sheet` wears
 * `role="dialog"` too, so excluding dialogs would blind this to every field on
 * every masters editor. Depth handles it instead — when a portal picker unmounts,
 * its own nodes leave the document and the first entry still `isConnected` is the
 * trigger the operator opened it from.
 */
const FOCUS_HISTORY_MAX = 8;
let focusHistory: HTMLElement[] = [];

export function rememberFocus(el: EventTarget | null): void {
  if (!(el instanceof HTMLElement)) return;
  if (typeof document !== "undefined" && el === document.body) return;
  focusHistory = [el, ...focusHistory.filter((x) => x !== el)].slice(0, FOCUS_HISTORY_MAX);
}

/**
 * FOCUS IS NEVER DROPPED TO `<body>`. Put the cursor back on the field the
 * operator came from if it has been stranded there.
 *
 * A portal picker renders into `<body>` and UNMOUNTS on pick — and removing the
 * focused node silently moves focus to `<body>` in Chrome without even firing
 * `blur`. So choosing a value left no cursor anywhere and the operator had to
 * reach for the mouse to get back to the field they had just filled in (client
 * 2026-07-28). `Sheet` already solved this for itself with `openerRef`; portal
 * pickers had nothing.
 *
 * Restores ONLY from `<body>`, and only to a node still in the document, so it
 * can never steal focus from whatever legitimately took it next.
 */
export function restoreFocusIfLost(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (active && active !== document.body) return false;
  // The most recent entry that is still real: still in the document, still laid
  // out, and not inside a closed `Sheet` (which stays mounted behind `inert`).
  const home = focusHistory.find(
    (el) => el.isConnected && el.offsetParent !== null && !el.closest("[inert]"),
  );
  if (!home) return false;
  focusField(home);
  return true;
}

/** Visible focusable elements inside `root`, in DOM order. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * Focusables ordered by *region* rather than DOM order: data fields first, then
 * the footer's Save/Cancel, then the header's close/actions last.
 *
 * An editor surface renders header → content → footer, so in raw DOM order the
 * header ✕ is `items[0]` — it became the first Tab stop and the wrap target of
 * the focus trap, so Tab hit "close" in the middle of data entry (client
 * 2026-07-24 #5). Surfaces opt in by stamping `data-focus-region` on their
 * wrappers; anything unstamped sorts with the content.
 *
 * NOTE this is no longer what decides where Tab goes — `cycleTab` targets FIELDS
 * and a ✕ is not one (client 2026-08-04, see the note there). Ordering still
 * matters for everything else that walks a surface: the focus-trap fallback for
 * a surface with no fields at all, `focusFirstField`'s last resort, and the
 * region confinement `arrowNavigate` / `enterAdvances` apply.
 */
const REGION_ORDER: Record<string, number> = { content: 0, footer: 1, header: 2 };

/** Which region an element sits in; unmarked surfaces are all "content". */
export function regionOf(el: HTMLElement): string {
  return el.closest<HTMLElement>("[data-focus-region]")?.dataset.focusRegion ?? "content";
}

export function orderedFocusables(root: HTMLElement): HTMLElement[] {
  const items = focusablesIn(root);
  const rank = (el: HTMLElement) => REGION_ORDER[regionOf(el)] ?? 0;
  // Stable sort keeps DOM order within each region.
  return items
    .map((el, i) => ({ el, i, r: rank(el) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.el);
}

/**
 * The focusables `el` may move among: its own region, nothing else. Shared by
 * `arrowNavigate` and `enterAdvances` so the two forward keys cannot disagree
 * about where the fields end — which is exactly where Enter decides to save.
 *
 * Confinement is what stops movement walking out of the fields into Cancel/Save.
 */
function regionItems(root: HTMLElement, el: HTMLElement): HTMLElement[] {
  const region = regionOf(el);
  return orderedFocusables(root).filter((x) => regionOf(x) === region);
}

/**
 * A SURFACE THAT HOLDS MORE THAN ONE PANE OF FIELDS, and what to do when
 * movement runs off the end of the one on screen.
 *
 * `MasterFullScreen` mounts one section at a time, so "the field after the last
 * field of Identity" lives in a pane that does not exist yet. Tab already solves
 * this locally, via `cycleTab`'s `onContentEdge`. Enter cannot: it is handled by
 * the global listener, which has no way to see a callback a component passed to
 * another function. Without this registry, Enter off the last field of section
 * ONE would save a record the operator has not finished — the same premature
 * save this whole contract change exists to remove, just moved to a new place.
 *
 * Keyed by the pane element and looked up by walking UP from the scope, which
 * gives containment for free: a portaled `Sheet` or `DataPicker` panel is not a
 * DOM descendant of the editor pane, so it can never trigger the editor's
 * hand-off. Module-level mutable state is already the pattern here — see
 * `focusHistory` above.
 */
const paneEdges = new WeakMap<HTMLElement, (dir: 1 | -1) => boolean>();

export function registerContentEdge(
  el: HTMLElement | null,
  fn: (dir: 1 | -1) => boolean,
): () => void {
  if (!el) return () => {};
  paneEdges.set(el, fn);
  return () => {
    // Only if still ours: a re-register from a newer mount must not be undone by
    // the previous effect's cleanup.
    if (paneEdges.get(el) === fn) paneEdges.delete(el);
  };
}

function contentEdgeFor(root: HTMLElement): ((dir: 1 | -1) => boolean) | undefined {
  for (let el: HTMLElement | null = root; el; el = el.parentElement) {
    const fn = paneEdges.get(el);
    if (fn) return fn;
    // AN OVERLAY OWNS ITS OWN LAST FIELD. `Sheet` and the picker panels
    // createPortal to <body>, so they are already out of reach of an editor
    // pane's registration — but a dialog rendered in place would otherwise
    // switch the section of the editor BEHIND its own scrim when the operator
    // pressed Enter off its last field. Stop at the overlay instead, and the
    // save ladder takes over as it does on any standalone surface.
    if (el.matches('[role="dialog"], [aria-modal="true"]')) return undefined;
  }
  return undefined;
}

/**
 * `[data-field-trigger]` — a dialog-picker trigger. It is a <button> for
 * accessibility, but to the operator it IS a field, sitting in a row of inputs
 * and styled identically. Without this, Enter fell through to the button's
 * native activation and OPENED the picker, so Enter meant one thing on a text
 * box and "open a dialog" on the picker beside it — roughly every other field on
 * a masters form (client 2026-07-25). Enter now moves to the next field
 * everywhere; ↓, Space and click open the picker.
 */
const FIELD_TRIGGER = "[data-field-trigger]";

/**
 * `[data-focus-optional]` — AN OPT-IN CONTROL, OFF THE DEFAULT TYPING PATH.
 *
 * Tab and Enter step straight over it; ↑ ↓ ← → still land on it, and so does the
 * mouse. It is for the escape-hatch toggle that most records leave alone — the
 * one an operator should reach for deliberately, never trip over.
 *
 * The first was Material ▸ Fabric ▸ **Direct Purchase**, and it earned the marker
 * by being actively destructive from the default path: a tick box is the one
 * field where Enter TOGGLES rather than advancing (see `enterAdvances`), and
 * ticking that box hides the Using field and clears the mixing rows. An operator
 * Entering down the form ticked it by reflex and lost the composition they had
 * just typed. Sitting between Fabric Type and Using, it was on the busiest path
 * in the form.
 *
 * NOT `tabindex="-1"`, which is the obvious reach and the wrong one:
 * `FOCUSABLE_SELECTOR` excludes it from `focusablesIn`, which feeds the arrow
 * contract as well as the Tab cycle, so the control would go mouse-only. These
 * operators are keyboard-only. Same reasoning, same conclusion as the header ✕
 * (see `orderedFocusables`): move it out of the typing path, keep it reachable.
 *
 * Apply it sparingly and only where BOTH hold: the control is genuinely optional
 * on most records, and there is a spatial neighbour an arrow key arrives from. A
 * field nobody can find is worse than a field in the way. And prefer to drop the
 * marker once the operator has opted IN — Fabric's checkbox is marked optional
 * only while unticked, so the control that undoes the mode is on the Tab path
 * exactly when undoing it is the thing you would want to do.
 *
 * IT WORKS INSIDE A CHILD GRID TOO, and that took a second reader. This file owns
 * Tab on a surface, but inside a `data-grid-row` the GRID owns it — `tabAlongRow`
 * (child-grid.tsx) walks its own `ROW_FIELDS` axis and never came through here. So
 * the marker was silently inert on every grid cell, which is where the second one
 * was wanted: Material Attributes ▸ **Blocked**, a per-line switch-off that Tab
 * stopped on between one attribute and the next (client 2026-08-11). `tabAlongRow`
 * now reads this predicate for its DESTINATION only, so the split stays exactly as
 * described above — the arrows' `fieldsIn` is untouched and ← → still reach the box.
 */
const OFF_TAB_PATH = "[data-focus-optional]";

/**
 * True for a control that Tab and Enter must step over. See `OFF_TAB_PATH`.
 *
 * Exported for `child-grid.tsx` alone, and for the same reason `ROW_FIELDS` there
 * is written as "`isFieldLike` expressed as a selector": the grid states the axis
 * in its own terms but must not own a second definition of what is off it.
 */
export function isOffTabPath(el: HTMLElement): boolean {
  return el.matches(OFF_TAB_PATH);
}

/**
 * The two things the save layer needs from lib/shortcuts.ts. `has` is the
 * non-firing probe: Enter-advance must know whether a surface CAN save before
 * deciding whether to claim the key, and asking by calling `fire` would save.
 */
export type SaveHooks = { has(): boolean; fire(): boolean };

/** Where a save would land, resolved but not performed. Null = nowhere. */
type SubmitTarget =
  | { kind: "footer"; primary: HTMLButtonElement }
  | { kind: "shortcut" }
  | { kind: "form"; form: HTMLFormElement; submitter: HTMLButtonElement }
  | null;

/**
 * Resolve WHERE a save would go, without doing it. Split out of `submitSurface`
 * so the resolution order — and the last-button-by-position rule below — exists
 * exactly once, and so `canSubmitSurface` can ask the question without firing
 * anything.
 *
 * The footer rule is lifted from the Ctrl+S handler in components/ui/sheet.tsx:
 * the primary action is the LAST footer button by POSITION (Cancel → Save), not
 * the last *enabled* one. When Save is disabled by a validation error, "last
 * enabled" resolves to Cancel, and Ctrl+S silently discarded the form (client
 * 2026-07-25). A disabled primary still counts as a target: the record is not
 * saveable yet, so the key is consumed and nothing happens.
 */
function submitTargetOf(root: HTMLElement | null, hooks?: SaveHooks): SubmitTarget {
  if (!root) return null;

  // 1. The surface's own footer, when the scope contains it.
  const footer = root.querySelector<HTMLElement>('[data-focus-region="footer"]');
  if (footer) {
    const btns = footer.querySelectorAll<HTMLButtonElement>("button");
    const primary = btns[btns.length - 1];
    if (primary) return { kind: "footer", primary };
  }

  // 2. The registered "save" handler. This is the path for `Sheet` (whose footer
  //    lives OUTSIDE the <form> that usually becomes the scope) and for
  //    `MasterFullScreen` (whose scope is its content pane). Only editors ever
  //    register "save", so a list page cannot save by accident.
  if (hooks?.has()) return { kind: "shortcut" };

  // 3. A plain form with a real submit button. Deliberately requires the button:
  //    `requestSubmit()` on a form that has no submit handler would navigate.
  const form = root instanceof HTMLFormElement ? root : root.closest("form");
  const submitter = form?.querySelector<HTMLButtonElement>(
    'button[type="submit"], input[type="submit"]',
  );
  if (form && submitter) return { kind: "form", form, submitter };

  return null;
}

/**
 * IS THIS A SURFACE ENTER CAN COMMIT? The gate that keeps Enter inert in every
 * list-page filter box and search field — the most-used inputs in the app.
 *
 * Before Enter advanced, "don't swallow a key that cannot save" was enforced at
 * the END, by only calling preventDefault when `submitSurface` returned true.
 * Advancing happens BEFORE any save, so the test has to move to the front:
 * without it, Enter in a search box would start walking the page furniture.
 */
export function canSubmitSurface(root: HTMLElement | null, hooks?: SaveHooks): boolean {
  return submitTargetOf(root, hooks) !== null;
}

/**
 * Save the surface the operator is standing in. Returns true when it found
 * something to do — the caller only swallows the key on true, so Enter on a
 * surface with nowhere to commit still falls through to the browser.
 */
export function submitSurface(root: HTMLElement | null, hooks?: SaveHooks): boolean {
  const target = submitTargetOf(root, hooks);
  if (!target) return false;
  if (target.kind === "footer") {
    if (!target.primary.disabled) target.primary.click();
    return true;
  }
  if (target.kind === "shortcut") return hooks?.fire() ?? false;
  if (!target.submitter.disabled) target.form.requestSubmit(target.submitter);
  return true;
}

/**
 * THE ONE DEFINITION OF "A FIELD" — where Tab may land, and where Enter-advance
 * may land. Buttons and links are deliberately not fields.
 *
 * It began as Enter's own guard, one of the two defences against the oldest trap
 * in this file: an unconfined Enter-advance once walked off the last data field
 * onto the footer's FIRST button — Cancel — and the next Enter discarded the
 * form. Region confinement (`regionItems`) covers surfaces that mark their
 * regions; targeting fields only covers the ones that mark nothing, which is most
 * page forms.
 *
 * TAB NOW SHARES IT, and that is the whole point of exporting it. Tab used to
 * walk `FOCUSABLE_SELECTOR`, which matches any `<button>`, so the three movement
 * keys held two different ideas of what a field is: the arrows and Enter stepped
 * over a child row's Remove ✕ while Tab stopped on it (client 2026-08-01, and
 * again 2026-08-04 on the ~22 screens that hand-roll a grid row rather than using
 * `ChildGrid`). One predicate, one answer, on every surface at once.
 *
 * `components/masters/child-grid.tsx` keeps its own `ROW_FIELDS` selector for the
 * grid axis. It is this list minus `radio`, because ↑/↓ natively move within a
 * radio group and a grid must not steal that. Any other divergence is a bug.
 */
export function isFieldLike(el: HTMLElement): boolean {
  if (el.matches(FIELD_TRIGGER)) return true;
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !/^(button|submit|reset|hidden|image)$/.test(el.type);
}

/**
 * A grid's "+ Add" control — A TAB STOP SINCE 2026-08-19, on the client's
 * instruction, and this REVERSES two written rules on purpose.
 *
 * What they reversed, and why the old rules existed:
 *
 *   "Tab moves between FIELDS and nothing else — not a ✕, not a child row's
 *   Remove, not Save or Cancel." That is still true of every one of those. The
 *   ✕ came off the Tab path because it sat MID-ROW and Tab stopped on it between
 *   two cells; "+ Add" is at the END of the grid, where the operator is already
 *   heading, so the reasoning that removed the ✕ never applied to it.
 *
 *   "Enter on the last row adds a row." It did — instantly, with no confirmation
 *   — and that is what the client asked to change: reaching the last field and
 *   pressing Enter "suddenly creates the next section". Enter now MOVES to this
 *   button and stops; a second Enter, on the button, is what creates the row.
 *
 * So a row now costs two deliberate keys instead of one automatic one. That is
 * the trade the client chose: an operator entering ten sizes presses Enter twice
 * per size, and in exchange nothing is ever created by a keystroke aimed at
 * moving. Do not "optimise" it back to one key without asking.
 *
 * IT IS NOT A FIELD, and this predicate is deliberately separate from
 * `isFieldLike` rather than folded into it. `isFieldLike` answers "can a value be
 * typed here", and it is read by the arrows, by `focusFirstField`, by
 * `ROW_FIELDS` and by the required/duplicate holds — a button joining that set
 * would put ↑↓←→ on it, let a form open onto it, and make it a candidate for a
 * cursor hold. Tab and Enter are the only two keys that should reach it, which is
 * exactly the two places this is called from.
 *
 * Enter ON the button needs no code at all: `enterAdvances` stands down on
 * anything that is not an input/select/trigger, so the browser's native
 * Enter-clicks-a-button fires, `landOnAddedRow` hears the click and puts the
 * cursor in the new row — the same path the mouse already took.
 */
export function isRowAdd(el: HTMLElement): boolean {
  return el.matches("[data-row-add]");
}

/**
 * A row's own "open this" button — Combos ▸ Detail (client 2026-08-19).
 *
 * Declared here for the same reason `isRowAdd` is: `cycleTab` needs it, and a
 * page-level grid outside a focus scope is served by `cycleTab` rather than by
 * `tabAlongRow`. Inside a grid the row axis (`ROW_FIELDS`, child-grid.tsx) also
 * carries the marker, so Tab, Enter and the arrows all agree about it — see the
 * note there for why that has to be one definition rather than a Tab-only list.
 */
export function isRowOpen(el: HTMLElement): boolean {
  return el.matches("[data-row-open]");
}

/**
 * ENTER MOVES TO THE NEXT FIELD, and saves only when there is no next field
 * (client 2026-07-31).
 *
 * It committed the record from anywhere between 2026-07-28 and this change. That
 * turned out to be a footgun in exactly the place it was most used: filling in an
 * address, the operator picks City from the dropdown with Enter, presses Enter
 * again out of habit, and the half-filled record saves. Advance is also what
 * legacy RP-Software did, so it is what the operators' hands already do.
 *
 * The ladder, in order:
 *   1. anything that already consumed the key (an open picker list picking its
 *      highlighted row, a child grid stepping down a row) has called
 *      preventDefault and is left alone;
 *   2. a tick box toggles — see below;
 *   3. a surface that cannot commit at all is not ours: the key is left
 *      completely untouched (`canSubmitSurface`), which is what keeps Enter
 *      inert in every list-page filter box;
 *   4. the next FIELD in the same region, if there is one;
 *   5. the next PANE, if this surface has one — a rail editor's next section,
 *      the same hand-off Tab uses, so Enter off the last field of Identity does
 *      not save a record that has not reached Address yet;
 *   6. otherwise save — refusing while the field is invalid.
 *
 * Textareas and real buttons keep their native Enter (a newline, an activation).
 */
export function enterAdvances(e: NavKeyEvent, root: HTMLElement | null, hooks?: SaveHooks) {
  if (e.key !== "Enter" || e.defaultPrevented) return;
  const t = e.target;
  const isTrigger = t instanceof HTMLElement && t.matches(FIELD_TRIGGER);
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || isTrigger)) return;
  if (t instanceof HTMLInputElement && /^(button|submit|reset)$/.test(t.type)) return;
  // A TICK BOX IS THE ONE FIELD WHERE ENTER DOES NOT MOVE: it ticks. Enter has no
  // native meaning on a checkbox, so "advance" would make it a dead key again —
  // which is what it was before 2026-07-28, when it instead fell through and
  // saved a half-filled form. One key, one job: it toggles, it does not
  // toggle-and-advance. Space still toggles natively, and Tab / ↓ / → still move.
  //
  // WITH ONE EXCEPTION, AND IT IS NOT A SOFTENING OF THE 07-28 RULE: a tick box
  // that is the LAST field of the surface ticks nothing forward, so "toggle and
  // stop" makes Enter-off-the-last-field — the ONLY keyboard route to Save,
  // since Tab never lands on it — unreachable for the whole surface. That is not
  // hypothetical: on Material Attributes ▸ New the trailing blank row's Blocked
  // box IS the last field, and every Enter route on the screen funnelled into a
  // checkbox, so the form was mouse-or-Ctrl+S only (client 2026-08-11). The
  // 07-28 bug was a checkbox committing while fields still followed it — a
  // half-filled form. Here nothing follows, so there is no half left to fill,
  // and the commit still passes through the section hand-off and the
  // aria-invalid gate below rather than short-cutting to submit.
  //
  // SPACE REMAINS THE TOGGLE and is untouched: it is native, and the hold
  // listener lets it through (Space is in neither NAV_KEYS nor HOLD_KEYS), so
  // the last box is still tickable by keyboard. A RADIO follows the same rule
  // rather than being carved out: ↑/↓ in a native group already *select* as they
  // move (see `ownsArrowKeys`), so Enter-to-select is redundant there and a
  // trailing radio is reached already checked — two rules would cost the one
  // sentence this has to be stated in.
  const tickBox =
    t instanceof HTMLInputElement && /^(checkbox|radio)$/.test(t.type) ? t : null;
  const tick = () => {
    e.preventDefault();
    tickBox?.click(); // same path Space and a mouse take, so onChange fires normally
  };

  // NOT OUR KEY unless this surface could actually commit. A list page's filter
  // box has no footer, no registered "save" and no submit button — Enter there
  // must reach the browser untouched, exactly as it did before. This used to be
  // enforced at the end (preventDefault only when the save found a target);
  // advancing happens first, so the test has to happen first too.
  if (!root || !canSubmitSurface(root, hooks)) {
    // Same predicate, `canSubmit: false` — the rule lives in ONE function so the
    // vectors in `check-keyboard-holds.mts` exercise the branch that runs, not a
    // parallel copy of it. The other fields cannot be computed yet (there is no
    // region axis without a root) and the predicate does not read them here.
    if (enterTicks({ tickBox: !!tickBox, canSubmit: false, hasNextField: false, located: true, optIn: false })) {
      tick();
    }
    return;
  }

  // 1. The next field along, confined to this element's region.
  const items = regionItems(root, t);
  const idx = items.indexOf(t);
  // …skipping opt-in controls, same as Tab: a tick box that changes what the rest
  // of the section means must be reached deliberately, never landed on by the
  // operator's typing rhythm. Enter ON one still ticks it (the branch above), so
  // arrowing across and pressing Enter works exactly as it reads.
  const next =
    idx === -1
      ? undefined
      : items.slice(idx + 1).find((el) => isFieldLike(el) && !isOffTabPath(el));
  if (
    enterTicks({
      tickBox: !!tickBox,
      canSubmit: true,
      hasNextField: !!next,
      located: idx !== -1,
      optIn: t instanceof HTMLElement && isOffTabPath(t),
    })
  ) {
    tick();
    return;
  }
  if (next) {
    e.preventDefault();
    // focusField, NOT .focus() — a bare focus leaves the caret at 0 and → then
    // refuses to leave the field until the whole value has been walked. See the
    // note on focusField.
    focusField(next);
    return;
  }

  // 2. Off the end of this pane: hand over to the next one if the surface has
  //    more (a rail editor's next section). Returns false on the last pane.
  //    Gated on the CONTENT region, the same condition `cycleTab` applies — a
  //    field that happens to live in a footer is at the end of the footer, not
  //    at the end of the section's data.
  if (regionOf(t) === "content" && contentEdgeFor(root)?.(1)) {
    e.preventDefault();
    return;
  }

  // 3. Nowhere left to go: commit. Don't commit from a field that is currently
  //    invalid (client 2026-07-24) — keep the operator on it until the message
  //    clears. Note this gate sits HERE and not at the top: ValidatedInput sets
  //    aria-invalid live for every required-but-empty field, so refusing to MOVE
  //    on it would cage the operator in the first blank box of every form. Tab
  //    has always drawn the same line — it moves regardless, and Enter/Ctrl+S are
  //    what validate.
  if (t.getAttribute("aria-invalid") === "true") {
    e.preventDefault();
    return;
  }
  // `|| tickBox` is not belt-and-braces: `submitSurface` returns false when a
  // registered "save" handler declines, and an UNCLAIMED Enter on a checkbox
  // inside a <form> is an implicit browser submit. A tick box's Enter must never
  // reach the browser, whether or not our save found anywhere to land.
  if (submitSurface(root, hooks) || tickBox) e.preventDefault();
}

/** Does Enter TICK this control rather than move on from it?
 *
 *  Split from the DOM so the rule can be exercised without a browser — the same
 *  reason `keyFills` is separated from `keyFillsField`; vectors live in
 *  `scripts/check-keyboard-holds.mts`.
 *
 *  A tick box ticks while there is still a field after it (the 2026-07-28 rule,
 *  unchanged for every box that is not last). It stops ticking, and lets the
 *  save ladder run, only when it is provably the LAST field of the surface —
 *  otherwise Enter-off-the-last-field, the one keyboard route to Save, is
 *  unreachable on the ~39 surfaces whose final control is a trailing
 *  `Default …` / `Inactive` box (client 2026-08-11).
 *
 *  Two answers are deliberately conservative, and both fail towards ticking:
 *  - `located: false` (`idx === -1`, e.g. a `position: fixed` control whose
 *    `offsetParent` is null and which drops out of `focusablesIn`) is NOT
 *    evidence of being last. Never commit on an inconclusive answer.
 *  - `optIn` (`data-focus-optional`) always ticks. Enter cannot have ARRIVED
 *    there by the typing rhythm — the advance step already steps over the
 *    marker — so committing would be a save the operator never asked for, which
 *    is the marker's own footgun with the polarity reversed.
 */
export type TickProbe = {
  tickBox: boolean;
  /** Could this surface commit at all? A list page's filter bar cannot. */
  canSubmit: boolean;
  hasNextField: boolean;
  located: boolean;
  optIn: boolean;
};
export function enterTicks(p: TickProbe): boolean {
  if (!p.tickBox) return false;
  // Nowhere to save TO: toggling is the only thing Enter could mean here, and
  // dropping to native would restore the dead key 07-28 removed.
  if (!p.canSubmit) return true;
  return p.hasNextField || !p.located || p.optIn;
}

/**
 * ↓ ON A FIELD OPENS ITS LIST — the same thing ↓ does on a Combobox, so every
 * "choose a stored value" field answers the same key (client 2026-07-28). This is
 * now the ONLY key that opens a list: Tab was previously overloaded to do it on a
 * second press, and no longer is.
 *
 * Without this, Count (a `<Select>`, so really a Combobox `<input>`) opened on ↓
 * while Category (a picker `<button>`) sat dead beside it in the same row.
 * Marking triggers as fields fixed Enter and fixed grid arrows, but a plain form
 * has no arrow handling at all — arrows there are purely native, and a native
 * button ignores them (client 2026-07-25).
 *
 * ↑ is deliberately NOT an opener: it means "the field above", so a picker is not
 * a one-way door.
 *
 * This fires inside a child grid too. Grids own ↑/↓ for row movement, so the
 * opener was Alt+↓ only — but Tab-Tab had been the way into a grid picker until
 * ↓ replaced it on forms, and grid cells got nothing back: both keys an operator
 * reaches for did nothing, leaving Space and an undiscoverable modifier (client
 * 2026-07-28). `gridKeyNav` now stands down on ↓ over a trigger; ↑ and Enter
 * still move rows from that cell, so no capability was traded away. Alt+↓ still
 * works as an alias. Returns true when it consumed the key.
 */
export function arrowOpensPicker(e: NavKeyEvent): boolean {
  if (e.defaultPrevented) return false;
  if (e.key !== "ArrowDown") return false;
  const t = e.target;
  if (!(t instanceof HTMLElement) || !t.matches(FIELD_TRIGGER)) return false;
  e.preventDefault();
  t.click(); // the trigger's existing onClick opens the dialog
  return true;
}

/**
 * Controls that own ↑/↓ themselves, so the global navigation must not steal
 * them. Everything NOT in this list navigates.
 *
 * `number` is deliberately absent: arrows natively spin a number input, and in
 * an ERP the operator types the figure and moves on — a stray arrow silently
 * editing a quantity is a data bug, not a feature. Navigating is both more
 * consistent and safer. Flip this single predicate if that turns out wrong.
 */
function ownsArrowKeys(t: HTMLElement): boolean {
  // A child grid: ↑/↓ move a ROW, in the same column (child-grid.tsx gridKeyNav).
  if (t.closest("[data-grid-row]")) return true;
  // Caret movement across lines.
  if (t instanceof HTMLTextAreaElement) return true;
  // A native <select> (touch/SSR) changes its VALUE on arrows.
  if (t instanceof HTMLSelectElement) return true;
  // A Combobox browses its own list — but only while that list is actually OPEN.
  // Closed, it is just a field: ↑ must reach `arrowNavigate` and move to the
  // field above, exactly as it does from a picker trigger. (↓ on a closed one
  // still opens the list, because the Combobox consumes that key itself.)
  if (t.getAttribute("role") === "combobox" && t.getAttribute("aria-expanded") === "true") {
    return true;
  }
  // Radios have native group semantics; the rest have segment/step semantics
  // that would be surprising to lose.
  if (
    t instanceof HTMLInputElement &&
    /^(radio|range|date|time|datetime-local|month|week)$/.test(t.type)
  ) {
    return true;
  }
  return false;
}

/**
 * A KEY THAT PUTS A VALUE IN IS NOT A KEY THAT MOVES AWAY.
 *
 * Read by the duplicate / mandatory holds in keyboard-nav-provider.tsx, which
 * refuse MOVEMENT off a field that is not yet acceptable. Refusing a key the
 * focused control uses to CHOOSE a value does not make the rule stricter, it
 * makes it unsatisfiable: the operator can neither fill the field nor leave it,
 * and the only way out is the mouse.
 *
 * That shipped. The first cut exempted ↓-opens-a-list and nothing else, so on a
 * held Item Class the operator could open the list and walk down it but **Enter
 * could not pick anything** (client 2026-08-04).
 *
 * NOT the same predicate as `ownsArrowKeys` above, and the difference is the
 * whole reason this is separate. That one answers "does this control handle ↑/↓
 * itself, so the global spatial walk must stand down?" — and a CHILD GRID ROW
 * answers yes, because ↑/↓ move a row there. Moving a row is still moving.
 * This one answers "does this key produce a VALUE in this field?", which a row
 * jump does not. Keep them apart; a hold that reused `ownsArrowKeys` would let
 * ↑/↓ walk straight out of a held grid cell.
 *
 * Tab appears in no branch, deliberately: leaving an open list without choosing
 * is exactly the departure a hold exists to refuse.
 */
export type FillProbe = {
  /** Uppercase tag name — SELECT / INPUT / TEXTAREA / BUTTON. */
  tag: string;
  role: string | null;
  ariaExpanded: string | null;
  /** Carries `data-field-trigger` — a picker button that is really a field. */
  fieldTrigger: boolean;
};

/** The pure rule. Split from the DOM so it can be exercised without a browser —
 *  see scripts/check-keyboard-holds.mts. */
export function keyFills(p: FillProbe, key: string): boolean {
  const arrowY = key === "ArrowUp" || key === "ArrowDown";
  const listOpen = p.ariaExpanded === "true";
  const hasList = p.fieldTrigger || p.role === "combobox";
  // An OPEN list owns its navigation AND its commit key.
  if (listOpen && (arrowY || key === "Enter")) return true;
  // A CLOSED list opens on ↓ — the only keyboard route to reaching a value.
  if (hasList && key === "ArrowDown") return true;
  // A native <select> has no popup to expand: ↑/↓ change the value in place, so
  // they are its entire keyboard interface. (The touch / SSR / multiple /
  // uncontrolled branch of components/ui/select.tsx.)
  if (p.tag === "SELECT" && arrowY) return true;
  return false;
}

export function probeOf(el: HTMLElement): FillProbe {
  return {
    tag: el.tagName,
    role: el.getAttribute("role"),
    ariaExpanded: el.getAttribute("aria-expanded"),
    fieldTrigger: el.matches(FIELD_TRIGGER),
  };
}

/** `keyFills` for a live element. */
export function keyFillsField(el: HTMLElement, key: string): boolean {
  return keyFills(probeOf(el), key);
}

/**
 * Does this key move the cursor BACKWARD? The half of a hold that is allowed out
 * of a mandatory-but-blank field (client 2026-08-04).
 *
 * THE TWO HOLDS PART COMPANY HERE, and it is what each one guards that decides
 * it. A `data-dup-error` guards a value that is **wrong**: leaving in any
 * direction leaves it wrong, so both directions stay refused. A
 * `data-required-empty` guards a value that is **blank**, and stepping back off
 * it leaves the field exactly as it already was — nothing is lost.
 *
 * What IS lost by refusing it: the field that makes a blank one fillable is
 * routinely BEHIND it. A Category picker's options are scoped by the Item Class
 * above it, so a blank mandatory Category with no way back is a hold the keyboard
 * cannot satisfy — the operator has to reach for the mouse to fix the field that
 * would let them fill this one. A rule that cannot be satisfied is not strict, it
 * is broken; that is the same failure as the first cut of the required hold,
 * where ↓ opened a list and Enter would not pick from it.
 *
 * Forward progress is still gated either way — Tab, Enter, ↓ and → refuse — so an
 * operator who walks back and returns meets the same hold, and Save stays out of
 * reach.
 *
 * SHIFT IS THE WHOLE POINT for Tab: forward and backward are the same `key`, told
 * apart only by the modifier. Anything that classifies on `key` alone gets this
 * one case exactly wrong, which is why `scripts/check-keyboard-holds.mts` probes
 * `Tab` with the modifier both ways rather than trusting the shape of the code.
 *
 * Lives here rather than in the provider because it is a rule, not delivery — the
 * same reason `keyFillsField` above is here. The provider decides WHICH hold is
 * in force by reading the two markers; this decides only what the key means.
 */
export function keyMovesBackward(key: string, shiftKey: boolean): boolean {
  if (key === "Tab") return shiftKey;
  return key === "ArrowUp" || key === "ArrowLeft";
}

/**
 * Is the caret already at the edge of `el`, so a ←/→ may leave the field?
 *
 * ←/→ natively move the CARET, so hijacking them unconditionally would break
 * ordinary typing. The rule is the spreadsheet one: move on only when there is
 * nowhere left to go inside the field.
 *
 * `selectionStart` is only defined for text/search/url/tel/password — it is
 * null (or throws) on number, email, date and time. That is not an edge case
 * here: the app has ~253 `type="number"` and ~150 `type="date"` inputs. For a
 * NUMBER, "caret unreadable" is treated as at-the-edge, because arrowing within
 * a number is worth little and walking fields is what an operator wants. DATE
 * never reaches this function — `ownsArrowKeys` keeps it, since ←/→ there move
 * between day/month/year segments.
 *
 * A PARTIAL selection returns false: let the arrow collapse it first. A FULL one
 * does not — see below.
 */
export function atCaretEdge(el: HTMLElement, dir: "prev" | "next"): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return true; // buttons, pickers, anything with no text to traverse
  }
  // A closed dropdown is not a text box. Its visible text is the SELECTED LABEL,
  // rewritten wholesale when the operator picks or types — there is no in-place
  // edit for ←/→ to protect, so walking a 20-character label to leave the field
  // is pure friction. (An OPEN one never reaches here: `ownsArrowKeys` claims it.)
  if (el.getAttribute("role") === "combobox") return true;
  let start: number | null;
  let end: number | null;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    return true; // number/email — caret not addressable, so treat as the edge
  }
  if (start === null || end === null) return true;
  if (start !== end) {
    // Native Tab leaves the whole value SELECTED. That is not "the operator is
    // part-way through the text", it is "the operator just arrived" — so treat
    // it as the edge and let the first ←/→ move on, rather than spending a press
    // collapsing a selection the operator never made (client 2026-07-28).
    return start === 0 && end === el.value.length;
  }
  return dir === "prev" ? start === 0 : start === el.value.length;
}

/** A focusable plus the geometry the spatial walk needs. */
type FieldBox = {
  el: HTMLElement;
  top: number;
  bottom: number;
  left: number;
  right: number;
  cx: number;
  cy: number;
};

function boxOf(el: HTMLElement): FieldBox | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // rendered but not laid out
  return {
    el,
    top: r.top,
    bottom: r.bottom,
    left: r.left,
    right: r.right,
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
  };
}

/**
 * How many px of vertical span two controls share. Positive means they sit on
 * the same visual row.
 *
 * This is the whole trick behind spatial navigation on a `DetailSection
 * cols={12}` form. Fields in one visual row do NOT share a pixel-exact `top` —
 * a Combobox is `h-8` next to an `h-9` Input, a picker trigger carries a label
 * above it — so grouping rows by `top` equality finds nothing. Overlap is
 * robust to all of that: two controls that look side by side always overlap
 * vertically, and two on different rows never do.
 */
function rowOverlap(a: FieldBox, b: FieldBox): number {
  return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
}

/** Overlap below this is treated as "different row" (sub-pixel layout noise). */
const SAME_ROW_PX = 4;
/** Two rows whose centres are within this are treated as the same row. */
const ROW_SLACK_PX = 8;

/**
 * The field the operator would say is directly above / below / left / right of
 * `el`, found from on-screen geometry rather than DOM order.
 *
 * ↓ must land on the box BELOW, not "the next field" — on a three-column form
 * those are different controls, and sequential order silently made ↓ a synonym
 * for → (client 2026-07-27). Vertical moves pick the nearest row and then the
 * candidate whose horizontal centre is closest, so ↓↓ down a column stays in
 * that column. Horizontal moves stay inside the current row.
 *
 * Returns null when there is nothing in that direction — a ragged last row, the
 * top row, the end of a line — and the caller falls back to sequential order so
 * focus is never stranded.
 */
export function spatialNeighbour(
  el: HTMLElement,
  dir: "up" | "down" | "left" | "right",
  items: HTMLElement[],
): HTMLElement | null {
  const from = boxOf(el);
  if (!from) return null;
  const boxes = items
    .filter((c) => c !== el)
    .map(boxOf)
    .filter((b): b is FieldBox => b !== null);
  if (!boxes.length) return null;

  if (dir === "left" || dir === "right") {
    const forward = dir === "right";
    const row = boxes
      .filter((b) => rowOverlap(from, b) > SAME_ROW_PX)
      .filter((b) => (forward ? b.left >= from.right - SAME_ROW_PX : b.right <= from.left + SAME_ROW_PX));
    if (!row.length) return null;
    // Nearest first: the neighbour, not the far end of the row.
    row.sort((a, b) => (forward ? a.left - b.left : b.right - a.right));
    return row[0].el;
  }

  const down = dir === "down";
  const offRow = boxes
    .filter((b) => rowOverlap(from, b) <= SAME_ROW_PX)
    .filter((b) => (down ? b.cy > from.cy : b.cy < from.cy));
  if (!offRow.length) return null;
  // The nearest row in that direction, then the closest field within it.
  const nearest = Math.min(...offRow.map((b) => Math.abs(b.cy - from.cy)));
  const band = offRow.filter((b) => Math.abs(b.cy - from.cy) <= nearest + ROW_SLACK_PX);
  band.sort((a, b) => Math.abs(a.cx - from.cx) - Math.abs(b.cx - from.cx));
  return band[0].el;
}

/**
 * THE GLOBAL ARROW CONTRACT: ↓/↑ move to the field above / below, ←/→ to the
 * field left / right — everywhere, on every control that does not own arrows
 * itself.
 *
 * The app had no form-level arrow handling at all: arrows worked only where an
 * individual control happened to implement them, so a dropdown responded, a
 * picker did nothing, a text box did nothing, and a number box silently changed
 * its value. That is why "arrow keys don't work here" kept being reported field
 * by field (client 2026-07-25) — there was nothing to fix centrally, so each
 * report produced another patch.
 *
 * Order is SPATIAL — what the operator sees, not DOM order. It was sequential
 * (the order Tab and Enter use) on the theory that "the field visually below"
 * was too ambiguous to compute on a 12-column grid. In practice that made ↓ and
 * → do the same thing on every multi-column form, which is not the model the
 * operators already have from the legacy screens (client 2026-07-27).
 * `spatialNeighbour` resolves the ambiguity by row-OVERLAP, and sequential order
 * remains the fallback whenever geometry finds nothing.
 *
 * Confined to the focused element's region, so ↓ cannot walk out of the fields
 * into Cancel/Save. Returns true when it consumed the key.
 */
export function arrowNavigate(e: NavKeyEvent, root: HTMLElement | null): boolean {
  if (e.defaultPrevented) return false;
  const vertical = e.key === "ArrowDown" || e.key === "ArrowUp";
  const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
  if (!vertical && !horizontal) return false;
  const t = e.target;
  if (!(t instanceof HTMLElement) || ownsArrowKeys(t)) return false;
  if (!root) return false;

  // ←/→ only leave the field once the caret has nowhere left to go, so typing
  // and in-place corrections still work. ↑/↓ have no such conflict.
  const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
  if (horizontal && !atCaretEdge(t, forward ? "next" : "prev")) return false;

  const items = regionItems(root, t);
  const idx = items.indexOf(t);
  if (idx === -1) return false;
  const dir =
    e.key === "ArrowDown"
      ? "down"
      : e.key === "ArrowUp"
        ? "up"
        : e.key === "ArrowRight"
          ? "right"
          : "left";
  const next = spatialNeighbour(t, dir, items) ?? items[forward ? idx + 1 : idx - 1];
  /**
   * OFF THE EDGE OF THE SECTION, THE ARROWS HAND OVER TOO (client 2026-08-19:
   * "I can't move section to section using the arrow key").
   *
   * Tab and Enter have both crossed sections since 2026-07-31, through
   * `registerContentEdge`; the arrows stopped dead at the last field and did
   * NOTHING. That is the one thing this contract says must never happen — "all
   * three movement keys read one definition, because when they disagreed the
   * disagreement was visible inside a single grid row". Here the disagreement
   * was visible across a whole editor: Tab left the section, ↓ did not.
   *
   * Same callback, so the three keys cannot drift: ↓ / → open the NEXT section,
   * ↑ / ← the PREVIOUS one — and `onContentEdge` lands "first" going forward and
   * "last" going back, so ↑ arrives on the previous section's last field rather
   * than its first, which is what makes the movement reversible.
   *
   * Region-gated exactly as Tab is: a footer button or a header ✕ is not a
   * section edge. And ← / → reach here only once the caret is already at the end
   * of the text (the `atCaretEdge` gate above), so this cannot fire while the
   * operator is still moving through a value.
   *
   * The horizontal keys hand over as well, deliberately. On a 12-column track
   * the last field of a section is as often reached by → as by ↓, and a rule
   * that crossed on one but not the other would be the same split one level
   * down.
   */
  if (!next) {
    if (regionOf(t) === "content" && contentEdgeFor(root)?.(forward ? 1 : -1)) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  e.preventDefault();
  focusField(next);
  return true;
}

/**
 * Focus the first "real" field inside `root` — the first text-like input,
 * select, or textarea, skipping buttons (Cancel/Save/close/icon-buttons) so an
 * editor opens with the cursor in its first data field, not on a button.
 * Returns true if something was focused.
 *
 * If there is no text-like field at all, fall back to the first focusable in
 * REGION order (content before footer before header). Without the fallback this
 * returned false and focus stayed wherever it was — outside the dialog — for
 * any overlay whose first control is a checkbox, a picker button, or a
 * confirm/cancel pair. That is the "the dialog opened but the keyboard does
 * nothing" symptom (client 2026-07-25). Region order matters here: the plain
 * DOM-first focusable would be the header's ✕.
 */
export function focusFirstField(root: HTMLElement | null): boolean {
  if (!root) return false;
  const items = focusablesIn(root).filter((el) => !isOffTabPath(el));
  const field =
    items.find(
      (el) =>
        (el instanceof HTMLInputElement &&
          !/^(button|submit|reset|checkbox|radio|hidden)$/.test(el.type)) ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement,
    ) ?? orderedFocusables(root).find((el) => !isOffTabPath(el));
  if (field) {
    focusField(field); // caret at the end — see the note there on ←/→
    return true;
  }
  return false;
}

/**
 * Focus the LAST focusable inside `root` — the mirror of `focusFirstField`, used
 * when an overlay is entered backwards (Shift+Tab into the previous section of a
 * rail editor). Unlike the forward case there is no "skip the buttons" rule to
 * apply: entering backwards, the last control IS where native Shift+Tab would
 * have landed.
 */
export function focusLastField(root: HTMLElement | null): boolean {
  const items = root ? focusablesIn(root) : [];
  const last = items[items.length - 1];
  if (!last) return false;
  focusField(last); // caret at the end — see the note there on ←/→
  return true;
}

/**
 * A ROW ADDED WITH THE MOUSE LANDS THE CURSOR IN IT, exactly as a row added with
 * the keyboard already did (client 2026-08-14: "in each tab end field is not
 * connected with keyboard — if click the last Add style it's moving to the next
 * field").
 *
 * THE TWO ROUTES DISAGREED, and only one of them was written down. Enter on a
 * grid's last row has always called `addRow()` and then landed on the new row's
 * first field (`gridKeyNav`, `focusColIn`). The BUTTON did not: `handleAdd` adds
 * the row, jumps the pager if there is one, and leaves the caret on itself. So
 * the operator clicked "+ Add style", got a row nobody was standing in, and the
 * next Tab did the one thing that looks like a bug from every angle — a "+ Add"
 * is the LAST node of its section, so Tab from it wrapped, hit the content edge,
 * and handed over to the NEXT TAB. The row they had just asked for was skipped.
 *
 * FOUND BY DIFFING FIELDS, NOT BY LOCATING THE GRID, and that is what makes one
 * function cover every grid in the app. The two kinds of add button do not agree
 * on where they live: a hand-rolled grid keeps its "+ Add" INSIDE
 * `data-grid-body` (`enterNestedGrid` requires that), while `ChildGrid` renders
 * its own as a SIBLING of the body, under the card. Pairing button to grid would
 * need a rule per shape; asking "which fields exist now that did not exist
 * before?" needs none, and answers correctly for a nested grid, a paginated one,
 * and the ~22 screens that hand-roll their rows.
 *
 * A DECLINED ADD MOVES NOTHING, for free: `addSize` and the Material Attribute
 * values list refuse to add while the last row is blank, so no field appears and
 * there is nothing to land on. The cursor stays where the operator put it rather
 * than being yanked into the row they were already told they cannot leave.
 *
 * IT DOES NOT BREAK A REQUIRED HOLD, and the reason is that there is no hold to
 * break: a hold refuses KEYS — Tab, the arrows, Enter — while "Escape, the mouse
 * and every other Ctrl/⌘ shortcut stay live" (AGENTS.md). This only ever runs
 * from a trusted click, which was already an exit from a held cell; the blank
 * field keeps its `data-required-empty` and Save keeps refusing.
 *
 * The 30ms is `gridKeyNav`'s, deliberately — the same wait for the same React
 * render, and two timing stories for one landing is one too many.
 */
export function landOnAddedRow(trigger: HTMLElement): void {
  const scope = trigger.closest<HTMLElement>("[data-grid-body]") ?? trigger.parentElement;
  if (!scope) return;
  const fieldsNow = () => focusablesIn(scope).filter(isFieldLike);
  const before = new Set(fieldsNow());
  /**
   * RETRY, AND NEVER STRAND THE CURSOR (client 2026-08-19, screenshot 2387:
   * "after enter … if I press tab no field is active — I used the mouse to point
   * the first field, after that tab worked").
   *
   * One 30ms shot was a race this grid loses. Adding a structure on the Combos
   * overlay re-renders a row that carries its own nested components grid, and in
   * dev that commit can land well past 30ms — so `fresh` came back empty, the
   * function gave up FOREVER, and the row the operator asked for had nobody
   * standing in it.
   *
   * Worse than doing nothing: the add button is frequently replaced in the same
   * commit, and removing the focused node drops focus to `<body>` in Chrome
   * WITHOUT firing blur. So the cursor was nowhere, and the next Tab — starting
   * from nothing — went to the first field of the surface. That is the same
   * "Tab jumps back to the first field" this session has already chased twice,
   * arriving through a third door.
   *
   * So: keep looking for a few frames, and if nothing ever appears, put the
   * cursor back on the trigger when it still exists. A declined add (`addSize`
   * refusing while the last row is blank) legitimately produces no field, and
   * leaving focus on the button is right there too — the refusal stays visible
   * and the operator is still standing on the control they pressed.
   */
  const RETRIES = [30, 60, 120, 240];
  const attempt = (i: number) => {
    const fresh = fieldsNow().filter((el) => !before.has(el));
    if (!fresh.length) {
      if (i + 1 < RETRIES.length) {
        window.setTimeout(() => attempt(i + 1), RETRIES[i + 1] - RETRIES[i]);
        return;
      }
      // Nothing appeared at all. Only rescue a cursor that has actually been
      // lost — if the operator has moved on, leave them alone.
      if (document.activeElement === document.body && trigger.isConnected) {
        focusField(trigger);
      }
      return;
    }
    /**
     * THE FIRST NEW FIELD IN DOM ORDER, which is the top-left of whatever just
     * appeared.
     *
     * "The last new row, then its first field" was tried first and is wrong on
     * exactly the screens this was reported from: a row that carries a NESTED
     * grid brings that grid's rows with it, so the last new row is the nested
     * one. On Prices, "+ Add style price" would have landed in the rate box of a
     * style nobody had chosen yet, one field past the Style picker the operator
     * clicked the button to fill.
     *
     * The cost is one narrow case: a PAGINATED grid that jumps to its last page
     * mounts that whole page at once, so if the page already held rows the caret
     * lands on the first of them rather than on the row just added. It is a real
     * row of the same grid one keystroke away, and it only happens when adding
     * from a page that is not the last — against a nested grid landing on the
     * wrong field every single time.
     */
    focusField(fresh[0]);
  };
  window.setTimeout(() => attempt(0), RETRIES[0]);
}

/**
 * Is this click one that adds a grid row? Two ways to say so, because the app
 * has two kinds of grid:
 *
 * - `data-row-add`, which `ChildGrid` stamps and new hand-rolled grids carry —
 *   18 sites today, correct by construction;
 * - a "+ …" button INSIDE a `data-grid-body`, which is what the older
 *   hand-rolled grids look like. The same compatibility trick `ROW_REMOVE` uses
 *   for its `aria-label^="Remove"` half, and for the same reason: the marker is
 *   the rule, matching the convention is what spares 22 edits.
 *
 * Deliberately NOT every button in a grid body. A row's own "Process" or
 * "[Detail]" button opens a sheet, and a pager's Next mounts a page — both would
 * be adds by any looser test. The "+" prefix is the app-wide convention for the
 * one control that grows a list ("+ Add line", "+ Add size", "+ Add style").
 */
export function isRowAddControl(el: HTMLElement): boolean {
  if (el.matches('[data-row-remove], [aria-label^="Remove" i]')) return false;
  if (el.matches("[data-row-add]")) return true;
  return !!el.closest("[data-grid-body]") && (el.textContent ?? "").trim().startsWith("+");
}

/**
 * IS A GRID ROW STILL BLANK? — the one gate on growing a grid.
 *
 * Read by BOTH doors, which is the whole point: `gridKeyNav`'s Enter rung
 * (child-grid.tsx) and the "+ Add" click that reaches `landOnAddedRow`. The test
 * it replaces asked "is the focused cell a picker that declares itself empty?" —
 * keyed on the CONTROL, so it leaked through every state that was not an empty
 * picker, and a grid ending in a typed <Input> grew a fresh blank row on every
 * Enter (client 2026-08-18).
 *
 * SPLIT FROM THE DOM on purpose, the same way `keyFills` is split from
 * `keyFillsField` and `enterTicks` from `enterAdvances`: the rule takes a list of
 * fields, so `scripts/check-keyboard-holds.mts` can exercise the branch that
 * actually runs rather than a parallel copy of it.
 */
export type RowField = {
  /** The control's current value, trimmed. "" for an empty text box. */
  value: string;
  /** A picker's own answer via `data-field-empty`; undefined when it declares nothing. */
  declaredEmpty?: boolean;
  /** A checkbox or radio, whose "empty" is not the same question as a text box's. */
  tickBox: boolean;
  /** True when the value on screen was put there by the app, not typed by the operator. */
  prefilled: boolean;
};

/**
 * TODO(you): decide what makes a row "still blank".
 *
 * Return true to REFUSE growing the grid, false to allow it. Things worth
 * weighing, each of which changes what an operator feels:
 *
 *  - A row where the ONLY filled cells are defaults the app put there (a UOM
 *    that prefills to PCS, a date that prefills to today) — has the operator
 *    started this row, or not? `prefilled` is there to answer it either way.
 *  - An unticked checkbox is not the same kind of empty as an empty text box:
 *    "off" is a real, deliberate value. `tickBox` marks them.
 *  - A bespoke picker declares nothing (`declaredEmpty === undefined`). Reading
 *    its silence as "filled" is what handed the runaway-blank-row bug back last
 *    time; reading it as "empty" risks caging a grid that cannot grow at all.
 *  - A grid with no fields in the row at all (`fields.length === 0`) — that is
 *    not a blank row, it is a row that has not rendered yet.
 */
export function rowIsBlank(fields: RowField[]): boolean {
  void fields;
  throw new Error("rowIsBlank: not implemented");
}

/**
 * IS THIS SURFACE AN EDITOR? — the gate that decides whether Tab belongs to this
 * contract at all.
 *
 * Tab is claimed only inside a surface that declares itself one: an overlay, a
 * pane that stamped `data-focus-scope`, or anything carrying a footer region. On
 * a list page, a filter bar or the app chrome, Tab stays exactly as native as it
 * has always been — the operator still tabs from the search box to Add to the
 * table to the sidebar.
 *
 * Deliberately NOT `canSubmitSurface`. That predicate answers "could Enter commit
 * here", and its last branch accepts *any* `<form>` with a submit button, which
 * would silently cage the operator inside an incidental search form. It is also
 * fed by the app-wide shortcut registry, so a `"save"` registered by an editor
 * elsewhere on the page would answer true for a scope that has nothing to do with
 * it. A marker on the surface itself cannot be wrong about which surface it is.
 */
export function isEditorScope(root: HTMLElement | null): boolean {
  if (!root) return false;
  if (root.matches('[role="dialog"], [aria-modal="true"], [data-focus-scope]')) return true;
  return !!root.querySelector('[data-focus-region="footer"]');
}

/**
 * TAB MOVES BETWEEN FIELDS, AND ONLY BETWEEN FIELDS (client 2026-08-04).
 *
 * Every stop is an `isFieldLike` control in the focused element's region. A ✕, a
 * child row's Remove, Save, Cancel, "+ Add" — none of them are fields, so none of
 * them are Tab stops, on any surface in the app.
 *
 * That last clause is the fix. Tab used to walk `orderedFocusables`, i.e. every
 * `<button>` that was not `tabindex="-1"`, while the arrows (`ROW_FIELDS` in
 * child-grid.tsx) and Enter (`isFieldLike`) both stepped over buttons. So the
 * three movement keys disagreed about what a field is, and the disagreement was
 * visible on one row of one grid: tabbing along it kept landing on the Remove ✕.
 * It was patched once per component — `tabIndex={-1}` on `ChildGrid`'s three
 * layouts (2026-08-01) — and came straight back on the ~22 screens that hand-roll
 * a grid row instead of using `ChildGrid`. Component-shaped fixes for a
 * contract-shaped bug always leave a remainder; this is the contract-shaped one.
 *
 * The actions that left the Tab path each keep a key: **Enter** off the last
 * field or **Ctrl+S** saves, **Escape** cancels and closes, and the mouse still
 * reaches everything. See the trade-off note in the skill's contract reference —
 * it is a deliberate deviation for a fixed-workstation ERP, not an oversight.
 *
 * TWO FALLBACKS, both load-bearing:
 *
 *  - **A surface with no fields at all** (a confirm dialog: message, Cancel, OK)
 *    would otherwise have no stops, and native Tab would walk straight out of it
 *    into the page behind. Every focusable becomes a stop there, which is the old
 *    behaviour, kept exactly where it is the only sensible one.
 *  - **Standing on a non-field** — the operator clicked ✕ or Save with the mouse,
 *    or arrowed onto an optional control. The walk is over the FULL ordered list
 *    with a stop predicate, never a pre-filtered list, so Tab still knows where
 *    that control sits and carries on into the fields from there rather than
 *    restarting at field one. A button origin aims at the CONTENT region, so Tab
 *    off the footer goes back to the data rather than round the footer forever.
 *
 * Off the end it hands to the next pane if the surface has one (a rail editor's
 * next section, via the same `registerContentEdge` publication Enter uses — ONE
 * lookup, so the two forward keys cannot disagree about where a section ends),
 * and otherwise wraps. It never escapes the surface: on an overlay that is the
 * focus trap, and on a page form it is what makes Tab behave identically to one.
 *
 * Returns true when it consumed the key.
 */
export function cycleTab(
  e: NavKeyEvent,
  root: HTMLElement | null,
  opts?: {
    /**
     * Where to resume when focus was orphaned onto <body> — a portal picker
     * unmounted, a control blurred itself. Without it the cycle restarts at the
     * top of the form instead of at the field the operator last stood on.
     */
    resumeFrom?: HTMLElement | null;
  },
): boolean {
  if (e.key !== "Tab" || e.defaultPrevented || !root) return false;
  const items = orderedFocusables(root);
  if (!items.length) return false;

  const active = document.activeElement;
  const inside = active instanceof HTMLElement && root.contains(active);
  const from = inside ? (active as HTMLElement) : opts?.resumeFrom ?? null;
  const idx = from ? items.indexOf(from) : -1;

  // Which region the stops live in. A non-field origin aims at the content, so a
  // moused-to ✕ or Save leads back to the data rather than nowhere.
  // `isRowAdd` counts as an origin too, or Tab off the "+ Add" button would
  // reset the region to "content" and jump back to the top of the form instead
  // of carrying on to the field after the grid.
  const region =
    from && (isFieldLike(from) || isRowAdd(from) || isRowOpen(from))
      ? regionOf(from)
      : "content";
  const isStop = (el: HTMLElement) =>
    (isFieldLike(el) || isRowAdd(el) || isRowOpen(el)) &&
    !isOffTabPath(el) &&
    regionOf(el) === region;
  // The fallback above: a surface with nothing field-like still has to trap.
  const stops = items.some(isStop) ? isStop : (el: HTMLElement) => !isOffTabPath(el);

  // focusField, not .focus() — it lands the caret at the END of the text. A bare
  // .focus() left it at 0, and `atCaretEdge` then refused to let → leave the
  // field until the operator had walked the whole value one character at a time.
  // Every masters editor tabs through this, so this one call is what "→ doesn't
  // move to the next field" was (client 2026-07-28).
  e.preventDefault();
  if (idx === -1) {
    const ordered = e.shiftKey ? [...items].reverse() : items;
    const first = ordered.find(stops);
    if (first) focusField(first);
    return true;
  }

  const dir: 1 | -1 = e.shiftKey ? -1 : 1;
  const step = (start: number): number | undefined => {
    for (let n = 1; n <= items.length; n++) {
      const at = (start + dir * n + items.length * n) % items.length;
      if (stops(items[at])) return at;
    }
    return undefined; // nothing to move to — leave focus alone
  };
  const nextIdx = step(idx);
  if (nextIdx === undefined) return true;

  // Off the end of this pane. "Wrapped" is read off the stop Tab will ACTUALLY
  // make: a single remaining stop, or a jump backwards while going forwards, both
  // mean there is no next field in this section — which is precisely where a rail
  // editor hands over to the next one.
  const wrapped = dir === 1 ? nextIdx <= idx : nextIdx >= idx;
  if (wrapped && regionOf(items[idx]) === "content" && contentEdgeFor(root)?.(dir)) {
    return true;
  }
  /**
   * IF THE STOP WILL NOT TAKE FOCUS, KEEP LOOKING (client 2026-08-19).
   *
   * `items` is a snapshot; between building it and moving, a node can stop being
   * focusable — React unmounts a collapsed row, a layout swap hides the twin of
   * a responsive grid. Landing on one of those left the cursor on `<body>` while
   * this function returned "handled", and `restoreFocusIfLost()` then resumed at
   * the top of the form. Walk on to the next real stop instead; only give up
   * once nothing in the cycle will take it, and then leave the key alone rather
   * than pretending to have moved.
   */
  let at: number | undefined = nextIdx;
  for (let n = 0; n < items.length && at !== undefined; n++) {
    if (focusField(items[at])) return true;
    at = step(at);
    if (at === nextIdx) break; // all the way round
  }
  return true;
}
