# Failure modes

Every item here shipped as a real bug at least once. None are obvious from
reading the code.

## A fix inside a shared component still leaves a remainder

**Symptom:** the same report comes back a few days later, worded "it works on some
screens and not others".

"Tab keeps landing on the row's Remove ✕" was answered on 2026-08-01 with
`tabIndex={-1}` on `ChildGrid`'s three layouts. `ChildGrid` backs **26** screens, so
that looked like the central fix and the commit said so. It was not: ~22 screens
hand-roll their own grid row — they carry `data-grid-row` (so the arrows already
worked) but render a plain focusable ✕ — and every one of them still had the bug.

The tell was available before shipping: the *rule* being restored was "Tab agrees
with the axis the grid declares", and that rule lives in `lib/focus.ts`, not in a
component. **Ask what the screens that do NOT use component X will do.** If the
answer is "the old thing", the fix is in the wrong layer. Tab is now delivered by
the provider and targets `isFieldLike`, so the 22 were fixed without being opened.

The same shape produced the `<td>` grid bug and the ~195-surfaces-vs-5-bindings
inventory. It is the single most repeated mistake in this contract's history.

## Half the surfaces were never trapping Tab at all

**Symptom:** Tab behaves differently on a page form and on an overlay, and on a
hand-rolled overlay it walks into the list page behind the scrim.

Before 2026-08-04 Tab was handled in exactly two components. `Sheet` and
`MasterFullScreen` ran `cycleTab`; everything else — plain page forms, the
`useOverlayFocus` overlays (which give autofocus and Escape but no trap), and
`document-no-format-master-screen`'s hand-rolled `fixed inset-0` editor — had raw
native tab order, where the header ✕ is `items[0]` and there is no boundary at all.

Delivering Tab from the provider fixes the trap and the ordering together, because
both are properties of "who owns the key". A surface joins by declaring itself an
editor (`isEditorScope`); the ones that already carried `data-focus-scope` or a
dialog role joined without an edit.

## A layer that closes on Escape without `preventDefault` also leaves the page

**Symptom:** one Escape dismisses the picker *and* navigates back a screen.

The page-level Escape (`keyboard-nav-provider.tsx`) is bound to `window`, so it
runs after every `document` handler and reads their `preventDefault()` as "already
handled". A layer that closes silently is invisible to it. `Sheet` and
`MasterFullScreen` both had exactly this shape until Escape gained a page layer,
and 12 of the 14 dialog pickers had no Escape handler at all.

Never move the page-level handler to `document` to "fix" an ordering problem — it
would then run *before* the layer it is supposed to defer to, and every Escape
anywhere would leave the page.

## A hold keyed off `aria-invalid` cages every blank required field

**Symptom:** Tab does nothing on the first field of an empty form.

`ValidatedInput` sets `aria-invalid` **live** — before blur, before anything is
typed — for required-but-empty and format-mismatched values. That is correct for
the Enter gate (Enter *commits*, so it may refuse) but catastrophic for anything
that blocks *movement*: every blank required field would trap the cursor and a
form could not be tabbed through at all.

The duplicate hold therefore keys off its own narrow marker, `data-dup-error`,
emitted only by `dupFieldProps()`. If you are adding any behaviour that refuses a
movement key, give it a marker of its own — do not reach for `aria-invalid`
because it is already there.

## A stale duplicate error outlives the value it describes

**Symptom:** the operator fixes the duplicated name, presses Tab immediately, and
is still held — for about half a second, unpredictably.

`useDuplicateCheck` debounces 300ms and then makes a server round trip. A plain
`useState` keeps the old answer until the new one lands, so in that window the
message on screen describes the *previous* value. Harmless while the error only
tinted a border; a lockout once it holds the cursor.

The fix is to key the state to an `askKey` built from the exact inputs and derive
the visible error during render — the error is only real for the value it was
computed for, so it goes null in the same render as the keystroke. The same
comparison makes a hung or failed check fail **open**: no answer, no hold.

