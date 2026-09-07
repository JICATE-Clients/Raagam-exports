---
name: raagam-screen-layout
description: "Raagam ERP's screen layout contract — which surface a screen uses (the list shell, a Sheet, or the section-rail editor mounted as an overlay or as a page route), the operator's five standing rules for a converted screen (its own name as the first rail row, no problem badge, an overlay that covers the app chrome, grids that wrap instead of scrolling sideways and do it in ONE frame rather than a box per row, everything on the keyboard contract), the de-clutter rule that blanks field placeholders and drops a grid's caption band and prose empty state, the one field width every field takes, line items as ChildGrid rather than a hand-rolled table, and the Cancel / Save as Draft / Save footer whose canSave is DERIVED rather than hand-assembled. This skill should be used when building or changing any screen under app/(app), when choosing between Sheet and MasterFullScreen, when a record needs sections or tabs, when wiring Save or a status/workflow bar, when a list screen needs its toolbar and row actions, and whenever a screen is about to write its own grid-cols-*, col-span-* or <table>. Keys and focus are raagam-keyboard-contract's; pickers and icon fields are raagam-masters-picker-wiring's; reports are raagam-report-data's."
---

# Raagam screen layout

## The rule that governs everything

**A screen composes primitives; it does not draw.** No screen writes `grid-cols-*`,
`col-span-*`, `gap-*` or a `<table>`. Width, spacing and structure are properties of
the primitives, decided once, so 232 screens cannot drift into 232 opinions.

This was written down before and ignored by 58 of 60 master editors, because nothing
checked. 92 screens had reached 29 different `grid-cols-*` values before anyone
counted. `scripts/audit_layout.py` is the counter — and §"Verifying" below explains
the one way it can still miss.

## Pick the surface

```
Is it a LIST of records?
  └─ yes → MasterListShell            components/masters/master-list-shell.tsx

Editing ONE record — how many fields?
  ├─ ≤ 7, no child grid    → Sheet + one DetailSection
  ├─ 7–15, no child grid   → Sheet + SectionGrid / SectionColumn
  └─ > 15, or ANY child grid, or the record has stages
                           → MasterFullScreen (the section rail)

MasterFullScreen — which mount?
  ├─ a MASTER (reference data)  → mount="overlay", opened over its list
  ├─ a DOCUMENT whose editor is
  │  a MODE of its list route    → mount="overlay"   ← see "The operator's five"
  └─ a DOCUMENT on its OWN route
     (/orders/[id]) with a link
     worth sharing               → mount="page"
```

A master is transient and sits over its list. A document on a route of its own needs a
shareable link, a working Back button and a screen that survives a refresh — and gets
`mount="page"`.

**But most "documents" in this app are not on a route of their own.** They are a
`mode === "edit"` state inside the list route, so there is no deep link to protect and
no Back button to keep working: the URL is identical either way. Those take
`mount="overlay"`, for the reason in "The operator's five" below.

**A page mount requires its host to be `flex h-full flex-col`.** The shell takes
`flex-1 min-h-0` and needs a definite height to divide — `app/(app)/layout.tsx`
provides one. Leave the host as `space-y-4` and the editor sizes to its content,
stranding the footer above a strip of dead page.

Read `references/shells.md` before the first page mount. It is the material that
exists in no other document.

**Picked "Sheet" for a nested `[Click]` sub-detail? Its SIZE is a separate decision** —
AGENTS.md's "A sub-detail Sheet's size" (STANDING): `size="sm"` by default, `"md"` only
when the sheet's own content is a `ChildGrid`, plus `alignToPane` / `origin` / a
`SubSheetFooter` when the sheet has nothing of its own to save. Read it before wiring a
new `[Click]` popup — `Sheet`'s own default (`"lg"`) is wrong for this shape and nothing
catches it yet.

## The operator's five (STANDING, 2026-08-10)

Five rules the operator gave directly, working through Material BOM Amendment. They
outrank the defaults above where they disagree, and each says why — because four of the
five look like regressions to anyone reading the code without this section.

