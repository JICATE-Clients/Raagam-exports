---
name: raagam-screen-layout
description: "Raagam ERP's screen layout contract — which surface a screen uses (the list shell, a Sheet, or the section-rail editor mounted as an overlay or as a page route), how sections declare their completion dots and blocking-problem badges, the one field width every field takes, line items as ChildGrid rather than a hand-rolled table, and the Cancel / Save as Draft / Save footer whose canSave is DERIVED rather than hand-assembled. This skill should be used when building or changing any screen under app/(app), when choosing between Sheet and MasterFullScreen, when a record needs sections or tabs, when wiring Save or a status/workflow bar, when a list screen needs its toolbar and row actions, and whenever a screen is about to write its own grid-cols-*, col-span-* or <table>. Keys and focus are raagam-keyboard-contract's; pickers and icon fields are raagam-masters-picker-wiring's; reports are raagam-report-data's."
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
  └─ a DOCUMENT (has a number,
     a status, a life cycle)    → mount="page", its own route
```

The kind of the entity decides the mount, not preference. A master is transient and
sits over its list; a document needs a shareable link, a working Back button and a
screen that survives a refresh.

**A page mount requires its host to be `flex h-full flex-col`.** The shell takes
`flex-1 min-h-0` and needs a definite height to divide — `app/(app)/layout.tsx`
provides one. Leave the host as `space-y-4` and the editor sizes to its content,
stranding the footer above a strip of dead page.

Read `references/shells.md` before the first page mount. It is the material that
exists in no other document.

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
