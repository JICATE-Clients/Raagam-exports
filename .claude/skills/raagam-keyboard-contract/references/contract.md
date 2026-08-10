# The contract in detail

## Architecture

```
app/(app)/layout.tsx
  └── components/shell/keyboard-nav-provider.tsx   ONE document keydown listener
        └── lib/focus.ts                            the contract itself
```

The provider resolves the focused element's **scope** — the boundary navigation
may not cross — via `SCOPE_SELECTOR`:

```
[data-focus-scope], [role="dialog"], form, main
```

`form` covers the overwhelming majority of surfaces, `[role="dialog"]` covers
overlays, and `main` is the fallback for fields rendered straight onto a page.
Because `main` wraps every page in the app shell, effectively every control is in
scope. `data-focus-scope="off"` opts a surface out entirely.

### Call order in the provider

```
NAV_KEYS filter  (Enter, ArrowDown, ArrowUp, ArrowLeft, ArrowRight)
  → bail on meta/ctrl          (those belong to lib/shortcuts.ts)
  → bail on alt, except Alt+↓  (the in-grid way to open a list)
  → bail on e.defaultPrevented (a control already claimed the key)
  → resolve scope
  → arrowOpensPicker
  → arrowNavigate
  → enterSaves
```

**Tab is its own branch**, ahead of the `NAV_KEYS` filter, because it reads
`shiftKey` and gates on the surface rather than on the control. It runs
`restoreFocusIfLost()` → `scopeOf` → `isEditorScope` → `cycleTab`.

It was absent until 2026-08-04, left to native order and to `Sheet`'s own focus
trap. That is what made it the odd key out — see "Tab moves. Once, it refuses."
below.

Shift is deliberately not filtered out with the other modifiers: Shift+Tab must
still walk backwards, and every handler declines it individually.

### Escape is a SECOND listener, on `window`

Escape unwinds one layer per press — open list, then surface, then the page — and
the first two layers are owned locally by whichever thing is on top. The provider
owns only the last one.

It is bound to **`window`, not `document`**, and that is the whole design. Every
other Escape handler in the app (`Sheet`, `MasterFullScreen`, the dialog pickers,
`Combobox`, and React's own delegated handlers) sits on `document`, and an event
reaches `window` only once `document` has finished with it. So the page-level
handler is guaranteed to run last and to see their `preventDefault()` — no
ordering hacks, no priority registry.

The corollary is a hard rule: **anything that consumes Escape must call
`preventDefault()`**, or dismissing it will also navigate the page away.

## Why each row of the table

### Tab moves, to a FIELD. Once, it refuses.

Tab goes to the next field, Shift+Tab to the previous one, and neither ever opens,
picks, or changes anything. A list that is open when Tab arrives closes *without
committing* and lets focus move on. There is exactly one case where it does not
move at all — see **The duplicate hold** below.

**Every stop is a field**, `isFieldLike` — the same predicate Enter-advance uses,
and the same axis `ROW_FIELDS` declares for the arrows in a grid. A ✕, a Save, a
Cancel, a "+ Add", a child row's Remove: none of them are fields, so Tab never
stops on any of them, on any surface (client 2026-08-04).

That last clause is the point. Until then Tab walked `orderedFocusables`, i.e.
every `<button>` not marked `tabindex="-1"`, while the other two movement keys
walked fields — so the three keys held two different ideas of what a field is, and
the difference was visible inside one row of one grid: tabbing along it landed on
the Remove ✕ that ↑↓←→ and Enter both stepped over. It was patched on 2026-08-01
with `tabIndex={-1}` in `ChildGrid`'s three layouts, which reads like a central
fix (26 screens) and is not one: **~22 screens hand-roll a grid row**, and the
report came back three days later, worded "some children work, some don't".

**Tab does not leave the surface.** Off the last field it hands to the next pane if
there is one, else wraps to the first. On an overlay that is the focus trap; on a
plain page form it is what makes the two behave identically, which is the other
half of "some screens work and some don't" — a page form used to leak Tab into the
sidebar while an overlay trapped it.

**Inside a child grid, the GRID owns it** — `tabAlongRow` in `child-grid.tsx`,
walking the row's fields and on to the next row, declining at the last cell of the
last row so Tab can still leave the grid. That is the same sanctioned exception the
grid already has for ↑↓←→ and Enter (a key belongs to a control when it means
something *inside* it), expressed against the axis the grid declares — not a second
rule. It is also what reaches the surfaces the gate below excludes: Orders ▸ TA Plan
/ TA Style / TA Department Assign are page screens with hand-rolled grids, and they
route their keys through this function already.

**A nested grid is part of its row, and this is the ONE place Tab and the arrows
read different axes on purpose.** The arrows use `ownDescendants`, scoped to the
nearest `data-grid-row` — a nested panel's fields counting as columns of the outer
row is exactly what made ↓ from "End Value" land on the 2nd value of the *next*
attribute line (client 2026-07-25), and that scoping is the fix. Tab fell out of the
same query and so skipped the nested panel altogether, which is a different bug
wearing the fix's clothes: Tab's job is to visit every field, and on Material
Attributes the values under a row were reachable only with the mouse (client
2026-08-05, screenshot 2172). Tab therefore walks `tabFieldsIn` — every field in the
row in DOM order, its own cells and then the panel beneath them — while ↑/↓ keep
crossing the boundary the way they always have, through `gridKeyNav`'s
`fromChildGrid` hand-off (↓ on the last nested field steps to the next outer row).

**An empty nested grid is entered by opening its first row** — `enterNestedGrid`.
A nested list starts with no fields and its only affordance is an "+ Add" button;
Tab lands on fields, never on buttons, so there was nothing to tab into and nothing
to stand on and press Enter. Tab stepping off the row's last cell finds the nested
grid's `data-row-add` control, drives it with `.click()` (the mouse path, so its own
guards still run — the same reasoning as `data-row-remove` under Ctrl+Del) and lands
in the field it opens, 30ms later. **Forward only** — Shift+Tab skips an empty panel,
because moving backwards out of a row is not the operator asking for one — and only
while the nested grid holds no fields at all, so it can never stack blank rows.