## A query failure reported as a duplicate is an unbreakable cage

**Symptom:** a field holds the cursor with a message like *"permission denied for
table items"*, and nothing the operator types clears it.

`dup-guard.ts` originally returned `{ ok: false, error }` for *both* "this name is
taken" and "the query failed". Identical to the save path, which only cares that
it must block — but a duplicate clears when the value changes and a broken query
never does. One RLS misconfiguration would have caged every screen, with Escape
as the only exit.

Hence `kind: "duplicate" | "failed"`. Only `"duplicate"` may hold. Any future
signal that immobilises the operator needs the same question asked of it: **can
the person actually make this go away?**

## `Combobox` must close on Tab without consuming it

Tab is pure movement. An open `Combobox` has to close (uncommitted — "Tab never
changes a value") and **not** call `preventDefault`, or focus stays put: the move
itself belongs to native tab order or to `Sheet`'s trap, both of which stand down
on `defaultPrevented`.

The historical version of this trap was the opposite — the provider used to own
Tab for comboboxes so a second press could open the list, and consuming Tab in the
component broke the state that let a third press escape the field. That whole
mechanism (`openedFor`) is gone; if you find a reference to it, it is stale.

## Deleting a key's owner without checking who else relied on it

**Symptom:** a picker cell inside a line-items grid cannot be opened from the
keyboard at all.

`tabOpensList` had **no** grid exclusion, while `arrowOpensPicker` always bailed
inside `[data-grid-row]`. So Tab-Tab was the *only* keyboard way into a grid
picker — a load-bearing asymmetry nobody had written down. Deleting Tab-opens-list
handed the job to ↓ on forms and left grid cells with neither key, only Space and
an Alt+↓ nobody could guess (client 2026-07-28).

The fix is `gridKeyNav` returning early on ↓ over a trigger. Note it must return
**without** `preventDefault` — the provider bails on `defaultPrevented`, so a grid
that "handles" the key by consuming it swallows the opener instead of delegating.
Standing down and doing nothing is how a layer delegates in this contract.

## ↑ must not be a second way to open a list

With Tab no longer able to walk past an open list, a field whose ↑ *and* ↓ both
open its list has no key that moves *up* out of it. `arrowOpensPicker` claims ↓
only, and `ownsArrowKeys` claims `role="combobox"` only while
`aria-expanded="true"` — a closed combobox has to let ↑ reach `arrowNavigate`.

## React `stopPropagation` is invisible to the provider

React 19 + Next attach delegated listeners to `document` — the same node the
provider and `Sheet` use. A React-level `stopPropagation()` therefore **cannot**
stop them: they are not ancestors, they are siblings on the same node.

Only `preventDefault` is visible. Every control that owns a key must call it.

## Portaled pickers are outside the Sheet

Most dialog pickers `createPortal` straight to `<body>`, so their DOM is not
inside the Sheet's container and they never join `sheetStack`. The Sheet stays
"topmost" and eats their Escape.

- `Sheet` guards with `inForeignModal()` — a `[role="dialog"]` not contained by
  its root.
- `MasterFullScreen` guards with `hasOpenModalInDom()`, because it is a bare
  `fixed inset-0` div with no dialog role and cannot rely on containment.

## A closed `Sheet` is still tabbable

The closed state is only `opacity-0` + `pointer-events-none`, and
`offsetParent !== null` does **not** filter an opacity-0 element. Every field of
every closed Sheet stayed in the page's tab order, so tabbing off the last control
of a page walked into an invisible form. Needs `inert={!open}`.

## A Sheet child's `autoFocus` fires once, while closed

`Sheet` renders its children unconditionally, so a child's `autoFocus` fires at
mount — while the sheet is still closed — and never again on open. Focus stayed on
the trigger button *outside* the dialog, and since pickers bind ↑/↓/Enter to their
list container, none of those keys reached it: the list could only be driven with
the mouse.

Portal-based pickers were unaffected because they mount their content on open,
which is why this only bit the Sheet-based ones. `Sheet` now calls
`focusFirstField()` on open for all sizes.

## `gridKeyNav` bypasses rules enforced only in `enterSaves`

`gridKeyNav` calls `stopPropagation()`, so anything enforced only in `enterSaves`
— such as the `aria-invalid` gate — is silently skipped inside grids. Duplicate
the rule.

## Grid navigation keyed off `<td>` silently did nothing

`gridKeyNav` must key off `data-grid-row` / `data-grid-body`, **not**
`closest("td")`. Every Material grid renders cards, not a table, so the `<td>`
version did nothing there — which is exactly why arrow keys "worked on some
screens and not others". Bind it to both renderers.

## Nested grids could not hand off to their parent

Deriving the grid from the event target made a parent re-derive the *same* inner
grid, find the same boundary, and return. Use `e.currentTarget` and
`ownDescendants(...)` scoped by the nearest marker, so a child grid's fields are
correctly not the parent's.

## A scoping fix for the arrows quietly took Tab out of the nested grid

The `ownDescendants` scoping in the entry above is right, and applying it to **Tab**
was wrong. Scoped to the nearest `data-grid-row`, a nested panel's fields are not the
outer row's columns — which is what the arrows need, and what stopped ↓ landing on the
2nd value of the *next* line. Tab was built on the same query and therefore skipped
the nested panel entirely: on Material Attributes, the value list under a row could be
reached only with the mouse (client 2026-08-05, screenshot 2172).

**One selector serving two keys that want different answers is the trap.** Tab's job
is to visit every field; the arrows' job is to be spatial along one axis. They are
split now — `tabFieldsIn` (every field in the row, DOM order) for Tab, `ownDescendants`
for ↑↓←→ — and the divergence is the one sanctioned one, written down in both places.
Note the arrows never needed the flat list: `gridKeyNav`'s `fromChildGrid` branch had
been carrying ↑/↓ across the boundary all along, which is why nobody noticed Tab was
not.

## Replacing a grid's blank row with an "+ Add" button removes the keyboard's only way in

The Material Attribute values list carried a permanently-open blank input. It was
replaced by a "+ Add value" button on 2026-08-04 (the client found the always-visible
box cluttered), with the note *"the keyboard is unaffected, because the button was
never its path: Enter off the last value still opens the next box"*.

Every clause of that is true and the conclusion is false. **Enter off the last value
needs a value to stand on.** With an empty list there was no field to be in, and Tab
lands on fields — never on a button — so the FIRST value of every manual attribute was
mouse-only. The blank row had been the entry point without anyone writing that down.

The fix is `enterNestedGrid` + a `data-row-add` marker: Tab into an empty nested grid
clicks its Add control and lands in the box that appears. When you take away a field,
ask what could only be reached *through* it — a button is not a replacement for a field
on a keyboard-only surface.

## Enter / Ctrl+S resolving to Cancel

Both must target the last footer button **by position** and no-op when it is
disabled. "Last *enabled* button" resolves to Cancel whenever Save is disabled by
a validation error, so the save key silently discarded the form.

**The other half of this is live again, so read it as a rule and not as history:**
an unconfined Enter-advance walks off the last data field onto the footer's
**first** button — Cancel — where the next Enter discards everything. That is why
`orderedFocusables` ranks by `data-focus-region` at all, and why `enterAdvances`
carries *two* defences rather than one. See the entry below.

## A global key needs an exception list, not just a bail-out list

Textareas and buttons were excluded from the Enter handler because they have their
own Enter. **Checkboxes and radios have none** — natively Enter does nothing on
them, Space toggles — so they fell straight through to whatever the global meaning
was, which at the time was "save the record". The operator pressing Enter on a tick
box got no tick AND an attempted save of a half-filled form (client 2026-07-28).

The lesson generalises: when a key is given a global meaning, "which controls
already own this key?" is the wrong question. The right one is "on which controls
would this meaning be *wrong*?" — a set that includes controls where the key
currently does nothing at all.

The same exclusion had a twin in `ROW_FIELDS` (`child-grid.tsx`), which left every
arrow key dead on a tick-box cell inside a `ChildGrid` — Tab was the only way off
one. A checkbox is now part of a row's column axis; a **radio** is still excluded,
because ↑/↓ natively move within a radio group and stealing that breaks it.

Ragged rows are not a hazard here: `focusColIn` clamps to the destination row's
last field, so a grid that renders a tick box on only some rows still navigates.

## Enter that cannot save must not be swallowed — and the test has to run FIRST

Swallowing Enter unconditionally makes it a dead key in every list-page filter box
and search field — the most-used inputs in the app.

While Enter only saved, this was enforced at the *end*: `submitSurface` returned
false when the scope had no footer, no registered `"save"` and no submit button,
and `preventDefault` was only called on true. **That placement stopped working the
moment Enter also advanced**, because advancing happens before any save — Enter in
a search box would have started walking the page furniture and never reached the
test. `canSubmitSurface` moves the question to the front of `enterAdvances`, and it
has to answer *without* firing anything, which is why `ShortcutsApi` carries a
non-firing `has()` beside `fire()`. Asking the old way meant saving the record to
find out whether Enter was allowed to move.

The generalisation: when a key grows a step that runs earlier than the old one,
every gate the old step relied on has to be re-placed, not just re-read.

## Enter-advance must target fields, not focusables

`isFieldLike` exists so Enter can never land on a button. Region confinement
(`regionItems`) is the other defence, and neither is redundant: confinement only
helps on surfaces that stamp `data-focus-region`, which `Sheet` and
`MasterFullScreen` do and most plain page forms do not. On an unmarked form,
"the next focusable" after the last input is Save or Cancel — and Enter landing on
Cancel means the *next* Enter discards the form, which is the trap above.

Order is **sequential**, deliberately not `spatialNeighbour`. Enter and Tab are both
forward keys now and two forward keys that disagree is the complaint this contract
exists to prevent; and geometry returns `null` at every ragged edge, so it cannot
tell "there is no next field" from "I couldn't compute one" — which is precisely
the signal Enter needs, because that is where it commits.

## The content edge of a rail editor is not the end of the record

**Symptom:** Enter on the last field of the *first* section saves a half-filled
record — the exact bug Enter-advance was introduced to remove, reappearing one
section along.

`MasterFullScreen` mounts one section at a time, so "no next field" is true at the
end of *every* section, not just the last. Enter must try the next pane before it
tries to save. Tab solved this locally with `cycleTab`'s `onContentEdge`; Enter is
handled by the global listener and cannot see a callback passed to another
function, so the pane publishes it through `registerContentEdge` (`lib/focus.ts`).

Two things that look optional and are not:

- **Register on the element carrying `data-focus-scope`, not on the inner content
  div.** The lookup walks *up* from the scope a field resolved to; a registration
  on a descendant of that scope is never found.
- **One callback shared by both keys.** If Tab and Enter ever hold separate copies,
  they will disagree about where a section ends, and the disagreement shows up as a
  premature save rather than as a navigation glitch.

## A local Enter handler silently opts its screen out of the contract

**Symptom:** one screen still saves from field one after the app-wide rule changed.

Anything that calls `preventDefault()` on Enter is invisible to the provider — that
is the bail-out the whole architecture rests on, and it means a per-screen Enter
handler does not merely *add* behaviour, it **replaces** the contract for that
surface and keeps doing so through every future change. Three existed when Enter
became an advance key (`simple-master-screen`'s inline row,
`category-quick-create-sheet`'s Name field, and the picker's own Add form), and all
three would have quietly kept committing from the first field.

The fix is never a second local handler. A surface that needs a keyboard-reachable
save registers `"save"` through `lib/shortcuts.ts` and lets the contract find it —
which also gets it Ctrl+S for free. Note `simple-master-screen` could *not* be
solved with a `data-focus-region="footer"` marker: it renders Save **then** Cancel,
and the footer rule takes the last button by position.

## Removing the focused node strands the cursor, silently

**Symptom:** pick a value from a ⓘ picker and the cursor is gone — no caret
anywhere, and the only way back to the field is the mouse.

A portal picker renders into `<body>` and unmounts on pick. Chrome moves focus to
`<body>` when the focused node is removed and **does not fire `blur` or
`focusout`**, so no listener can react to it — which is why this cannot be solved
with a focusout handler. `Sheet` had solved it for itself years earlier with
`openerRef`; the 14 portal pickers had nothing.

The fix is a focus HISTORY (`rememberFocus` / `restoreFocusIfLost` in
`lib/focus.ts`, fed by one `focusin` listener) plus `usePickerFocusReturn(open)`
in each picker, which runs on the close transition — after React has removed the
portal — and focuses the first history entry still in the document.

Do NOT try to express this as "the last element outside an overlay": `Sheet` also
carries `role="dialog"`, so that selector excludes every field on every masters
editor. Depth in the history is what distinguishes them, not a selector.

## A bare `.focus()` kills → but not ←

**Symptom:** "→ doesn't move to the next field." ← does. Same field, same form.

`atCaretEdge` gates ←/→ on the caret, so where a programmatic focus leaves the
caret decides whether the key works. A bare `el.focus()` leaves it at **0** —
which already *is* the edge for ←, and is `value.length` characters away from the
edge for →. Hence the asymmetry, which is the giveaway when it is reported.

Always move focus with `focusField()` (`lib/focus.ts`). The helper existed three
times over — inline in `arrowNavigate`, inline in `focusFirstField`, copied into
`child-grid.tsx` — and the one path that skipped it was `Sheet`'s Tab trap, i.e.
every masters editor (client 2026-07-28).

Related, same root cause: native Tab leaves the whole value **selected**, so
`atCaretEdge` must treat a full-value selection as the edge or the first ←/→ is
spent collapsing a selection the operator never made.

## A picker's list keys bound to the search box

Bind `pickerKeyDown` on the **dialog**, not on the search `<Input>`. Bound to the
input, ↑/↓/Enter stop working the moment focus moves onto a result row or onto
Cancel — which is most of the time, since the dialog has a focus trap.

Two consequences of binding on the dialog, both handled inside `pickerKeyDown` and
both easy to reintroduce by hand-rolling it:

- Enter on a real `<button>` must fall through, or Enter on Cancel picks a row.
- A picker with an inline Add/Modify form must pass `active: mode === "list"`, or
  the list handler steals ↑/↓/Enter from the form's own fields.

## `tabindex="-1"` needs a guard on every selector branch

In `FOCUSABLE_SELECTOR`, a trailing `[tabindex]:not([tabindex="-1"])` clause is a
*separate* comma-branch and only governs generic elements. Without a per-branch
`:not([tabindex="-1"])`, `input:not([disabled])` still matched
`<input tabindex="-1">`, and every `skipTab` / auto-generated field stayed an
Enter-advance stop and a focus-trap boundary. Native Tab skipped them; nothing
else did.

## Number inputs silently changing value

`ownsArrowKeys` deliberately omits `number`. Arrows natively spin a number input,
and in an ERP a stray arrow silently editing a quantity is a data bug, not a
feature. Navigating is both more consistent and safer.

## A section switch unmounts the field you are standing on

`MasterFullScreen` mounts one section at a time, so the Tab that crosses a section
boundary destroys its own `document.activeElement`. Two consequences, both of which
strand the cursor on `<body>` if skipped:

- The landing focus must be deferred past the commit — the fields being aimed at do
  not exist during the handler. The 60 ms timeout in the autofocus effect is that
  deferral; it is not a "wait for animation" hack.
- A section with **no focusable at all** makes `focusFirstField` return false and
  nothing gets focused. Fall back to the rail button (the effect does), or the
  operator's next keystroke reaches nothing.

Related: the direction of arrival matters. Shift+Tab into the previous section must
land on its **last** field, not its first, or Shift+Tab and Tab together bounce the
operator between the same two fields forever. That is what `focusLastField` and the
`landingRef` intent are for.

## Escape on `MasterFullScreen` was once correctly refused

`MasterFullScreen` originally had no Escape-to-close, documented as "closing a
dirty 30-field form must be an explicit ✕ / Cancel". That was a sound objection to
a *silent* Escape — the only kind that existed then. It is answered by
`confirmDiscard()`, not overruled. If the confirm is ever removed, the original
objection returns with it.

## `window.confirm` freezes browser automation

`confirmDiscard()` uses `window.confirm`. Triggering it through a browser-driving
tool blocks all further browser events and hangs the session. Verify the dirty-Esc
path by hand.

## A held field that refuses the key which FILLS it cannot be satisfied

The required hold (client 2026-08-04) refuses movement on a blank mandatory field.
Refuse the keys that *choose a value* along with it and the field becomes
impossible: it cannot be filled, cannot be left, and the only way through the form
is the mouse. On these operators — keyboard-only by definition — that is not a
rough edge, it is an unusable screen.

It shipped. The first cut exempted ↓-opens-a-list and stopped there, so on a held
Item Class the operator pressed ↓ (list opened), ↓ (highlight moved), **Enter
(nothing)**. Reported the same day, and reported as happening "in a lot of child
forms" — because every picker in every grid had it.

`keyFills` (lib/focus.ts) is the rule now, with vectors in
`scripts/check-keyboard-holds.mts`:

| state | keys that FILL | still refused |
|---|---|---|
| list open | ↑ ↓ Enter | Tab |
| list closed | ↓ | ↑ Enter Tab |
| native `<select>` | ↑ ↓ | Enter Tab |
| text field | — | all of them |

Two things it is easy to get wrong when extending this:

- **Tab belongs in no branch.** Tabbing out of an open list leaves without
  choosing, which is the exact departure a hold exists to refuse. An open list
  must never become an escape hatch from a mandatory field.
- **It is NOT `ownsArrowKeys`.** That predicate answers a different question —
  "does this control handle ↑/↓ itself, so the spatial walk must stand down?" —
  and a **child-grid row answers yes**, because ↑/↓ move a row there. Moving a row
  is still moving. Reusing it would let ↑/↓ walk straight out of a held cell.

The general form, worth carrying to any future refusal: refuse a key's NAVIGATION
meaning, never its EDITING meaning. It is the same reasoning that keeps ←/→ moving
the caret inside a held text box and refuses only the press at the edge.

## A blank mandatory cell in a freshly-added grid row needs Ctrl+Del

Same shape, different key. Add a row to a child grid, leave a mandatory cell blank,
and every movement key is refused — so the operator cannot fill it, cannot leave
it, and cannot reach the row's ✕ either, because Tab has visited fields only since
2026-08-04 and the ✕ is not a field.

`Ctrl+Del` is the exit, and it survives because `onHold` bails out on every Ctrl/⌘
chord *before* it consults the hold. Anything that narrows that bail-out — "only
allow Ctrl+S", say — turns an accidentally-added row into a dead end whose only
escape is abandoning the whole record with Escape.

## A `*` that was decorative becomes a cage

`data-required-empty` is emitted wherever `required` is declared — `<Field
required>`, a picker's own `required`, `ChildGridColumn.required`. Across ~51 files
those declarations pre-date the hold and were only ever asked to draw a red star.

Where the star was accurate, the hold is the feature. Where it was aspirational —
a field the screen *wishes* were filled but saves happily without — it now stops
the operator dead. Marking a field `required` is no longer cosmetic, and the test
is not "should this usually be filled?" but "must the record be unsaveable
without it?"
