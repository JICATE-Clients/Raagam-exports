---
name: raagam-keyboard-contract
description: "Raagam ERP's single keyboard/focus contract for every editable surface — Tab moves and only moves (its two refusals: a live duplicate-name error, and a mandatory field left blank), ↓ opens a field's list and keeps opening it even while a field is held, arrows move spatially, Enter moves to the next field and saves only off the last one (or picks), Esc unwinds one layer at a time down to leaving the page. This skill should be used when building or editing any screen with fields (masters, orders, grids, dialogs), when marking a field required, when wiring a picker or dropdown, when touching lib/focus.ts, keyboard-nav-provider.tsx, field.tsx, sheet.tsx, child-grid.tsx, picker-keys.ts or reload-guard.ts, and whenever a report says arrow keys / Tab / Enter / Escape behave wrongly or inconsistently between fields."
---

# Raagam keyboard contract

Raagam's operators are keyboard-only data-entry staff migrating from legacy
RP-Software. The keyboard model is a **product requirement**, not a polish item:
if two fields sitting side by side answer the same key differently, that is a bug
report, and historically it was *the* recurring bug report.

## The one rule that governs everything

**Field navigation is delivered from ONE place and never bound per surface.**

- The contract lives in `lib/focus.ts`.
- It is delivered by a single `document` keydown listener in
  `components/shell/keyboard-nav-provider.tsx`, mounted in `app/(app)/layout.tsx`.
- Every editable surface inherits it automatically. New screens are correct by
  default.

**Never add a per-screen keyboard handler to fix a keyboard complaint.** An
inventory once found ~195 editable surfaces against 5 per-surface bindings; every
"arrow keys don't work here" report was simply a surface nobody had reached.
Per-surface binding is not a strategy, it is a treadmill. Fix `lib/focus.ts`
instead, and the whole app changes at once.

**And a per-COMPONENT patch is the same treadmill wearing a better disguise.**
"Tab keeps landing on the row's Remove ✕" was answered on 2026-08-01 with
`tabIndex={-1}` on `ChildGrid` — a shared primitive backing 26 screens, so it
looked like the central fix. It was not: ~22 more screens hand-roll a grid row,
and the identical report came back three days later. Tab is now delivered from
the provider like every other key, and targets `isFieldLike` like every other key.
If a fix's blast radius is "every screen that uses component X", ask what the
screens that do not use X will do.

A local handler does not merely *add* behaviour — because the provider bails on
`defaultPrevented`, it **replaces** the contract on that surface, and goes on
replacing it through every future change. When Enter became an advance key in
2026-07-31, three such handlers would have silently kept saving from field one. A
surface that needs a keyboard-reachable save registers `"save"` through
`lib/shortcuts.ts` and lets the contract find it (that also gets it Ctrl+S).

## The contract

| Key | In a field | In an open list | In a child grid |
|---|---|---|---|
| Tab / Shift+Tab | next / previous **field**, and only ever a field or a grid's **"+ Add"** (2026-08-19) — never a ✕, a Save, a Cancel or a row's Remove; **never opens anything**; it does not leave the surface (it wraps, or on a section rail opens the **next section**); **the two refusals**: a field showing a live "already exists" error (both directions), and a MANDATORY field left blank (forward only — Shift+Tab out of it is allowed) | close without choosing, then move | next / previous cell, then **into the row's nested grid** (opening its first row when it has none), then the next row, then **the grid's "+ Add" button** |
| ↓ | **open this field's list**; with no list, the field **below**, spatially | move the highlight down (clamped), and off the last row **onto the "+ Add" button** | **open a picker cell's list**; on any other cell, next row |
| ↑ | the field **above**, spatially | move the highlight up (clamped); off the **"+ Add" button** back into the list | previous row, same column |
| ← / → | field **left / right**, once the caret is at the edge | — | previous / next column |
| Enter | the **next field**; off the last one, **save the record** (blocked while that field is invalid); on a **tick box / radio**, toggles it instead | **pick the highlight, close, stay on the field**; **on the "+ Add" button, add** | next row; **on the last row, move to the "+ Add" button** — a second Enter, on the button, is what adds |
| Esc | close the list → close the surface (**confirm if dirty**) → **leave the page** | close the list only | cancel the editor |
| Space / Alt+↓ | — | — | open a picker cell's list (aliases for ↓) |
| Ins · F2 · Ctrl+Del | — | **add · modify · delete the highlight** | Ctrl+Del **removes this row** |

The last row is `DataPicker` only (`components/ui/data-picker.tsx`, the one picker
component since 2026-07-29). Its list is a **dropdown, not a modal**, so Tab must pass
straight through it — which leaves no way for a keyboard to reach the per-row edit and
delete icons. These three keys are that way, and they are what the operators already
press in legacy RP.