**And it is claimed only on an editor.** `isEditorScope` — a `[role="dialog"]` /
`[aria-modal]`, a pane carrying `data-focus-scope`, or a surface containing a
`[data-focus-region="footer"]`. On a list page, a filter bar or the app chrome, Tab
is exactly as native as it has always been: search box → Add → table → sidebar.
Deliberately **not** `canSubmitSurface`, the gate Enter uses: its last branch
accepts any `<form>` with a submit button, which would cage the operator inside an
incidental search form, and it reads the app-wide shortcut registry, so a `"save"`
registered by an editor elsewhere on the page would answer for an unrelated scope.
(98 of the 99 unmarked `<form>`s in this repo have a submit button, including every
list-page filter panel — the numbers were checked before the gate was written.)

**The known remainder**, and it is enumerated rather than guessed at: a page-level
editor that declares no marker keeps native Tab OUTSIDE its grids. ~51 screens are
in that state — the `planning/*-detail` family, the `*-assign-screen` masters, the
TA screens' non-grid fields. `--check tab-page-form` lists them; the fix for each
is one `data-focus-scope` on the form wrapper, not a handler.

**The two fallbacks in `cycleTab` are not defensive padding.** A surface with no
field at all (a confirm dialog: message, Cancel, OK) has no stops, and without a
fallback native Tab would walk straight out of it — so there, every focusable is a
stop. And standing on a *non*-field (the operator clicked ✕ or Save with the mouse,
or arrowed onto a `data-focus-optional` control), the walk still runs over the full
ordered list with a stop predicate, so Tab knows where that control sits and
carries on into the fields rather than restarting at field one. A non-field origin
aims at the `content` region, so Tab off the footer goes back to the data.

**What the operator lost, and what answers it.** Save, Cancel and ✕ are no longer
Tab stops. Each keeps a key — Enter off the last field or Ctrl+S saves, Escape
cancels and closes, **Ctrl+Del** removes the grid row the cursor is on — and all of
them stay on the mouse and in screen-reader focus order. That last part is the
difference from `tabindex="-1"`, which removes a control from the document's focus
order outright. See the accessibility note at the end of this file.

It briefly did more. A second Tab on the same field used to open that field's list
(the legacy RP-Software Tab-Tab-↓↓-Enter), which needed a module-level `openedFor`
to remember which field had already been shown — otherwise the next Tab re-opened
the list it had just closed and the operator was caged on the field forever. ↓ took
over the job on 2026-07-28 and all of that went away: no hidden state, no "third
Tab to get past a picker", and Tab back to meaning one thing.