**1. THE SCREEN'S OWN NAME IS THE FIRST RAIL ROW.** A record's header fields — its date,
its customer, its document number — are a SECTION, not a band floating above the rail.
So Material BOM Amendment's rail reads: Material BOM Amendment · Items · Processes ·
Calculated Quantities.

Not cosmetic. The header band is where a screen hand-rolls: MBA's was a full-bleed
`CardBody` of `<div><Label/><Input/></div>` pairs with a literal `"Date *"` typed into
the label text — so the red star had nothing behind it and `useRequiredHold` never ran
on that screen at all. A field that is not in a section is a field the primitives cannot
see. `amendment-screen.tsx`'s "Order Info" is the same move.

**2. NO `problems` BADGE ON THE RAIL.** Pass `done`, never `problems`. A section with a
blank mandatory field shows the quiet empty dot, not a red count.

This one IS a real loss and the operator accepted it knowingly: one section is mounted at
a time, so the badge was the only thing that could say WHICH section blocked Save before
Save was pressed. What must therefore be present is `footer.onBlockedSave` — Save stays
clickable, names the missing field in a toast and steers the cursor to it. **Dropping the
badge without wiring `onBlockedSave` leaves a dead Save button and no way to find out
why**, which is the exact bug `sectionValidity` was built to end.

Keep `sectionValidity` regardless: `canSave` must stay DERIVED (rule 5 below). Only its
`bySection` output goes unused.

**3. THE EDITOR COVERS THE APP CHROME.** `mount="overlay"` for a record editor that is a
mode of its list route. A page mount left the module sidebar beside the section rail, so
entering a record put TWO navigation lists on screen — the app's and the record's — and
left ~1090px for a 13-column grid.

An overlay mount changes two things a converter must not miss:

- **`header` becomes required.** The overlay covers the route's `PageHeader`, so without
  it nothing on screen names the record being edited.
- **The screen must call `useUnsavedGuard(dirty || isPending)` ITSELF.** The shell calls
  `useModalGuard(open)` on an overlay, and `confirmDiscard()` deliberately does not read
  that one (`reload-guard.ts`: "an open overlay is not the same thing as edited data").
  Miss this and **Escape discards a half-entered record silently.** Key it on real
  dirtiness, never on `mode === "edit"` — that pins the silent PWA auto-update off for as
  long as the operator sits on the screen.

**4. A GRID WRAPS; IT NEVER SCROLLS SIDEWAYS — IN ONE FRAME.** LAYOUT.md §6's
"no scroll-in-a-box" on the horizontal axis. A row of more than ~6 columns cannot fit
1180px minus the 228px rail, and the responsive table answers that with a scrollbar: the
operator fills the first cell, then drags a bar to reach the last one with the first
scrolled out of sight.

**THE SECOND HALF OF THAT SENTENCE ARRIVED ON 2026-08-19 AND IS THE CLIENT'S**: the
wrapping was right, the FRAMING was not. `forceCards` answers "don't scroll" by giving
every row its own bordered box, so a section holding six lines drew seven frames — the
section's, then one per row — and the operator reported the screen as a stack of boxes
rather than a table. **One frame per grid, rows divided by a hairline inside it.**

That is `flatRows`, and it is **paired with `forceCards`, never substituted for it**:
`flatRows` is a cards-mode modifier, so on its own it is a silent no-op and the boxes
stay. This is the whole trap — the prop reads like a mode and behaves like a flag.

Why `flatRows` and not the true table the phrase "table layout" suggests: the per-row
band carries the row's identity (`rowSummary`) **and its ✕, which is the `data-row-remove`
node Ctrl+Del drives**. `listRows` drops that band and makes the screen hand-roll one —
~20 lines of chrome per screen, and a Ctrl+Del target that each screen can forget. The
band is the cheapest thing on the row and the only one the keyboard contract needs.

The shape, and it is the same four props every time:

