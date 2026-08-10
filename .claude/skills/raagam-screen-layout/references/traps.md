# Traps

Every entry here shipped as a real defect. They are recorded because each one looks
like a reasonable thing to do right up until it does not work, and several came back
after being fixed once.

---

## 1. Save is dead and nothing on screen says why

**Shipped in** `customer-master-screen.tsx:1649` and `vendor-master-screen.tsx:2240`:

```ts
canSave: !!form.name.trim() && !gstDupError && !nameDupError,
```

`nameDupError` renders on **Identity**; `gstDupError` renders on **General**. Only one
section is mounted at a time, so an operator on Identity with a colliding GST number
sees a dead Save button, no error anywhere, and no way to reach the cause.

**Two separate faults.** The gate is hand-assembled, so it is a list a screen can forget
to extend. And `MasterFullScreen` had no way for a parent to switch section, so even a
screen that *knew* could not act.

**Do:** derive `canSave` from `sectionValidity`, feed `bySection` into
`section.problems`, and supply `footer.onBlockedSave` that toasts `first.message` and
calls `goToSection(first.section, "problem")`.

**Do not** try to find the offending field by querying the DOM. An inactive section is
not rendered, so a blank mandatory field there carries no marker to find.

---

## 2. Disabling Save silently reroutes Ctrl+S

`submitTargetOf` (`lib/focus.ts`) resolves a surface's primary action to the footer's
**last non-disabled button**. Disable Save and Ctrl+S and Enter-off-the-last-field fall
through to "Save as Draft" — or to Cancel, which is the 2026-07-25 defect.

**Do:** supply `onBlockedSave` so Save stays enabled and all three entry points reach
one handler. Omit it and the button behaves as before; that is the opt-out.

---

## 3. A footer stranded above a strip of empty page

The page mount was `min-h-[70vh]`. `sticky bottom-0` can only reach the bottom of *its
own container*, so a container that stops short of the scrollport parks Save halfway up
the screen with dead page beneath it.

**Do:** `min-h-0 flex-1` on the shell and `flex h-full flex-col` on the host. Guessing a
`calc(100dvh - <chrome>)` is fragile; the shell already sits inside a `<main>` with a
definite height.

---

## 4. A floating widget on top of the Save button

The bug-reporter FAB covered Save on the page mount. `app/globals.css` already lifts it
to `bottom: 4.5rem` "because every full-screen master editor and every Sheet drawer's
sticky footer places its primary Save button in the same bottom-right corner" — an
assumption that held only while footers sat at the **viewport** bottom.

The first fix was a ~96px right gutter on the footer. That was papering over the
geometry: the real fix was making the page mount end where the overlay ends, after which
one existing CSS rule covered both surfaces again and the gutter was deleted.

**Do:** when a shared rule stops working for a new surface, check whether the surface
broke the rule's assumption before adding a second rule.

---

## 5. A reload guard that never lifts

```ts
useUnsavedGuard(mode === "edit" || isPending);   // WRONG on a route
```

`mode === "edit"` is true for as long as the editor is open, so the silent PWA
auto-update is pinned off for the whole session on that route — not just while work
would be lost. AGENTS.md records the same failure for an ungated tooltip flag.

**Do:** gate on a real `dirty` flag set by `set()` and by each grid mutation, cleared by
`openAdd`/`openEdit`. **Do not** derive it from "do fields hold values" — on an existing
record they always do, so it would announce "Unsaved changes" before a key was pressed.

---

## 6. A `*` that holds nothing

`<Label>Date *</Label>` — the asterisk typed into label text. It looks identical to a
required field and does nothing: no cursor hold, and `--check required-hold` cannot see
it either.

`required` is read through React context (`RequiredScope` → `useRequiredHold` →
`data-required-empty`), so a hand-rolled `<div><Label/><Input/></div>` is *structurally*
invisible to it. The star was not wired wrong; there was nothing for it to wire to.

**Do:** `<Field label="Date" required>`. One prop, both halves.

**This one shipped, twice, and the second half is the lesson.** Reported 2026-08-10:
Material ▸ New Yarn ▸ Category ▸ "+ Add" → a blank Name in the quick-create sheet let
Tab, Enter and ↓ straight past. The cause was exactly the shape above. But it was never
one screen — the identical markup was in `data-picker.tsx`'s own inline "+ Add" form, a
**primitive**, so the same dead star sat behind ~160 picker call sites, plus the Country,
Currency and Bank add sheets. Six of the seven picker-reachable create surfaces did not
hold.

**Two things worth carrying:**