If a future report says "I can tab straight past a dropdown without seeing it" —
that is the accepted cost of this, not a regression to fix by re-claiming Tab.

**Where it moves on a rail editor.** `MasterFullScreen` renders one section at a
time, so "the next field" after the last field of Identity is in a pane that is
not mounted yet. Tab off that field opens the next section and lands in its first
field; Shift+Tab off a section's first field opens the previous one and lands in
its *last*. Note the nav scope there is the content **pane** (it carries
`data-focus-scope`), not the whole overlay, so the rail, the footer and the ✕ are
outside the cycle by construction as well as by the field rule. This is still pure
movement — no value changes. It refuses in exactly two cases, a colliding name and
a blank mandatory field; both are below. Before it existed, the only way from
Identity to Address was the mouse (client 2026-07-30).

### The holds — the two refusals

While a field carries either marker, **forward movement — Tab, Enter, ↓ and → — is
refused and the cursor stays on it.** Both are the legacy RP-Software behaviour the
operators asked for, and both release the moment the field is fixed.

**They differ on BACKWARD movement, and the difference is what each one guards**
(client 2026-08-04). Shift+Tab, ↑ and ← are still refused out of a `data-dup-error`:
that value is *wrong*, and leaving in any direction leaves it wrong. They are
**allowed** out of a `data-required-empty`: a blank field is not made worse by
stepping back off it, and the field that makes it fillable is routinely the one
behind it — Category's options are scoped by Item Class, so a blank mandatory
Category with no way back is a hold the keyboard cannot satisfy. Forward stays
gated either way, so an operator who walks back and returns meets the same hold and
Save stays out of reach.

| Marker | Set when | Asked for |
|---|---|---|
| `data-dup-error` | a live "already exists" name collision | client 2026-07-31 |
| `data-required-empty` | a MANDATORY field is blank | client 2026-08-04 |

**The required hold reversed what this file used to say.** Until 2026-08-04 the
rule was one refusal, and this section said Tab "never refuses because a required
field is empty". That was a decision about the SIGNAL, not about the intent, and
the signal is still the point: see the first bullet below.

Implemented once, in `components/shell/keyboard-nav-provider.tsx`. Everything
about it is load-bearing:

- **The signal is `data-dup-error` / `data-required-empty`, never
  `aria-invalid`.** `ValidatedInput` sets `aria-invalid` *live* for every
  required-but-empty **and format-mismatched** field, so a hold keyed off it would
  also fire on a value the operator is halfway through typing correctly — a cage
  on a right answer. The markers are emitted only by `dupFieldProps()` and
  `useRequiredHold()`, each from one declaration.
- **A hold refuses MOVEMENT and never refuses CHOOSING.** Not a courtesy — without
  it the required hold is unsatisfiable, and the operator can neither fill the
  field nor leave it. `keyFills` (lib/focus.ts) draws the line: an OPEN list owns
  ↑ ↓ and Enter, a CLOSED list opens on ↓, a native `<select>` fills on ↑ ↓, and
  **Tab is in none of those branches** so an open list never becomes an escape
  hatch. Ctrl+Del likewise survives — every Ctrl/⌘ chord bails out before the hold
  is consulted — and it is the only way to abandon a half-added grid row.

  The first cut of the required hold exempted ↓-opens-a-list alone, so a held Item
  Class could be opened and walked but not picked from: **Enter did nothing**, and
  the form was mouse-only (client 2026-08-04). `keyFills` is deliberately NOT
  `ownsArrowKeys` above — that answers "does this control handle ↑/↓ itself?" and
  a child-grid row answers yes, but moving a row is still moving.
- **A `readOnly` or `disabled` field never holds.** It cannot be typed into, so
  the hold would have no exit. The composed Material Name is the case, and it is
  why requiring its *sources* is the right shape — filling them writes it.
- **The catch-up watches duplicates only.** Requiredness is known synchronously,
  so a required hold always fires on the keystroke itself; there is no late
  answer to fetch the cursor back for.
- **`window`, capture phase, and it stops propagation.** `preventDefault` alone
  is not enough: `gridKeyNav` (`child-grid.tsx`) and the Tab branch of
  `pickerKeyDown` (`picker-keys.ts`) never read `defaultPrevented` and would move
  focus anyway. `window` capture is the first node on the propagation path — not
  a registration-order race — so React never dispatches and no `document`
  listener runs. Note the symmetry: **window-capture runs first (this),
  window-bubble runs last (the page-level Escape), `document` is where everything
  that negotiates with everything else lives.**
