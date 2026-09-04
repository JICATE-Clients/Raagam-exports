"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FIELD_SPAN, FIELD_TRACK, RequiredScope } from "@/components/ui/field";
import { LABEL_METRICS } from "@/components/ui/label";
import { Truncated } from "@/components/ui/truncated";
import { PaginationBar } from "@/components/ui/pagination";
import { usePagination } from "@/lib/use-pagination";
import { atCaretEdge, focusField, isOffTabPath, landOnAddedRow } from "@/lib/focus";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The body track for `across="compact"` — fixed 9rem cells that wrap, instead of
 * `FIELD_TRACK`'s twelve fractions of the section. See the `across` prop.
 *
 * A LITERAL, never interpolated: Tailwind v4 scans source text, so a computed
 * `grid-cols-[repeat(auto-fill,${w})]` produces no CSS at all — the same warning
 * `FIELD_TRACK` itself carries.
 */
const ACROSS_COMPACT_TRACK =
  "grid gap-x-3 gap-y-2 @2xl/editor:gap-y-1.5 grid-cols-[repeat(auto-fill,9rem)]";

/**
 * The controls that form a row's navigable axis, in DOM order.
 *
 * `[data-field-trigger]` (a dialog-picker trigger) counts as a field even
 * though it is a <button>: to the operator it IS a column. Leaving it out made
 * Enter mean "down one row" on a text cell but "along to the next cell" on the
 * picker beside it, and left arrow keys dead on pickers entirely — the same
 * split this whole pass exists to remove (client 2026-07-25).
 *
 * A **checkbox** counts too, for the same reason: it is a column the operator
 * sees, and excluding it made every arrow key dead on a tick-box cell — the only
 * way off one was Tab (client 2026-07-28). It has no native arrow meaning to
 * protect. Rows that render a tick box conditionally are fine: `focusColIn`
 * already clamps to the last field when the destination row is shorter.
 *
 * A **radio** does NOT: ↑/↓ natively move within a radio group, and stealing
 * that would make the group unusable.
 *
 * A **disabled** control is not a field either, and leaving it in was a dead key.
 * `focusField` is `.focus()`, which a disabled element ignores, but `focusColIn`
 * reported success anyway — so `gridKeyNav` claimed the key with `preventDefault`
 * and the cursor went nowhere. It stayed invisible while no grid had a disabled
 * cell; Material Attributes then gave every non-stepped row four (Start / End /
 * Unit / Step are only live on a Value-In-Steps line), and ←/→ died on the first
 * of them (client 2026-08-04). `FOCUSABLE_SELECTOR` in lib/focus.ts has excluded
 * `[disabled]` all along — this selector was simply the one place that did not,
 * which is the same disagreement described below arriving from a new direction.
 * Ragged rows are already handled: `focusColIn` clamps to the last field.
 *
 * This is `isFieldLike` (lib/focus.ts) expressed as a selector, minus that radio.
 * They are the same axis and must stay so — when they disagreed, Tab stopped on a
 * row's Remove ✕ while the arrows stepped over it, on the same row of the same
 * grid. The radio is the ONE difference, and it is a difference about ↑/↓ rather
 * than about what a field is.
 *
 * ## IT IS NOT THE ONLY DIFFERENCE. THERE IS A SECOND, UNRESOLVED ONE
 * (found 2026-08-31, recorded rather than fixed.)
 *
 * **This selector has no `tabindex` guard and `FOCUSABLE_SELECTOR` does** — every
 * branch of that one carries `:not([tabindex="-1"])` (lib/focus.ts:40). So a
 * field carrying `tabIndex={-1}` — which is every `readOnly` `<Input>`, since
 * `Input` sets it itself, and every `Field skipTab` — is invisible to EVERY key
 * outside a grid, and is still ON THE ROW AXIS inside one.
 *
 * That is the same class of disagreement as the `[disabled]` one two paragraphs
 * up, unfixed. It is why the Combos tab's collapsed Style ref cell needs an
 * explicit `data-focus-optional` on its wrapper: `tabIndex={-1}` alone would take
 * it off Tab anywhere else in the app, and does not here.
 *
 * **The call-site rule it implies, since nothing else states it:** a `readOnly` or
 * auto-filled cell INSIDE a `ChildGrid` needs `data-focus-optional`; the same cell
 * OUTSIDE a grid does not.
 *
 * NOT changed here, and the reason is blast radius rather than doubt: this
 * selector backs 26 `ChildGrid` screens plus the ~22 that hand-roll a row, and it
 * deliberately COUNTS controls `FOCUSABLE_SELECTOR` would drop for other reasons
 * (a checkbox, per the 2026-07-28 fix for dead arrows on a tick-box cell). Adding
 * `:not([tabindex="-1"])` to five branches is a one-line diff and an app-wide
 * behaviour change, so it wants its own change with its own verification — not a
 * footnote to a comment fix.
 */
const ROW_FIELDS =
  'input:not([type="button"]):not([type="hidden"]):not([type="radio"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [data-field-trigger]:not([disabled]), [data-row-open]:not([disabled])';

/**
 * `data-row-open` — A ROW'S OWN "OPEN THIS" BUTTON, and it is a CELL of the row
 * (client 2026-08-19, screenshot 2358: "that tab navigation is not moving to the
 * details button, why").
 *
 * Combos ▸ Detail is the case. It sits under its own column header, between
 * Combo and the row's ✕, and it is the ONLY way to reach the Structure Details
 * overlay — six fields per structure and a components grid, an entire surface
 * behind one button. Tab visits fields, a `<Button>` is not one, so that surface
 * was mouse-only. This is the same argument `enterNestedGrid` was written for
 * ("an empty nested list has no keyboard way in at all — Tab lands on fields, and
 * this is a button"), one shape along.
 *
 * IT JOINS `ROW_FIELDS`, WHICH MEANS ALL THREE MOVEMENT KEYS, NOT JUST TAB. That
 * is deliberate and it is the whole reason this marker exists instead of a
 * Tab-only list: AGENTS.md's rule is that Tab, Enter and the arrows read ONE
 * definition, "because when they disagreed the disagreement was visible inside a
 * single grid row" — Tab stopping on a control the arrows stepped over is
 * literally the 2026-08-01 bug. A Detail cell reachable by Tab but invisible to
 * ←/→ would rebuild it.
 *
 * THE ✕ IS STILL NOT THIS. A Remove has Ctrl+Del, so it loses nothing by staying
 * off the axis; Detail has no key of its own, which is what earns it one. Mark a
 * button only when it OPENS something the keyboard cannot otherwise reach — never
 * to make an action "convenient", or the typing path fills up with chrome again.
 *
 * `:not([disabled])` matches the rest of the selector: a Detail button greyed out
 * because the combo is unnamed is not a place the cursor can usefully stop.
 */

/**
 * Enter-on-last-row must not grow a grid that has its "+ Add" hidden (a
 * Single-Yarn fabric is capped at exactly one component).
 *
 * Returns `false`, which DECLINES the key rather than swallowing it: the grid
 * cannot grow, so Enter belongs to whoever is next — the parent grid, or the
 * provider's `enterAdvances`. Returning nothing meant a capped grid ate Enter on
 * its last row and the cursor sat there with no feedback. Material Attributes
 * relies on this: its rows appear by filling in the trailing blank one, never by
 * a key or a click, so every "add" there is really a move.
 */

// `focusField` (lib/focus.ts) focuses a cell and puts the caret at the end, so
// typing appends rather than overwrites — and so ←/→ can leave the cell on the
// first press. It was duplicated here; one copy now, shared with the provider.

/** Direct descendants only — a nested ChildGrid must not steal the outer one's rows. */
function ownDescendants(scope: HTMLElement, selector: string, boundary: string): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.closest(boundary) === scope && el.offsetParent !== null,
  );
}

/**
 * A row's Remove control — the thing Ctrl+Del drives.
 *
 * `data-row-remove` is the marker, and the `aria-label` prefix is the
 * compatibility half: ~22 screens hand-roll their own grid row rather than using
 * `ChildGrid`, and every one of them labels the button "Remove row" / "Remove
 * contact" / "Remove segment" / … . Matching the label is what gives all of them
 * the key without 22 edits — the same reason this file finds rows by
 * `data-grid-row` and not by `<tr>`. New code should carry the marker.
 */
/**
 * THE FRAME A GRID DRAWS AROUND ITSELF, exported so a non-grid panel standing
 * BESIDE a grid can match it exactly.
 *
 * "One frame per grid" (the screen-layout skill) says how many borders there
 * are; it says nothing about a control that has to sit next to one. On Style ▸
 * Components & Sizes the framed Components table shared a row with an unframed
 * Sizes control, and the client read the bare half as floating (2026-08-18).
 * Retyping these classes there would have put the same four numbers in two
 * files, which is how a border ends up 1px or 2px off and nobody can say which
 * one is wrong — the reason `FIELD_SPAN` and `FIELD_TRACK` are exported too.
 *
 * A LITERAL, never a template. Tailwind v4 scans source text, so interpolating
 * anything into it produces no CSS at all (`FIELD_TRACK` carries the same
 * warning).
 */
export const GRID_FRAME = "rounded-lg border border-border p-2.5 @2xl/editor:p-2";

/**
 * THE COLUMN-HEADER BAND'S TYPE — darker and a half-step bigger than a field
 * label, for the reason the `<th>` below records: on a row of identical boxes
 * the heading is the ONLY thing telling the operator which cell they are in, so
 * a muted grey 12px "reads as decoration" (client 2026-08-18).
 *
 * EXPORTED BECAUSE A PANEL BESIDE A GRID HAS TO MATCH IT. Order Info ▸ Styles
 * Details lays a coordinates list, this grid and a Sizes picker on one line;
 * the middle one drew bold headings and the two beside it drew nothing and a
 * muted `Label`, so the row read as one titled thing between two untitled ones
 * (client 2026-08-26: "the centered section only have field titles but that
 * left and right section field title no — so add it and make bold"). They title
 * themselves with THIS string rather than a retyped copy of it, which is the
 * same argument `LABEL_METRICS` makes one component over.
 *
 * It was typed out twice inside this file before that — the `#` header and the
 * column headers — which is exactly how a third copy starts.
 */
export const GRID_HEADER_TEXT = "text-[12.5px] font-semibold text-foreground";

/**
 * `openRowKey`'s "nothing is open" value — see the state declaration below.
 *
 * A STRING THAT CANNOT BE A ROW KEY, rather than a second boolean beside the
 * key: the fold test is one comparison (`row.key !== target`), and a sentinel
 * keeps it one comparison. Callers mint keys with `newKey()` (`k0`, `k1`, ...)
 * or a uuid, so a parenthesised phrase is unreachable by construction.
 *
 * PRINTABLE, deliberately. The first cut used a literal NUL, which is a valid
 * JS string and made `grep` report the whole file as binary -- every text tool
 * in this repo, the audit scripts included, then treats it as unreadable.
 */
const ALL_FOLDED = "(all folded)";

const ROW_REMOVE = '[data-row-remove], [aria-label^="Remove" i]';

/**
 * A grid's Add control — what Tab drives when it steps into a nested grid that
 * has no rows yet (see `enterNestedGrid`).
 *
 * The marker only, with no `aria-label` compatibility half: unlike Remove, this
 * one CREATES something, and "+ Add" / "+ Size" / "+ Add value" are a far looser
 * family of labels than "Remove …". A grid opts in by saying so.
 */
const ROW_ADD = "[data-row-add]";

/**
 * A ROW'S TAB AXIS INCLUDES ITS NESTED GRIDS — every field inside the row, in DOM
 * order, which on screen is: the row's own cells, then the panel underneath it.
 *
 * This is where Tab and the arrows deliberately part company. `ownDescendants`
 * scopes by the nearest `data-grid-row`, which keeps a nested grid's fields OUT
 * of the outer row's arrow axis — without that, ↓ from "End Value" landed on the
 * 2nd value of the next attribute line (client 2026-07-25). Tab fell out of that
 * same query and so skipped the nested panel entirely, which is a different bug
 * wearing the fix's clothes: Tab's whole job is to visit every field, and the
 * values list under a Material Attribute row was reachable only with the mouse
 * (client 2026-08-05, screenshot 2172).
 *
 * Nothing else may use this. `gridKeyNav`'s `fieldsIn` stays scoped, and its
 * `fromChildGrid` hand-off is what carries ↑/↓ across the boundary instead.
 *
 * IT IS DELIBERATELY UNFILTERED — `[data-focus-optional]` cells are IN here. That
 * is the second place Tab and the arrows part company, and the split is one step
 * finer than the one above: `tabAlongRow` skips an optional cell when picking
 * where to GO, never when working out where it IS. The distinction is the whole
 * fix. Filter it here instead and `fields.indexOf(el)` returns -1 for a cursor
 * standing on that cell (← → still put it there), `tabAlongRow` declines the key,
 * and on a page-level grid native Tab takes over and lands on the row's ✕ — the
 * complaint of 2026-08-01 walking back in through its own fix.
 */