```tsx
<ChildGrid<Row>
  columns={columns}          // still the ONE declaration
  rows={rows}
  forceCards                 // drop the table
  flatRows                   // ...and drop the per-row BOX — one frame, hairline rows
  renderMobileRow={(row, i) => (
    <FieldGrid>
      {columns.map((c, ci) => (
        <Field key={ci} label={c.header} required={c.required} size="sm">
          {c.cell(row, i)}
        </Field>
      ))}
    </FieldGrid>
  )}
  onAdd={…} onRemove={…}
/>
```

Read the labels and cells off `columns` — never retype them beside it, or a new column
leaves the card and the header disagreeing. `Field` supplies the label the `<th>` used
to AND the `RequiredScope` that cards mode applies per column only when it renders the
columns itself, so `required` must be forwarded or the cell's hold is silently lost.

Below ~6 columns a table still fits and still reads better; the wrapping half of this
rule is about the ones that do not. **The one-frame half has no exception** — a table
mode grid already draws a single frame, so "one frame per grid" is true of every grid
either way, and a `forceCards` without `flatRows` is now the only way to break it.

Checked by `python scripts/audit_layout.py . --check grid-single-frame`, which fires on
a `forceCards` that declares no `flatRows` and no `listRows`. Opt out per line with a
`// grid-single-frame: exempt -- <reason>` comment; a row that genuinely draws its own
summary header wants `listRows` and passes without one.

**Any new `ChildGrid` check must read its props through `_component_open_tag`, never
`_jsx_open_tag`.** All 30 call sites are written `<ChildGrid<StyleRow> …`, and the plain
scanner ends the tag at the `>` closing the generic — so the tag carries no props and the
check reports a clean pass. That is not hypothetical: the first cut of these two checks
returned 0 and 3 against files carrying 18 `forceCards` and 42 `label`.

**4a. A BOUNDARY BETWEEN RECORDS OUTRANKS THE BOUNDARIES INSIDE ONE.** Once a grid has
one frame and no box per row, the only thing saying "a new record starts here" is a rule
and some space — and both were being drawn at exactly the weight of field chrome. The
divider was `border-border`, the SAME token and the same 1px as every `<Input>`'s edge,
and the gap between two records was 16px against the 8px between a record's own fields.
The operator could not tell one structure from the next (client 2026-08-19, screenshot
2379: "all the lines look same kind, so can't tell the next section").

`ChildGrid` owns both halves for `flatRows` / `listRows`, so no screen sets them:

- **`border-t-2 border-border-strong`** — WEIGHT and COLOUR, and it took two attempts to
  learn that colour alone is not enough. A 1px rule at `#cbd2da` shipped first and the
  client still could not see it: **every field edge on the screen is also 1px, so a 1px
  line reads as chrome whatever its shade.** Two pixels is a different KIND of line, which
  is what "a new record starts here" has to be. The token is `#9aa4b2` light / `#4d5666`
  dark (app/globals.css). "Stronger" means MORE CONTRAST AGAINST THE SURFACE, not darker —
  light mode goes darker than `--border`, dark mode goes LIGHTER; call it "darker" and the
  divider disappears in the dark theme. If it ever looks heavy, the answer is more SPACE
  around it, never less contrast in it.