- **It stands down on `readOnly` / `disabled` fields.** Material's Name is
  read-only for attribute-driven classes; holding a field the operator cannot
  type into is a cage with no keyboard way out.
- **← and → only refuse at the caret edge** (same `atCaretEdge` predicate the
  movement rule uses). Refusing them outright would make the field un-editable.
- **Three ways out, always live**: editing the value, Escape, and the mouse.
  (`Ctrl+F` also moves focus to the list search box — a modified key is an
  explicit command, so that is a fourth, by design.)
- **A refused key is never a dead key**: a 160ms nudge on the field, an assertive
  live-region announcement, and the message already under it. Not a toast — held
  Tab presses come in bursts.
- **A late answer fetches the cursor back.** The refusal above is a KEYDOWN-time
  test, so a check that answers 300ms later has already lost: the operator types
  a colliding name, tabs straight away, and the message paints under a field they
  have left. "The error is showing and the cursor moved anyway" was the report
  that the whole rule was broken (client 2026-08-01). A `MutationObserver` in the
  same listener watches the field the last movement key left, and returns the
  cursor to it — nudge and announcement included — if the error lands within 2s.
  It stands down when pulling back would be worse than missing: a `pointerdown`
  (the mouse is one of the promised ways out), a non-movement key (the operator
  is already typing in the next field, and stolen focus misdirects keystrokes),
  focus in another surface, or a field now gone / read-only / inert.
  **The real fix is upstream**: `useDuplicateName` with `rows` answers in the same
  render as the keystroke, so the hold engages and nothing ever moves. Every
  masters screen uses it; the catch-up is the net under the checks only the
  server can answer.
- **The error may not outlive the value it describes.** `useDuplicateCheck` keys
  its state to an `askKey` built from the exact inputs, so the instant the name
  changes the error is null *in the same render*. Without that, the 300ms
  debounce plus a server hop means the operator fixes the name and is still
  caged. It also fails **open**: a hung or failed check answers nothing, so
  nothing holds.
- **Only `kind: "duplicate"` holds.** `dup-guard.ts` tags a query failure
  (an RLS denial, a timeout) as `kind: "failed"` — holding on "permission denied"
  would be a cage no keystroke can open, because every re-check fails the same way.

Accepted cost: blocking Shift+Tab puts a picker Add form's "Back" button out of
keyboard reach while the error shows. Escape is the exit and `<DuplicateError>`
says so on screen. Holding Tab but *not* Shift+Tab would be worse — a half-rule
is the adjacent-fields-behave-differently split this contract exists to prevent.

The mechanism is `cycleTab` in `lib/focus.ts`, which looks the hand-off up
through `registerContentEdge` — the same registry `enterAdvances` reads, so the
two forward keys cannot hold separate copies of where a section ends. It fires
exactly where Tab would run off the `data-focus-region="content"` pane, so
`lib/focus.ts` never has to know what a section is, and a surface with a single
pane (every `Sheet`) simply registers nothing. On the LAST section the callback
declines and Tab wraps to the section's first field; Save is reached with Enter
off the final field, or Ctrl+S.

The section rail itself is an ARIA tablist with **manual** activation and a roving
tab stop: arrows move focus between sections, Enter/Space switches. Auto-activating
on arrow would fire the autofocus effect and pull the cursor into the form
mid-arrow, leaving no way to browse the rail.

### Arrows are spatial, not sequential

`spatialNeighbour(el, dir, items)` finds the field the operator would say is
directly above / below / left / right, from `getBoundingClientRect()`.

Arrow order used to be sequential (the same order Tab and Enter use), on the
theory that "the field visually below" was too ambiguous to compute on a
12-column grid. In practice that made ↓ and → do the same thing on every
multi-column form, which is not the model the operators have.

**Rows are grouped by vertical rect OVERLAP, never by equal `top`.** This is the
whole trick. On a `DetailSection cols={12}` form an `h-8` Combobox sits beside an
`h-9` Input, and a picker trigger carries a label above it — so fields in one
visual row never share a pixel-exact `top`, and grouping by `top` finds nothing.
Two controls that *look* side by side always overlap vertically; two on different
rows never do.