- **Suspect the declaration before the mechanism.** The obvious suspect was the
  `RequiredScope` reset that `Sheet` and `DataPicker` put at their portal boundary
  (trap #13 below). It is innocent: it clears *inherited* requiredness and a `<Field
  required>` inside provides its own context, which wins. The hold was never broken; it
  was never declared.
- **Fix the primitive first.** One edit to `data-picker.tsx` reached every picker. The
  four sheets were the remainder, not the problem.

`--check required-star` now catches the shape everywhere, which `--check required-hold`
structurally cannot (trap #8).

---

## 7. Removing a field from the form nulls the column

Dropping a field from the JSX while leaving it in the Zod input with `.default(null)` is
not a harmless leftover. `headerOnly(p.data)` writes the parsed object, so **every
update writes NULL over the stored value**.

`lib/masters/process-types.ts` documents the correct shape: `commodity_id` is
deliberately absent from the schema so saves cannot touch it.

**Do:** to withdraw a field, remove it from the form **and** from the Zod input, and
leave the column alone. Measure the blast radius first — who else selects it.

---

## 8. A clean audit that never ran

`audit_layout.py`'s `is_editor_screen()` (line 157) inspects a file only if it matches
`<(Sheet|MasterFullScreen|DetailSection|SectionGrid|FieldGrid)` or contains
`@container/editor`.

`style-master-screen.tsx` reported **clean on all 12 checks** while writing two raw
`<table>`s and three hand-rolled grid classNames. It became visible only when it imported
`MasterFullScreen`.

`--check required-hold` narrows again: only a `*-master-screen.tsx` whose types resolve
to `lib/masters/<x>-types.ts`. Exactly two files in the repo carry that filename outside
`components/masters/`, and both are invisible to it by path shape alone.

**Do:** judge by what a screen imports. A clean result on a hand-rolled screen is not a
pass — it is silence. This is the same failure mode as the `created_by` sweep, where 143
services rendered a correct-looking column with a dash in every row.

---

## 9. Tab walks out of a page-level form

A page editor that declares no `data-focus-scope` keeps native Tab order, so Tab leaves
the form and stops on buttons. AGENTS.md enumerates **~51 screens** in that state
(`--check tab-page-form`) — enumerated, not guessed, because a per-screen fix for a
contract-level rule always leaves a remainder.

**Do:** use the shell. Its content pane carries the marker on both mounts, so a page
editor cannot ship without it.

---

## 10. A hand-rolled grid row, and the fix that came back

Tab stopped on a row's Remove ✕ that the arrows and Enter both stepped over. Fixed once
with `tabIndex={-1}` on `ChildGrid`'s three layouts (2026-08-01) — and returned three
days later, because ~22 screens hand-roll a grid row instead of using `ChildGrid`.

A related one: the Sizes list on Style master was a bare flex list with **no
`data-grid-body`**, so arrow keys had never worked in it at all — for as long as the
screen had existed.

**Do:** `ChildGrid`. Never answer a keyboard complaint with a per-screen patch.

---

## 11. A nested grid cannot live in a table cell

A component that owns a *list* (its processes) cannot be a row of a `<table>` — there is
nowhere for the list to go.

**Do:** switch that grid to `forceCards listRows frameless` + `renderMobileRow`, and put
the nested `ChildGrid` inside the rendered row. That is the one arrangement `lib/focus.ts`
already understands as "a row with a nested grid" — `tabFieldsIn` walks into it,
`enterNestedGrid` opens an empty one, and `fromChildGrid` hands ↑/↓ across the boundary.
`material-attribute-master-screen.tsx` is the working precedent.

---

## 12. A totals row that is really a grid row

A totals band placed inside `<tbody data-grid-body>` is counted by `ownDescendants` as
navigable: ↓ from the last data row lands in the totals, and Enter there stops adding
rows. A totals band computed by the caller is also wrong whenever the grid paginates —
it would sum the visible page.

**Do:** declare `ChildGridColumn.total`. The component places the band outside the
navigable body and computes over all rows.

---

## 13. The portal `RequiredScope` reset is innocent — do not "fix" it

`Sheet` (`sheet.tsx:234`) and `DataPicker` (`data-picker.tsx:1069`) each open with
`<RequiredScope required={false} label={null}>`. It looks like it would suppress a hold
inside a sheet. It does not.

It exists because `RequiredScope` follows the **render** tree, and a quick-create sheet is
rendered by the picker that opened it. With that picker in a mandatory `ChildGrid` cell,
every empty field inside the sheet inherited "required" and held — on New Yarn opened from
Fabric ▸ Composition ▸ Yarn \*, the **optional** Purity refused Tab and announced "Yarn is
required" (client 2026-08-06).

The reset clears inheritance only. A `<Field required>` below it renders its own nested
provider, and React context resolves to the nearest one — so a sheet's own required fields
work normally. Removing the reset would bring back the 08-06 bug and fix nothing.

---

## 14. A mandatory field the form never renders

`REQUIRED_BY_FORM.YARN` lists `base_uom_id`, and the Yarn quick-create sheet supplies it
as KG rather than asking — which is correct, quick-create is KG for every slot. But when
the shop's Stock Unit master had no KG row, `kgUnitId` was null, Save was enabled anyway,
and `createMaterial` answered "Fill in Yarn Type, Base UOM before saving" — naming a field
that is not on the screen and cannot be put there.

**Do:** when a required value is DERIVED rather than asked, gate Save on the derivation
succeeding and say why it did not. A picker would have been the wrong fix; it would
contradict the KG rule the sheet is built on.