**A picker's "+ Add" is reached the same way a grid's is** (client 2026-09-02, on
Material BOM ▸ Item Color): ↓ off the last row lands on it, a second Enter adds. `Ins`
still adds from anywhere in the list and is the faster key — but it has to be TAUGHT,
and the panel prints "Ins add · F2 edit · Ctrl+Del delete" only at `@lg`, which a
`compact` picker in a grid cell never reaches. So the button was mouse-only on exactly
the screens whose hint was off screen. Two consequences the implementation has to keep:
while the button holds the highlight **no row does** (one highlight is one promise about
what Enter commits, so F2 and Ctrl+Del decline there), and the button keeps
`tabIndex={-1}` — Tab through an open list still closes it and moves to the next FIELD.

Read `references/contract.md` for the reasoning behind each row, the marker
attributes that make it work, and the exact call order in the provider.

## Before writing any keyboard code

1. **Read `lib/focus.ts` first.** Most of what a task needs already exists:
   `atCaretEdge` (the caret-first ←/→ rule), `spatialNeighbour` (geometry),
   `orderedFocusables` (region ordering), `ownsArrowKeys` (the stand-down list),
   `focusField` (**always** move focus with this — a bare `.focus()` leaves the
   caret at 0 and silently breaks →). Reimplementing any of these creates a
   second, divergent contract.
2. **Check `references/traps.md`.** It lists failure modes that have each already
   shipped as a bug once. They are not obvious from reading the code.
3. **Decide whether the change belongs in the contract or in a control.** A
   control owns a key only when the key means something *inside* it (an open
   listbox, a textarea, a grid). Everything else belongs in `lib/focus.ts`.

## Marker attributes

The contract is driven by DOM markers, not by props. Applying a marker is how a
new component joins the contract.