- Vertical: pick the nearest row, then the candidate whose horizontal centre is
  closest — so ↓↓ down a column stays in that column.
- Horizontal: stay inside the current row, nearest first.
- Returns `null` when there is nothing in that direction (a ragged last row, the
  top row, the end of a line), and `arrowNavigate` falls back to sequential order
  so focus is **never stranded**.

### ←/→ are caret-first

`atCaretEdge(el, dir)` gates horizontal movement: ←/→ move the *text caret*
normally and only leave the field once the caret has nowhere left to go. Typing
must never break. `gridKeyNav` applies the same rule to grid columns.

`selectionStart` is only defined for text/search/url/tel/password — it is null or
throws on number, email, date and time. For a **number**, "caret unreadable" is
treated as at-the-edge, because arrowing within a number is worth little. **Date**
never reaches this function: `ownsArrowKeys` keeps it, since ←/→ there move
between day/month/year segments.

Three things count as "at the edge", and the last two exist because caret-first is
only defensible while the caret is somewhere the OPERATOR put it:

- the caret is collapsed at position 0 (for ←) or at `value.length` (for →);
- the **whole value is selected** — that is what native Tab leaves behind, so it
  means "just arrived", not "part-way through the text". A *partial* selection
  still returns false and lets the arrow collapse it first;
- the element is a **closed `role="combobox"`**. Its visible text is a selected
  label, rewritten wholesale on pick — there is no in-place edit to protect, so
  walking a 20-character label to leave the field is pure friction. (An open one
  never reaches here; `ownsArrowKeys` claims it.)

**And every programmatic focus must land the caret at the end** — that is what
`focusField()` is for. A bare `.focus()` leaves it at 0, and → then refuses to
leave the field until the operator has walked the whole value one character at a
time, while ← works fine from the same field because 0 already is its edge. See
the matching entry in `traps.md`.

### ↓ opens the list, ↑ does not

↓ on any field backed by stored data drops its list open — a picker `<button>` via
`arrowOpensPicker`, a `Combobox` `<input>` via its own handler. It is the single
way in, so every "choose a stored value" field answers the same key.

↑ is deliberately **not** a second opener: it means "the field above", which is
what keeps a picker from being a one-way door now that Tab no longer walks past an
open list. The same asymmetry is why `ownsArrowKeys` claims `role="combobox"` only
while `aria-expanded="true"` — a *closed* combobox is just a field, and ↑ on it has
to reach `arrowNavigate`.

**This holds inside a child grid too.** Grids own ↑/↓ for row movement, so the
opener there was Alt+↓ alone — and that failed in practice: Tab-Tab had been the
way into a grid picker until ↓ replaced it on forms, and grid cells got nothing
back, so both keys an operator reaches for did nothing (client 2026-07-28).
`gridKeyNav` now returns early on ↓ over a `[data-field-trigger]` — **without**
`preventDefault`, which is the whole point: the provider bails on
`defaultPrevented`, so claiming the key there would swallow the opener.

Nothing was traded away. From a picker cell ↑ still goes up a row and Enter still
goes down one. And it closed a split that was visible inside a single row: a
Combobox cell already opened on ↓ (it consumes the key itself, so `gridKeyNav`
never saw it) while the picker beside it moved a row. Alt+↓ and Space still work
as aliases.

### Enter moves to the next field, and saves off the last one

Enter picks the highlighted row when a list is open. With nothing open it **moves
one field forward**, and it saves only when there is no next field (client
2026-07-31).

It committed the record from anywhere between 2026-07-28 and that date. The
reversal is not a change of taste — it was a footgun in the place the app is used
most. Filling in an address, the operator picks City from the dropdown with Enter,
presses Enter again out of habit, and the half-filled record saves. Advance is also
what legacy RP-Software did, so it is what the operators' hands already do; the
commit key they still have is Ctrl+S, and Enter reaches the same handler at the end
of the form.

`enterAdvances` runs a ladder, and the ORDER is the design:

1. anything that already called `preventDefault` is left alone;
2. a tick box toggles (below);
3. **a surface that cannot commit at all is not ours** — the key is left
   completely untouched;
4. the next **field** in the same region;
5. the next **pane**, if the surface has one;
6. otherwise save.