function tabFieldsIn(row: HTMLElement): HTMLElement[] {
  // `offsetParent` for the same reason `focusablesIn` (lib/focus.ts) has always
  // filtered on it: a grid in the default `responsive` mode has BOTH a table and
  // a card layout mounted with CSS hiding one, and a `foldRows` grid keeps
  // collapsed rows in the DOM. Tab aiming at a hidden cell lands nowhere, and
  // "nowhere" is what restarts the cycle at the top of the form.
  return Array.from(row.querySelectorAll<HTMLElement>(ROW_FIELDS)).filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * TAB INTO A NESTED GRID THAT HAS NO ROWS YET OPENS ITS FIRST ONE.
 *
 * A nested list starts empty and its only affordance is a button — and Tab lands
 * on fields, never on buttons (`cycleTab`, lib/focus.ts). So the FIRST value of a
 * Material Attribute was mouse-only: nothing to tab into, and nothing to stand on
 * and press Enter. The list used to carry a permanently-open blank box, which is
 * what made the keyboard work; when that was replaced by "+ Add value" the note
 * said the keyboard was unaffected because "Enter off the last value still opens
 * the next box" (2026-08-04) — true only once the list already holds a value.
 *
 * Drives the button with `.click()`, the path a mouse takes, for the same reason
 * `removeRowKey` does: whatever guard that button carries still runs, and this can
 * never get out of step with what the button does.
 *
 * FORWARD ONLY. Shift+Tab skips an empty panel instead — moving backwards out of a
 * row is not the operator asking for one. And it fires only when the nested grid
 * has NO fields at all, so it cannot stack blank rows: one empty box is enough to
 * stop it firing again.
 *
 * Returns true when it consumed the key.
 */
/**
 * TAB ONTO A SHUT FOLD OPENS IT AND CARRIES ON INSIDE (client 2026-08-27, on
 * Material BOM: "open the first section, close the second one").
 *
 * A folded group's band is a `data-grid-row` whose only field is its chevron, so
 * without this Tab off the last row of one group STOPS on the next group's
 * chevron — the operator presses Enter to open it, then Tab again to get into
 * it. Three keys to cross a boundary they did not ask to be stopped at.
 *
 * IT IS NOT THE "+ Add" RULE AND MUST NOT INHERIT ITS CAUTION. Enter off the
 * last row deliberately LANDS on "+ Add" and takes a second press to fire,
 * because that button CREATES a row and the client complained about rows being
 * conjured by a keystroke aimed at moving (2026-08-19). Opening a fold creates
 * nothing: the rows already exist and are already the operator's, and the only
 * question is which of them is on screen. Revealing is not creating, so the
 * automatic move is right here and would be wrong there.
 *
 * Drives the chevron with `.click()`, the path a mouse takes — the same reason
 * `enterNestedGrid` and `removeRowKey` do: whatever the button does, including
 * shutting the fold the operator is leaving, happens exactly once and cannot
 * drift from what a click does.
 *
 * `landOnAddedRow` then puts the cursor in the first field that appeared, which
 * is what makes this one move rather than two. It diffs the grid body before and
 * after, so it is indifferent to an accordion ALSO closing the previous group in
 * the same commit — the fields that vanish are not candidates, and it retries
 * across a few frames for the render.
 *
 * FORWARD ONLY, like `enterNestedGrid`: Shift+Tab out of a group is the operator
 * leaving, not asking for the group above to unfold. And only a SHUT fold —
 * `aria-expanded="false"` — so an open band's chevron stays an ordinary stop.
 */
function enterShutFold(target: HTMLElement, e: React.KeyboardEvent<HTMLElement>): boolean {
  if (!target.matches('[data-row-open][aria-expanded="false"]')) return false;
  e.preventDefault();
  target.click();
  landOnAddedRow(target);
  return true;
}

function enterNestedGrid(row: HTMLElement, e: React.KeyboardEvent<HTMLElement>): boolean {
  // Nested bodies only — `row.closest` would find the grid this row belongs to —
  // and LAID OUT ones only: a `responsive` ChildGrid mounts its table and its
  // cards together and hides one by CSS, so the empty half of a nested grid that
  // is not even on screen must not be what Tab opens. Same `offsetParent` test
  // `focusablesIn` (lib/focus.ts) uses.
  const empty = Array.from(row.querySelectorAll<HTMLElement>("[data-grid-body]")).filter(
    (body) => body.offsetParent !== null && body.querySelector(ROW_FIELDS) === null,
  );
  for (const nested of empty) {
    // The Add control sits inside the body (material-attribute's "+ Add value")
    // or beside it in the grid's own wrapper (ChildGrid's "+ Add row",
    // opportunity-tabs' "+ Size"). Never the ROW itself, and so never outside it:
    // the row's own Add button — or a sibling panel's — is not this panel's way in.
    const wrapper = nested.parentElement;
    const scope =
      wrapper && wrapper !== row && wrapper.closest("[data-grid-row]") === row ? wrapper : nested;
    /**
     * A NESTED `ChildGrid` STATES ITS OWN EXTENT — ask it before guessing.
     *
     * `nested.parentElement` is the grid's card in `cards` / `inline` mode and
     * NOT in `responsive` mode, which is the default: there the visible body is
     * a `<tbody>`, whose parent is the `<table>`, two levels below the card the
     * "+ Add" actually sits in. So `scope.querySelector` came back null, the
     * loop skipped the panel, and an empty nested grid had NO keyboard way in at
     * all — its only affordance is a button and Tab lands on fields, so this
     * function is the single route. That is the Material Attributes "the first
     * value was mouse-only" defect (2026-08-05) arriving through another door,
     * and it is the same blindness `ownAddControl` had: a rule looking for the
     * button where one of ChildGrid's two layouts does not put it.
     *
     * `row.contains(card)` IS LOAD-BEARING. A HAND-ROLLED nested grid has no
     * card of its own, so `closest` climbs to the OUTER grid's card — which
     * contains `row` rather than sitting inside it. Without the test, Tab into a
     * hand-rolled panel would click the outer grid's "+ Add" and add a whole new
     * outer row. Those grids keep the `wrapper`/`scope` branch, which is what
     * has always served them.
     */
    const card = nested.closest<HTMLElement>("[data-grid-card]");
    const add =
      (card && row.contains(card)
        ? ownDescendants(card, ROW_ADD, "[data-grid-card]")[0]
        : undefined) ?? scope.querySelector<HTMLElement>(ROW_ADD);
    if (!add || (add instanceof HTMLButtonElement && add.disabled)) continue;
    e.preventDefault();
    e.stopPropagation();
    add.click();
    // The field does not exist until React has re-rendered — same 30ms hand-off
    // `gridKeyNav` uses after Enter adds a row.
    window.setTimeout(() => {
      const first = nested.querySelector<HTMLElement>(ROW_FIELDS);
      if (first) focusField(first);
    }, 30);
    return true;
  }
  return false;
}

/**
 * CTRL+DEL REMOVES THE ROW THE CURSOR IS STANDING IN.
 *
 * The row's ✕ is not a field, so Tab does not stop on it and the arrows step over
 * it (`ROW_FIELDS` above has always left it out). That is deliberate — Tab is the
 * typing path, and an action button sitting in it is what "Tab keeps landing on
 * the close icon" was (client 2026-08-01, again 2026-08-04). But "not on the Tab
 * path" must never mean "not reachable": without this key a keyboard-only
 * operator could add a row and never delete one.
 *
 * `Ctrl+Del` and not plain `Delete` because a grid cell is a text box the
 * operator is typing into — the identical reasoning to the picker list, which has
 * used Ctrl+Del for delete since it was written, so this is one key with one
 * meaning rather than a second thing to learn.
 *
 * It drives the button with `.click()`, the path a mouse takes, so whatever
 * confirmation or guard that button carries still runs. It never reimplements
 * removal, and it therefore cannot get out of step with what the ✕ does.
 *
 * Returns true when it consumed the key.
 */
function removeRowKey(e: React.KeyboardEvent<HTMLElement>): boolean {
  if (e.key !== "Delete" || !(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  // The INNERMOST row, so Ctrl+Del inside a nested grid deletes the nested row.
  const row = el.closest<HTMLElement>("[data-grid-row]");
  if (!row) return false;
  // …and its OWN body, so the cursor is put back among its siblings and not the
  // outer grid's, whichever handler in the nest happens to have caught the key.
  const body = row.closest<HTMLElement>("[data-grid-body]") ?? e.currentTarget;
  const rows = ownDescendants(body, "[data-grid-row]", "[data-grid-body]");
  const idx = rows.indexOf(row);
  if (idx === -1) return false;
  // The remove control of the CELL the cursor is standing in, falling back to
  // the row's own.
  //
  // Nearly every row has exactly one ✕, and for those this finds the same button
  // "the row's first" did. But a row is not always one removable thing — a grid
  // that packs several records onto one `data-grid-row` has several, and "the
  // row's first ✕" then deletes record #1 whichever cell the cursor was in
  // (found on a four-across value grid, 2026-08-04; that grid has since gone
  // back to one value per row, but the trap it exposed is general).
  //
  // Walking UP from the focused field lands on the nearest control that owns it:
  // the value's own ✕ where cells carry one, the row's where they don't. The
  // `closest(...) === row` filter is the same nested-grid boundary
  // `ownDescendants` applies — a child grid's remove buttons are never ours.
  const removeIn = (scope: HTMLElement): HTMLElement | undefined =>
    Array.from(scope.querySelectorAll<HTMLElement>(ROW_REMOVE)).find(
      (b) => b.closest("[data-grid-row]") === row,
    );
  let scope: HTMLElement | null = el;
  let btn: HTMLElement | undefined;
  while (scope) {
    btn = removeIn(scope);
    if (btn || scope === row) break;
    scope = scope.parentElement;
  }
  if (!btn || (btn instanceof HTMLButtonElement && btn.disabled)) return false;

  const col = ownDescendants(row, ROW_FIELDS, "[data-grid-row]").indexOf(el);
  e.preventDefault();
  e.stopPropagation();
  btn.click();
  // The node under the cursor is about to be unmounted, and Chrome drops focus to
  // <body> without firing blur when that happens (see lib/focus.ts). Land on the
  // same column of the row that takes its place — the last row when the one
  // removed was last. `restoreFocusIfLost` is the net if this finds nothing.
  window.setTimeout(() => {
    const fresh = ownDescendants(body, "[data-grid-row]", "[data-grid-body]");
    const target = fresh[Math.min(idx, fresh.length - 1)];
    if (!target) return;
    const fields = ownDescendants(target, ROW_FIELDS, "[data-grid-row]");
    const next = fields[col] ?? fields[fields.length - 1];
    if (next) focusField(next);
  }, 30);
  return true;
}

/**
 * TAB WALKS THE ROW'S CELLS — and skips everything that is not one.
 *
 * The grid is the sanctioned exception to "Tab is delivered from one place": a
 * key belongs to a control when it means something *inside* it, and inside a grid
 * Tab means "the next cell". `cycleTab` (lib/focus.ts) reaches the same answer on
 * every surface it owns, so this is not a second rule — it is the same rule
 * expressed against the axis this file already declares, `ROW_FIELDS`.
 *
 * THE ROW INCLUDES ITS NESTED GRIDS — `tabFieldsIn`, not `ownDescendants`. A panel
 * under a row (a Material Attribute's values, an Opportunity combo's sizes) is
 * part of that row on screen, so it is part of it on the Tab path: the row's own
 * cells first, then the panel, then the next row. See `tabFieldsIn` for why the
 * arrows keep the scoped axis and Tab does not, and `enterNestedGrid` for the
 * panel that has no rows yet.
 *
 * IT IS ALSO WHAT REACHES THE PAGE-LEVEL SCREENS. The provider claims Tab only on
 * a surface that declares itself an editor (`isEditorScope`), which a hand-rolled
 * page form does not — and Orders ▸ TA Plan / TA Style / TA Department Assign are
 * exactly that: page screens with hand-rolled grids, three of the ~22 where "Tab
 * lands on the Remove ✕" was reported. Every one of them already routes its keys
 * through this function, so putting the rule here is what covers them.
 *
 * At the row's end it moves to the next row's first cell. At the LAST cell of the
 * last row it **declines** — no `preventDefault` — and the layer above takes over
 * (the provider inside an editor, native Tab on a page). A grid is a region of a
 * form, not a trap of its own; trapping here would be the "cannot tab past a
 * child grid" complaint, which is worse than the one being fixed.
 *
 * Returns true when it consumed the key.
 */
function tabAlongRow(e: React.KeyboardEvent<HTMLElement>): boolean {
  if (e.key !== "Tab" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false;
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  const row = el.closest<HTMLElement>("[data-grid-row]");
  if (!row) return false;
  const body = row.closest<HTMLElement>("[data-grid-body]") ?? e.currentTarget;
  const rows = ownDescendants(body, "[data-grid-row]", "[data-grid-body]");
  const r = rows.indexOf(row);
  if (r === -1) return false;
  const fields = tabFieldsIn(row);
  const c = fields.indexOf(el);
  // Not in this row's axis at all — a control that is focusable but not field-like.
  // Nothing to step from; let the key go up.
  if (c === -1) return false;

  const dir = e.shiftKey ? -1 : 1;
  // A CELL MAY BE OFF THE TYPING PATH AND STILL BE A CELL. `data-focus-optional`
  // (lib/focus.ts) is the app's marker for the escape-hatch toggle Tab steps over
  // while ← → and the mouse still reach it — Material Attributes ▸ Blocked, which
  // Tab stopped on between one attribute line and the next (client 2026-08-11).
  // `cycleTab` has always honoured it; inside a grid THIS function owns Tab, so
  // until now the marker was inert on every cell. Skipping (rather than the
  // obvious `tabIndex={-1}`) is what keeps the box on the arrow axis: `ROW_FIELDS`
  // counts a checkbox on purpose, because excluding one made every arrow key dead
  // on a tick-box cell (client 2026-07-28, see the note on ROW_FIELDS).
  //
  // Applied to the DESTINATION only — see `tabFieldsIn` for why the axis this
  // walks must stay unfiltered.
  /*
   * A DERIVED CELL IS NOT A TAB STOP, INSIDE A GRID EITHER (client 2026-08-31:
   * Prices ▸ "the field is already filled, no need to focus go the field ...
   * directly move to the price type").
   *
   * `tabIndex={-1}` is the app's standing marker for a field nothing types into
   * — `Input` stamps it on every `readOnly` box itself, and AGENTS.md's
   * auto-field rule says derived fields are therefore skipped. That was true on
   * a form and FALSE in here: `FOCUSABLE_SELECTOR` (lib/focus.ts:40) carries
   * `:not([tabindex="-1"])` on every branch, `ROW_FIELDS` carries no tabindex
   * guard at all, and inside a `data-grid-row` THIS function owns Tab. So the
   * same read-only cell left the typing path on Prices — where it sits in a
   * `<Field>` — and stayed on it in T&A, where it sits in a row. One rule, two
   * answers, decided by which container the cell happened to be in.
   *
   * The T&A columns' own note asserts the opposite ("the cell leaves the Tab
   * path with no per-screen opt-out"), which is the shape that gets a marker
   * deleted as dead code: a claim a reader can falsify in a minute. It is true
   * as written now.
   *
   * ## DESTINATION ONLY — `ROW_FIELDS` IS DELIBERATELY UNTOUCHED
   *
   * Guarding the selector itself would take these cells off ↑ ↓ ← → as well,
   * and the arrows are how an operator READS a derived value they cannot type
   * into. That is the same split `isOffTabPath` already uses one line up, and
   * the same reason `ROW_FIELDS` counts a checkbox on purpose (2026-07-28).
   * Tab skips; the arrows and the mouse still arrive.
   */
  const skipAsDestination = (el: HTMLElement) =>
    isOffTabPath(el) || el.getAttribute("tabindex") === "-1";
  const step = (from: HTMLElement[], at: number) => {
    for (let i = at + dir; i >= 0 && i < from.length; i += dir) {
      if (!skipAsDestination(from[i])) return from[i];
    }
    return undefined;
  };
  let target = step(fields, c);
  if (!target) {
    // Off the end of the row's OWN fields, forward: a nested panel with no rows
    // yet is entered by opening its first one. Tab is otherwise the key that
    // cannot reach it, since its only affordance is a button.
    if (dir === 1 && enterNestedGrid(row, e)) return true;
    const nextRow = rows[r + dir];
    if (!nextRow) return false; // the grid's edge — hand the key upwards
    // The SAME flattened axis, so Shift+Tab arrives on the previous row's last
    // nested field rather than skipping the panel it just walked past. Entering
    // from outside, so step from the edge: -1 forwards, length backwards.
    const into = tabFieldsIn(nextRow);
    target = step(into, dir === 1 ? -1 : into.length);
    if (!target) return false; // a collapsed / summary-only row: let Tab pass
    // Off the end of a fold's LAST row, forward: the next thing is a shut fold's
    // own chevron, and standing on it is a stop the operator has to press Enter
    // on. Open it and carry straight in instead.
    if (dir === 1 && enterShutFold(target, e)) return true;
  }
  /**
   * CLAIM THE KEY ONLY IF THE CURSOR ARRIVED (client 2026-08-19).
   *
   * `focusField` now reports whether the element actually took focus. It cannot
   * always: a hidden twin from the other responsive layout, a collapsed row, a
   * node React unmounted between the query and the move. Before this, Tab was
   * consumed regardless — the cursor ended up on `<body>`, and the provider's
   * `restoreFocusIfLost()` then resumed from the TOP of the form. That is the
   * "Tab jumps back to the first field" report, and from inside this function it
   * looked like a successful move.
   *
   * Declining hands the key on — `cycleTab` gets it, finds the next real stop
   * (the grid's "+ Add", the next section) and moves there — which is the same
   * decline-and-bubble every other refusal in this file uses. A key that does
   * the next best thing beats a key that silently loses the cursor.
   */
  if (!focusField(target)) return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}

/**
 * Excel-like vertical movement inside a child grid (checklist "Better Table
 * Navigation"): Enter / ArrowDown move to the same column one row down; ArrowUp
 * moves up. On Enter in the last row we call `onAdd` and focus the same column
 * in the freshly-added row. Horizontal movement stays on native Tab (and the
 * Sheet's row-major Enter-advance, which this overrides via stopPropagation for
 * the keys it handles). Only fires for text-like inputs, so pickers keep their
 * native Enter (e.g. opening a picker dialog).
 *
 * Deliberately shape-agnostic: rows are found via `data-grid-row` /
 * `data-grid-body` rather than `<tr>`/`<td>`, and a row's "column" is the
 * position of the control among that row's fields. It previously keyed off
 * `closest("td")`, so it silently did nothing outside the table — which is
 * every Material grid, since none of them render one (they pass `inlineCards`;
 * they passed `forceCards` when this was written). That is why arrow keys
 * appeared to work on some screens and not others (client 2026-07-24 #2).
 */
/**
 * THE `addRow` ARGUMENT IS GONE (client 2026-08-19).
 *
 * Every caller used to hand this function a way to add a row, because Enter on
 * the last row added one. Enter now moves to the grid's "+ Add" button and the
 * button adds — so the callback was dead, and 18 call sites were passing a
 * function that could never run. A parameter nothing calls is worse than no
 * parameter: the next reader assumes Enter still adds because the wiring says so.
 *
 * The refusal it carried ("return false to decline", so a grid that cannot grow
 * right now lets Enter reach the parent) did not disappear with it — it moved to
 * `ownAddControl` returning null, which is the same decline-and-bubble, decided
 * by whether there is anything to move TO rather than by a callback's answer.
 */
export function gridKeyNav(e: React.KeyboardEvent<HTMLElement>) {
  if (removeRowKey(e)) return;
  if (tabAlongRow(e)) return;
  const vertical = e.key === "ArrowDown" || e.key === "ArrowUp";
  const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
  if (e.key !== "Enter" && !vertical && !horizontal) return;
  // Alt+↓ is how a grid cell opens its list — the global contract routes it to
  // `arrowOpensPicker` (lib/focus.ts) precisely BECAUSE plain ↑/↓ belong to this
  // handler. Claiming it here swallowed it: on any row but the last, Alt+↓ moved
  // down a row and the picker never opened. Alt belongs to the layer above.
  if (e.altKey) return;
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  // Text-like inputs and picker triggers navigate; native selects and textareas
  // keep their own Enter/arrow meaning (change value / insert newline).
  const isTrigger = el.matches("[data-field-trigger]");
  if (!isTrigger) {
    if (!(el instanceof HTMLInputElement)) return;
    // Radios keep their native arrow semantics (↑/↓ move within the group).
    if (/^(button|submit|reset|radio)$/.test(el.type)) return;
    // A checkbox navigates like any other cell (see ROW_FIELDS) — but Enter on
    // it is not ours. It belongs to `enterAdvances` (lib/focus.ts), which ticks
    // it.
    // Declined WITHOUT preventDefault, so the provider still gets the key.
    if (el.type === "checkbox" && e.key === "Enter") return;
  }
  // ↓ ON A PICKER CELL OPENS ITS LIST, exactly as it does on a form. Standing
  // down WITHOUT preventDefault is what hands the key to `arrowOpensPicker`
  // (lib/focus.ts) — the provider bails on `defaultPrevented`, so claiming it
  // here would swallow the opener.
  //
  // Nothing is lost: from this cell ↑ still goes up a row and Enter still goes
  // down one, which is the Excel key for it anyway. And it removes a split that
  // was already visible inside a single row — a Combobox cell opens on ↓ (it
  // consumes the key itself, so this handler never sees it) while the picker
  // beside it moved a row instead (client 2026-07-28).
  if (isTrigger && e.key === "ArrowDown") return;
  // Same rule the Sheet's Enter-advance follows: don't COMMIT out of a field
  // that is currently invalid. gridKeyNav stopPropagations, so without this the
  // validation gate was bypassed inside every grid.
  //
  // Enter only — deliberately NOT arrows. ValidatedInput reveals its message on
  // Enter (validated-input.tsx), so a blocked Enter explains itself; a blocked
  // ArrowDown would just be a dead key with no feedback, and would also kill the
  // native caret-to-start/end that arrows do in a text input.
  if (e.key === "Enter" && el.getAttribute("aria-invalid") === "true") {
    e.preventDefault();
    return;
  }
  // The grid this handler OWNS — not `el.closest("[data-grid-body]")`, which
  // always resolves to the innermost. That distinction is the whole fix: when a
  // nested grid reaches its own boundary it declines the key (no
  // preventDefault) so the event bubbles to the parent's handler — but the
  // parent then re-derived the SAME inner grid from the target, found the same
  // boundary, and returned. A nested grid could never hand off to its parent
  // (client 2026-07-25: ↓ dead-ended on the Attribute values list).
  const body = e.currentTarget;
  const rows = ownDescendants(body, "[data-grid-row]", "[data-grid-body]");
  const row = rows.find((r) => r.contains(el));
  if (!row) return;

  const fieldsIn = (r: HTMLElement) => ownDescendants(r, ROW_FIELDS, "[data-grid-row]");
  // -1 means the target belongs to a NESTED grid inside this row (ownDescendants
  // scopes by nearest marker, so a child grid's fields are correctly not ours).
  // We still handle the key: the child has already declined it, so this is the
  // hand-off — move a whole row and land on its first field.
  const col = fieldsIn(row).indexOf(el);
  const fromChildGrid = col === -1;

  // ←/→ move within the row; only once the caret has nowhere left to go, so
  // typing inside a cell still works. Same rule as lib/focus.ts arrowNavigate.
  if (horizontal) {
    if (fromChildGrid) return;
    const forward = e.key === "ArrowRight";
    if (!atCaretEdge(el, forward ? "next" : "prev")) return;
    const fields = fieldsIn(row);
    const target = fields[forward ? col + 1 : col - 1];
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    focusField(target);
    return;
  }

  const idx = rows.indexOf(row);

  const focusColIn = (target?: HTMLElement) => {
    if (!target) return false;
    const fields = fieldsIn(target);
    // Arriving from a nested grid has no column of its own — land on the first.
    // Otherwise clamp to the last field when the destination row is SHORTER
    // than this one (rows are ragged wherever a cell is conditional), rather
    // than letting `fields[col]` come back undefined.
    const next = fromChildGrid
      ? fields[0]
      : (fields[col] ?? fields[fields.length - 1]);
    if (!next) return false;
    // The same test Tab now makes: this function's callers use its answer to
    // decide whether to consume the key, and "I found an element" is not the
    // same fact as "the cursor is on it" — see `focusField`.
    return focusField(next);
  };

  // Consume the key only once the destination actually took focus. A row with no
  // fields at all — this grid's collapsed accordion rows, where everything but
  // the summary is unmounted — used to swallow the key and land nowhere.
  // Declining lets the provider have it (lib/focus.ts `enterAdvances`), so the
  // key still does something instead of dying on an empty row. `focusColIn`
  // already clamps for merely ragged rows, so this only fires when the
  // destination is genuinely empty.
  if (e.key === "ArrowUp") {
    if (idx > 0 && focusColIn(rows[idx - 1])) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }
  // Enter or ArrowDown
  if (idx < rows.length - 1) {
    if (!focusColIn(rows[idx + 1])) return;
    e.preventDefault();
    e.stopPropagation();
  } else if (e.key === "Enter") {
    // Last row + Enter → add a new row and land in the same column.
    //
    // From an EMPTY picker trigger this looped: the new row's trigger is again
    // the last row, so a second Enter added another row, and on a picker-ONLY
    // grid (customer Agents / Category / Vendor) Enter had no other meaning —
    // holding it wrote a run of blank child records to the server.
    //
    // Refined to only the empty case (client 2026-07-28): a grid whose first
    // cell is a picker — Material Attributes — could never be extended from the
    // keyboard at all, since the guard fired before the row was ever filled in.
    // A picker that HAS a value is a finished row, so Enter behaves there as it
    // does on a typed field.
    //
    // Opt-IN, hence `!== "false"` rather than a bare `hasAttribute`: a picker
    // states its emptiness through `data-field-empty="true|false"`, which
    // `DataPicker` itself now emits (data-picker.tsx), so every picker built on
    // it inherits the behaviour rather than only the two shared wrappers. The
    // dozen-odd bespoke triggers (customer / vendor / bank / country …) declare
    // nothing and keep the old no-op — reading their silence as "filled" would
    // hand the runaway-blank-row bug straight back to the grids it came from.
    // Space still opens the picker either way.
    //
    // AND IT MUST NOT BLOCK THE HAND-OFF (`!fromChildGrid`). The guard exists to
    // stop a picker-only grid spawning blank rows of ITS OWN; it has nothing to
    // say about the row a PARENT grid would add. Applied to the escalation it
    // was fatal rather than merely strict: a nested grid whose last cell is an
    // empty picker declined the key (correctly), the parent re-ran this same
    // guard on the same element, and Enter died between the two — the only
    // keyboard route out of the nested list.
    //
    // Reported 2026-08-14 on the Garment Order: with the size list moved to the
    // end of a style row, Enter at the end of the row hit a blank size picker
    // and "+ Add style" became unreachable from the keyboard. It was invisible
    // until then only because the row used to end in a typed field.
    //
    // Runaway rows cannot come back through this door: after the parent adds,
    // `focusColIn` lands on the NEW row's first field, so the next Enter is on
    // the parent's own empty picker and the guard fires there normally.
    /**
     * ENTER GOES TO THE "+ ADD" BUTTON. IT DOES NOT ADD (client 2026-08-19:
     * "enter key automatically creating the new section … instead need to move
     * to that add button, then on that button need to create").
     *
     * Everything below this line used to add a row outright. The button is a Tab
     * stop now (`isRowAdd`, lib/focus.ts), so Enter lands on the same control the
     * mouse uses and a SECOND Enter — the browser's native click — is what
     * creates the row. `landOnAddedRow` then puts the cursor in it, exactly as
     * before, so the end of the journey is unchanged; only the confirmation step
     * is new.
     *
     * THE EMPTY-PICKER GUARD IS GONE WITH IT, and that is a consequence rather
     * than a decision. It existed because "holding Enter wrote a run of blank
     * child records to the server" — Enter added, the new row's empty picker was
     * again the last row, and the next Enter added another. Enter creates nothing
     * now, so a runaway is unreachable; and keeping the guard would have broken
     * the very case that prompted this change, since a grid ending in a blank
     * picker (Garment Order sizes, Material Attribute values) would still have
     * declined the key and never reached the button.
     *
     * NO BUTTON, NO CLAIM. A grid with `hideAdd`, or one that has hit its own
     * cap, has nothing to move to — so decline WITHOUT preventDefault and let the
     * key carry on to the parent grid or to `enterAdvances`, which is the same
     * decline-and-bubble hand-off the rest of this function relies on. Silently
     * swallowing Enter at the end of a grid that cannot grow is how a surface
     * loses its only route to Save.
     */
    const addBtn = ownAddControl(body);
    if (!addBtn) return;
    e.preventDefault();
    e.stopPropagation();
    addBtn.focus();
    return;
  }
}

/**
 * This grid's own "+ Add" control, and only ever this grid's.
 *
 * It lives in one of two places depending on the layout, which is why this is a
 * function rather than a selector: `across` mode renders it INSIDE
 * `data-grid-body` so it takes a cell on the wrapping track, every other mode
 * renders it as a SIBLING of the body. `enterNestedGrid` already depends on the
 * first of those.
 *
 * Scoped both ways. Inside, `ownDescendants` stops at a nested `data-grid-body`,
 * so a child grid's button is not mistaken for ours. Outside, the sibling search
 * excludes anything the body contains, so the same nested button cannot be found
 * by the second branch either — which would otherwise send Enter at the end of a
 * parent row into the CHILD's Add.
 */
function ownAddControl(body: HTMLElement): HTMLElement | null {
  const inside = ownDescendants(body, "[data-row-add]", "[data-grid-body]")[0];
  if (inside) return inside;
  /**
   * A `ChildGrid` STATES ITS OWN EXTENT, so ask it rather than walking
   * (client 2026-08-21: "key focus directly moving to the size … first should
   * work on component section").
   *
   * THE WALK BELOW COULD NEVER FIND IT IN `responsive` MODE — the DEFAULT — and
   * that is the whole of the bug this branch fixes. Responsive renders TWO
   * `data-grid-body` elements for ONE grid (the table, and the `@lg:hidden` card
   * list), so the first ancestor that holds the sibling "+ Add" is also the first
   * that holds both bodies. The walk's own ambiguity bound then fired — "more
   * than one `data-grid-body`, so a `[data-row-add]` can no longer be attributed
   * to US" — and returned null against a button that unambiguously IS ours.
   *
   * What that cost is not a missing keystroke; it is the WRONG one. Enter at the
   * end of the last row declines and bubbles (`NO BUTTON, NO CLAIM`, see
   * `gridKeyNav`), so `enterAdvances` moved to the next field AFTER the grid.
   * On Style ▸ Components & Sizes, that field is the Sizes box in the other half
   * of the split section: finishing a component row jumped the cursor out of the
   * grid entirely, and "+ Add component" was never offered. It was true of every
   * default-mode grid in the app at once, and invisible to `--check tab-fields`,
   * which reads source rather than the shape the two layouts make together.
   *
   * Tab was RIGHT throughout, which is why this read as a Tab bug: `cycleTab`
   * finds the button by `isRowAdd` in the ordered focusables and never asks this
   * function. Enter and Tab disagreeing about where a grid ends is exactly the
   * divergence AGENTS.md's "all three movement keys read one definition" exists
   * to prevent — so the fix is one shared answer, not an Enter-side special case.
   *
   * `data-grid-card` is the marker `ChildGrid` stamps on the card that holds its
   * layouts. `ownDescendants` bounded by that marker excludes a NESTED grid's
   * own "+ Add" (its nearest card is the inner one), which is the distinction the
   * body count was reaching for and could not express.
   */
  const card = body.closest<HTMLElement>("[data-grid-card]");
  if (card) return ownDescendants(card, "[data-row-add]", "[data-grid-card]")[0] ?? null;
  /**
   * WALKING UP, BUT NEVER PAST A SECOND GRID.
   *
   * One level is not enough in practice: Work Timing puts "+ Add shift" in the
   * card's HEADER band, which is a sibling of the div holding the body, so a
   * `body.parentElement` search misses it. Unbounded walking is worse — it would
   * eventually find some other grid's button and send Enter there.
   *
   * The bound is the ambiguity itself: stop as soon as an ancestor contains more
   * than one `data-grid-body`, because from there a `[data-row-add]` can no
   * longer be attributed to US. Consignee is exactly that shape — Contacts and
   * Notify are two grids under one section — so the walk halts and Enter simply
   * declines rather than adding a contact from the notify grid.
   */
  let scope = body.parentElement;
  while (scope) {
    if (scope.querySelectorAll("[data-grid-body]").length > 1) return null;
    const found = Array.from(scope.querySelectorAll<HTMLElement>("[data-row-add]")).find(
      (b) => !body.contains(b) && b.offsetParent !== null,
    );
    if (found) return found;
    scope = scope.parentElement;
  }
  return null;
}

/**
 * THE MASTER-DETAIL LIST PANE OWNS ↑ ↓ AND ENTER (client 2026-09-02, reported on
 * Material BOM ▸ Materials: the left list was reachable only with the mouse).
 *
 * OWNED HERE, AND THAT IS THE NARROW EXCEPTION RATHER THAN A NEW HABIT. The
 * contract says keys come from `lib/focus.ts` and are never bound per surface —
 * but a control owns a key when the key means something INSIDE it, which is why
 * `gridKeyNav` and `tabAlongRow` already live in this file. A rail is that shape:
 * it is a LIST, ↑↓ walk its entries and Enter chooses one. `arrowNavigate` cannot
 * express "the next entry" — it asks geometry, and this pane SCROLLS
 * (`overflow-y-auto`, `md:max-h-[560px]`), so the same keystroke would answer
 * differently depending on where the operator had scrolled to.
 *
 * BOUND ON THE ENTRY, NOT ON THE PANE, so a key it declines bubbles to
 * `gridKeyNav` on the body and then to the provider — the same decline-and-bubble
 * hand-off the rest of this file relies on. ↑ off the FIRST entry declines on
 * purpose: there is nothing above the list, and swallowing the key would strand
 * the operator in a pane they can enter and not leave.
 */
function mdListKeyNav(e: React.KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented) return;
  const el = e.currentTarget;

  /**
   * ENTER OPENS THE MATERIAL AND PUTS THE CURSOR IN ITS FORM.
   *
   * `.click()` rather than a second copy of the open action, so the keyboard and
   * the mouse cannot drift — the same reason Ctrl+Del drives the row's own ✕.
   * A `<button>` fires that click natively anyway (`enterAdvances` stands down on
   * anything that is not an input / select / trigger), so what this branch is
   * really for is the FOCUS half: choosing a material is choosing to work in it,
   * and leaving the cursor out on the rail would make the operator reach for the
   * mouse to start typing — which is the complaint, one step along.
   */
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    const body = el.closest<HTMLElement>("[data-grid-body]");
    el.click();
    // The form does not exist until React has re-rendered — the same 30ms
    // hand-off `enterNestedGrid` and the Ctrl+Del path already use.
    window.setTimeout(() => {
      if (!body) return;
      // In `masterDetail` the folded rows ARE the list pane and render nowhere
      // else (`if (mdActive && folded) return null`), so the body holds exactly
      // one `data-grid-row`: the one just opened.
      const row = ownDescendants(body, "[data-grid-row]", "[data-grid-body]")[0];
      const first = row ? ownDescendants(row, ROW_FIELDS, "[data-grid-row]")[0] : null;
      if (first) focusField(first);
    }, 30);
    return;
  }

  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const pane = el.closest<HTMLElement>("[data-md-list]");
  if (!pane) return;
  const items = Array.from(pane.querySelectorAll<HTMLElement>("[data-md-list-item]"));
  const idx = items.indexOf(el);
  if (idx === -1) return;

  const next = e.key === "ArrowDown" ? items[idx + 1] : items[idx - 1];
  if (next) {
    e.preventDefault();
    e.stopPropagation();
    // A plain `.focus()`, NOT `focusField`: that one drops a caret at the end of
    // a value, and an entry is a button with no value to put one in. Focus is
    // also what scrolls the entry into view inside the pane, which is the half a
    // geometry-based move would have had to do for itself.
    next.focus();
    /**
     * THE SELECTION TRAVELS WITH THE ARROWS (client 2026-09-02: "only the single
     * item navigated to with Arrow Up / Down must have this blue highlight").
     *
     * THIS REVERSES 2026-09-02's OWN FIRST ANSWER, deliberately. That one kept
     * focus and selection apart and gave focus a dashed outline of its own,
     * reasoning that browsing should not re-open twenty forms. The client saw it
     * and chose the other trade: one mark, always on the entry the arrows are
     * standing on. So there is now no such thing as a focused-but-unselected
     * entry, which is what makes "exactly one blue" a property of the STATE
     * rather than a styling rule that has to keep two cues apart.
     *
     * `.click()` rather than a second copy of the open action — same reason the
     * Enter branch above uses it, and the same reason Ctrl+Del drives the row's
     * own ✕: the keyboard and the mouse must not be able to drift.
     *
     * CHEAP ENOUGH TO RUN PER KEYSTROKE, and that was checked rather than
     * assumed: the click sets `openRowKey`, which is this component's own state,
     * and `onOpenRow` is optional — the one screen using `masterDetail` today
     * (Material BOM) passes none. A caller that later passes an expensive one is
     * the thing to re-weigh here, not the re-render.
     *
     * ENTER STILL HAS A JOB. It no longer needs to switch the material — the
     * arrows did that — but it is what moves the cursor OFF the rail and into
     * the form, which is the difference between browsing and working.
     */
    next.click();
    return;
  }

  /**
   * OFF THE LAST ENTRY, ↓ LANDS ON "+ Add" — the same last stop Tab and Enter
   * already have at the end of a grid (AGENTS.md, "Add a grid row"), and found
   * through `ownAddControl` so the rail cannot disagree with them about which
   * button belongs to this grid. Enter on it adds; that is the button's own
   * doing and needs nothing here.
   *
   * NO BUTTON, NO CLAIM — a grid with `hideAdd` has nothing to move to, so the
   * key is declined rather than swallowed, exactly as `gridKeyNav` declines it.
   */
  if (e.key === "ArrowUp") return;
  const body = el.closest<HTMLElement>("[data-grid-body]");
  const add = body ? ownAddControl(body) : null;
  if (!add || (add instanceof HTMLButtonElement && add.disabled)) return;
  e.preventDefault();
  e.stopPropagation();
  add.focus();
}

/**
 * What a column contributes to the grid's totals band.
 *
 * `sum` and `count` cover the two cases every line-item document has; `derived`
 * is for an average, a weighted rate, or a "% of 100" that is not a plain sum.
 * `blank` is only ever needed to say "deliberately nothing here" where the
 * reader would expect a figure — omitting `total` says the same thing and is
 * what almost every column does.
 */
export type ChildGridTotal<T> =
  | { kind: "sum"; of: (row: T) => number; format?: (n: number) => ReactNode }
  | { kind: "count"; format?: (n: number) => ReactNode }
  | { kind: "derived"; value: (rows: T[]) => ReactNode }
  | { kind: "blank" };

/**
 * Pane widths a `tableFrom` grid may switch at — Tailwind's own container sizes,
 * NOT arbitrary pixel variants.
 *
 * `@min-[1540px]` is valid v4 syntax and was the first attempt, and it is the
 * wrong tool twice over: it is generated only if the literal survives into a
 * scanned source file, and a threshold nobody can name invites picking one that
 * lands a few pixels above the real pane — which renders as stacked cards, looks
 * like a broken grid, and gives no clue that a width comparison is what failed.
 * The built-ins are always generated and each has a number a reader can check.
 */
export type TableFrom = "5xl" | "6xl" | "7xl";

const TABLE_FROM: Record<TableFrom, { px: number; show: string; hide: string; hug: string }> = {
  "5xl": { px: 1024, show: "@5xl:block", hide: "@5xl:hidden", hug: "@5xl:w-fit" },
  "6xl": { px: 1152, show: "@6xl:block", hide: "@6xl:hidden", hug: "@6xl:w-fit" },
  "7xl": { px: 1280, show: "@7xl:block", hide: "@7xl:hidden", hug: "@7xl:w-fit" },
};

export interface ChildGridColumn<T> {
  header: string;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  /** Card-mode track width, e.g. "6rem" for a percentage or "auto" to hug.
   *  Omit to flex and take the remaining space (the picker/name column). */
  width?: string;
  /**
   * A totals cell under this column. Any column declaring one switches the
   * grid's totals band on; the rest render blank, so the figures stay under the
   * columns they total.
   *
   * COMPUTED OVER EVERY ROW, NEVER THE CURRENT PAGE. This grid paginates
   * internally (`pageSize`), so a total a CALLER computed from what it could see
   * would be a total of the visible page — wrong exactly when the grid is long
   * enough for anyone to want one. That, plus the fact that a `<tfoot>` has to
   * be inside the same `<table>` to inherit the header's column widths, is why
   * this lives on the component rather than in a wrapper around it.
   *
   * THE BAND IS NOT A ROW. It carries no `data-grid-row` and holds text only —
   * never an `<input>`, never a picker. Those two properties are what keep it
   * off the keyboard axis: `ownDescendants` finds rows by `[data-grid-row]`, so
   * a marked band would make ↓ off the last line land in the totals and Enter
   * there stop adding rows; and `ROW_FIELDS` finds cells by control, so a
   * focusable total would put a read-only figure on the Tab path.
   *
   * (It sits INSIDE `data-grid-body` in the two card layouts, which is safe for
   * exactly those reasons, and is required in `responsive` mode — the cards
   * container is what carries `@lg:hidden`, so a band outside it would render
   * beside the table's `<tfoot>` at wide sizes rather than instead of it.)
   */
  total?: ChildGridTotal<T>;
  /**
   * A cell that must be filled before the cursor may leave it (client
   * 2026-08-04), the grid equivalent of `<Field required>` — the header draws a
   * `*` and the control inside holds.
   *
   * Ctrl+Del still removes the row, and that is not incidental: a blank
   * mandatory cell in a row the operator should not have added would otherwise
   * be a trap they could neither fill, leave, nor delete.
   *
   * ~22 screens hand-roll a grid row instead of using this component, so their
   * cells do not inherit it — wrap those in `<RequiredScope>` directly.
   *
   * **AND SO DOES A GRID THAT PASSES `renderMobileRow`, INCLUDING THIS ONE.**
   * The stacked-cards layout below calls that function instead of the
   * `columns.map()` that wraps each cell in `RequiredScope`, so the declaration
   * never reaches the control — and with `forceCards` there is no width at which
   * it starts working again.
   *
   * What makes it worth spelling out is that it fails HALF-way: the header `*`
   * is still drawn from this prop, so forgetting the control leaves a star with
   * no hold behind it — the one divergence the single declaration is supposed to
   * rule out. Declare `required` on the control inside the row too
   * (`<Field required={c.required}>`, or `required` on a hand-rolled `<Input>`).
   * Checked by `audit_layout.py --check grid-required-mobile`; AGENTS.md ▸
   * Mandatory fields carries the reasoning.
   */
  required?: boolean;
}

/**
 * One totals cell's value.
 *
 * `rows` is EVERY row the grid holds, never `view` — see `ChildGridColumn.total`.
 *
 * A `sum` coerces through `Number(…) || 0` because a half-typed numeric cell is
 * `NaN`, and one `NaN` anywhere in a `reduce` blanks the whole figure. A total
 * that vanishes while the operator is mid-keystroke reads as a bug in the total,
 * not as an incomplete row.
 */
function renderTotal<T>(total: ChildGridTotal<T> | undefined, rows: T[]): ReactNode {
  if (!total || total.kind === "blank") return null;
  if (total.kind === "derived") return total.value(rows);
  if (total.kind === "count") {
    return total.format ? total.format(rows.length) : fmtNumber(rows.length);
  }
  const n = rows.reduce((acc, r) => acc + (Number(total.of(r)) || 0), 0);
  return total.format ? total.format(n) : fmtNumber(n);
}

/**
 * Reusable "repeating line items" editor for masters child grids (mixing
 * lines, attribute values, coordinates, description lines, sub-categories,
 * etc.) — a real table on desktop (`md:` and up), a stacked-card list on
 * mobile, a numbered `#` column, a per-row remove button, and a configurable
 * "+ Add {label}" button. Generalizes the desktop-table/mobile-card pattern
 * first built (four times) in `material-master-screen.tsx`.
 */
export function ChildGrid<T extends { key: string }>({
  label,
  badge,
  columns,
  rows,
  onAdd,
  onRemove,
  addLabel = "+ Add row",
  addClassName,
  renderMobileRow,
  pageSize,
  forceCards = false,
  frameless = false,
  keyboardNav = true,
  hideAdd = false,
  narrow = false,
  tableFrom,
  centerHeaders = false,
  lockExisting = false,
  hideRemove = false,
  keepOne = true,
  inlineCards = false,
  across = false,
  fill = false,
  flushRows = false,
  hideIndex = false,
  listRows = false,
  flatRows = false,
  rowSummary,
  foldRows = false,
  masterDetail = false,
  defaultOpenKey,
  railAlways = false,
  railWidthPx,
  railCompact = false,
  railBg = true,
  railAdd = false,
  renderListItem,
  onOpenRow,
  canFold,
  renderFoldedRow,
  seedRow = false,
  startIndex = 0,
  totalsLabel = "Total",
}: {
  /**
   * The grid's caption. OPTIONAL — omit it when the surrounding
   * `DetailSection` already names the grid, and the caption row disappears
   * with it (see the `label || badge` guard below, which has always handled
   * this; the prop was simply typed required, so the one screen that wanted it
   * could not say so).
   *
   * Omitting it is a LAYOUT decision, not just tidiness: a caption costs the
   * grid a band, so a grid sharing a row with fields sits one band lower than
   * they do and nothing lines up across the two cells (Material ▸ Fabric ▸
   * Composition, client 2026-08-05). That screen moved both the caption and
   * the badge to `DetailSection`'s `action` slot.
   *
   * `addLabel` is independent and still defaults to "+ Add row", so a grid
   * with no caption keeps a usable Add button.
   */
  label?: ReactNode;
  /** Optional trailing status next to the label, e.g. a "83% of 100%" running-total badge. */
  badge?: ReactNode;
  columns: ChildGridColumn<T>[];
  rows: T[];
  /** Return `false` to decline — see `gridKeyNav`'s `addRow`. */
  onAdd: () => boolean | void;
  onRemove: (row: T) => void;
  addLabel?: string;
  /**
   * Extra classes for the "+ Add" button, for the ONE case a caller needs: two
   * Add buttons sitting near each other that must render the same box.
   *
   * A grid's Add is `variant="outline" size="sm"` and content-width, so two of
   * them differ by exactly the width of their labels — "+ Add size" is ~6px
   * narrower than "+ Add style" beside it, which the client has now reported
   * twice (2026-08-17, 2026-08-18). The first fix put a width floor on the
   * hand-rolled one alone; a floor tuned to the OTHER button's font metrics can
   * only be right by luck, and that one overshot by 20px — leaving the pair
   * mismatched again, the other way round.
   *
   * So the floor is declared ONCE and both buttons read it: the caller passes
   * the same constant here and to its own button, and neither can be measured
   * against the other again. It is deliberately NOT a default on this
   * component — widening every "+ Add row" in ~32 screens to suit one pair is a
   * change nobody asked for.
   */
  addClassName?: string;
  /** Custom mobile-card body per row; falls back to stacking every column's cell if omitted. */
  renderMobileRow?: (row: T, index: number) => ReactNode;
  /** Paginate the rows at N per page with a Prev/Next bar, instead of an inner
   *  scrollbar (client 2026-07-25 — no scroll-in-a-box). The pager self-hides
   *  when everything fits; "+ Add" jumps to the last page. Omit for no paging. */
  pageSize?: number;
  /** Always render the stacked row-cards, never the wide table — for grids
   *  living inside a half-width column (Fabric organized layout 2026-07-23). */
  forceCards?: boolean;
  /** Drop the outer bordered card so the grid can nest INSIDE a DetailSection
   *  (e.g. Attributes (Mixing) under Composition) without a double border. */
  frameless?: boolean;
  /** Excel-like Enter/↑/↓ vertical cell navigation on the desktop table (on by
   *  default). Set false for grids where Enter should keep its native meaning. */
  keyboardNav?: boolean;
  /** Hide the trailing "+ Add" button — for grids capped at a fixed row count
   *  (e.g. Single Yarn fabric = exactly one component). */
  hideAdd?: boolean;
  /**
   * Every column holds a SHORT value — one picker, a size, a coordinate — so cap
   * the grid's width instead of stretching it across the section.
   *
   * A `<table>` shares its slack among the columns, and `ChildGridColumn.width`
   * cannot help: it is a CARD-mode track width and the table branch does not
   * read it. So a one-column grid renders a two-character size in a 1200px
   * control (client 2026-08-10). Legacy draws the same list in a narrow panel.
   *
   * THE CAP AND THE TABLE'S BREAKPOINT ARE COUPLED — this is the part to leave
   * alone. The layout is chosen by a CONTAINER query on this component's own
   * root, so capping the root's width also decides which layout it gets.
   * `max-w-lg` (32rem) with the table showing from `@md` (28rem) leaves 4rem of
   * headroom over the table's own `min-w-[420px]`. Tighten the cap below the
   * breakpoint and the grid silently flips to stacked cards, which looks like a
   * different bug entirely.
   */
  narrow?: boolean;
  /**
   * THE PANE WIDTH THE TABLE NEEDS BEFORE IT MAY APPEAR — the opposite end of
   * `narrow`, for a grid whose declared widths sum past what `@lg` promises.
   *
   * `@lg` IS 512px, NOT 1024. Container-query breakpoints are not the viewport
   * ones, and that is the trap this prop exists to close: the responsive table
   * shows from a 512px container, so a row of columns summing to ~1500px renders
   * as a table inside a 1090px pane on an ordinary laptop and grows the
   * horizontal scrollbar the operator's rule 4 bans. Nothing warns — the widths
   * are honoured, the table simply overflows and `overflow-x-auto` does what it
   * says.
   *
   * `5xl` = 1024px, `6xl` = 1152px, `7xl` = 1280px. Set it and the grid is a
   * table above that width and stacked cards below.
   * Both halves obey rule 4: no sideways scroll at any width, because the layout
   * changes instead of the content sliding.
   *
   * ## SET IT FROM THE DECLARED WIDTHS, NOT FROM A FEELING ABOUT THE SCREEN
   *
   * Add the columns' `width` values up, allow ~80px for the `#` and remove
   * columns, and pick the first threshold ABOVE the total — leaving the
   * flexible column enough to be readable at that width. Callers today: Fabric
   * BOM sums ~1210 and takes `7xl`; Fabric Plan (~950) and Budgeting (~790)
   * take `5xl`.
   *
   * AND KEEP `renderMobileRow`. Below the threshold the grid stacks, and the
   * DEFAULT stacked cell is a bare `<div>` around a `RequiredScope` — no visible
   * label. Fourteen unlabelled full-width boxes is a worse screen than the one
   * this prop was added to fix, and it is what happens if the callback is
   * dropped as redundant.
   *
   * ## WHY A FIXED SET AND NOT A NUMBER
   *
   * Tailwind reads class names out of the SOURCE. `@min-[${n}px]:block` built
   * from a variable produces a class that exists in no stylesheet — the grid
   * would silently never switch, which looks like the bug this prop fixes. The
   * strings below are literal for that reason; add a threshold by adding a
   * literal entry, never by interpolating one.
   */
  tableFrom?: TableFrom;
  /**
   * EVERY COLUMN HEADING IS CENTRED, whatever its cells do (client, 2026-08-18:
   * "make all the heading in center, everything should look neat and clean").
   *
   * The header normally inherits `ChildGridColumn.align`, which is chosen for
   * the VALUE — numbers right, text left — and on a row of equal-width cells
   * that leaves the labels scattered against alternating edges while the boxes
   * beneath them are all the same size. Centring the labels is what makes the
   * row read as a row.
   *
   * IT IS THE HEADINGS ONLY. The cells keep their own alignment, because that
   * one is not cosmetic: a column of right-aligned figures lines up on its
   * decimal point, and centring quantities would take that away to tidy a
   * heading. Opt-in per grid rather than a new default for the same reason —
   * a wide free-text column reads better with its label over the text.
   */
  centerHeaders?: boolean;
  /**
   * ROWS THAT WERE ALREADY SAVED CANNOT BE REMOVED — only ones added since this
   * grid mounted (client 2026-08-10: "delete permission should not be allowed").
   *
   * Master Data child grids offered a ✕ on every row regardless of permission:
   * 0 of 27 gated it, while 29 list screens already gated their row Delete. So
   * the list half respected permissions and the grid half did not.
   *
   * WHY "ADDED SINCE MOUNT" AND NOT "HAS NO ID". Almost none of these row types
   * carry the database id — the screens map stored rows onto fresh `key`s on
   * load — so provenance is not representable per row without editing 27 row
   * types and their mapping functions. The grid remembers the keys it was handed
   * on its first render instead; those are the stored ones by construction,
   * because every one of these sheets sets its rows in the same handler that
   * opens it.
   *
   * THE ROW JUST ADDED STAYS REMOVABLE, and that is not a softening of the rule
   * — it is what keeps it satisfiable. Ctrl+Del deletes a grid row by clicking
   * the row's own ✕, and AGENTS.md keeps that exemption precisely so a blank
   * MANDATORY cell in a row the operator should not have added is not a dead end
   * they can neither fill, leave, nor delete. Lock a freshly added row and a
   * required cell inside it becomes exactly that cage.
   *
   * The caveat, stated: a grid whose rows arrive AFTER mount would treat them as
   * new and leave them removable. No masters sheet does that today; if one ever
   * loads asynchronously it must pass its rows before the grid mounts, or this
   * silently permits what it is meant to prevent.
   */
  lockExisting?: boolean;
  /**
   * NO ✕ ON ANY ROW — for a grid whose rows are DERIVED rather than entered.
   *
   * Distinct from `lockExisting`, which withholds the ✕ only from the rows
   * present at MOUNT and its own doc records the hole: rows arriving later are
   * treated as new and stay removable. A derived grid re-creates its rows on
   * every render, so that guard would protect the first set and nothing after
   * it — the operator could delete a row the next render puts straight back.
   *
   * Removing the button also removes Ctrl+Del, which drives that same button
   * (`locked` is read by both), so the keyboard and the mouse agree without a
   * second rule.
   */
  hideRemove?: boolean;
  /**
   * THE LAST ROW CANNOT BE DELETED — for a grid the record cannot be saved
   * without (client 2026-08-31: "every tab must retain a minimum of one active
   * section or row … the grid becomes completely blank, leaving the tab in an
   * invalid state").
   *
   * ## IT IS THE DEFAULT, AND THAT REVERSED LATER THE SAME DAY
   *
   * It shipped opt-IN, and four grids took it — Styles, Combos, Prices,
   * Quantities. The client then hit the same defect on a grid that had not
   * (screenshot 2561: Color/Print ▸ Yarn Dyeing, Fabric Dyeing and Roll Form
   * Prints all deleted down to nothing, three bare "+ Add" buttons and a tab in
   * the invalid state the first report described) and asked for it **as a
   * global condition**.
   *
   * The reversal is the one `uppercase` already made in `Input` and for the
   * identical reason, which AGENTS.md states under CAPITALS: a rule every screen
   * has to remember is a rule that holds until someone writes a new screen. Opt-
   * in put the burden on the author of grid number 30 to know about a decision
   * taken for grid number 4. **Never answer a recurrence of this with another
   * call site** — the four that pass it explicitly are now redundant and are
   * kept only because their comments record why *that* grid in particular cannot
   * be empty.
   *
   * ## WHAT IT DOES AND DOES NOT DO
   *
   * It refuses the last DELETION. It does not seed: a grid sitting at zero rows
   * — as those three were when this was reported — stays at zero until someone
   * adds one, and is then held at one. Seeding every grid to a blank row would
   * write meaningless children for an order that genuinely has no yarn dyeing,
   * which is a different and worse defect.
   *
   * ## OPTING OUT
   *
   * `keepOne={false}`, with a comment saying why zero rows is a legitimate state
   * for that grid. Reach for it only when emptiness is an ANSWER rather than an
   * omission.
   *
   * It is folded into `locked` rather than written beside it, which is what
   * makes it ONE rule instead of four: all four layouts read `locked`, and so
   * does Ctrl+Del — it drives the row's own `[data-row-remove]` by `.click()`,
   * so a button that is not rendered is a key that declines. The mouse and the
   * keyboard cannot disagree about this without someone adding a second test.
   *
   * DISTINCT FROM `seedRow`, and the two answer the same worry differently.
   * `seedRow` lets the last row go and puts a fresh BLANK one back; this refuses
   * the deletion outright. Prefer `seedRow` where the row is a container the
   * operator may legitimately want to empty (clearing a line, then retyping it),
   * and this where the row's EXISTENCE is the answer — an order with no style
   * line, a price group with no rate.
   *
   * NOT A CAGE, and that was checked against the mandatory-field hold
   * (AGENTS.md): the hold's escape hatch is "Ctrl+Del still removes a row the
   * operator should not have added", and here there is no such row — the one
   * that survives is the one the record requires, so filling it is the only
   * correct move and Escape still leaves the surface. Do NOT set this on a grid
   * whose sole row can be a blank the operator has no way to complete.
   *
   * IT IS ONLY THE SCREEN'S HALF, AND THERE IS NO SERVER HALF YET (corrected
   * 2026-08-31). This note previously said the rule was "one the server also
   * states" and pointed at `emptyMandatoryGrid` in
   * `lib/orders/amendments/actions.ts`. **That function does not exist**, in
   * that file or anywhere in the repo — the claim was aspirational and reads as
   * settled, which is the shape that stops the next person writing the guard
   * because they believe it is already there.
   *
   * So, stated honestly: a hidden button cannot stop a stale client or a direct
   * post from sending an empty array, and nothing currently refuses one. Writing
   * that guard is worth doing; until it is, this is a UI rule and no more.
   */
  keepOne?: boolean;
  /** One flex row per record with a single shared header, honouring each
   *  column's `width`. Use instead of `forceCards` for grids of narrow fields
   *  (Mixing %, Shade) that shouldn't stack. Ignores `renderMobileRow`. */
  inlineCards?: boolean;
  /**
   * ACROSS, NOT DOWN — the records flow ALONG a row and wrap, instead of one per
   * line. For a list whose record is a SINGLE short control: a size, a coordinate.
   *
   * The other three layouts are all one-record-per-line by construction, and for
   * a one-control record that is the whole cost: at 36px a line plus a 32px Add
   * button, six sizes is ~248px of a screen whose other cells are 32px tall — a
   * legacy screen does the same list in ~170px. Laid across `FIELD_TRACK`, six
   * take ONE line (client 2026-08-14 on the Garment Order's Style(s) tab;
   * 2026-08-17 on the Style master, "row design instead of column based").
   *
   * IT WAS HAND-ROLLED FIRST, and that is why it is here. `amendment-screen.tsx`'s
   * `sizeGrid` built this shape by hand — its own `data-grid-body`, its own
   * `gridKeyNav` call, its own span per item — because no mode expressed it. A
   * second hand-rolled copy on the next screen asking for it is exactly what the
   * `foldRows` note above warns about, so the shape moved in here instead. Read
   * that function for the reasoning behind each detail below; every one of them
   * was paid for once already.
   *
   * WHAT IT DRAWS, and each piece is load-bearing:
   *   - `FIELD_TRACK` as the body, so a record lands in the SAME 12-column track
   *     the fields above it use — six to a line, at identical widths and gutters.
   *     `FieldGrid` cannot be used instead: it would need a `<Field>` per record,
   *     and `Field` always draws a label line, which is the 14px per row this mode
   *     exists to remove.
   *   - `FIELD_SPAN.xs` per record (2 of 12). A FIXED span, never `flex-1`: the
   *     items have to line up in columns as they wrap, and an unsized item absorbs
   *     the row's slack — the same failure `hugsContent` records.
   *   - The "+ Add" INSIDE `data-grid-body`, taking a cell of its own. It lines up
   *     with the records above it and lands on the same line as the last of them
   *     instead of costing a fresh 40px — and `enterNestedGrid` looks for
   *     `data-row-add` *inside* the body, which is Tab's only way into an empty
   *     list. This is the one mode where the shared trailing Add button is
   *     suppressed for that reason.
   *   - NO HEADER BAND and NO ORDINAL. One header cannot head six columns of the
   *     same thing, so the label belongs to the `<Field label>` around the grid,
   *     where it carries `Label`'s real metrics. The ordinal restated what
   *     position already says, and `sno` is written from the array index at save,
   *     so nothing depended on it being drawn.
   *
   * ↑/↓ WALK THE LIST LEFT TO RIGHT, and that is a real change worth stating. It
   * stays coherent because this is a ONE-DIMENSIONAL list whose DOM order and
   * visual order agree — unlike the 2026-07-25 defect, where ↓ crossed out of a
   * row's own cells into a nested panel's and landed on the wrong line entirely.
   * Nothing here crosses a boundary. Every marker is unchanged, so Ctrl+Del,
   * Tab-lands-on-fields and ↓-opens-a-list all behave as they do everywhere else.
   *
   * Honours `seedRow`, `hideAdd`, `lockExisting`, `keyboardNav`, `frameless` and
   * pagination. Ignores `renderMobileRow`, `rowSummary`, `foldRows`, `flushRows`,
   * `hideIndex`, `narrow`, `fill` and column `total`s — a wrapping track has no
   * column for a figure to sit under, so declare no `total` here.
   *
   * FOR A ONE-CONTROL RECORD. Two columns per record would render side by side
   * inside a 2/12 span; use `inlineCards` or `forceCards` for those.
   *
   * `across="compact"` — THE SAME LAYOUT ON A FIXED 9rem TRACK instead of the
   * 12-column one (client 2026-08-18, screenshot 2335: "reduce this size dialing
   * fields length, now it looks too large, make compact").
   *
   * A span is a FRACTION of whatever it is given, and that is the whole defect:
   * the Style master's size list is `size="full"`, so 2/12 of a full-width
   * section is ~248px — a quarter of a metre of dropdown holding "XL". The
   * earlier note above predicted the fix as a per-caller `itemSize`, and that is
   * the wrong shape for it: every size on `FIELD_SPAN` is a fraction too, `xs`
   * is already the smallest, and the value here is 2-4 characters wide however
   * wide the section is. What the record needs is a WIDTH, not a share.
   *
   * So the compact track is `repeat(auto-fill, 9rem)` — 144px cells, wrapping,
   * left-aligned, identical at 1366 and at 1920. Nine sizes to a line where the
   * fractional track fitted six, and the tenth wraps under the first rather than
   * the picker growing to swallow the slack.
   *
   * The track is a literal constant for the reason `FIELD_TRACK` is: Tailwind v4
   * scans source text, so `grid-cols-[repeat(auto-fill,${n})]` would compile to
   * no CSS at all.
   *
   * KEEP THE DEFAULT WHERE THE RECORDS SIT UNDER FIELDS. The 12-col track is not
   * decoration there — on the Garment Order's Style(s) tab a size cell lands
   * exactly under Style / Order Unit / PO Qty, and a 9rem cell would line up with
   * nothing. Compact is for a list that stands on its own row.
   */
  across?: boolean | "compact";
  /**
   * TAKE THE WIDTH GIVEN instead of hugging the columns — for a grid that shares
   * a row with another grid, where the two cards' edges must line up.
   *
   * A grid whose columns all declare a `width` hugs its content (`hugsContent`),
   * and that is right for a grid standing alone: a card the width of a two-
   * character Size box beats one with a metre of grey beside it. Put four such
   * grids in a `SectionGrid` and the same rule turns against itself — Order
   * Amendment ▸ Color/Print Details drew Yarn Dyeing at ~520px above Roll Form
   * Prints at ~350px, so a 2×2 that was meant to read as a block had four
   * different right edges (client 2026-08-12, screenshot 2273).
   *
   * It suppresses ONLY the hug. The columns keep their declared widths, so the
   * fields inside stay the size they were and the slack falls to the right of
   * them — never "stretch the last picker to fill the card", which is what
   * dropping a column's `width` would do instead (see the note on Colour in
   * `dyeColumns`).
   */
  fill?: boolean;
  /**
   * Inline rows that read as FIELDS rather than as cards — for a grid sharing a
   * row with a plain `Field`, where the two must line up.
   *
   * They did not, and the offset was structural rather than one stray margin.
   * A `Field` puts its control 14px down (`Label` is `leading-[14px]`, `mb-0`
   * under compact density). An inline grid put its first control 31px down, from
   * three separate places: an 18px header band (`text-xs` 16px + `pb-0.5`), the
   * 6px `space-y-1.5` under it, and the row's own 7px `border` + `p-1.5`. So
   * Material ▸ Fabric ▸ Composition drew a Using select and a Yarn picker side
   * by side, 17px out of step (client 2026-08-05, screenshot 2169).
   *
   * This drops all three: the header band takes `Label`'s exact metrics, the gap
   * goes, and rows lose their card inset — separated by a rule instead, so a
   * multi-row grid still reads as rows. First control lands at 14px, level with
   * the field beside it.
   *
   * "TAKES `Label`'S EXACT METRICS" WAS ASPIRATIONAL UNTIL 2026-08-17. The band
   * retyped them as `leading-[14px] mb-1.5` and landed at 22px, so this paragraph,
   * LAYOUT.md §6 and the code disagreed for twelve days while all three read as
   * correct. It imports `LABEL_METRICS` from `label.tsx` now; the arithmetic and
   * the two independent reasons it was 8px out are recorded at the band itself.
   *
   * OPT-IN, because eight call sites across five screens use `inlineCards` and
   * only this one shares its row. It is the same argument `listRows` below makes
   * ("a card inside a card"), for the case where the neighbour is a field.
   *
   * No effect outside inline mode.
   */
  flushRows?: boolean;
  /**
   * DROP THE `#N` TRACK — for a one-column grid whose LEFT EDGE has to line up
   * with the fields above and below it.
   *
   * `flushRows` above answers the vertical half of that alignment and this is the
   * horizontal one, which is why they arrive together on the same grid. The index
   * costs 16px of `w-4` plus the row's 8px `gap-2`, so EVERY cell — and the header
   * above them — sits 24px right of the field in the row above. On Style ▸ Sizes
   * that put the size boxes 24px right of the Size Group select above them AND of
   * the "+ Add size" button below them, which is a child of the grid root and so
   * was never indented; the operator reported the section as still unaligned with
   * the vertical half already fixed (client 2026-08-17, screenshot 2316).
   *
   * WHAT IS LOST IS SMALLER THAN IT LOOKS, and it is not the ✕. A numbered row
   * earns its place in a multi-column grid, where "row 3" is how one line of eight
   * fields gets talked about. In a one-column list of sizes the VALUE is the
   * identity, nothing stores or reports the ordinal (`sizes.map` writes `sno: 0`),
   * and removal is untouched: the row keeps its ✕ and its `data-row-remove`, so
   * mouse and Ctrl+Del both work exactly as before.
   *
   * ALL THREE TRACKS GO TOGETHER — the header band's spacer, the row's number and
   * the totals band's caption cell — because the two bands exist to mirror the
   * rows' columns and half a track is a 24px shear between a figure and the column
   * it heads or totals. A consequence worth stating: `totalsLabel` renders in the
   * index slot, so it has nowhere to go here. No `flushRows` grid declares a
   * `total` today; a grid that needs both wants its index back.
   *
   * No effect outside inline mode, exactly as `flushRows` has none.
   */
  hideIndex?: boolean;
  /**
   * Cards mode, but the rows are flat list items divided by a rule instead of
   * boxes, and `renderMobileRow` owns the whole row INCLUDING its header — no
   * `#N` / remove band above it.
   *
   * For rows that already draw their own summary line (the Material Attribute
   * accordion). Boxing those produced a card inside a card: the outer grid's
   * border, then the row's border 12px further in, then the row's own padding
   * again — 22px of chrome before a field, against 8px for a `DetailSection`
   * beside it, so no two form controls on the page shared a left edge. It also
   * cost two stacked header bands saying the same thing, one of them ~40px tall
   * for nothing but an index and a delete icon.
   *
   * The row still carries `data-grid-row`, so keyboard nav is unaffected.
   */
  listRows?: boolean;
  /**
   * Cards mode with the BAND KEPT and the BOX DROPPED — rows divided by a rule
   * instead of each sitting in its own bordered card.
   *
   * The middle setting between `forceCards` and `listRows`, and it exists
   * because those two were the only choices and neither fit a client asking for
   * one less frame (2026-08-18, screenshot 2342: "remove that New style price
   * frame, just that top frame is enough"). `forceCards` draws a card inside the
   * section's own card. `listRows` drops the card but ALSO drops the header —
   * summary and ✕ both — so the screen has to hand-roll a band, which is the
   * ~20 lines of duplicated chrome the Combos structure grid deleted when it
   * moved the other way. Choosing between two frames and no delete button is
   * not a choice a grid should force.
   *
   * So: `rowSummary` still draws, the ✕ still sits in it carrying
   * `data-row-remove` for Ctrl+Del, folding still works — only the border and
   * the 10px of padding go, and a hairline takes over the job of saying where
   * one row ends.
   *
   * There is no focus wash to keep: the row tint was removed app-wide on
   * 2026-08-18 (see `app/globals.css`). The rule between rows is what says
   * where one row ends.
   *
   * Cards-mode only, like `listRows`. Pair it with `forceCards`.
   */
  flatRows?: boolean;
  /**
   * Who this row IS, drawn beside its `#N` in the cards-mode header band.
   *
   * A `forceCards` grid paginates identical-looking boxes: with `pageSize={3}`
   * you page through "#4 #5 #6" and the only way to tell a bank's Chennai
   * branch from its Coimbatore one is to read the fields. The band already
   * exists and is mostly empty, so the identity costs no extra height.
   *
   * Return a plain string for the common case; the band styles it. Return your
   * own element when a row can be blank — a new, untouched row has no identity
   * yet and should say so in muted text rather than render an empty line.
   *
   * `listRows` ignores this: there the row draws its own header, summary and
   * all. Table and `inlineCards` modes ignore it too — both already carry a
   * per-column header that names the values.
   */
  rowSummary?: (row: T, index: number) => ReactNode;
  /**
   * ONE ROW OPEN AT A TIME — finish an item, start the next, and the finished
   * one folds to a single line (client 2026-08-14, across the Orders module).
   *
   * A card row that carries more than six fields wraps to two or three lines, so
   * three records is a screenful before the operator reaches "+ Add". Folding
   * the ones not being worked on is what keeps a multi-record document readable.
   *
   * IT LIVES HERE RATHER THAN ON THE SCREENS. It was hand-rolled twice — the
   * Garment Order's styles and quantities — and the module has ~18 card grids;
   * a third and fourth copy is how a contract-level behaviour becomes eighteen
   * slightly different behaviours. Same reason `gridKeyNav` and `landOnAddedRow`
   * are single implementations.
   *
   * WHAT A FOLDED ROW MUST STILL DO, and none of it is optional:
   *   - keep ONE field, so Tab can still reach the row. Tab lands on fields, and
   *     `data-focus-optional` takes controls OFF that path with nothing to put
   *     one on — a row rendering no field is reachable by mouse alone. That is
   *     the caller's job, in `renderFoldedRow`.
   *   - open on FOCUS, so tabbing into a folded row unfolds it around the cursor.
   *   - open on CLICK anywhere, because the summary is the larger target and a
   *     picker is a poor one (it opens its own list on the way).
   */
  foldRows?: boolean;
  /**
   * THE FOLDED ROWS MOVE INTO A COLUMN BESIDE THE OPEN ONE, instead of stacking
   * above and below it (client 2026-08-20, Material BOM).
   *
   * `foldRows` already answers "one row open at a time"; this answers "and where
   * do the other nineteen go". Stacked, a twenty-line document puts the open row
   * an unpredictable distance down the page and moves it every time a different
   * one is opened. Beside, the list holds still, every line stays readable while
   * one is being filled, and the operator can see how far through they are.
   *
   * OPT-IN, AND IT CHANGES NOTHING FOR ANYONE ELSE. Default off, so the seven
   * existing `foldRows` callers keep stacking. It is `cards`-mode only — a table
   * row cannot be a pane — and it needs `renderListItem` below.
   *
   * THE KEYBOARD IS UNTOUCHED, and that is the reason this lives here rather
   * than being hand-rolled on the screen. The open row keeps its `data-grid-row`
   * inside the same `data-grid-body`, so `gridKeyNav`, `tabAlongRow`, the
   * required-holds and `data-row-remove` all still find it. A screen that built
   * its own two-pane layout would lose every one of those — the exact failure
   * AGENTS.md records for the ~22 hand-rolled grids.
   */
  masterDetail?: boolean;
  /**
   * WHICH ROW OPENS ON MOUNT, INSTEAD OF `ALL_FOLDED` (2026-09-04, Fabric BOM
   * ▸ Components: "why the bottom looks so flying… default open first
   * component with that table panel").
   *
   * THIS IS NOT A REVERSAL OF "A GRID OPENS WITH EVERYTHING FOLDED"
   * (2026-08-19, on Combos ▸ Structure Details — see `openRowKey`'s own
   * note). That rule is about a data-entry grid's SECTIONS: several answered
   * sections pre-expanded on a document the operator is EDITING reads as
   * noise, and the client said so directly. A `masterDetail` RAIL is a
   * different shape — a navigation list beside a detail pane, the one this
   * screen already borrowed whole from Material BOM — and a rail with
   * nothing selected is not "closed and calm", it is a list floating over an
   * empty pane with no content to anchor it, which is what was reported here.
   * List-then-detail UI opening on its first item is the ordinary case, not
   * the exception `openRowKey`'s note is guarding against.
   *
   * OPT-IN AND UNDEFINED BY DEFAULT, so every existing caller — Material
   * BOM's own `masterDetail` rail included — keeps mounting on `ALL_FOLDED`
   * exactly as before. Only a caller that names a row here changes.
   */
  defaultOpenKey?: string | null;
  /**
   * SHOW THE RAIL EVEN AT ONE ROW, opting a caller OUT of "a list of one is
   * not a list" (the note on `mdActive` below, client 2026-08-20).
   *
   * DEFAULT OFF, SO EVERY EXISTING CALLER IS UNCHANGED — Material BOM and
   * Fabric BOM ▸ Components both still hide the rail until a second row
   * exists, which is the behaviour that rule was written for: a document
   * that starts with exactly one blank line should not spend 220-268px on a
   * list holding "Not filled in" and nothing else.
   *
   * FABRIC BOM ▸ MANUAL ASKED FOR THE OPPOSITE (2026-09-04): its rows are
   * FABRICS, not a document's own single line, and the operator wants the
   * rail's shape — a list to click between, a name on each entry — visible
   * from the first fabric rather than appearing only once a second one is
   * added. `folded` (below) still requires `rows.length > 1` on its own, so
   * this changes ONLY whether the rail-and-detail split renders, never
   * whether the one row's card is suppressed — a single row still shows its
   * full body, now inside the detail column instead of full width.
   */
  railAlways?: boolean;
  /**
   * THE RAIL'S OWN WIDTH, IN PX — 268 (Material BOM's own figure, settled
   * 2026-08-20/08-28) UNLESS A CALLER NAMES ANOTHER ONE.
   *
   * A LITERAL PX VALUE, NEVER A CLASS BUILT FROM THIS NUMBER: the column is
   * inline-styled (`gridTemplateColumns`), not a Tailwind utility, for exactly
   * the reason every other numeric track in this file is a static class —
   * Tailwind v4 scans source TEXT, and an interpolated
   * `` `md:grid-cols-[${n}px_...]` `` compiles to no CSS at all. Inline style
   * has no such scanning step, so it is the one place in this component a
   * genuinely per-caller number is safe to accept.
   *
   * FABRIC BOM ▸ COMPONENTS HAS NOW ASKED FOR THREE DIFFERENT NUMBERS ON THIS
   * ONE RAIL (2026-09-03): 160 ("the rail is sized to its text"), then 268
   * ("same as Material BOM"), then 220 (shown Material BOM's own width next
   * to the client's own reference screenshot and asked to sit between the
   * two). A boolean could express the first two; it cannot express a third
   * — which is the whole reason this became a number instead of staying
   * `railCompact`.
   */
  railWidthPx?: number;
  /**
   * TIGHTER ENTRY PADDING — `px-2.5 py-1` instead of `px-3 py-2` — SEPARATE
   * FROM WIDTH NOW (client 2026-09-03, on Fabric BOM ▸ Components).
   *
   * IT USED TO SET BOTH AT ONCE, under one boolean, back when this rail only
   * ever needed the one narrower number (160). Once a caller needed 220
   * instead, bundling padding into the same flag would have forced 220px to
   * carry either 268's roomy padding or 160's tightest — neither of them
   * actually asked for. The two are independent measurements of the same rail
   * and are now two independent props.
   *
   * IT SIZES NOTHING INSIDE THE RAIL. What an entry SAYS is
   * `renderListItem`'s, so a caller taking this also sets its own type size —
   * the same separation that made `renderListItem` its own renderer.
   */
  railCompact?: boolean;
  /**
   * THE PANE'S TINT, OPT-OUT (client 2026-09-04, Fabric BOM ▸ Components and
   * ▸ Manual: "need remove that grey bg from that rail").
   *
   * `bg-surface-muted/60` on the list pane was added on 2026-08-20 so the
   * pane read as a box rather than running on down an empty white column
   * once the entries ran out — see the note on the pane `<div>` below. That
   * reasoning still holds for Material BOM, the rail it was written for, so
   * this is a per-caller opt-out rather than a deletion: Components and
   * Manual are the two call sites that pass `false`, Material BOM passes
   * nothing and keeps the tint.
   */
  railBg?: boolean;
  /**
   * PUT THE "+ Add" INSIDE THE RAIL, at the foot of the list rather than
   * under both panes (client 2026-09-04, Fabric BOM ▸ Components: the rail
   * "must ALWAYS render on the left ... containing the '+ Add part' button
   * inside it").
   *
   * OPT-IN AND OFF BY DEFAULT, the same shape as `railAlways`, `railWidthPx`,
   * `railCompact` and `defaultOpenKey` above — Material BOM's rail keeps its
   * Add under the grid exactly as before, and only a caller that asks moves.
   * A rail's Add is a rail concern on a grid whose rows ARE the rail, and it
   * is a full-width footer control on a grid whose rows are the pane; there
   * is no single answer to default to.
   *
   * IT PAYS FOR `railAlways` AT ZERO ROWS. An always-on rail with nothing in
   * it is a tinted empty column; with the Add in it, the empty rail is the
   * thing that says how a part gets made, which is the state this pairing was
   * asked for.
   *
   * THE BUTTON DOES NOT GO INSIDE `data-md-list`, and that is not a detail.
   * That element carries `data-focus-optional`, which `isOffTabPath` reads
   * with `closest` — so an Add nested in it would inherit "off the typing
   * path" and stop being a Tab stop, undoing "Enter or Tab off the last row
   * LANDS ON the '+ Add' button" (AGENTS.md, client 2026-08-19). The list and
   * the button are therefore siblings inside a wrapper that carries the
   * pane's own chrome; `mdListKeyNav` finds its entries within
   * `data-md-list`, whose own note already promises that wrapping the pane
   * cannot break ↑↓.
   */
  railAdd?: boolean;
  /**
   * What one line looks like in the master-detail list. Required by
   * `masterDetail`; ignored without it.
   *
   * A SEPARATE RENDERER, AND IT HAS TO BE. The two obvious candidates both fail:
   * `renderFoldedRow` may hold live CONTROLS (Material BOM's folded line carries
   * its Material picker), and nesting those inside the list's own button is
   * invalid markup that swallows the click; `rowSummary` is optional and the
   * screen that asked for this passes none — its band was removed on 2026-08-19
   * to reclaim the row's height.
   *
   * So this one is declared to be INERT: text, a status dot, a figure. Anything
   * focusable in here is a second tab stop per line, on a surface whose whole
   * point is that the fields live in the other pane.
   */
  renderListItem?: (row: T, index: number) => ReactNode;
  /**
   * Fires when the operator PICKS a line out of the master-detail list.
   *
   * Deliberately not "the open row changed": `openRowKey` also moves when a row
   * is added or removed, and a screen reacting to those would be reacting to its
   * own writes. This is the operator's own act of choosing one line to work on,
   * which is the only thing a caller has a reason to know about — Material BOM
   * folds the section rail away on it, to give the fields the width back.
   */
  onOpenRow?: (row: T, index: number) => void;
  /**
   * Has this row enough identity to fold TO? Default: yes.
   *
   * A row with nothing filled in has no summary worth showing, and a folded
   * blank line is indistinguishable from an empty record — so it stays open
   * until it says who it is.
   */
  canFold?: (row: T) => boolean;
  /**
   * What a folded row shows instead of its fields. Required by `foldRows`; it
   * must include at least one real field (see above).
   */
  renderFoldedRow?: (row: T, index: number) => ReactNode;
  /**
   * OPEN WITH ONE BLANK ROW instead of an empty state (operator, 2026-08-11).
   *
   * An empty grid shows a header, a line of prose and an "+ Add row" button —
   * so entering the first line costs a click before any typing, on every grid of
   * every document, when a blank first row is what the operator wanted in every
   * case anyway. The legacy RP screens they are migrating from all open with a
   * row standing ready.
   *
   * It is also the keyboard rule underneath AGENTS.md's `enterNestedGrid` note:
   * "replacing a grid's permanently-open blank row with a button removes the
   * keyboard's only way in — 'Enter off the last value opens the next box' needs
   * the operator to already be inside." A grid whose only affordance is a button
   * has nothing for Tab to land on, because Tab lands on fields.
   *
   * SEEDS ONCE PER EMPTY SPELL, not once per mount. `seeded` resets when rows
   * arrive, so opening record A (which has lines) and then record B (which has
   * none) still seeds B — the grid stays mounted across that switch, and a
   * mount-scoped guard would leave B empty.
   *
   * It respects a declining `onAdd` (`false`) exactly as `gridKeyNav` does, and
   * it is a no-op under `hideAdd`, where the row count is fixed by the caller
   * and an extra row would be wrong rather than helpful.
   */
  seedRow?: boolean;
  /** Offset for the displayed "#" numbers — set to the page offset when the
   *  caller paginates `rows`, so numbering stays global (11, 12… on page 2)
   *  instead of restarting at 1 each page. Defaults to 0. */
  startIndex?: number;
  /** Caption for the totals band, rendered where the "#" would be. Only appears
   *  when at least one column declares a `total`. Defaults to "Total". */
  totalsLabel?: ReactNode;
}) {
  // `onAdd` behind a ref: every caller passes a fresh closure, so depending on it
  // directly would re-run the seed effect on every render. The effect wants to
  // watch `rows.length`, and nothing else.
  const onAddRef = useRef(onAdd);
  useEffect(() => {
    onAddRef.current = onAdd;
  });
  /**
   * Which row shows its fields, when `foldRows` is on.
   *
   * THREE STATES, and the third is why this is not just `string | null`:
   *   - a row key  → that row is open (the operator clicked it)
   *   - `null`     → THE LAST ROW is open. `handleAdd` sets this, because the
   *                  grid never sees the key the caller just minted, so "the
   *                  last one" is how a newly added row names itself.
   *   - `ALL_FOLDED` → nothing is open. The mount state.
   *
   * **A GRID OPENS WITH EVERYTHING FOLDED** (client 2026-08-19, on Combos ▸
   * Structure Details: "instead of open one section the sections should be in
   * closed state, because it's making confusion for the user"). It used to mount
   * at `null`, which resolves to the last row — so a two-structure combo opened
   * with one section expanded and the operator could not tell whether that was a
   * selection, a default, or the only one there was.
   *
   * The sentinel matters: collapsing this back to "null means nothing open"
   * would take `handleAdd` with it, and a structure added by the "+ Add" button
   * would arrive FOLDED — no fields to type into, and nothing for
   * `landOnAddedRow` (AGENTS.md) to put the cursor in. Mounting closed and
   * opening on add are two different questions and need two different values.
   */
  const [openRowKey, setOpenRowKey] = useState<string | null>(defaultOpenKey ?? ALL_FOLDED);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seedRow || hideAdd) return;
    // Rows arrived (seeded, loaded, or typed) — arm for the next empty spell.
    if (rows.length > 0) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    onAddRef.current();
  }, [seedRow, hideAdd, rows.length]);

  const align = { left: "text-left", right: "text-right", center: "text-center" };
  // Optional pagination (no inner scroll). When pageSize is unset we use a huge
  // page so every row lands on a single page (a fixed big number, NOT rows.length
  // — usePagination captures its size once, so a growing grid must not re-page).
  const paginated = !!(pageSize && pageSize > 0);
  const pg = usePagination(rows, paginated ? pageSize! : 1_000_000);
  const offset = (pg.page - 1) * pg.pageSize;
  const view = pg.paged;
  // Add a row, then jump to the (new) last page so the fresh row is visible.
  // Propagates `onAdd`'s answer — a caller that DECLINES (returns false) must
  // reach `gridKeyNav`, or the decline-and-bubble hand-off dies here.
  const handleAdd = () => {
    const added = onAdd();
    if (added === false) return false;
    // The new row is the one being worked on. Clearing the key rather than
    // setting it lets the "last row" fallback name it — the grid never sees the
    // key the caller just minted.
    if (foldRows) setOpenRowKey(null);
    if (paginated) pg.setPage(Number.MAX_SAFE_INTEGER);
    return true;
  };
  /**
   * Four layouts, ONE choice.
   *
   * `forceCards` and `inlineCards` arrived at different times as independent
   * booleans, which made a nonsense combination representable: a caller could
   * ask for the inline rows AND leave the responsive table switched on. The
   * table is only `hidden` BELOW `@lg` (512px of this grid's own inline size),
   * so nothing looked wrong in a narrow column — but at ≥512px both rendered
   * and every row appeared twice, once as a `#`-numbered table row and once as
   * an inline row beneath it. All four Material grids hit exactly that (they
   * were migrated `forceCards` → `inlineCards` and this gate was never
   * updated); it only became visible when the editor surface widened to 1180px
   * and pushed their container past the threshold.
   *
   * Deriving one mode makes that state unrepresentable rather than merely
   * unused. The props stay as they are — they are the public API across ~32
   * screens — but nothing downstream reads them directly any more.
   */
  /** `across="compact"` is the same mode on a fixed track — see the prop. */
  const acrossCompact = across === "compact";

  /** Master-detail, but only once a list of lines has something to list —
   *  see the container below for why one row must not open a pane — UNLESS
   *  the caller opted out of that with `railAlways` (see its own note). */
  const mdActive = masterDetail && (railAlways || rows.length > 1);

  const mode: "across" | "inline" | "cards" | "responsive" = across
    ? "across"
    : inlineCards
      ? "inline"
      : forceCards
        ? "cards"
        : "responsive";

  /**
   * The band appears when a COLUMN asks for one. `blank` is a column saying
   * "nothing goes here", not the grid saying "no band" — otherwise a grid whose
   * only declaration was a `blank` would draw an empty strip.
   *
   * `responsive` mode renders the table's `<tfoot>` and the cards band both, and
   * CSS picks one — the same way it already picks between the two layouts, so
   * exactly one is ever on screen.
   */
  const hasTotals = columns.some((c) => c.total && c.total.kind !== "blank");

  /**
   * THE "+ ADD" BUTTON, HOISTED so it can render in one of two places.
   *
   * `mode !== "across"` because that layout renders its own inside
   * `data-grid-body` — see the `across` prop. Rendering both gives two Adds.
   */
  const addBtn =
    !hideAdd && mode !== "across" ? (
      // `data-row-add` is the marker every key steers by, and it now buys three
      // of them: Tab LANDS here (`isRowAdd`, lib/focus.ts — reversed 2026-08-19,
      // "move to that add button, then on that button need to create"), Enter at
      // the end of the last row moves here rather than adding outright
      // (`ownAddControl`), and Tab into a NESTED grid with no rows yet clicks it
      // (`enterNestedGrid`).
      //
      // This comment used to say "Tab still never LANDS on it; a button is not a
      // field". That was true until 08-19 and is the opposite of the live rule —
      // left standing on the control it governs, which is how a reversal gets
      // quietly reverted by the next reader.
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-row-add
        className={addClassName}
        onClick={handleAdd}
      >
        {addLabel}
      </Button>
    ) : null;

  /**
   * DOES ADD RIDE ON THE TOTALS ROW? (client 2026-08-17, Approval Qty.)
   *
   * A totals band is right-aligned, so its left half is empty — and the Add
   * button sat on a row of its own directly beneath that emptiness, costing a
   * line to say nothing. Pairing them puts Add in the space the totals were
   * already leaving.
   *
   * NOT IN `responsive` MODE, and that is the whole of the care needed here.
   * The totals band lives INSIDE the cards container because that container
   * carries `@lg:hidden` in responsive mode (a band outside it would print
   * alongside the table's own <tfoot> at wide sizes) — so an Add button moved in
   * there would inherit the same hiding and VANISH on a wide screen. It stays
   * outside for that mode.
   *
   * Only two screens in the app declare column totals today (Approval Qty and
   * Budgets) and both are `forceCards`, so this pairs on exactly the grids that
   * asked for it and changes nothing else.
   */
  /**
   * THE ADD RIDES IN THE RAIL — see `railAdd`. Derived here rather than at the
   * two render sites so "which of the three places does this button live in"
   * is answered once: `addInRail` wins, then the totals row, then the foot of
   * the grid. `renderListItem` is in the test because it is what `mdActive`
   * itself gates the rail on — no list renderer, no rail, and an Add put in a
   * rail that does not exist would vanish rather than move.
   */
  const addInRail = mdActive && !!renderListItem && !!addBtn && railAdd;
  const addOnTotalsRow = !!addBtn && !addInRail && hasTotals && mode !== "responsive";
  /** Where the figures start — everything left of it belongs to the label. */
  const firstTotalIndex = columns.findIndex((c) => c.total && c.total.kind !== "blank");

  /**
   * Every caller column has declared a width, so the TABLE CAN HUG ITS CONTENT
   * instead of filling the section.
   *
   * `w-full` is right when the columns are open-ended — a description, a party
   * name — because the slack has to go somewhere and spreading it is the least
   * surprising choice. It is wrong when every column is a short value: a Size
   * grid rendered "S" in a 490px control (client 2026-08-10) purely because it
   * was the only column and inherited all the slack.
   *
   * The declaration is all-or-nothing on purpose. With one column sized and one
   * open, `w-auto` would shrink-wrap the sized one and leave the other to fight
   * for the remainder — a layout that depends on content length, which is the
   * thing a fixed width is chosen to avoid.
   *
   * `w-fit` goes on the SCROLL WRAPPER, never on the `@container` root above:
   * `container-type: inline-size` applies `contain: inline-size`, so a
   * content-sized container query element is a cycle the browser resolves by
   * collapsing it. The root stays parent-sized; only the bordered box hugs.
   *
   * `fill` opts out — see the prop. A grid standing alone should hug; a grid
   * sharing a row with another one has an edge to line up with instead.
   */
  const hugsContent = !fill && columns.length > 0 && columns.every((c) => c.width);

  /**
   * THE CARD HUGS ONLY AT THE WIDTH WHERE THE TABLE IS ACTUALLY SHOWN.
   *
   * `hugsContent` is a statement about the TABLE — every column declares a
   * width, so the box around it should stop at the last column instead of
   * trailing grey. A `responsive` grid does not always render that table: below
   * `tableFrom` it renders the stacked cards instead, and `w-fit` around those
   * is not merely unnecessary, it COLLAPSES THEM.
   *
   * That is the same cycle this file already records one paragraph up, arriving
   * from the other side. A card's `width: fit-content` is computed from the
   * max-content of its children — and `renderMobileRow` usually returns a
   * `FieldGrid`, whose root is `@container/section` and therefore
   * `contain: inline-size`, so it contributes ZERO. The card shrinks past every
   * field in it and settles on the widest thing that is not itself contained:
   * a bare `<Input>`, about 38px. Fabric BOM ▸ Manual showed it exactly so
   * (client 2026-09-03, screenshots 2657-2659) — "Purch. width" wrapping onto
   * two lines above a 38px box, one field per line, in a pane 996px wide.
   *
   * IT NEEDED A 125%-SCALED SCREEN TO APPEAR, which is why it survived review
   * on the machine it was written on: the detail pane is ~1245 device pixels
   * and 996 CSS pixels, so `@6xl` (1152) matches on one desk and not the next.
   * A layout that depends on the reader's display scaling is not a layout.
   *
   * The scroll wrapper below keeps the unconditional `w-fit`: it is `hidden`
   * under the same breakpoint, so it can only hug when it is on screen.
   *
   * `cards`, `inline` and `across` are unchanged — none of them renders a table
   * at any width, so `hugsContent` there is the caller saying "these columns are
   * short" about a layout that has no columns, and it has always meant `w-fit`.
   */
  const cardHug =
    mode === "responsive"
      ? tableFrom
        ? TABLE_FROM[tableFrom].hug
        : narrow
          ? "@md:w-fit"
          : "@lg:w-fit"
      : "w-fit";

  /**
   * The row keys this grid was handed on its FIRST render — the stored rows.
   *
   * A LAZY `useState` INITIALISER, not a ref. Both run once per mount, but a ref
   * read during render is `react-hooks/refs` ("Cannot access refs during
   * render") — the compiler cannot prove the value is stable, and this one is
   * read in all three layout branches. State computed once is legal to read and
   * says the same thing. There is no setter: the snapshot must never be
   * recomputed, or every row would re-lock the instant it was added.
   */
  const [storedKeys] = useState<Set<string>>(() => new Set(rows.map((r) => r.key)));
  /** Withhold the ✕ — and with it Ctrl+Del, which drives that same button. */
  const locked = (row: T) =>
    hideRemove ||
    // The sole survivor keeps no ✕ — see `keepOne`. `rows`, not `view`: with
    // `pageSize` set, page 2 holding one row must not lock it while nine sit on
    // page 1.
    (keepOne && rows.length <= 1) ||
    (lockExisting && storedKeys.has(row.key));
  /**
   * DOES THE TABLE DRAW ITS ✕ COLUMN AT ALL?
   *
   * `locked` is a PER-ROW question and cannot answer this one. The table's
   * trailing cell is emitted unconditionally and only the `<Button>` inside it
   * is gated — deliberately, and the note on the inline track below records
   * why: `lockExisting` withholds the ✕ from SOME rows, so a track that came
   * and went per row would put a stored line and a freshly added one on two
   * different widths.
   *
   * `hideRemove` is not that question. It is stated once for the whole grid and
   * cannot change while the grid is mounted, so every row is locked by
   * construction and the column is empty by construction — 32px and a left
   * border after the last real column, for a button that can never appear.
   * Fabric BOM ▸ Components' colourways grid is the one that showed it: it
   * passes `hideRemove` (a colourway is not a row an operator adds or deletes —
   * `onAddPanel` writes all N), so its table ended on an empty cell hanging off
   * Specification.
   *
   * SO THE GATE IS `hideRemove` AND NOTHING ELSE. `keepOne` and `lockExisting`
   * both stay unconditional: they are row-dependent, and a column appearing the
   * moment a second row is added is the drift this cell was made unconditional
   * to prevent.
   */
  const removeColumn = !hideRemove;

  return (
    // TWO ELEMENTS, TWO JOBS — the outer one is the CONTAINER-QUERY element and
    // nothing else; the inner one is the visible card.
    //
    // They were a single div until 2026-08-11, and that is exactly why a hugging
    // table sat inside a full-width card with a band of empty grey beside it
    // (client, Style ▸ Sizes): `hugsContent` puts `w-fit` on the scroll wrapper
    // and CANNOT put it here, because `container-type: inline-size` implies
    // `contain: inline-size`, so a content-sized container-query element is a
    // cycle the browser resolves by collapsing it. Splitting the two roles lets
    // the card hug while the container stays parent-sized.
    //
    // `narrow`'s cap STAYS ON THE OUTER ELEMENT. The query measures this div, so
    // the cap is what decides table-vs-stacked-cards — see the prop's own note.
    // Moved inward, the container would measure the whole section instead and
    // the layout choice would change silently.
    <div className={cn("@container", narrow && "max-w-lg")}>
      {/* Padding and rhythm are `DetailSection`'s, not this grid's own — they
          were `p-3` / `space-y-3` against the section's `p-2.5
          @2xl/editor:p-2`, so a grid's label and fields sat 4px right of the
          section's above it and nothing down the page shared a left edge.

          `@2xl/editor:` resolves against the NAMED `editor` container on the
          editor pane, so these classes mean here exactly what they meant on the
          old single root. */}
      <div
        /* THIS GRID'S EXTENT, stated once so `ownAddControl` never has to guess
           it. A grid is not one `data-grid-body`: `responsive` mode renders TWO
           — a table and a card list — and CSS shows one. The "+ Add" is a
           sibling of both, at the end of this card. See `ownAddControl` for what
           counting bodies instead of grids cost. */
        data-grid-card
        className={cn(
          "space-y-2 @2xl/editor:space-y-1.5",
          !frameless && GRID_FRAME,
          // The card hugs exactly when the table inside it does, so there is no
          // dead space between the last column and the border. `max-w-full`
          // keeps a table wider than the cap inside the section; the scroll
          // wrapper's own `overflow-x-auto` takes it from there.
          // `cardHug`, not a bare `w-fit` — see its note: below `tableFrom` this
          // card holds stacked cards, and hugging those collapses them.
          hugsContent && cn(cardHug, "max-w-full"),
        )}
      >
        {/* No caption row when there is nothing to put in it. A grid nested inside
            a `DetailSection` that already names it would otherwise draw an empty
            band above its first row.

            `flushRows` suppresses it outright: that mode allows the grid EXACTLY
            ONE band, because a second one puts the first row 14px below the field
            it is supposed to line up with. The `label` is rendered inside that one
            band instead — see the empty-state branch below. */}
        {!flushRows && (label || badge) && (
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
            {badge}
          </div>
        )}

        {/* wide-container table — only in `responsive` mode. The inline layout is
            a REPLACEMENT for this, not a companion to it. */}
        {mode === "responsive" && (
        <div
          className={cn(
            "hidden overflow-x-auto rounded-lg border border-border",
            // See `narrow`: the cap would otherwise push this below @lg and the
            // grid would render as cards. See `wideTable` for the other end —
            // and note @lg is 512px here, not the 1024 the viewport name suggests.
            tableFrom
              ? TABLE_FROM[tableFrom].show
              : narrow
                ? "@md:block"
                : "@lg:block",
            hugsContent && "w-fit max-w-full",
          )}
        >
          <table
            className={cn(
              "border-collapse text-sm",
              // `table-fixed` IS THE HALF THAT MAKES `width` MEAN ANYTHING. Under
              // the default `table-layout: auto` a `<th>` width is a SUGGESTION —
              // the browser still distributes by content and available space, so
              // ten declared columns in a narrow container were all squeezed
              // together and every picker read "— S…" (client 2026-08-11). Fixed
              // layout honours the declarations and lets the table exceed its
              // container, which is what `overflow-x-auto` on the wrapper is for.
              hugsContent ? "w-auto table-fixed" : "w-full min-w-[420px]",
            )}
          >
            <thead>
              {/* WHITE, NOT GREY (client 2026-08-27: "that inside cell for some
                  sections is grey — make it white too"). This is the ONE part of
                  the de-framing round that survives the restore below it: the
                  frames were asked for back, the grey fill was not.

                  The header still separates itself — `border-b` draws the line
                  and `GRID_HEADER_TEXT` keeps the labels darker and a half-step
                  bigger than the cells. The fill was a third signal saying what
                  those two already said, and it read as a panel inside a panel
                  now that the grid has its card back. */}
              <tr className="border-b border-border">
                <th className={cn("w-10 px-2 py-2 text-center", GRID_HEADER_TEXT)}>#</th>
                {columns.map((c, i) => (
                  <th
                    key={i}
                    // The header carries the width for the whole column — a
                    // `<td>` cannot widen past its `<th>` under `border-collapse`,
                    // so declaring it once here is what makes `width` mean
                    // anything in the table layout at all. It was previously read
                    // ONLY by the card layouts, which is why setting it on a table
                    // grid appeared to do nothing.
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      // DARKER AND A HALF-STEP BIGGER than the muted 12px this
                      // was (client, 2026-08-18). On a fourteen-column row of
                      // identical boxes the heading is the ONLY thing telling the
                      // operator which cell they are in — it is not chrome here,
                      // it is the label for every value beneath it, and a muted
                      // grey 12px reads as decoration.
                      "border-l border-border px-2 py-2",
                      GRID_HEADER_TEXT,
                      // See `centerHeaders`: the heading is centred while the
                      // CELLS keep `c.align`, so a column of figures still lines
                      // up on its decimal point.
                      centerHeaders ? "text-center" : align[c.align ?? "left"],
                      c.className,
                    )}
                  >
                    {c.header}
                    {c.required && <span className="ml-0.5 text-danger">*</span>}
                  </th>
                ))}
                {removeColumn && <th className="w-8 border-l border-border" />}
              </tr>
            </thead>
            {/* The handler must sit on the SAME element as `data-grid-body` —
                gridKeyNav takes its grid from `e.currentTarget`. It used to be on
                the <table>, which still worked when the grid was derived from the
                event target, but would now resolve to a node that owns no rows. */}
            <tbody data-grid-body onKeyDown={keyboardNav ? (e) => gridKeyNav(e) : undefined}>
              {view.map((row, localI) => {
                const i = offset + localI;
                return (
                <tr
                  key={row.key}
                  data-grid-row
                  // A ROW HIGHLIGHTS AS A ROW. With every cell drawing its own
                  // box the eye followed the boxes; a hover tint is what makes
                  // fourteen cells read as one line again.
                  className="border-b border-border last:border-0 hover:bg-surface-muted/40"
                >
                  <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{startIndex + i + 1}</td>
                  {columns.map((c, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        // FAINTER GRIDLINE. Full-strength rules between cells are
                        // what makes a data grid look like a 1998 spreadsheet;
                        // they only need to be strong enough to separate columns.
                        "border-l border-border/50 px-1.5 py-1",
                        /**
                         * THE CELL IS THE BOX — the control inside it is not.
                         *
                         * Every cell drew a border AND the input inside drew
                         * another, so a fourteen-column row carried twenty-eight
                         * nested rectangles and the eye spent its time on boxes
                         * instead of values (client, 2026-08-18: "everything
                         * looks so like same"). Dropping the inner border halves
                         * that. It is the shape every modern data grid uses —
                         * borderless at rest, structure from the gridline and the
                         * header — and NOT the heavy-gridline spreadsheet look,
                         * which is what the faded rule above is avoiding.
                         *
                         * ONLY AT REST, and the exclusions are the whole safety
                         * of it:
                         *  - `:focus` keeps its border and ring, so the cell being
                         *    typed in is the one thing that stands out;
                         *  - `.border-danger` is how a duplicate, an invalid GSTIN
                         *    and a rejected picker all render, and a blanket rule
                         *    here would outrank it and silently erase the only
                         *    marking an error has.
                         */
                        "[&_input:not(:focus):not(.border-danger)]:border-transparent",
                        "[&_input:not(:focus):not(.border-danger)]:bg-transparent",
                        align[c.align ?? "left"],
                        c.className,
                      )}
                    >
                      <RequiredScope required={c.required} label={c.header}>
                        {c.cell(row, i)}
                      </RequiredScope>
                    </td>
                  ))}
                  {removeColumn && (
                  <td className="border-l border-border px-1 py-1.5 text-center">
                    {!locked(row) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      // Reached by Ctrl+Del (see `removeRowKey`) and the mouse, not
                      // by Tab — Tab is the typing path and this is an action.
                      //
                      // It carried `tabIndex={-1}` for three days to get that
                      // (2026-08-01). That fixed this component and left the ~22
                      // screens that hand-roll a grid row untouched, which is how
                      // the same report came back. `cycleTab` now targets fields on
                      // every surface, so the marker is all this needs — and being
                      // focusable again keeps it in screen-reader order.
                      data-row-remove
                      className="text-muted-foreground hover:text-danger"
                      onClick={() => onRemove(row)}
                      aria-label="Remove row"
                    >
                      <X className="h-4 w-4 shrink-0" />
                    </Button>
                    )}
                  </td>
                  )}
                </tr>
                );
              })}
            </tbody>
            {/* A SIBLING of <tbody data-grid-body>, so `gridKeyNav` — which is
                bound to that element and takes its grid from `e.currentTarget` —
                never sees a keystroke from here, and `ownDescendants` never counts
                this as a row. It has to be inside the same <table> to inherit the
                <th> widths above it, which is the whole reason totals could not be
                a wrapper around this component. */}
            {/* White, with the header above (2026-08-27). The `border-t-2` is
                what separates a total from the rows it sums — deliberately
                heavier than a row rule — and `font-semibold` is what makes it
                read as a figure. The fill was a third signal. */}
            {hasTotals && (
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  {/* THE LABEL SPANS EVERYTHING BEFORE THE FIRST TOTALLED COLUMN.
                      It used to sit alone in the `#` cell, which is `w-10` — so
                      "Total PO Qty" wrapped to three lines and pushed the band
                      taller than the rows above it (client 2026-08-11). Spanning
                      is also what a totals row is supposed to look like: the label
                      on the left, each figure under the column it totals. */}
                  <td
                    colSpan={1 + Math.max(0, firstTotalIndex)}
                    className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] uppercase tracking-wide text-muted-foreground"
                  >
                    {totalsLabel}
                  </td>
                  {columns.slice(Math.max(0, firstTotalIndex)).map((c, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "border-l border-border px-2 py-1.5 text-sm tabular-nums",
                        align[c.align ?? "left"],
                        c.className,
                      )}
                    >
                      {/* `rows`, not `view` — see ChildGridColumn.total. */}
                      {renderTotal(c.total, rows)}
                    </td>
                  ))}
                  {removeColumn && <td className="border-l border-border" />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        )}

        {/* Inline rows — a flex "table" that survives a half-width column, where a
            real <table> would overflow. Each column keeps its own width, so a
            Mixing % stays a small box instead of stretching and shoving the next
            field onto a second line (client 2026-07-24 #4). */}
        {mode === "across" ? (
          /* ACROSS — one record per grid CELL along `FIELD_TRACK`, wrapping. See
             the `across` prop for why this exists and what each piece is for. */
          <div
            data-grid-body
            className={acrossCompact ? ACROSS_COMPACT_TRACK : FIELD_TRACK}
            onKeyDown={keyboardNav ? (e) => gridKeyNav(e) : undefined}
          >
            {view.map((row, localI) => {
              const i = offset + localI;
              return (
                <div
                  key={row.key}
                  data-grid-row
                  // `items-center`, not `items-start`: a record here is ONE short
                  // control, so there is no two-line cell to tilt the row — the
                  // case `items-start` exists for in the inline layout.
                  // On the compact track the CELL is already 9rem, so there is no
                  // span to take: the item fills the fixed column it was dealt.
                  className={cn("flex items-center gap-1.5", !acrossCompact && FIELD_SPAN.xs)}
                >
                  {columns.map((c, ci) => (
                    <div key={ci} className="min-w-0 flex-1">
                      {/* The cell fills its span, so `flex-1` here rather than a
                          `width` — the SPAN is what fixes the item's size, and a
                          second width inside it would fight the track. Required
                          still arrives per column, exactly as the inline layout
                          does it: this mode renders the columns itself, so a
                          `ChildGridColumn.required` reaches the control only
                          because this wrapper is here (AGENTS.md, "a grid that
                          renders its own row must declare `required` twice"). */}
                      <RequiredScope required={c.required} label={c.header}>
                        {c.cell(row, i)}
                      </RequiredScope>
                    </div>
                  ))}
                  {/* A RESERVED SLOT, for the reason the inline layout's note
                      gives at length: a record that loses its ✕ must not hand
                      the width back to the control beside it, or two records on
                      one track draw their boxes at two different widths.
                      `w-4` is the icon's own width — the button is `px-0` here,
                      unlike the inline layout's `w-8` — so a record that still
                      has its ✕ is unchanged. */}
                  <span className="flex w-4 shrink-0 items-center">
                  {!locked(row) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-row-remove // Ctrl+Del / mouse — see the table layout's note
                      className="shrink-0 px-0 text-muted-foreground hover:text-danger"
                      onClick={() => onRemove(row)}
                      aria-label="Remove row"
                    >
                      <X className="h-4 w-4 shrink-0" />
                    </Button>
                  )}
                  </span>
                </div>
              );
            })}
            {!hideAdd && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-row-add
                /* `justify-self-start` is the part that actually does it, and
                   dropping a width alone would NOT: a grid item's default
                   `justify-self` is STRETCH, so this button fills its column
                   because it IS a grid cell, whatever its own display says. It
                   keeps its column slot so it lines up with the records above,
                   and matches `ChildGrid`'s own Add button everywhere else —
                   `variant="outline" size="sm"`, content width. */
                className={cn(
                  "justify-self-start whitespace-nowrap",
                  !acrossCompact && FIELD_SPAN.xs,
                  addClassName,
                )}
                onClick={handleAdd}
              >
                {addLabel}
              </Button>
            )}
          </div>
        ) : mode === "inline" ? (
          <div
            data-grid-body
            // `flushRows` removes the gap under the header band as well, so the
            // first row starts where a `Field`'s control does. See the prop.
            className={cn(!flushRows && "space-y-1.5")}
            onKeyDown={keyboardNav ? (e) => gridKeyNav(e) : undefined}
          >
            {/* THE ONE BAND, when the grid has no rows to head.
                `view.length > 0` gates the column headers, so an empty inline grid
                used to start with its "+ Add" button flush at 0 while the field
                beside it started at 14 — the same misalignment as a filled grid,
                in the state the operator sees FIRST (client 2026-08-05,
                screenshot 2170). The label fills the slot the headers will take,
                at identical metrics, so the two cells line up before and after the
                first row exists and nothing has to move when it appears. */}
            {flushRows && label && view.length === 0 && (
              <div className={cn("flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground", LABEL_METRICS)}>
                {label}
              </div>
            )}
            {view.length > 0 && (
              <div
                className={cn(
                  "flex items-center gap-2",
                  /**
                   * `LABEL_METRICS` IS THE WHOLE POINT OF FLUSH ROWS — the band is
                   * a column-header row standing in for a label row, so it has to
                   * carry `Label`'s line box AND `Label`'s margin, not numbers that
                   * look like them. doc/ui/LAYOUT.md §6 has always said "the header
                   * band gets `Label`'s exact metrics"; it said so while this line
                   * read `leading-[14px] mb-1.5`, which was 8px out at the density
                   * every desktop editor runs at (client 2026-08-17, screenshot
                   * 2316 — Style ▸ Sizes drew its first size box 8px below the
                   * Description textarea beside it).
                   *
                   * BOTH HALVES OF THE OLD VALUE WERE WRONG, and neither in a way
                   * reading this line could show:
                   *
                   *   `mb-1.5` (6px) was reasoned against a label carrying
                   *   `mb-0.5`, but under `@2xl/editor` — this component's own
                   *   compact density, so ALWAYS on the surfaces that use
                   *   `flushRows` — `Label` is `mb-0`. 6px too many.
                   *
                   *   `leading-[14px]` never applied to anything. It sat on this
                   *   FLEX PARENT while each header cell below carries `text-xs`,
                   *   whose own 1rem line-height wins on the child; with
                   *   `items-center` the band's height is the tallest child, so the
                   *   band was 16px. Hence `leading-[inherit]` on the cells — the
                   *   fix is not to retype 14px there, it is to let the metric
                   *   arrive from one place. 2px more.
                   *
                   * `px-2 pb-0.5` is the ordinary inline band and is unchanged; it
                   * would put a flush band at 18px and shift the headers 2px right
                   * of their own cells.
                   */
                  flushRows ? LABEL_METRICS : "px-2 pb-0.5",
                )}
              >
                {!hideIndex && <span className="w-4 shrink-0" />}
                {columns.map((c, ci) => (
                  <div
                    key={ci}
                    className={cn(
                      // `leading-[inherit]` so the BAND decides the line box: see
                      // the note above — `text-xs` would otherwise re-set it to
                      // 16px and silently outvote `LABEL_METRICS`.
                      "min-w-0 text-xs font-semibold leading-[inherit] text-muted-foreground",
                      c.width ? "shrink-0" : "flex-1",
                      align[c.align ?? "left"],
                    )}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    {c.header}
                    {c.required && <span className="ml-0.5 text-danger">*</span>}
                  </div>
                ))}
                <span className="w-8 shrink-0" />
              </div>
            )}
            {view.map((row, localI) => {
              const i = offset + localI;
              return (
              <div
                key={row.key}
                data-grid-row
                className={cn(
                  // `items-start`, NOT `items-center` — a cell that stacks a hint
                  // under its control (the Style pickers on Order Amendment print
                  // the picked line's Article No beneath the box) is taller than
                  // its neighbours, and centring made EVERY OTHER control in the
                  // row drop by half that difference. One two-line cell tilted the
                  // whole row (client 2026-08-12, screenshot 2264).
                  //
                  // Aligning the tops is only half of it: a cell holding nothing
                  // but text would then sit at the row's ceiling instead of level
                  // with the boxes beside it. So the CELL centres its own content
                  // inside one control's height (below) and the row aligns those
                  // slots — short cells stay centred exactly as they were, and a
                  // tall one grows downwards instead of pushing its row about.
                  "flex items-start gap-2",
                  flushRows
                    ? // No card inset: the row's own controls draw the boxes, so
                      // the first one sits level with a `Field` beside it. Rows
                      // stay separable by a rule rather than by a border each.
                      // `localI === 0` rather than `first:` — the header band is a
                      // sibling in this container, so `first:` would match IT.
                      cn("border-b border-border pb-1.5 last:border-b-0", localI > 0 && "pt-1.5")
                    : "rounded-md border border-border p-1.5",
                )}
              >
                {/* The index and the ✕ belong to the row's CONTROL LINE, not to
                    its full height — on a row carrying a two-line cell, centring
                    them against the whole thing left the number floating below
                    the boxes it counts. `min-h-*` matches the control heights the
                    field primitives use (`h-9`, `@2xl/editor:h-8`), so a row of
                    plain text keeps the height the ✕ already gave it. */}
                {!hideIndex && (
                <span className="flex min-h-9 w-4 shrink-0 items-center justify-center text-xs text-muted-foreground @2xl/editor:min-h-8">
                  {startIndex + i + 1}
                </span>
                )}
                {columns.map((c, ci) => (
                  <div
                    key={ci}
                    className={cn(
                      // One control's height, content centred in it: a bare
                      // figure or label lines up with the boxes beside it (the
                      // derived Qty columns on Order Amendment), while a cell
                      // that needs two lines simply gets taller. `[&>button]:w-fit`
                      // undoes the stretch a flex column would otherwise put on
                      // an auto-width child — a [Detail] / [Process] button in a
                      // cell keeps the width it draws itself.
                      "flex min-h-9 min-w-0 flex-col justify-center @2xl/editor:min-h-8 [&>button]:w-fit",
                      c.width ? "shrink-0" : "flex-1",
                      c.className,
                    )}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    <RequiredScope required={c.required} label={c.header}>
                      {c.cell(row, i)}
                    </RequiredScope>
                  </div>
                ))}
                {/* THE TRACK IS UNCONDITIONAL; ONLY THE BUTTON INSIDE IT COMES
                    AND GOES — the same shape the table layout has always had,
                    where the `<td>` is always emitted and only the `<Button>` is
                    gated.

                    IT WAS THE WHOLE `<span>` THAT WAS GATED, and that is a
                    layout bug rather than a tidy-up. The header band and the
                    totals row below both reserve `w-8` unconditionally, so a
                    row with no ✕ handed 32px + an 8px gap back to its `flex-1`
                    columns and drew them 40px wider than the header above and
                    than every unlocked row beside it. `lockExisting` withholds
                    the ✕ PER ROW, so on the five grids that combine it with
                    `inlineCards` (Material ▸ Mixing / Composition, Composition
                    master, Size Group, Category) a STORED line and a freshly
                    added one sat on two different tracks — the fields
                    "misaligning and drifting" after a row is added or deleted.

                    `w-8` on the span reproduces the button's own width exactly,
                    so nothing moves on a row that still has its ✕. */}
                <span className="flex min-h-9 w-8 shrink-0 items-center @2xl/editor:min-h-8">
                  {!locked(row) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-row-remove // Ctrl+Del / mouse — see the note on the table layout above
                    className="w-8 shrink-0 px-0 text-muted-foreground hover:text-danger"
                    onClick={() => onRemove(row)}
                    aria-label="Remove row"
                  >
                    <X className="h-4 w-4 shrink-0" />
                  </Button>
                  )}
                </span>
              </div>
              );
            })}
            {/* Mirrors the header band's track exactly — same `w-4` index spacer,
                same `shrink-0`/`flex-1` per column, same `w-8` trailing spacer —
                or the figures do not sit under the columns they total. No
                `data-grid-row` and no control inside, so it stays off both the
                arrow axis and the Tab path. */}
            {hasTotals && (
              <div className="flex items-center gap-2 border-t-2 border-border pt-1.5 font-semibold">
                {/* GATED WITH THE OTHER TWO TRACKS, because mirroring the header
                    band is the whole job of this row: leave the spacer standing
                    under `hideIndex` and every figure sits 24px right of the
                    column it totals. `totalsLabel` has nowhere to go here as a
                    result — see the prop's note. */}
                {!hideIndex && (
                <span className="w-4 shrink-0 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                  {totalsLabel}
                </span>
                )}
                {columns.map((c, ci) => (
                  <div
                    key={ci}
                    className={cn(
                      "min-w-0 text-sm tabular-nums",
                      c.width ? "shrink-0" : "flex-1",
                      align[c.align ?? "left"],
                    )}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    {renderTotal(c.total, rows)}
                  </div>
                ))}
                <span className="w-8 shrink-0" />
              </div>
            )}
          </div>
        ) : (
        /* stacked row-cards — the whole grid in `cards` mode, and the narrow half
            of `responsive` mode (hence `@lg:hidden`, the partner to the table's
            `hidden @lg:block`). Carries the same keyboard nav as the table:
            where these ARE the grid, binding nav only to the table left arrow
            keys dead. */
        <div
          data-grid-body
          className={cn(
            /* NO `divide-y` HERE — the rule between rows is drawn BY the row
               (`border-t` on every row after the first, below). Tailwind's
               `divide-y` is `& > :not(:last-child)`, so it hangs the rule off
               the row's BOTTOM edge: with a totals band as the last child, the
               last row stopped being last and grew a border under it — a grey
               line across the section directly above "+ Add quantity" (client
               2026-08-18, screenshots 2345 · 2346). Drawing it on the row's TOP
               instead cannot paint a trailing edge, whatever follows the rows. */
            listRows || flatRows ? undefined : "space-y-2",
            /* `tableFrom` is the caller-declared breakpoint at which the table
               takes over; it falls back to the `narrow` pair when unset. Merged
               with the rule above rather than replacing it — the two answer
               different questions (WHICH rule between rows, and AT WHAT WIDTH
               the cards give way), and an earlier resolution that took one side
               whole would have silently reverted the other's fix. */
            mode === "responsive" &&
              (tableFrom
                ? TABLE_FROM[tableFrom].hide
                : narrow
                  ? "@md:hidden"
                  : "@lg:hidden"),
            /* TWO PANES, AND ONLY ON A WIDE SURFACE. Below the breakpoint the
               grid falls back to exactly what it does today — list above, open
               row beneath — because a 268px column beside a form is a phone
               showing two things badly. `space-y-0` undoes the stacking rhythm:
               the panes are columns now, and the gap between them is a border. */
            /* `rows.length > 1`: A LIST OF ONE IS NOT A LIST. On a new document
               there is exactly one blank line, and the pane stood there 268px
               wide holding the words "Not filled in" and half a screen of
               nothing (client 2026-08-20, screenshot 2404: "while opening it is
               still a mess"). The grid already draws this distinction one prop
               along — `folded` carries `rows.length > 1` for the same reason,
               "a single row never folds, there is no next item to move on to".
               The pane appears with the second material and is never seen
               before it earns its width. */
            /* `gap-x-5`: THE BORDER IS NOT A GUTTER. With `gap-0` the detail
               pane's first label started against the list's right edge, so the
               two panes touched and the rule between them read as a seam in one
               surface rather than as a space between two (client 2026-08-20,
               "add gap between that separation left and right split screen").
               20px after the border is what lets each pane have an edge. */
            mdActive && "md:grid md:gap-x-5 md:gap-y-0 md:space-y-0",
            /* STATIC LITERALS, both of them, never `md:grid-cols-[${w}px_...]`:
               Tailwind v4 scans source TEXT, so an interpolated track compiles to
               no CSS at all and the rail would silently stack instead of sitting
               beside the pane. The same warning `FIELD_TRACK` carries. */
            /* A CSS VARIABLE, NOT AN INTERPOLATED CLASS. `railWidthPx` is a
               runtime number a caller supplies, and Tailwind v4 scans SOURCE
               TEXT — a template literal built from a prop compiles to no CSS
               at all, the same trap this file already names for `${w}px`
               above. `md:grid-cols-[var(--rail-w)_minmax(0,1fr)]` is the
               fixed literal Tailwind sees; only the VALUE the variable holds
               changes, set below as an inline style, which has no scanning
               step to defeat. */
            mdActive && "md:grid-cols-[var(--rail-w)_minmax(0,1fr)]",
          )}
          style={mdActive ? ({ "--rail-w": `${railWidthPx ?? 268}px` } as CSSProperties) : undefined}
          onKeyDown={keyboardNav ? (e) => gridKeyNav(e) : undefined}
        >
          {mdActive && renderListItem && (
            /* THE RAIL COLUMN — the scrolling list, and under it the "+ Add"
               when `railAdd` is set. The pane's own chrome (its ground, its
               height cap and the rule between the two panes) lives on THIS
               element rather than on the list, so the button sits inside the
               pane instead of below it and the list scrolls under a button
               that stays put.

               THE WRAPPER IS SAFE TO ADD and `data-md-list`'s own note below
               says so in advance: its entries are found within that element
               rather than off `el.parentElement`, "so wrapping the pane in
               another div later cannot quietly break ↑↓". This is that later.

               IT IS ALSO THE ONLY PLACE THE BUTTON CAN GO. Nested inside
               `data-md-list` it would inherit that element's
               `data-focus-optional` through `isOffTabPath`'s `closest` and
               stop being a Tab stop — see `railAdd`. */
            /* A GROUND OF ITS OWN, and this is what makes it read as a pane
               rather than as a stray vertical rule. Both halves were
               `bg-surface`, so the border between them was the only thing
               saying there were two of anything — and below the last line it
               ran on down an empty white column (client 2026-08-20, screenshot
               2406, "that separate item and table look not good"). Tinting the
               list is what turns that emptiness into the bottom of a pane —
               which is why `railBg` is an opt-OUT: a caller that takes it is
               saying its rail does not need the box, not that the box was
               wrong. It is stated on the WRAPPER rather than on the list
               because the "+ Add" sits in here too, and a tint that stopped at
               the last entry would leave the button on a ground of its own. */
            <div
              className={cn(
                "flex flex-col border-border md:max-h-[560px] md:overflow-hidden md:border-r",
                railBg && "bg-surface-muted/60",
              )}>
            <div
              /* THE SCOPE `mdListKeyNav` WALKS. Its entries are found within this
                 element rather than off `el.parentElement`, so wrapping the pane
                 in another div later cannot quietly break ↑↓. */
              data-md-list
              /**
               * OFF THE TYPING PATH, ON THE ARROW PATH — ONE DECLARATION FOR THE
               * WHOLE PANE (`isOffTabPath` reads `closest`, so every entry
               * inherits it).
               *
               * This is the marker `lib/focus.ts` documents for exactly this
               * case, and its note names the mistake this pane was making:
               * "NOT `tabindex="-1"`, which is the obvious reach and the wrong
               * one — `FOCUSABLE_SELECTOR` excludes it … so the control would go
               * mouse-only. These operators are keyboard-only." Twenty entries on
               * the Tab path would put nineteen stops between one field and the
               * next, which is why the old comment here reached for `-1`; the
               * marker gets that same result without the mouse-only half.
               */
              data-focus-optional
              /* THE GROUND AND THE CAP MOVED UP to the rail column above —
                 `railBg`'s tint with them, onto the element that also holds the
                 "+ Add", so opting out of the tint takes the whole pane rather
                 than just the part of it the entries fill. What stays here is
                 the scrolling itself. `min-h-0` is what lets a flex child
                 actually scroll instead of growing past its parent's cap —
                 without it the list would push the "+ Add" out of the pane at
                 exactly the row count that makes an Add most useful. */
              className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {view.map((row, localI) => {
                const i = offset + localI;
                const isOpen =
                  row.key === (openRowKey ?? rows[rows.length - 1]?.key ?? null);
                return (
                  <button
                    key={row.key}
                    type="button"
                    /**
                     * ROVING TABINDEX — THE OPEN ENTRY IS THE PANE'S ONE STOP.
                     *
                     * Still not a Tab stop: Tab moves between FIELDS (AGENTS.md),
                     * and `data-focus-optional` on the pane is what holds that
                     * line. This is about the ARROW path, which reads
                     * `FOCUSABLE_SELECTOR` — a list where every entry is
                     * `tabindex="-1"` is invisible to it, and that is why the rail
                     * was mouse-only (client 2026-09-02). The comment that stood
                     * here claimed "the arrow keys and a screen reader all still
                     * reach it"; nothing did.
                     *
                     * ONE STOP, NOT TWENTY, and the arithmetic is the point — the
                     * objection that put `-1` on every entry was nineteen stops
                     * between one field and the next. Roving leaves a single
                     * entry, the one the operator is already working in, so even
                     * on a surface where the contract does NOT claim Tab the pane
                     * costs one stop rather than a screenful. ↑↓ still reach the
                     * other entries: `mdListKeyNav` focuses them directly, and
                     * `.focus()` does not care about `tabindex="-1"`.
                     */
                    tabIndex={isOpen ? 0 : -1}
                    onKeyDown={mdListKeyNav}
                    /* A styling hook, same family as `data-skin` — and, since
                       2026-09-02, the axis `mdListKeyNav` walks with ↑↓, so it is
                       no longer inert and must stay on every entry.
                       `aria-current` marks only the OPEN row, so a skin that wants
                       to draw every entry in this list has nothing to select on
                       without it. */
                    data-md-list-item=""
                    aria-current={isOpen ? "true" : undefined}
                    onClick={() => {
                      setOpenRowKey(row.key);
                      onOpenRow?.(row, i);
                    }}
                    className={cn(
                      "w-full border-b border-l-[3px] border-b-border text-left transition-colors last:border-b-0",
                      /* The rail's own density — see `railCompact`. The 3px left
                         border and the bottom rule are the SELECTION and the
                         separator, so neither varies with it. */
                      railCompact ? "px-2.5 py-1" : "px-3 py-2",
                      /**
                       * ONE MARK, ON THE ENTRY THE ARROWS ARE STANDING ON
                       * (client 2026-09-02, in three steps — and the middle one
                       * is written down here because it was tried and rejected,
                       * not because it was wrong on paper).
                       *
                       * FIRST the rail showed TWO blue entries at once. The two
                       * cues were the same colour by coincidence, not by design,
                       * and nothing in this file drew the second: the open entry
                       * paints `--primary` (`border-l-primary`, plus the skin's
                       * `[aria-current="true"]` inset ring), while the focused
                       * entry got `outline: 2px solid var(--ring)` from the
                       * `@layer base` focus floor in `app/globals.css` — and
                       * `--ring` is defined as the same hex, commented "matches
                       * --primary". Once ↑↓ could move focus off the open entry,
                       * the list showed two identical marks and no way to tell
                       * which one Enter would act on.
                       *
                       * THEN focus was given a dashed foreground outline to tell
                       * the two apart. It worked and the client rejected it: a
                       * black dashed box is a second visual language in a list
                       * that already says everything in blue, and it still left
                       * two entries marked.
                       *
                       * SO THE SELECTION NOW FOLLOWS THE ARROWS (see
                       * `mdListKeyNav`), and the styling below is the whole of
                       * the answer: `isOpen` is true for exactly one entry, so
                       * exactly one entry is blue, and no entry can be marked
                       * without being the one on screen.
                       *
                       * `outline-none` IS SAFE HERE AND NOWHERE NEAR A DEFAULT.
                       * `app/globals.css` treats suppressing focus without
                       * replacing it as a bug — it names the three files that did
                       * and says they were fixed at source. This replaces it: an
                       * entry cannot hold focus without also being the open one,
                       * so the blue left border, the surface fill and the skin's
                       * ring ARE the focus indicator. Restore the outline the
                       * moment focus and selection can come apart again.
                       *
                       * A UTILITY BEATS THE FLOOR WITHOUT `!important` — the
                       * floor sits in `@layer base` precisely so a control that
                       * expresses its own focus style wins (see its comment), and
                       * Tailwind's utilities layer is declared after base, so this
                       * needs no specificity trick to hold.
                       */
                      "focus-visible:outline-none",
                      isOpen
                        ? "border-l-primary bg-surface"
                        : "border-l-transparent hover:bg-surface-muted",
                    )}
                  >
                    {renderListItem(row, i)}
                  </button>
                );
              })}
            </div>
            {addInRail && (
              /* SEPARATED BY A RULE, NOT BY A GAP. The entries run edge to edge
                 down the pane, so a button floating in whitespace under them
                 would read as a third thing; a border makes it the foot of the
                 list. `shrink-0` keeps it at its own height while the list
                 above takes the slack. */
              <div className="shrink-0 border-t border-border p-1.5">{addBtn}</div>
            )}
            </div>
          )}
          {view.map((row, localI) => {
            const i = offset + localI;
            /**
             * OPEN = the row being worked on. `openRowKey` unset resolves to the
             * LAST row, which is why `handleAdd` clears it rather than tracking
             * the new key: the grid does not mint row keys, the caller does, and
             * falling back to "the last one" needs no key at all.
             *
             * A SINGLE ROW NEVER FOLDS — there is no next item to move on to.
             */
            const folded =
              foldRows &&
              !!renderFoldedRow &&
              rows.length > 1 &&
              row.key !== (openRowKey ?? rows[rows.length - 1]?.key ?? null) &&
              (canFold ? canFold(row) : true);

            /* THE FOLDED ROWS ARE THE LIST PANE ABOVE, so they do not render a
               second time here. Returning null rather than filtering `view`
               keeps `localI` — and so `i`, which the caller's cells index by —
               pointing at the real position in the array. */
            if (mdActive && folded) return null;
            /**
             * WHAT THE CARD'S HEADER BAND HAS TO SAY — and whether it has
             * anything at all (client 2026-08-17, screenshot 2332: "remove that
             * #1, #2, all this kind of numbering, making huge UI gap").
             *
             * THE ORDINAL IS GONE FROM THIS MODE. A card is not a table row: its
             * fields are stacked and labelled, so nothing here is identified by
             * position the way "row 3" identifies a line of eight columns. It was
             * decorative, nothing read it back (no message in this app names a row
             * by number, and `sno` is written from the array index at save), and
             * on a grid with no summary it was the ONLY content of a 32px band —
             * a whole line per row spent printing a number. That is the gap the
             * client is pointing at, and it is the same reasoning `hideIndex`
             * states for inline mode, arrived at from the other direction.
             *
             * SO THE BAND IS NOW CONDITIONAL, and this is the half that removes
             * the space rather than merely the digits: with a `rowSummary` the
             * band still earns its line (it names the row — "Circular Knit"), and
             * with none there is no line at all, only the ✕ floated into the
             * card's own corner. Removing the number while keeping the band would
             * have answered the client's words and not their complaint.
             */
            // `!listRows &&` first: in list mode the ROW draws its own header, so
            // calling the caller's summary here would be work whose result is
            // thrown away on every render of every row.
            const summary = !listRows && rowSummary ? rowSummary(row, i) : null;
            const bandLine = !!summary;
            const cornerRemove = !listRows && !summary && !locked(row);
            return (
            <div
              key={row.key}
              data-grid-row
              /**
               * `data-row-box` is INERT and kept on purpose. It was the opt-out
               * from the `--row-active` row wash, narrowed twice — first to
               * rows that draw a card (client 2026-08-18, screenshot 2338
               * "some sections have this grey bg"), then to every cards-family
               * row (2343, Quantities) — before the client removed the wash
               * from the whole application rather than from one more place.
               *
               * It stays because it costs nothing and it is the answer already
               * worked out for the shape: a row laid out as a PANEL OF FIELDS
               * must never take a full-row fill, whatever that fill is for.
               * `app/globals.css` says what to do if the cue ever returns.
               */
              data-row-box=""
              className={cn(
                "space-y-2",
                // `py-2` only — no horizontal padding, so a flat row's fields keep
                // the grid's own left edge and line up with the sections above it.
                /**
                 * `py-3`, NOT `py-2` (client 2026-08-19, screenshot 2379).
                 *
                 * A record's own fields sit 8px apart (`FieldGrid`'s `gap-y-2`),
                 * so at `py-2` the gap BETWEEN two records was 16px against 8px
                 * WITHIN one — a ratio of two, which the eye does not read as a
                 * boundary. At `py-3` it is 24px against 8px, and proximity does
                 * most of the grouping before any line is drawn at all.
                 *
                 * This is the cheapest cue available and the only one that adds
                 * no ink: a fill is closed (the row tint was removed app-wide on
                 * 2026-08-18) and a box per row is closed (the client asked for
                 * one frame, which is why `flatRows` exists). 8px per record is
                 * the price, paid once per row rather than per field.
                 */
                listRows || flatRows
                  ? "py-3 first:pt-0 last:pb-0"
                  : "rounded-lg border border-border p-2.5",
                /**
                 * The divider, owned by the row that needs one — see the
                 * container. `localI` is the index on the PAGE, so the first row
                 * the operator can see never carries a rule above it.
                 *
                 * `border-strong`, NOT `border-border`: this line says "a new
                 * record starts here" and it was being drawn in the same token
                 * and the same 1px as an <Input>'s own edge, so it carried no
                 * more weight than field chrome. A boundary BETWEEN records has
                 * to outrank the boundaries WITHIN one, or there is nothing for
                 * the eye to parse. See `--border-strong` in app/globals.css for
                 * why "stronger" is not "darker".
                 */
                /* `border-t-2`, not `border-t` (client 2026-08-19, second
                   report: still invisible at 1px). WEIGHT is the half colour
                   cannot carry on its own — a 1px line reads as chrome whatever
                   its shade, because every field edge on the screen is also 1px.
                   Two pixels is a different KIND of line, which is what "a new
                   record starts here" has to be. */
                /* `!masterDetail`: that rule separates one record from the
                   NEXT one, and in the detail pane there is only ever one. Its
                   `localI > 0` would draw a stray line above whichever row
                   happened to be open. */
                !mdActive &&
                  (listRows || flatRows) &&
                  localI > 0 &&
                  "border-t-2 border-border-strong",
                // Only when the ✕ floats: `relative` to hang it on, and room on
                // the right so the last field's LABEL does not run under it. A
                // banded card needs neither — its ✕ is in the flow.
                cornerRemove && "relative pr-10",
                // A folded row reads as one thing you can open, and says so.
                folded && "cursor-pointer hover:bg-surface-muted",
              )}
              title={folded ? "Open this row" : undefined}
              /* FOCUS OPENS IT, which is what keeps the fold keyboard-operable:
                 Tab out of one row lands on the next row's remaining field and
                 the row unfolds around the cursor. `onFocus` bubbles, so one
                 handler catches the mouse and the keyboard. */
              /* ANY ROW CLAIMS THE FOLD, not just a folded one (client
                 2026-08-18: "if the user moved to next structure details, close
                 the first one automatically").
                 
                 `folded ? …` was the whole bug. A row that CANNOT fold —
                 `canFold` refuses a structure with nothing picked yet, and a
                 blank row is exactly the one an operator moves to next — got no
                 handler at all, so focusing it left `openRowKey` pointing at the
                 row behind. Two rows stood open, which is the state "one open at
                 a time" exists to prevent, and it appeared precisely when the
                 operator started the second one.
                 
                 The functional update is what keeps this free: re-focusing
                 inside the row already open returns the same key, so React
                 bails out instead of re-rendering the grid on every Tab. */
              onFocus={
                foldRows && renderFoldedRow
                  ? () => setOpenRowKey((k) => (k === row.key ? k : row.key))
                  : undefined
              }
              /* AND A CLICK ANYWHERE, minus buttons: the row's own ✕ is inside
                 this handler's reach, and unfolding a row on the way to deleting
                 it is a flicker with no purpose. */
              onClick={
                folded
                  ? (e) => {
                      if ((e.target as HTMLElement).closest("button")) return;
                      setOpenRowKey(row.key);
                    }
                  : undefined
              }
            >
              {bandLine && (
                /* `ml-auto` on the remove button, not `justify-between` on the
                   row: the summary is the row's name and the ✕ is an action on
                   it, so the name stays left and the action goes to the edge. */
                <div className="flex items-center gap-2">
                  <Truncated className="text-sm font-medium text-foreground">{summary}</Truncated>
                  {!locked(row) && (
                    <Button type="button" variant="ghost" size="sm" data-row-remove className="ml-auto shrink-0 text-muted-foreground hover:text-danger" onClick={() => onRemove(row)} aria-label="Remove row">
                      <X className="h-4 w-4 shrink-0" />
                    </Button>
                  )}
                </div>
              )}
              {cornerRemove && (
                /* THE SAME BUTTON, OUT OF THE FLOW — not a second one and not a
                   lesser one. `data-row-remove` is what Ctrl+Del drives and the
                   `aria-label` is what a screen reader reads, so both come with
                   it; only the line it used to stand on is gone. */
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-row-remove
                  className="absolute right-1 top-1 text-muted-foreground hover:text-danger"
                  onClick={() => onRemove(row)}
                  aria-label="Remove row"
                >
                  <X className="h-4 w-4 shrink-0" />
                </Button>
              )}
              {folded ? (
                renderFoldedRow!(row, i)
              ) : renderMobileRow ? renderMobileRow(row, i) : columns.map((c, ci) => (
                      <div key={ci}>
                        <RequiredScope required={c.required} label={c.header}>
                          {c.cell(row, i)}
                        </RequiredScope>
                      </div>
                    ))}
            </div>
            );
          })}
          {/* Cards stack their columns, so there is nothing to sit a figure UNDER
              — a column-aligned band here would align with nothing. One labelled
              summary row after the last card instead, and one for the whole list
              rather than one per card (a per-card total is the card).

              It lives INSIDE this container on purpose: in `responsive` mode the
              container is what carries `@lg:hidden`, so a band outside it would
              render alongside the table's <tfoot> at wide sizes. */}
          {hasTotals && (
            /* NO RULE ABOVE THE TOTALS (client 2026-08-18, screenshots 2345 ·
               2346: "above of the add quantity i can see the grey line remove
               it", and the same on Approval Qty). `border-t-2 border-border` was
               a table's `<tfoot>` habit carried onto a card stack, where it does
               not read as "figures below the line" — the band holds the "+ Add"
               button as its left half, so the rule drew a full-width line above
               a BUTTON. `pt-2` still sets it apart, and the labels are already
               uppercase-muted against a bold figure.

               The table's own <tfoot> and the inline band keep theirs: there the
               figures really do sit under columns of numbers. */
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-2">
              {/* The empty left half of a right-aligned totals row — Add takes it
                  when it can, and an empty span holds the `justify-between` apart
                  when it cannot, so the figures stay right-aligned either way. */}
              {addOnTotalsRow ? addBtn : <span />}
              <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
              {columns
                .filter((c) => c.total && c.total.kind !== "blank")
                .map((c, ci) => (
                  <span key={ci} className="flex items-baseline gap-1.5">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {c.header}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {renderTotal(c.total, rows)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {/* `pageCount > 1`, not just `paginated`. doc/ui/LAYOUT.md §6 says the
            pager "self-hides when everything fits", and it half did: PaginationBar
            drops its NAV buttons at one page but still prints the count, so a grid
            holding a single row rendered "1–1 of 1" — a line of chrome explaining
            that the one visible row is the one visible row (client 2026-08-04).
            Its own self-hide only fires at `total === 0`, which is the empty state
            this never reaches. Makes the documented behaviour true. */}
        {paginated && pg.pageCount > 1 && (
          <PaginationBar
            page={pg.page}
            pageCount={pg.pageCount}
            total={pg.total}
            pageSize={pg.pageSize}
            onPageChange={pg.setPage}
          />
        )}

        {/* Below the grid unless it is riding the totals row or sitting in the
            rail — see `addOnTotalsRow` and `addInRail`. Rendered in exactly one
            of the three places. */}
        {!addOnTotalsRow && !addInRail && addBtn}
      </div>
    </div>
  );
}