| Marker | Meaning |
|---|---|
| `data-field-trigger` | A picker `<button>` that is really a *field*. Required in three places — see `references/contract.md`; missing one produces the "adjacent fields behave differently" complaint. |
| `data-focus-region` | `content` / `footer` / `header`. **Tab stays inside the `content` region**, and the arrows and Enter are confined to whichever region the cursor is in — which is what keeps ↓ from a field landing on a ✕. The edges of `content` are also where the section hand-off fires (`registerContentEdge`), turning "off the last field" into "open the next section". A surface that stamps nothing is all `content`, so an unmarked ✕ sorts *with the fields*: stamp the header. |
| `data-focus-scope` | Declares a navigation boundary. `"off"` opts a surface out entirely. |
| `data-grid-row` / `data-grid-body` | Grid structure. Keyed off these, **never** `<tr>`/`<td>` — Material grids render cards, not tables. |
| `data-dup-error` | A field showing a LIVE "already exists" duplicate. **Holds the cursor**: Tab / Shift+Tab / Enter / arrows are refused until the value is edited. And if it appears *after* the cursor has already left — a server-only check answering 300ms late — the field **fetches the cursor back** (the catch-up, same listener), unless the operator left by mouse or is already typing elsewhere. Emitted only by `dupFieldProps()` (`lib/masters/use-duplicate-check.ts`), never by hand, and paired with `<DuplicateError>`. Prefer `useDuplicateName` with `rows` so the answer beats the keystroke and no catch-up is needed. |
| `data-required-empty` | A MANDATORY field left blank (client 2026-08-04). **Holds FORWARD movement** through the same listener — Tab, Enter, ↓ and → refused. **Backward is allowed** — Shift+Tab, ↑ and ← move freely (client 2026-08-04), which is the one place the two holds differ: a duplicate is a value that is *wrong*, so leaving in any direction leaves it wrong, while a blank field is not made worse by stepping back off it — and the field that makes it fillable is routinely the one behind it (Category's options are scoped by Item Class). Forward is still gated, so Save stays out of reach. NOT watched by the catch-up: requiredness is known synchronously, so the hold always fires on the keystroke itself. Emitted only by `useRequiredHold()` (`components/ui/field.tsx`), never by hand, from ONE declaration — `<Field required>`, a picker's own `required`, or a `ChildGridColumn.required` — which is the same prop that draws the `*`, so the star and the hold cannot disagree. **Still never key a hold off `aria-invalid`**: it is live for a merely half-typed value too, which is why this marker exists instead. |
| `data-focus-optional` | An **opt-in** control, off the default typing path: Tab and Enter step over it, ↑↓←→ and the mouse still land on it, and Space/Enter on it then works normally. For the escape-hatch toggle an operator should reach for deliberately rather than trip over. Read `[data-focus-optional]` by `cycleTab` / `enterAdvances` / `focusFirstField` / `tabAlongRow` (child-grid), deliberately ignored by `arrowNavigate` and by `gridKeyNav`'s `fieldsIn` — so outside a grid it needs a focus-trapped surface (`Sheet` / `MasterFullScreen`) to work, and everywhere it needs a spatial neighbour to be reachable from. Inside a grid row the grid owns Tab, so the marker works on a plain page form too; it is applied to the DESTINATION only, never to locating the cursor. Prefer to drop it once the operator has opted IN. Uses: Material ▸ Fabric ▸ Direct Purchase (first, reference), Material Attributes ▸ Blocked (first in a grid, 2026-08-11). |
| `tabIndex={-1}` | Auto-generated / derived fields. Skipped by every key, not just native Tab. **`<Input readOnly>` sets this for you** — a field the operator cannot type into is never a tab stop. Pass `tabIndex` explicitly only to opt a read-only field back IN. A field that is composed but still hand-overridable (so not `readOnly`) must set it itself. |
| `data-row-remove` | A child row's Remove control. **Ctrl+Del on any cell of the row clicks it** (`gridKeyNav`), which is how the row ✕ stays reachable now that Tab visits fields only. `[aria-label^="Remove"]` is honoured as a fallback so the ~22 hand-rolled grids work unedited; new code carries the marker. Do **not** reach for `tabIndex={-1}` here — see the note above about per-component patches. |
| `data-row-add` | A grid's "+ Add" control. **REQUIRED ON EVERY GRID THAT CAN GROW since 2026-08-19**, because Enter and Tab off the last row now LAND on it and a second Enter adds the row — a grid whose button is unmarked has no reachable Add at all, so the eleven hand-rolled grids were swept when the rule changed. It was previously needed only when the grid is **nested inside another grid's row**: Tab stepping off the row's last cell into a nested list that has no rows yet clicks it and lands in the box it opens (`enterNestedGrid`). Without it an empty nested list has no keyboard way in at all — Tab lands on fields, and this is a button. `ChildGrid`'s own button carries it; a hand-rolled one must say so. Marker only, no `aria-label` fallback: "+ Add value" / "+ Size" / "+ Add row" are too loose a family, and this one *creates* a row. |

## Adding a new field type that has a list

To make a new control participate:

1. Put `data-field-trigger` on its trigger (if it is a button) or `role="combobox"`
   plus `aria-expanded` (if it is an input).
2. Open on `onClick` — the contract opens lists by calling `.click()`, the same
   path a mouse takes. Do not invent a separate imperative open API.
3. Seed the highlight from the **current value**, scrolled into view, so editing
   an existing record shows the operator where they are before they change it.
4. **Handle Escape and `preventDefault()`.** Escape's last layer leaves the *page*
   (see below), so a list that closes without claiming the key navigates away too.
5. **Do not preventDefault on Tab** unless you are trapping focus inside a dialog.
   Close your list without committing and let focus move on: Tab never changes a
   value. It fails to move in exactly two cases, and neither is **yours to
   implement**: a field carrying `data-dup-error` or `data-required-empty` holds
   the cursor (see `references/contract.md` § The holds). Both are served by one
   window-capture listener that stops the event before your handler runs.
   **Never add a third refusal**, and never key one off `aria-invalid` — that is
   live for a half-typed value as well as a blank one, so a hold on it would cage
   the operator on a field they are in the middle of filling in correctly.

   **A HOLD REFUSES MOVEMENT AND NEVER REFUSES CHOOSING**, and a new control has
   to publish enough for `keyFills` (lib/focus.ts) to tell the two apart. Set
   `role="combobox"` (or `data-field-trigger`) **and keep `aria-expanded` honest**:
   the open state is what tells the hold that ↑ ↓ now move a highlight and Enter
   now picks, rather than moving to another field. A control that never sets
   `aria-expanded` is one whose Enter is refused while its list is open — the
   operator opens it, walks down it, and cannot choose anything. That exact bug
   shipped on Item Class (client 2026-08-04); the vectors in
   `scripts/check-keyboard-holds.mts` are what stop it coming back.
6. If it is a portal dialog, reuse `pickerKeyDown` from
   `components/masters/picker-keys.ts` rather than hand-rolling ↑/↓/Enter/Esc/Tab
   — that block was copied into 14 files once, and 12 of them lost Escape.
7. Call `usePickerFocusReturn(open)` (same file). Unmounting the dialog strands
   the cursor on `<body>`; this hands it back to your trigger.

## The bail-out that makes it all work

The provider stands down on `e.defaultPrevented` — **not** on propagation. React
19 + Next attach delegated listeners to `document`, the same node the provider
uses, so a React `stopPropagation()` cannot stop it. Any control that legitimately
owns a key **must** call `preventDefault()`. This one convention is what lets
`Combobox`, `gridKeyNav`, the pickers and the search palette keep working
untouched while a global listener handles everything else.

It matters most for Escape. The page-level Escape is a second listener bound to
`window`, which the browser reaches only after every `document` handler has run —
that is what makes "close the innermost layer first" work without an ordering
hack. The price is that a layer which closes silently ALSO leaves the page.
`Sheet`, `MasterFullScreen`, `Combobox` and `pickerKeyDown` all preventDefault for
exactly this reason.

## Auditing a change

Run the bundled audit to find surfaces that have drifted out of the contract:

```bash
python scripts/audit_keyboard.py <repo-root>
```

It reports candidates — picker triggers missing `data-field-trigger`, hand-rolled
`fixed inset-0` overlays missing `useModalGuard`, editable screens missing
`useUnsavedGuard`, and listbox arrow handlers missing `stopPropagation`. Findings
are heuristics to inspect, not verdicts.

## Verifying keyboard work

Type checks cannot validate any of this. After `npm run build` (must be
`next build --webpack`), exercise these by hand — each has caught a real
regression:

1. **A wide masters form** (Material, `DetailSection cols={12}`): does ↓ land on
   the field *below*, not the one to the right?
2. **A picker**: Tab onto it, ↓ opens, ↓↓ moves, Enter picks. Then Tab twice in a
   row — it must simply move two fields and open nothing.
3. **Enter advances**: mid-form it moves one field forward and saves nothing; off
   the last field of a rail-editor section it opens the *next section*, and only
   off the last field of the last section does it click Save. On a field showing a
   validation error it still moves, but the save at the end refuses. In a list
   page's filter box it does nothing at all.
3a. **A duplicate name**: type a name that already exists. Tab, Shift+Tab, Enter
   and all four arrows must refuse — visible nudge, cursor stays. ← and → must
   still move the caret *inside* the text. Type one more character and Tab must
   move on **that keystroke**, not 300ms later. Escape must still cancel.
3a-i. **The same, tabbed IMMEDIATELY** (do it on a server-only check — a picker's
   "+ Add" panel): focus moves, then snaps back to the field with the nudge as the
   answer lands. Then check the two stand-downs: leaving by *mouse* must not yank,
   and neither must tabbing and typing a character in the next field — the
   keystrokes belong where the operator put them.
3b. **A blank MANDATORY field holds** (client 2026-08-04 — this reversed the
   earlier rule, so do not "fix" it back). New Material ▸ Item Class YARN: Tab,
   Enter and ↓/→ all refuse on Item Class / Yarn Type / Count / Category / Base
   UOM while blank, with a nudge and a spoken reason. **Shift+Tab, ↑ and ← must
   MOVE** — backward is allowed out of a required hold and refused only out of a
   duplicate (client 2026-08-04); a blank Category whose Item Class sits behind it
   is otherwise unsatisfiable by keyboard. Then CHOOSE
   one with the keyboard alone, which is what makes it a guide rather than a cage:
   **↓ opens the list, ↓↑ walk it, Enter picks** — all three must work while the
   field is held, or the hold cannot be satisfied at all (it shipped broken on
   2026-08-04: Enter did nothing and the form was mouse-only). **Ctrl+Del must
   still remove a child-grid row.** Escape and the mouse stay live as always.
   `node --experimental-strip-types scripts/check-keyboard-holds.mts` covers the
   rule; only the browser covers the wiring.
3b-i. **A blank OPTIONAL field must still let Tab through** — Purity, HSN Code and
   Shade on that same form. If an unmarked field holds, something is keying off
   `aria-invalid` rather than `data-required-empty` and is wrong.
3b-ii. **A read-only field never holds**, mandatory or not: the composed Material
   Name is the case, and it is a cage with no keyboard way out at all. It fills
   itself once Count + Category are filled, which is why requiring the sources is
   enough. Check on a field that has both a format and a duplicate check (Our
   Bank ▸ Account No).
4. **The Escape ladder**, three presses with a picker open: list → surface → page.
   Exactly one layer per press.
5. **A child grid, including a nested one**: ↑↓ rows, ←→ columns, Alt+↓ opens a
   picker cell.
5b. **Tab reaches a nested grid** — Material Attributes ▸ New, pick an attribute, then
   Tab off the row's last column: it must land IN the values list, opening the first
   box when the list is empty. Shift+Tab back must return to that last value, not skip
   past it. That panel was mouse-only until 2026-08-05 (screenshot 2172), and an empty
   one had no keyboard way in at all.
6. **A half-typed text box**: ← and → move the caret, not the field.
7. **Esc on a dirty form**: prompts. Note this uses `window.confirm`, which
   freezes browser-automation tooling — verify it manually, not with a driver.