**Step 3 is where "Enter that cannot save must not be swallowed" now lives.** That
rule used to be enforced at the *end*, by only calling `preventDefault` when
`submitSurface` found a target. Advancing happens before any save, so the test had
to move to the front — otherwise Enter in a list page's filter box would start
walking the page furniture. `canSubmitSurface` answers it by resolving where a save
*would* go without performing it, which is why `ShortcutsApi` grew a non-firing
`has()` beside `fire()`: asking the old way meant saving.

**Step 4 targets FIELDS, not focusables, and stays inside the element's region.**
Two independent defences against the same trap — an unconfined advance once walked
off the last data field onto the footer's *first* button, Cancel, where the next
Enter discarded the form. Region confinement covers surfaces that mark their
regions; field-only targeting covers the ones that mark nothing, which is most page
forms. Order is **sequential**, deliberately not `spatialNeighbour`: Enter and Tab
are both "forward" now and must agree, and geometry has no reliable "there is no
next field" signal — which is exactly the signal this needs, because it is where
the save happens.

**Step 5 is what stops the footgun reappearing one section along.**
`MasterFullScreen` mounts one section at a time, so without it Enter off the last
field of *Identity* would save a record that has not reached Address yet. It is the
same `onContentEdge` callback Tab reads, published to `lib/focus.ts` via
`registerContentEdge` because the global listener cannot see a callback a component
handed to `cycleTab`. One callback, so the two forward keys can never disagree about
where a section ends.

`submitSurface(root, hooks)` resolves what "save" means, in order: the scope's own
`[data-focus-region="footer"]` primary button → the registered `"save"` shortcut
(the path `Sheet` and `MasterFullScreen` use, and the same handler Ctrl+S fires) →
a `<form>` with a real submit button.

The primary action is the last footer button **by position**, never "the last
enabled one": when Save is disabled by a validation error, last-enabled resolves to
*Cancel*. A disabled primary means the record is not saveable, so the key is
consumed and nothing happens.

**`aria-invalid` blocks the save, not the move — and that is still true after the
required hold.** The gate sits at step 6, not at the top. `ValidatedInput` sets
`aria-invalid` *live* for a **format** mismatch as well as an empty required
field, so refusing to move on it would hold a value the operator is halfway
through typing correctly. The two rules are not in tension because they read
different signals: a blank field a screen has DECLARED mandatory carries
`data-required-empty` and holds; a half-typed GSTIN carries only `aria-invalid`,
moves freely, and is caught by Enter/Ctrl+S at the end. Never committing from an
invalid field survives intact (client 2026-07-24).

**A tick box is the one field where Enter does not move: it toggles.** Standing on
a checkbox or a radio, "Enter" can only sensibly mean *tick this*. Enter has no
native meaning there at all, so "advance" would make it a dead key again — which is
what it was before 2026-07-28, when it instead fell through and committed a
half-filled form. It is implemented as `t.click()`, the same path Space and the
mouse take, so `onChange` fires normally. Space keeps working, and Tab / ↓ / → still
move. One key, one job: it toggles, it does **not** toggle-and-advance.

### Escape unwinds one layer at a time

Escape closes the innermost thing first: an open list, then the surface, then the
page (`router.back()`). It never closes two layers in one press. When the surface
holds unsaved work it asks first.

The dirty signal is a **global count** in `lib/reload-guard.ts`
(`isDirty()` / `confirmDiscard()`), fed by the `useUnsavedGuard(dirty || isPending)`
that every editing screen already calls. That is why Escape-confirm went live
app-wide with zero call-site changes.

It is deliberately **not** fed by `useModalGuard`: an open-but-untouched overlay
is not unsaved work, and confirming on every Escape trains the operator to
dismiss the prompt unread.

The imprecision — a dirty form underneath a clean dialog reads as dirty — costs
nothing in practice, because every overlay that owns Escape consumes the key
before it reaches a surface-level handler.

The page layer adds two guards of its own: `hasOpenModalInDom()` (belt-and-braces
for an overlay that forgot to `preventDefault`) and `window.history.length > 1`,
so Escape in a directly-opened tab does not dump the operator outside the app.

## `data-field-trigger` must be honoured in THREE places

This marker is what makes a picker `<button>` behave as a *field*. Miss any one
and fields sitting side by side answer the same key differently — which is the
whole complaint.

