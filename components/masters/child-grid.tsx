"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequiredScope } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { PaginationBar } from "@/components/ui/pagination";
import { usePagination } from "@/lib/use-pagination";
import { atCaretEdge, focusField, isOffTabPath } from "@/lib/focus";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

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
 */
const ROW_FIELDS =
  'input:not([type="button"]):not([type="hidden"]):not([type="radio"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [data-field-trigger]:not([disabled])';

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
const NO_ADD = () => false;

// `focusField` (lib/focus.ts) focuses a cell and puts the caret at the end, so
// typing appends rather than overwrites — and so ←/→ can leave the cell on the
// first press. It was duplicated here; one copy now, shared with the provider.

/** Direct descendants only — a nested ChildGrid must not steal the outer one's rows. */
function ownDescendants(scope: HTMLElement, selector: string, boundary: string): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.closest(boundary) === scope,
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
  return Array.from(row.querySelectorAll<HTMLElement>(ROW_FIELDS));
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
    const add = scope.querySelector<HTMLElement>(ROW_ADD);
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
  const step = (from: HTMLElement[], at: number) => {
    for (let i = at + dir; i >= 0 && i < from.length; i += dir) {
      if (!isOffTabPath(from[i])) return from[i];
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
  }
  e.preventDefault();
  e.stopPropagation();
  focusField(target);
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
export function gridKeyNav(
  e: React.KeyboardEvent<HTMLElement>,
  /**
   * Add a row. **Return `false` to decline** — the grid then leaves the key
   * alone so it reaches the parent grid (or the provider). Returning nothing
   * means "handled", which is what every existing caller does.
   */
  addRow: () => boolean | void,
) {
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
    focusField(next);
    return true;
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
    if (!fromChildGrid && isTrigger && el.getAttribute("data-field-empty") !== "false") return;
    // ASK FIRST, THEN CLAIM THE KEY. A grid that cannot grow right now must
    // DECLINE, so Enter carries on up to the parent grid — the same
    // decline-and-bubble hand-off the `e.currentTarget` note above exists for.
    //
    // This is what "Enter Enter starts the next attribute" is built on. The
    // Material Attribute values list refuses to add after a blank value (there
    // is nothing to add until the row already there has been typed into), but
    // `preventDefault` used to fire BEFORE `addRow` was called — so the refusal
    // was invisible and Enter simply died in the empty box. A keyboard operator
    // inside a nested list had no key that meant "done here, next parent row"
    // (client 2026-08-04).
    //
    // Order matters: `addRow()` runs before `preventDefault`, so a caller that
    // returns nothing (every pre-existing one) behaves exactly as before.
    if (addRow() === false) return;
    e.preventDefault();
    e.stopPropagation();
    window.setTimeout(() => {
      const fresh = ownDescendants(body, "[data-grid-row]", "[data-grid-body]");
      focusColIn(fresh[fresh.length - 1]);
    }, 30);
  }
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
  renderMobileRow,
  pageSize,
  forceCards = false,
  frameless = false,
  keyboardNav = true,
  hideAdd = false,
  narrow = false,
  lockExisting = false,
  inlineCards = false,
  fill = false,
  flushRows = false,
  listRows = false,
  rowSummary,
  foldRows = false,
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
  /** One flex row per record with a single shared header, honouring each
   *  column's `width`. Use instead of `forceCards` for grids of narrow fields
   *  (Mixing %, Shade) that shouldn't stack. Ignores `renderMobileRow`. */
  inlineCards?: boolean;
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
   * OPT-IN, because eight call sites across five screens use `inlineCards` and
   * only this one shares its row. It is the same argument `listRows` below makes
   * ("a card inside a card"), for the case where the neighbour is a field.
   *
   * No effect outside inline mode.
   */
  flushRows?: boolean;
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
  /** Which row shows its fields, when `foldRows` is on. Null = the last row. */
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
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
  const addFn = hideAdd ? NO_ADD : handleAdd;
  /**
   * Three layouts, ONE choice.
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
  const mode: "inline" | "cards" | "responsive" = inlineCards
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
  const locked = (row: T) => lockExisting && storedKeys.has(row.key);

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
        className={cn(
          "space-y-2 @2xl/editor:space-y-1.5",
          !frameless && "rounded-lg border border-border p-2.5 @2xl/editor:p-2",
          // The card hugs exactly when the table inside it does, so there is no
          // dead space between the last column and the border. `max-w-full`
          // keeps a table wider than the cap inside the section; the scroll
          // wrapper's own `overflow-x-auto` takes it from there.
          hugsContent && "w-fit max-w-full",
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
            // grid would render as cards.
            narrow ? "@md:block" : "@lg:block",
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
              <tr className="border-b border-border bg-surface-muted">
                <th className="w-10 px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">#</th>
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
                      "border-l border-border px-2 py-1.5 text-xs font-semibold text-muted-foreground",
                      align[c.align ?? "left"],
                      c.className,
                    )}
                  >
                    {c.header}
                    {c.required && <span className="ml-0.5 text-danger">*</span>}
                  </th>
                ))}
                <th className="w-8 border-l border-border" />
              </tr>
            </thead>
            {/* The handler must sit on the SAME element as `data-grid-body` —
                gridKeyNav takes its grid from `e.currentTarget`. It used to be on
                the <table>, which still worked when the grid was derived from the
                event target, but would now resolve to a node that owns no rows. */}
            <tbody data-grid-body onKeyDown={keyboardNav ? (e) => gridKeyNav(e, addFn) : undefined}>
              {view.map((row, localI) => {
                const i = offset + localI;
                return (
                <tr key={row.key} data-grid-row className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{startIndex + i + 1}</td>
                  {columns.map((c, ci) => (
                    <td key={ci} className={cn("border-l border-border px-2 py-1.5", align[c.align ?? "left"], c.className)}>
                      <RequiredScope required={c.required} label={c.header}>
                        {c.cell(row, i)}
                      </RequiredScope>
                    </td>
                  ))}
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
            {hasTotals && (
              <tfoot className="border-t-2 border-border bg-surface-muted font-semibold">
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
                  <td className="border-l border-border" />
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
        {mode === "inline" ? (
          <div
            data-grid-body
            // `flushRows` removes the gap under the header band as well, so the
            // first row starts where a `Field`'s control does. See the prop.
            className={cn(!flushRows && "space-y-1.5")}
            onKeyDown={keyboardNav ? (e) => gridKeyNav(e, addFn) : undefined}
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
              <div className="flex items-center leading-[14px] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </div>
            )}
            {view.length > 0 && (
              <div
                className={cn(
                  "flex items-center gap-2",
                  // `leading-[14px]` matches `Label` exactly (label.tsx) — the
                  // whole point of flush rows. `px-2 pb-0.5` would put the band at
                  // 18px and shift the headers 2px right of their own cells.
                  //
                  // `mb-1.5` is the GAP under the band, and it is not decoration:
                  // it matches the 6px the grid root's own `space-y-1.5` already
                  // puts under the empty-state band, and the 6px the field beside
                  // this grid carries under its label. All three states then put
                  // their first control at 20px (client 2026-08-05, screenshot
                  // 2171 — the empty grid had the gap and the field did not).
                  // Lives here rather than on the body's `space-y`, which would
                  // also push every row apart from its neighbour.
                  flushRows ? "leading-[14px] mb-1.5" : "px-2 pb-0.5",
                )}
              >
                <span className="w-4 shrink-0" />
                {columns.map((c, ci) => (
                  <div
                    key={ci}
                    className={cn(
                      "min-w-0 text-xs font-semibold text-muted-foreground",
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
                <span className="flex min-h-9 w-4 shrink-0 items-center justify-center text-xs text-muted-foreground @2xl/editor:min-h-8">
                  {startIndex + i + 1}
                </span>
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
                {!locked(row) && (
                <span className="flex min-h-9 shrink-0 items-center @2xl/editor:min-h-8">
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
                </span>
                )}
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
                <span className="w-4 shrink-0 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                  {totalsLabel}
                </span>
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
            listRows ? "divide-y divide-border" : "space-y-2",
            mode === "responsive" && (narrow ? "@md:hidden" : "@lg:hidden"),
          )}
          onKeyDown={keyboardNav ? (e) => gridKeyNav(e, addFn) : undefined}
        >
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
            return (
            <div
              key={row.key}
              data-grid-row
              className={cn(
                "space-y-2",
                // `py-2` only — no horizontal padding, so a flat row's fields keep
                // the grid's own left edge and line up with the sections above it.
                listRows ? "py-2 first:pt-0 last:pb-0" : "rounded-lg border border-border p-2.5",
                // A folded row reads as one thing you can open, and says so.
                folded && "cursor-pointer hover:bg-surface-muted",
              )}
              title={folded ? "Open this row" : undefined}
              /* FOCUS OPENS IT, which is what keeps the fold keyboard-operable:
                 Tab out of one row lands on the next row's remaining field and
                 the row unfolds around the cursor. `onFocus` bubbles, so one
                 handler catches the mouse and the keyboard. */
              onFocus={folded ? () => setOpenRowKey(row.key) : undefined}
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
              {!listRows && (
                /* `ml-auto` on the remove button, not `justify-between` on the
                   row: with a summary between them, space-between would push the
                   index and the summary to opposite ends of the card instead of
                   keeping them together as one label. */
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">#{startIndex + i + 1}</span>
                  {rowSummary && (
                    <Truncated className="text-sm font-medium text-foreground">{rowSummary(row, i)}</Truncated>
                  )}
                  {!locked(row) && (
                    <Button type="button" variant="ghost" size="sm" data-row-remove className="ml-auto shrink-0 text-muted-foreground hover:text-danger" onClick={() => onRemove(row)} aria-label="Remove row">
                      <X className="h-4 w-4 shrink-0" />
                    </Button>
                  )}
                </div>
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
            <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 border-t-2 border-border pt-2">
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

        {!hideAdd && (
          // `data-row-add` is what Tab drives when this grid is NESTED in another
          // grid's row and has no rows yet — see `enterNestedGrid`. Tab still never
          // LANDS on it; a button is not a field.
          <Button type="button" variant="outline" size="sm" data-row-add onClick={handleAdd}>
            {addLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
