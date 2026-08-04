"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  arrowOpensPicker,
  arrowNavigate,
  atCaretEdge,
  cycleTab,
  enterAdvances,
  isEditorScope,
  keyFillsField,
  keyMovesBackward,
  rememberFocus,
  restoreFocusIfLost,
} from "@/lib/focus";
import { useShortcuts } from "@/lib/shortcuts";
import { confirmDiscard, hasOpenModalInDom } from "@/lib/reload-guard";

/**
 * The ONE place field navigation is wired up.
 *
 * The contract itself lives in lib/focus.ts; this just delivers it everywhere.
 * It used to be bound per surface, which meant a screen only had working keys
 * if someone had remembered to wire it — and an inventory found ~195 editable
 * surfaces against 5 bindings. Every "arrow keys don't work here" report was a
 * surface nobody had reached yet, and every NEW screen started broken (client
 * 2026-07-25). One document listener fixes the whole app and makes future
 * screens correct by default.
 *
 *   Tab      → next FIELD. It does not open lists, and it changes nothing.
 *   ↓        → open this field's list; with no list, the field below
 *   ↑        → the field above
 *   ←/→      → field left / right, once the caret is at the edge
 *   Enter    → pick the highlighted row, else the NEXT FIELD; off the last one,
 *              save the record
 *   Esc      → close the list, then the surface, then leave the page
 *
 * Controls that own a key (an open dropdown, a child grid, a textarea, a native
 * select) consume it first and this stands down — see the bail-out below.
 *
 * TAB IS DELIVERED HERE TOO, since 2026-08-04, and it is its own branch rather
 * than a NAV_KEYS member because it reads `shiftKey` and gates on the surface.
 * It used to live in `Sheet` and `MasterFullScreen` alone, walking every
 * focusable, so it stopped on buttons the arrows and Enter both step over —
 * a child row's Remove ✕ most visibly — and did nothing at all on the surfaces
 * neither component backs. Two implementations of one rule is the drift this
 * provider exists to prevent; there is now one, in `cycleTab`.
 *
 * The duplicate hold below is a SEPARATE listener, on a different node and
 * phase, and it is what makes Tab's one refusal work.
 *
 * THE ONE REFUSAL. Every movement key above has exactly one case where it will
 * not move: a field showing a live "already exists" duplicate holds the cursor
 * until the value is edited (client 2026-07-31). It is implemented once, here,
 * and nowhere else — see the hold effect below.
 */

/**
 * What counts as "the form you are in" — the boundary navigation may not cross.
 * `form` covers the overwhelming majority of surfaces, `[role="dialog"]` covers
 * overlays, and `main` is the fallback for fields rendered straight onto a page.
 * `[data-focus-scope]` lets a surface declare its own boundary, and
 * `[data-focus-scope="off"]` opts out of global navigation entirely.
 */
const SCOPE_SELECTOR = '[data-focus-scope], [role="dialog"], form, main';