1. **`enterAdvances`** (`lib/focus.ts`) — form context, twice over: Enter moves
   *off* the trigger instead of activating the button and opening the dialog, and
   `isFieldLike` counts the trigger as a landing place so Enter can move *onto*
   it. Miss the marker and Enter both opens a dialog and skips the field.
2. **`ChildGrid`'s `ROW_FIELDS`** (`components/masters/child-grid.tsx`) — grid
   context: it is a real column, so Enter goes down a row and arrows land on it.
   But Enter on a **last-row** picker must NOT add a row: the new row's trigger is
   again last, so Enter loops and writes blank child records.
3. **`arrowOpensPicker`** (`lib/focus.ts`) — ↓ opens it, matching what ↓ does on a
   Combobox. It fires in a grid too, because `gridKeyNav` stands down on ↓ over a
   trigger.

Triggers also need a focus ring (`[data-field-trigger]:focus-visible` in
`globals.css`): they are keyboard destinations, and none of them carried the
app's focus style by default.

## Focus hygiene invariants

- **Focus is never dropped to `<body>`.** Two ways it happened, both fixed
  centrally rather than per surface:
  - `Combobox.commit()` must not `blur()`; blurring sent focus to `<body>`, the
    Sheet trap saw `!inside` and ran `items[0].focus()`, and `items[0]` was the ✕.
  - A **portal picker unmounts on pick**, and removing the focused node moves
    focus to `<body>` in Chrome *without firing `blur`*, so nothing downstream can
    react. `rememberFocus` / `restoreFocusIfLost` (`lib/focus.ts`) keep a short
    focus HISTORY, fed by one `focusin` listener in the provider; when a picker
    closes, `usePickerFocusReturn(open)` puts the cursor back on the first entry
    that is still in the document — the trigger. A history, not a single "last
    element outside an overlay", because `Sheet` wears `role="dialog"` too, so
    excluding dialogs by selector would blind it to every masters form field.
  - The provider also calls `restoreFocusIfLost()` at the top of its keydown, so
    a cursor stranded by anything else recovers on the next keystroke instead of
    swallowing it.
- **Tab never changes a value.** Brushing an arrow key then tabbing must not
  silently write a different value.
- **Tab order is fields, and only fields.** `cycleTab` filters on `isFieldLike`,
  so a ✕ / Save / Cancel / row-Remove is never a stop anywhere in the app.
  `orderedFocusables()`'s region ranking still decides where the *other* walkers
  go — the no-fields trap fallback, `focusFirstField`'s last resort, and the
  region confinement the arrows and Enter apply.
  Do NOT solve "Tab hits the close button" with `tabIndex={-1}`: it removes the
  control from the focus order outright (strand), and it fixes exactly the one
  component you put it on (remainder). Both failure modes have shipped.
- **That is not the same rule as the one for derived fields, and the difference
  is what the key would DO if it landed there.** ✕ is an action the operator
  needs, so it gets reordered, never removed. A read-only field — a composed
  Name, an age from a date of birth — offers nothing to do: stopping on it costs
  a keystroke and returns a dead box. So `<Input readOnly>` sets
  `tabIndex={-1}` itself (`components/ui/input.tsx`), which removes it from Tab,
  from the ↑↓←→ walk, from Enter-advance and from the focus trap in one go,
  while a click still reaches it. Nothing is stranded: there was nothing there
  to reach. A composed value that is still hand-overridable is NOT `readOnly`,
  so it must set `tabIndex={-1}` at the call site — Material's Name does, keyed
  off the item CLASS rather than off whether a name has been composed yet, or
  the field joins and leaves the tab order as the form fills in.
- **`data-focus-optional` is the third answer, for a control that is neither an
  action to reorder nor a dead box to remove: a live, destructive, rarely-wanted
  toggle.** Material ▸ Fabric ▸ **Direct Purchase** sat between Fabric Type and
  Using; ticking it hides Using and clears the mixing rows; and Enter *ticks* a
  checkbox rather than advancing. So the operator Entering down the form lost the
  composition they had just typed (client 2026-08-01). `cycleTab`,
  `enterAdvances` and `focusFirstField` step over the marker; `arrowNavigate`
  ignores it, so ↓ / → from Using still lands there and Space/Enter ticks it.
  `tabIndex={-1}` would have been the obvious reach and the wrong one — it strips
  the arrow contract too, leaving a keyboard-only operator no way in at all.
  Two conditions before applying it: the control is genuinely optional on most
  records, AND an arrow key arrives from a spatial neighbour. And it comes OFF
  once the operator has opted in — Fabric's checkbox is marked only while
  unticked, so the control that undoes the mode is on the Tab path exactly when
  undoing it is what you would want.
  `cycleTab` walks the full focusable list and steps over marked entries rather
  than pre-filtering, so Tab still knows where an arrowed-onto optional control
  sits and carries on from there instead of restarting at field one.