- **`py-3`, not `py-2`** — 24px between records against 8px within. Proximity groups more
  reliably than any line and costs no ink, which matters because the two obvious cues are
  both closed: a **fill** is out (the row tint was removed app-wide on 2026-08-18, "no more
  that grey state in anywhere") and a **box per row** is out (rule 4 above).

**A TABLE AND AN `inlineCards` ROW ARE DELIBERATELY LEFT ALONE.** The rule scales with how
much vertical space one record occupies: a record that is ONE LINE under a shared header is
already grouped by its columns, and strengthening every line there just makes a dense table
noisy. A record that is a panel of fields — and often a nested grid beneath it — is the
case that needs a real boundary. Apply this where a record is tall, not everywhere a line
exists.

**4b. A GRID OPENS WITH ONE BLANK ROW.** Never the empty state — a header, a line of
prose and an "+ Add row" button. Entering the first line must cost no click.

`ChildGrid` does it with `seedRow`:

```tsx
<ChildGrid rows={lines} seedRow onAdd={…} onRemove={…} columns={…} />
```

It seeds once per EMPTY SPELL, not once per mount: the flag resets when rows arrive, so
opening a record that has lines and then one that has none still seeds the second. It
respects a declining `onAdd` and is a no-op under `hideAdd`, where the row count is the
caller's to fix.

A screen that still hand-rolls its tables seeds by hand — through the SAME adder its
"+ Add row" button calls, never a second copy of the row shape.
`amendment-screen.tsx`'s `seedGrids()` is the reference: eight grids, so a new amendment
used to begin with eight clicks before a value could be typed.

This is also a KEYBOARD rule, which is why it is not merely a nicety. AGENTS.md's
`enterNestedGrid` note records it: "replacing a grid's permanently-open blank row with a
button removes the keyboard's only way in — 'Enter off the last value opens the next box'
needs the operator to already be inside." Tab lands on fields; an empty grid has none, so
its only affordance is a button Tab will not visit.

**5. EVERY FIELD AND EVERY BUTTON ON THE KEYBOARD CONTRACT.** Tab lands on fields only,
Ctrl+Del removes a grid row, ↓ opens a field's list. In practice this is not extra work
— **it is what composing the primitives buys**, because the contract is driven by DOM
markers that `Field`, `ChildGrid`, `DataPicker` and `MasterFullScreen` already carry
(`data-field-trigger`, `data-row-remove`, `data-row-add`, `data-focus-scope`). A screen
that hand-rolls a `<table>` or a `<div><Label/><Input/></div>` inherits none of them.

So rule 5 is a CHECK on rules 1–4 rather than a separate task: if a converted screen
still needs a keyboard fix of its own, something above it was not actually converted.
Never answer a keyboard complaint on one screen — see `raagam-keyboard-contract`.

## The screen says nothing it does not need to (STANDING, 2026-08-19)

The de-clutter pass that removed `SectionBody` hints (51 sites) and rejected a `—` in an
empty field reached the fields and stopped. It now covers the three bands left, all on
the same test: **does this text name a state of the DATA, or describe the box it sits in?**
The second kind goes.

| Text | Rule | Survivor |
|---|---|---|
| `placeholder=` on any field | Blank it | Only a state of the record — `"No projection"`, `"Pick a Style first"`; `All` on a filter facet |
| `ChildGrid label=` (the caption band) | Omit it — the section names the grid | A `flushRows` grid, or two grids sharing one section |
| A grid's prose empty state | Delete it | One naming a CAUSE elsewhere — "No sizes in the Sizes master yet" |

**`placeholder` is not an escape hatch, and used to be one.** LAYOUT.md §3 said "an
explicit `placeholder` still wins", which is how 352 survived a sweep whose subject was
that an empty control says nothing. The two survivors above are exhaustive until the
client names a third — so `"Why is this order being amended?"` (restates its label),
`"1"` (reads as a default) and `"(auto)"` (on a field that is already `readOnly`) all go.

Reasoning and the exemption comments: `LAYOUT.md` §3 and §6. Checked by
`--check placeholder-blank` and `--check grid-caption`.

**Do NOT sweep `PageHeader description` by analogy.** 375 sites, asked and DECLINED by
the client on 2026-08-17. A rule about a field's box does not reach a page's subtitle.

## Five rules that are decisions

1. **One width.** Every field is `<Field size="sm">` — 3 of 12, four per row, ~280px.
   Nothing is sized to its own data, so a Year box and a Customer picker line up down
   the page. `lg` only inside a `SectionColumn`; `xl`/`full` are for a grid or a
   textarea that takes the row, never to make a field wider. Reasoning: `LAYOUT.md` §3.

2. **Line items are `ChildGrid`.** Never a hand-rolled `<table>`. The component brings
   Ctrl+Del row delete, `data-row-add`, required cells, pagination, mobile cards and a
   totals band. A hand-rolled grid gets none of it, and ~22 screens proved that a
   per-screen keyboard fix always leaves a remainder. Details: `LAYOUT.md` §6.

3. **`required` is declared once**, on `<Field required>`. That one prop draws the red
   `*` **and** holds the cursor while the box is blank, through `RequiredScope`
   context. A `*` typed into label text is decoration with nothing behind it — and a
   hand-rolled `<div><Label/><Input/></div>` is structurally invisible to the hold,
   because `Field` never wraps the control.

4. **The footer is Cancel / [Save as Draft] / Save.** `saveLabel` names the entity —
   "Save style", not "Save". `status` names the save state ("Unsaved changes" / "All
   changes saved" / "New style") and reads a real `dirty` flag, not a guess derived
   from whether fields hold values (on an existing record they always do).

5. **`canSave` is DERIVED.** Call `sectionValidity` (`lib/screens/validity.ts`); never
   hand-assemble `!!name.trim() && !dupError && …`. That list is one a screen can
   forget to extend, and two shipped screens gate Save on errors from a section the
   operator cannot see. Supply `footer.onBlockedSave` so a blocked Save says why and
   jumps there.

## Sections

`FullScreenSection` carries `done` (a quiet "has data" dot) and `problems` (a red
count). Derive `problems` from `sectionValidity().bySection` so a red badge and a
cursor that refuses to leave a field always mean the same thing.

Only one section is mounted at a time. **A blank mandatory field on an inactive
section has no DOM node**, so validity is computed from state — the DOM is consulted
only after the target section mounts. That is why `sectionValidity` exists and why
reading markers off the document cannot replace it.

## What this skill does not own

| Concern | Owner |
|---|---|
| Tab, arrows, Enter, Escape, holds, every `data-focus-*` / `data-grid-*` marker | `raagam-keyboard-contract` |
| Pickers, icon fields, `config_lookups` kinds, the child build recipe | `raagam-masters-picker-wiring` |
| Reports and the item fact model | `raagam-report-data` |
| Anatomy, columns, field width, grouping, child rows, row actions, density | `doc/ui/LAYOUT.md` §1–§4, §6, §6a, §9, §10 |
| CAPS, dates, duplicates, disabled rows, created columns, autofill | `AGENTS.md`, the STANDING sections |

Cite those; do not restate them. Several rules already exist in three places, and a
fourth copy is a fourth thing to keep true.

## Building a screen

1. **Copy a template** rather than starting from prose:
   - `assets/list-master-screen.tsx.template` — list + `Sheet` editor
   - `assets/rail-screen.tsx.template` — `MasterFullScreen mount="page"` with sections,
     derived `canSave`, problem badges and the footer
2. Replace the entity name, fields and child rows. Keep every comment that explains a
   *why* — they are the reason the next person makes the same choice.
3. Reach for `references/shells.md` for the shell API, and `references/traps.md` before
   assuming a surprising behaviour is a bug.
4. Verify.

## Verifying

```bash
python scripts/audit_layout.py .                       # 18 layout checks
python .claude/skills/raagam-keyboard-contract/scripts/audit_keyboard.py .
npx tsc --noEmit && npx eslint <changed files>
```

Both audits **always exit 0** — they are advisory, not gates. Read the findings.

### A clean audit is not always a pass

`audit_layout.py` inspects a file only if it matches
`<(Sheet|MasterFullScreen|DetailSection|SectionGrid|FieldGrid)` or contains
`@container/editor` (`is_editor_screen()`, line 157). The gate exists because a chart,
a nav shell or a report view legitimately writes its own grid.

**So a screen that uses none of the primitives is invisible to every layout check, and
reports clean.**

That is not hypothetical. `app/(app)/orders/styles/style-master-screen.tsx` reported
clean on all 12 checks while writing two raw `<table>`s and three hand-rolled grid
classNames. It became visible only when it imported `MasterFullScreen` — at which point
the findings appeared, which was the check working, not a regression.

`--check required-hold` narrows further: it runs only on a `*-master-screen.tsx` whose
types resolve to `lib/masters/<x>-types.ts`. A screen whose types live elsewhere is
skipped whatever it does.

**Therefore: if a screen is not built from these primitives, its clean audit means the
checks never ran.** Judge by what the screen imports, not by the summary line.