/** The keys this provider claims. Everything else is left to the browser. */
const NAV_KEYS = new Set(["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]);

/**
 * The keys the duplicate hold refuses. Tab IS here — unlike NAV_KEYS — because
 * the hold is about not leaving the field, and Tab is the main way to leave it.
 */
const HOLD_KEYS = new Set(["Tab", "Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]);


function scopeOf(el: HTMLElement): HTMLElement | null {
  const scope = el.closest<HTMLElement>(SCOPE_SELECTOR);
  if (!scope || scope.dataset.focusScope === "off") return null;
  return scope;
}

export function KeyboardNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // Enter's LAST step saves, through the same registry Ctrl+S uses. Held in a ref
  // because the context value is a fresh object each render and the listeners
  // bind once.
  const shortcuts = useShortcuts();
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  });

  /**
   * THE HOLDS — the two places in the app where a movement key deliberately
   * fails to move. One listener serves both, because a second listener is a
   * second set of stand-downs to keep in step and they would not stay in step.
   *
   *   data-dup-error      a live "already exists" duplicate (client 2026-07-31)
   *   data-required-empty a MANDATORY field left blank    (client 2026-08-04)
   *
   * While either marker is on the focused field, FORWARD movement — Tab, Enter,
   * ↓ and → — is refused and the cursor stays on it. Editing the value clears the
   * marker in the same render as the keystroke (for duplicates see the `askKey`
   * rule in lib/masters/use-duplicate-check.ts; requiredness is known
   * synchronously), so movement resumes immediately.
   *
   * THE TWO HOLDS PART COMPANY ON BACKWARD MOVEMENT (client 2026-08-04).
   * Shift+Tab, ↑ and ← still refuse out of a DUPLICATE — that value is wrong, and
   * leaving in any direction leaves it wrong — but they are allowed out of a
   * REQUIRED hold, because a blank field is not made worse by stepping back off
   * it, and the field that makes it fillable is often the one behind it. The
   * reasoning is at the `backward` test in `onHold`.
   *
   * THE REQUIRED HOLD REVERSES WHAT THIS FILE USED TO SAY, so do not "fix" it
   * back. Until 2026-08-04 the rule was one refusal only, on the reasoning that
   * `aria-invalid` is live for every required-but-empty field and holding on it
   * would cage the operator in the first blank box of every form. That reasoning
   * is still exactly right and is why this keys off `data-required-empty` — an
   * explicit marker a field only carries when a screen has DECLARED the field
   * mandatory — and never off `aria-invalid`, which is also live for a value
   * that is merely half-typed.
   *
   * A HOLD REFUSES MOVEMENT AND NEVER REFUSES CHOOSING. Without that the rule
   * is not strict, it is unsatisfiable — the operator can neither fill the field
   * nor leave it. Three things stay live:
   *
   *   Every key that produces a VALUE — ↓ to open a list, ↑/↓ to move its
   *     highlight, Enter to pick, ↑/↓ on a native <select>. See `keyFillsField`;
   *     the first cut of this rule exempted only ↓-opens-a-list and the operator
   *     could open Item Class, walk down it, and not pick anything (client
   *     2026-08-04). Tab is in none of those branches: leaving an open list
   *     without choosing is exactly the departure being refused.
   *   Ctrl+Del removes a child-grid row. A blank mandatory cell in a row the
   *     operator should not have added is otherwise a trap with no keyboard
   *     exit: they can neither fill it, leave it, nor delete it. Every Ctrl/⌘
   *     chord bails out at the top of `onHold`, which is what delivers this.
   *   Escape and the mouse, always.
   *
   * WINDOW, CAPTURE PHASE, AND IT STOPS PROPAGATION. `preventDefault` alone is
   * not enough: `gridKeyNav` (components/masters/child-grid.tsx) and the Tab
   * branch of `pickerKeyDown` (components/masters/picker-keys.ts — which is
   * exactly the DataPicker Add form where the duplicate hint lives) never read
   * `defaultPrevented` and would move focus anyway. `window` capture is the
   * FIRST node on the propagation path, not a registration-order race, so
   * stopping there means React never dispatches and no `document` listener
   * runs. Note the symmetry with the Escape ladder at the bottom of this file:
   * window-capture runs first, window-bubble runs last, and `document` is where
   * everything that negotiates with everything else lives.
   *
   * `stopPropagation`, NOT `stopImmediatePropagation` — components/pwa/
   * silent-updater.tsx is another window-capture listener and has no reason to
   * be blinded.
   *
   * AND IT CATCHES UP. The paragraph above is a KEYDOWN-time test — it reads the
   * attribute off the focused field at the instant the key is pressed. A check
   * that answers 300ms later (every server-only `useDuplicateCheck`) is not back
   * yet, so the operator who types and tabs straight away is already gone when
   * the message paints, and the whole rule looks broken from the floor: "the
   * error is showing and the cursor moved anyway" (client 2026-08-01). So a late
   * answer FETCHES THE CURSOR BACK — see the catch-up below. The synchronous
   * half of `useDuplicateName` is still the real fix; this is what makes the
   * rule true even when only the server can know.
   *
   * Scoped as narrowly as it can be, and every narrowing below applies to BOTH
   * markers for the same reason:
   *   - keys off the two explicit markers, NEVER `aria-invalid` (see above).
   *   - never holds a field they cannot type into (readOnly/disabled). The
   *     Material Name is readOnly for attribute-driven classes; holding there
   *     is a cage with no keyboard way out at all — and it is composed from the
   *     very fields the required hold makes them fill, so it fills itself.
   *   - ←/→ still move the CARET; only the edge press is refused.
   *   - Escape, the mouse and every Ctrl/⌘ shortcut stay live. Those are the
   *     three ways out, and the message under the field names the first.
   */
  const liveRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    /** The reason this field is holding, ready to announce, or null. Duplicate
     *  first: if a field is somehow both, "already exists" is the more specific
     *  thing to say and the one the operator can act on. */
    function holdReason(el: HTMLElement): string | null {
      const dup = el.getAttribute("data-dup-error");
      if (dup) return `${dup} Edit the value, or press Escape to cancel.`;
      const req = el.getAttribute("data-required-empty");
      if (req) return `${req} Fill it in, or press Escape to cancel.`;
      return null;
    }

    function heldField(): HTMLElement | null {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return null;
      if (!holdReason(el)) return null;
      // A field with nothing to edit cannot clear its own error.
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        (el.readOnly || el.disabled)
      ) {
        return null;
      }
      return el;
    }

    /**
     * A REFUSED KEY MUST NOT BE A DEAD KEY — that is the exact bug class this
     * app has shipped before. Three cheap channels: a 160ms nudge on the field,
     * an assertive announcement, and the message already sitting under it.
     *
     * Deliberately NOT a toast: held Tab presses arrive in bursts and would
     * fill the corner with identical errors.
     */
    function refuse(el: HTMLElement, message: string) {
      // Re-set with a forced reflow between, or a second refusal restarts
      // nothing and the nudge only ever plays once.
      delete el.dataset.dupHeld;
      void el.offsetWidth;
      el.dataset.dupHeld = "";
      // Clear it again when the animation finishes, so the attribute does not
      // outlive the nudge on a node React knows nothing about. Safe under
      // reduced motion: globals.css clamps to 0.01ms rather than 0s precisely
      // so this event still fires.
      el.addEventListener("animationend", () => delete el.dataset.dupHeld, { once: true });

      const live = liveRef.current;
      if (!live) return;
      // Blank first: an identical string written twice is not re-announced.
      live.textContent = "";
      live.textContent = message;
    }

    /**
     * THE CATCH-UP — the hold, for an answer that arrived too late.
     *
     * `leftField` is where the cursor was standing when a movement key took it
     * away, and `leftAt` is when. If that field grows a `data-dup-error` within
     * the window, the cursor goes back to it: the check was simply still in
     * flight when the key was pressed, and the operator must not be allowed to
     * walk away from a colliding name just because the network was slow.
     *
     * Recording EVERY departure, not just from duplicate-checked fields, is
     * free — the observer only ever fires for an element that later grows the
     * attribute, and knowing in advance which fields are checked would mean
     * teaching this listener about the masters layer.
     *
     * DUPLICATES ONLY, deliberately — `data-required-empty` is not watched and
     * must not be. The catch-up exists because a server round trip answers after
     * the operator has already gone; requiredness is known synchronously, so the
     * hold below always fires on the keystroke itself and there is nothing
     * arriving late to point at. Watching it would only mean a field that became
     * blank for some other reason could yank the cursor back out of wherever the
     * operator is now typing.
     *
     * `forget()` is the whole safety story, and every caller of it below is a
     * case where pulling the cursor back would be WORSE than missing:
     *   - a non-movement key: the operator is already TYPING in the field they
     *     moved to, and stealing focus mid-word misdirects those keystrokes.
     *   - `pointerdown`: leaving by mouse is a deliberate exit, and the mouse is
     *     one of the three ways out this rule promises.
     *   - focus landed in another surface, or the field is gone / read-only /
     *     inert / not rendered — the same stand-downs `heldField` makes.
     * Past the window the operator has moved on and a jump would read as the
     * page misbehaving rather than as an error being pointed at.
     */
    const CATCH_UP_MS = 2000; // the 300ms debounce plus a slow round trip
    let leftField: HTMLElement | null = null;
    let leftAt = 0;
    function forget() {
      leftField = null;
    }

    function catchUp(el: HTMLElement) {
      const message = el.getAttribute("data-dup-error");
      if (!message) return; // the error CLEARED — nothing to point at
      if (Date.now() - leftAt > CATCH_UP_MS || !el.isConnected) return forget();
      const active = document.activeElement;
      if (active === el) return forget(); // never actually left, or already back
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        (el.readOnly || el.disabled)
      ) {
        return forget();
      }
      // A field in a closed Sheet or an unmounted section is not somewhere the
      // cursor may be put. `offsetParent` is the same cheap test `focusablesIn`
      // (lib/focus.ts) uses; `inert` covers the closed-but-rendered Sheet.
      if (!el.offsetParent || el.closest("[inert]")) return forget();
      // Focus is in a different surface — another dialog, a picker portal, the
      // sidebar. Yanking ACROSS surfaces is worse than the miss: the operator
      // is somewhere they chose to be. `body` is not a surface, it is stranded
      // focus, and that is exactly a case worth rescuing.
      const strayed = active instanceof HTMLElement && active !== document.body;
      if (strayed && scopeOf(active) !== scopeOf(el)) return forget();

      forget(); // one shot — a second answer must not yank a second time
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        // Caret at the end, nothing selected. Selecting the value would arm the
        // operator's own typing to wipe it, and this is a correction prompt.
        try {
          el.setSelectionRange(el.value.length, el.value.length);
        } catch {
          /* number/email inputs don't support selection ranges */
        }
      }
      refuse(el, message);
    }

    const watcher = new MutationObserver((records) => {
      if (!leftField) return;
      for (const r of records) {
        if (r.target === leftField) {
          catchUp(leftField);
          return;
        }
      }
    });
    watcher.observe(document.body, { subtree: true, attributeFilter: ["data-dup-error"] });

    function onHold(e: KeyboardEvent) {
      if (e.isComposing) return; // an IME candidate-commit Enter is not movement
      // Anything that is not a plain movement key — typing, Backspace, Home/End,
      // Esc, F2, Ins, Ctrl+S, Ctrl+F, Alt+↓ — means the operator is doing
      // something else now, so the catch-up stands down (see `forget` above).
      if (!HOLD_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
        forget();
        return;
      }
      const el = heldField();
      if (!el) {
        // No error on this field YET — but one may be in flight for it. Note
        // where the cursor is leaving from, before the browser moves it.
        const active = document.activeElement;
        leftField = active instanceof HTMLElement ? active : null;
        leftAt = Date.now();
        return;
      }
      // Standing on a held field, no departure to remember.
      forget();

      // ←/→ are the only keys that do two jobs. Refusing them outright would
      // make the field un-editable, which defeats the whole point — so use the
      // same edge predicate `arrowNavigate` does, and the hold and the movement
      // rule can never disagree about where the edge is.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!atCaretEdge(el, e.key === "ArrowRight" ? "next" : "prev")) return;
      }
      // A key that PUTS A VALUE IN is not a key that moves away — see
      // `keyFillsField`. Refusing those is what made the first cut of the
      // required hold unusable.
      if (keyFillsField(el, e.key)) return;

      // BACKWARD IS ALLOWED OUT OF A REQUIRED HOLD, AND ONLY A REQUIRED ONE
      // (client 2026-08-04). The rule and its reasoning live in
      // `keyMovesBackward` (lib/focus.ts); what belongs HERE is only the reading
      // of the markers that says which hold is in force.
      if (keyMovesBackward(e.key, e.shiftKey) && !el.getAttribute("data-dup-error")) return;

      e.preventDefault();
      e.stopPropagation();
      refuse(el, holdReason(el) ?? "");
    }

    window.addEventListener("keydown", onHold, true);
    window.addEventListener("pointerdown", forget, true);
    return () => {
      window.removeEventListener("keydown", onHold, true);
      window.removeEventListener("pointerdown", forget, true);
      watcher.disconnect();
    };
  }, []);

  /**
   * Remember where the cursor was, so an overlay that unmounts can hand it back.
   * One listener, because the alternative is every portal picker growing its own
   * `openerRef` the way `Sheet` had to. See `rememberFocus` in lib/focus.ts.
   */
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => rememberFocus(e.target);
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    /**
     * TAB GOES TO THE NEXT FIELD, on every surface (client 2026-08-04).
     *
     * The rule itself is `cycleTab` in lib/focus.ts — fields only, confined to
     * the region, wrapping inside the surface. This function is only the two
     * questions that have to be answered before it may run.
     *
     * ONE: is this a surface Tab belongs to? `isEditorScope` says so, and a list
     * page, a filter bar and the app chrome all say no — Tab there stays as
     * native as it has always been, which is what keeps "search box → Add →
     * table → sidebar" working. The same shape as the `canSubmitSurface` gate at
     * the front of `enterAdvances`, and for the same reason: a global key that
     * cannot answer for a surface must not swallow it.
     *
     * TWO: is the cursor where the operator left it? `restoreFocusIfLost` is
     * called for the arrow keys already, but Tab needs it MORE than they do —
     * a portal picker unmounts on pick and strands focus on <body>, and native
     * Tab from <body> restarts at the top of the document. "I picked a value and
     * the cursor vanished, then Tab jumped to the top of the page" is one report,
     * not two.
     *
     * Not claimed when modified: Ctrl+Tab / ⌘+Tab belong to the browser and the
     * OS, and Alt+Tab never reaches us at all.
     */
    function onTab(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      restoreFocusIfLost();
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      const root = scopeOf(active);
      if (!isEditorScope(root)) return;
      cycleTab(e, root);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Tab") {
        onTab(e);
        return;
      }
      if (!NAV_KEYS.has(e.key)) return;
      // Modified keys belong to the shortcut layer (see shortcuts-provider),
      // except Alt+↓, which is how a child-grid cell opens its list.
      if (e.metaKey || e.ctrlKey) return;
      if (e.altKey && e.key !== "ArrowDown") return;

      // THE bail-out. React 19 + Next attach their delegated listeners to
      // `document` — the same node as this listener — so a React-level
      // stopPropagation() can NOT stop us; only preventDefault is visible here.
      // Everything that legitimately owns a key (Combobox, gridKeyNav, the
      // pickers, the search palette) already calls preventDefault, so honouring
      // this is what keeps them working untouched.
      if (e.defaultPrevented) return;

      // Last line of defence for the "focus is never stranded" invariant: if
      // something dropped the cursor on <body>, put it back before reading it,
      // so the very next keystroke works instead of being swallowed.
      restoreFocusIfLost();

      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      const root = scopeOf(active);
      if (!root) return;

      if (arrowOpensPicker(e)) return;
      if (arrowNavigate(e, root)) return;
      enterAdvances(e, root, {
        // `has` is probed BEFORE Enter claims the key at all — see the gate in
        // enterAdvances. Firing to find out would save the record.
        has: () => shortcutsRef.current?.has("save") ?? false,
        fire: () => shortcutsRef.current?.fire("save") ?? false,
      });
    }

    // Bubble phase, so React's handlers run first and can claim the key.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * ESCAPE, LAST LAYER: leave the page (client 2026-07-28).
   *
   * Escape unwinds exactly one layer per press — an open list, then the
   * surface — and each of those layers already owns the key locally. This is the
   * bottom of the ladder: nothing is open, so the page itself is what the
   * operator is escaping from.
   *
   * It is bound to `window`, not `document`, and that is the whole design. Every
   * other Escape handler in the app — `Sheet`, `MasterFullScreen`, the dialog
   * pickers, `Combobox`, and React's own delegated handlers — sits on
   * `document`, and an event reaches `window` only after `document` has finished
   * with it. So this listener is guaranteed to run LAST and to see their
   * `preventDefault()`, without any ordering hacks. The corollary is a hard rule:
   * anything that consumes Escape MUST call preventDefault, or dismissing it will
   * also navigate the page away.
   */
  useEffect(() => {
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Belt-and-braces for an overlay that forgot to preventDefault.
      if (hasOpenModalInDom()) return;
      // Nothing to go back to (a directly-opened tab): stay put rather than
      // dumping the operator outside the app.
      if (window.history.length <= 1) return;
      if (!confirmDiscard()) return;
      e.preventDefault();
      router.back();
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [router]);

  return (
    <>
      {children}
      {/* Announces a REFUSED keypress. The message under the field carries
          role="alert" and announces when it appears, but blocking a key while
          it is already on screen produces nothing new to read. Always mounted:
          a live region only announces nodes inserted while it is already in
          the accessibility tree (the same lesson as components/ui/toast.tsx). */}
      <span ref={liveRef} role="status" aria-live="assertive" className="sr-only" />
    </>
  );
}