- `Sheet` remembers the last focused field (`onFocusCapture`) and resumes from it
  when focus is orphaned; it captures the opener on open and restores it on
  close, which is what returns the cursor to a picker trigger.

## Pickers: one component, and the mode decides the keys

Since 2026-07-29 every field over stored data is `components/ui/data-picker.tsx`
(`DataPicker`); the ~15 `*-picker.tsx` files are ~30-line adapters over it. Which
keys apply depends on which of its two modes is showing, and that split is the
design — see `doc/ui/LAYOUT.md` §5a.

**List mode is a dropdown, so it is NOT modal.** `DataPicker` owns these keys itself,
on the trigger, exactly as `Combobox` does:

- ↓ opens; ↓/↑ then move the highlight, clamped. ↑ on a CLOSED picker bubbles, so
  the provider moves to the field above — ↑ must never be a second way in.
- Enter picks the highlight, closes, and leaves focus on the field. Closed, it
  bubbles, so the *next* Enter moves to the next field. Staying put is deliberate:
  picking a value and moving on are two decisions, and one keypress doing both
  means a mis-pick is three fields ago by the time it is noticed.
- **Tab closes without committing and does NOT `preventDefault`.** Trapping Tab here
  would make a dropdown a dialog in disguise.
- Escape closes the list only, and MUST `preventDefault` — the page-level Escape is
  the next layer, so a list that closes quietly navigates off the screen too.
- **Ins** adds, **F2** modifies the highlight, **Ctrl+Del** deletes it. These exist
  because Tab cannot reach the row icons in a non-modal panel, and they are legacy-RP
  muscle memory. `Ctrl+Del` and not plain `Delete`: the trigger is a text box the
  operator is typing a filter into.

**Form mode (Add / Modify / Delete) IS modal** — scrim, `role="dialog"`,
`useModalGuard` — and reuses `pickerKeyDown` from `components/masters/picker-keys.ts`
with `active: false`:

- `onClose` unwinds **one** layer: form → list; only from the list does the panel close.
- `active: false` means ↑/↓/Enter belong to the form's own fields — the operator is
  typing a record, not choosing one. Escape and the Tab trap stay live, because both
  are about the panel itself.
- It traps Tab. The panel portals to `<body>`, outside any `Sheet` trap; before this,
  Tab walked into the form behind the scrim.

**Do not route list mode through `pickerKeyDown`.** Its Tab branch traps focus, which
is right for a modal and wrong for a list you must be able to Tab straight past.

## Accessibility trade-off, stated plainly

Two deliberate deviations from platform convention, both accepted for a
fixed-workstation ERP whose operators are trained on exactly this model, and
neither to be extended to public-facing surfaces without revisiting:

- **Enter moves rather than activating the focused control.** Real buttons and
  textareas keep their native Enter, so the deviation is now confined to fields —
  but a screen-reader user on the last field of a form will still find Enter
  committing it. Milder than it was: between 2026-07-28 and 2026-07-31 Enter
  committed from *any* control, which is what made it a footgun for sighted
  operators too.
- **Escape navigates.** Any layer that swallows Escape without `preventDefault()`
  turns one press into "close the dialog AND leave the page".
- **Tab never reaches a button.** Save, Cancel, ✕ and a child row's Remove are off
  the Tab path on every surface (client 2026-08-04), so a keyboard-only user cannot
  reach them the way a platform-conventional form would allow. Each keeps a key —
  Enter off the last field, Ctrl+S, Escape, Ctrl+Del — and the shortcuts sheet
  (`components/shell/shortcuts-provider.tsx`) names all four, which is the only
  reason this is defensible: the controls are moved off the typing path, not
  removed from the document. They stay focusable and stay in screen-reader order,
  which `tabindex="-1"` would not have allowed. Do not extend this to a
  public-facing surface without revisiting it.
