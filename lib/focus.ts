/**
 * Shared focus helpers. The key-handling ones are driven from ONE place —
 * components/shell/keyboard-nav-provider.tsx — so every surface in the app gets
 * the same contract without per-screen wiring. Sheet/MasterFullScreen still use
 * the focus-trap and autofocus helpers directly, because those are overlay
 * concerns rather than field navigation.
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
export function focusField(el: HTMLElement): void {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* number/email inputs reject selection ranges */
    }
  }
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
 * 2026-07-24 #5). Reordering keeps ✕ reachable by keyboard (unlike
 * `tabindex="-1"`, which would strand keyboard-only users) while moving it out
 * of the typing path. Surfaces opt in by stamping `data-focus-region` on their
 * wrappers; anything unstamped sorts with the content.
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
 */
const OFF_TAB_PATH = "[data-focus-optional]";

/** True for a control that Tab and Enter must step over. See `OFF_TAB_PATH`. */
function isOffTabPath(el: HTMLElement): boolean {
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
 * Can Enter-advance LAND here? Buttons and links are deliberately not fields.
 *
 * This is one of the two defences against the oldest trap in this file: an
 * unconfined Enter-advance once walked off the last data field onto the footer's
 * FIRST button — Cancel — and the next Enter discarded the form. Region
 * confinement (`regionItems`) covers surfaces that mark their regions; targeting
 * fields only covers the ones that do not mark anything, which is most page
 * forms. Enter ON a real button is untouched anyway — native activation is right.
 */
function isFieldLike(el: HTMLElement): boolean {
  if (el.matches(FIELD_TRIGGER)) return true;
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !/^(button|submit|reset|hidden|image)$/.test(el.type);
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
  // Radios get the same treatment — Enter selects, ↑/↓ still walk the group.
  if (t instanceof HTMLInputElement && /^(checkbox|radio)$/.test(t.type)) {
    e.preventDefault();
    t.click(); // same path Space and a mouse take, so onChange fires normally
    return;
  }

  // NOT OUR KEY unless this surface could actually commit. A list page's filter
  // box has no footer, no registered "save" and no submit button — Enter there
  // must reach the browser untouched, exactly as it did before. This used to be
  // enforced at the end (preventDefault only when the save found a target);
  // advancing happens first, so the test has to happen first too.
  if (!root || !canSubmitSurface(root, hooks)) return;

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
  if (submitSurface(root, hooks)) e.preventDefault();
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
  if (!next) return false;

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
 * Own the Tab cycle for an overlay surface.
 *
 * Tab is native everywhere else in the app (see keyboard-nav-provider.tsx —
 * `NAV_KEYS` deliberately excludes it). An overlay is the one exception, because
 * native Tab would walk straight out of it into the page behind, which is still
 * mounted underneath.
 *
 * We drive the WHOLE cycle rather than only guarding the two edges: the cycle is
 * region-ordered (fields → footer → ✕) while native Tab is DOM-ordered
 * (✕ → fields → footer), so edge-only trapping compared the wrong elements and
 * let Tab off Save escape the dialog entirely. Owning every Tab keeps the visible
 * order and the trap boundary as one and the same thing.
 *
 * `onContentEdge` is how a surface that holds MORE than one pane of fields — the
 * section rail in components/masters/master-full-screen.tsx — joins in: it fires
 * at the moment Tab would leave the field region, i.e. exactly where "the last
 * field of this section" is, without this file needing to know what a section is.
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
    /**
     * Called when Tab would leave the CONTENT region: forward off the last
     * content focusable, backward off the first. Return true when the callback
     * moved focus itself; false falls through to the normal wrapping cycle
     * (on to the footer, or round to the start).
     */
    onContentEdge?: (dir: 1 | -1) => boolean;
  },
): boolean {
  if (e.key !== "Tab" || e.defaultPrevented || !root) return false;
  const items = orderedFocusables(root);
  if (!items.length) return false;

  const active = document.activeElement;
  const inside = active instanceof HTMLElement && root.contains(active);
  const from = inside ? (active as HTMLElement) : opts?.resumeFrom ?? null;
  const idx = from ? items.indexOf(from) : -1;

  // focusField, not .focus() — it lands the caret at the END of the text. A bare
  // .focus() left it at 0, and `atCaretEdge` then refused to let → leave the
  // field until the operator had walked the whole value one character at a time.
  // Every masters editor tabs through this, so this one call is what "→ doesn't
  // move to the next field" was (client 2026-07-28).
  e.preventDefault();
  if (idx === -1) {
    focusField(e.shiftKey ? items[items.length - 1] : items[0]);
    return true;
  }

  const dir: 1 | -1 = e.shiftKey ? -1 : 1;
  // The next stop, stepping over anything marked off the typing path. Walking
  // the FULL list rather than pre-filtering it is what makes Tab work when the
  // operator arrowed ONTO an optional control: it still knows where that control
  // sits, so Tab carries on from there instead of restarting at field one.
  const step = (start: number): number | undefined => {
    for (let n = 1; n <= items.length; n++) {
      const at = (start + dir * n + items.length * n) % items.length;
      if (!isOffTabPath(items[at])) return at;
    }
    return undefined; // every focusable is optional — leave focus alone
  };
  const nextIdx = step(idx);
  if (nextIdx === undefined) return true;

  if (opts?.onContentEdge && regionOf(items[idx]) === "content") {
    // "Leaving content" is decided by the stop Tab will ACTUALLY make, not by the
    // raw DOM neighbour — an optional control sitting last in the section would
    // otherwise look like a reason to stay and swallow the hand-off to the next
    // pane.
    const leaving = regionOf(items[nextIdx]) !== "content" || nextIdx === idx;
    if (leaving && opts.onContentEdge(dir)) return true;
  }
  focusField(items[nextIdx]);
  return true;
}
