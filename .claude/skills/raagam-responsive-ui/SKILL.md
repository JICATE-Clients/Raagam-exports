---
name: raagam-responsive-ui
description: "Raagam ERP's responsive contract — how any module, page or component is made to work on a phone (~360–430px), a tablet (~768–1024px) and a laptop/desktop (1366px at 100% and up) WITHOUT changing the desktop UI and WITHOUT a per-module mobile implementation. Carries the two axes this app already uses and when each applies (the ONE viewport switch `md` = 768px for app chrome; CONTAINER queries for everything inside a pane — @container/editor 672, /section 512, /sections 896, ChildGrid @lg 512 and tableFrom 5xl/6xl/7xl), the primitive that already answers each element (DataTable → stacked cards, MasterListShell `mobile`, MobileCardList, ChildGrid renderMobileRow / forceCards+flatRows, FieldRow + Field w=, FilterBar / FilterDrawer, Tabs strip, Sheet → bottom sheet, MasterFullScreen rail → chip strip, PageHeader, mobile-nav), the inspect → implement → verify process at 375 / 768 / 1024 / 1366 / 1920, and `audit_responsive.py`, which flags the hand-rolled patterns that break on a phone. This skill should be used whenever a screen, module, page or component must work on mobile or tablet, whenever a report says something is cut off, overflows, scrolls sideways, is too small to tap, overlaps, or 'looks broken on phone / tablet / small laptop', and before writing any sm:/md:/lg: class, hidden md:block, grid-cols-*, a fixed w-[…px], a raw <table>, a JS width check, or a separate mobile component. Triggers on: \"mobile\", \"responsive\", \"phone\", \"tablet\", \"small screen\", \"breakpoint\", \"overflow\", \"horizontal scroll\", \"cut off\", \"touch\", \"tap target\", \"PWA layout\", \"make it mobile friendly\"."
---

# Raagam responsive UI

## The rule that governs everything

**Responsiveness is a property of the primitives, not of the screen.** Every element an
operator meets — a list, a form, a grid, a filter bar, a tab strip, a dialog, the nav —
already has ONE component in this repo that decides how it behaves below a phone's width.
A screen made of those components is responsive without writing a single `sm:` class. A
screen that hand-rolls one of them has to re-derive the phone case, and ~22 hand-rolled
grids proved (see AGENTS.md "Tab lands on fields") that a per-screen fix always leaves a
remainder.

So the job, for any module, is almost never "add mobile styles". It is:

1. **find the parts that are NOT built from the primitives**, and
2. **move them onto the primitive** — or, where the primitive genuinely lacks the case,
   **fix the primitive once** so every module gets it.

A per-module `…MobileView` component, a `useIsMobile()` branch, or a copy of a table as
cards beside the table is the thing this skill exists to prevent.

**Desktop is the regression you are guarding.** Every recipe below is additive below a
breakpoint (base classes = phone; `md:`/`@…:` restores the desktop value). If a change
moves a single pixel at 1366px, it is wrong.

## The two axes — pick the right one

| Axis | Syntax | Use it for | Why |
|---|---|---|---|
| **Viewport** | `md:` (768px) — occasionally `sm:` 640 / `lg:` 1024 for chrome text | App CHROME only: sidebar ↔ `mobile-nav`, topbar items, `DataTable` table ↔ cards, the rail ↔ chip strip, page padding (`p-4 pb-20 … md:pb-6`), Sheet side-panel ↔ bottom-sheet | Chrome is sized by the device. There is **one** mobile/desktop switch in this app and it is `md`. |
| **Container** | `@container/<name>` + `@lg/<name>:…` | EVERYTHING INSIDE A PANE: field tracks, section columns, grid table ↔ cards, density | The same editor body is ~1180px full-screen and ~440px in a nested picker **at the same viewport**. A viewport breakpoint gets the second case wrong every time (LAYOUT.md §2, §10). |

The containers that already exist — use them, never declare a rival:

| Container | Threshold | Effect |
|---|---|---|
| `@container/editor` (Sheet fullScreen, MasterFullScreen content) | `@2xl` 672px | compact density on (h-9 → h-8) |
| `@container/section` (DetailSection) | `@lg` 512px | 12-col field track on |
| `@container/sections` (SectionGrid) | `@4xl` 896px | sections go 2-up |
| `@container/identity` (IdentityRow) | `@2xl` 672px | uneven tracks on |
| ChildGrid (responsive mode) | `@lg` 512px default; `tableFrom` `5xl` 1024 · `6xl` 1152 · `7xl` 1280 | table ↔ stacked cards |

Breakpoints are Tailwind v4 defaults (no custom `--breakpoint-*` in `app/globals.css`):
`sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536.

**Classes must be static literals.** Tailwind v4 scans source text, so
`` `md:grid-cols-${n}` `` or `` `@min-[${px}px]:block` `` compiles to NO CSS — the layout
silently never switches (LAYOUT.md §2; ChildGrid's `TableFrom` comment). Use a
`Record<…, "literal class">` map, the way `filter-drawer.tsx`'s `COLS` and ChildGrid's
`TABLE_FROM` do.

**No JS width checks for layout.** `window.innerWidth < 768` / `matchMedia("(max-width…")`
renders the server HTML at one width and the client at another (hydration mismatch), and
it duplicates a breakpoint CSS already owns. The repo's JS media queries are legitimately
about **pointer type** (`(hover: hover) and (pointer: fine)` in `select.tsx`,
`data-picker.tsx`) and **popover positioning** (`vw` clamps in `combobox.tsx`) — never
about which layout to render.

## The screen sizes, and what each one is for

| Width | Stands for | What must hold |
|---|---|---|
| **375** (360–430) | phone, installed PWA | no horizontal page scroll; every list is cards; every action reachable with a thumb; targets ≥ 36px; `mobile-nav` visible, sidebar gone; `pb-20` clears it |
| **768** | tablet portrait — the `md` edge | the flip point: check BOTH 767 and 768. Tables appear, sidebar appears, sheets become side panels |
| **1024** | tablet landscape / small laptop | rail + editor side by side; `tableFrom="5xl"` grids are tables; nothing squeezed to "— S…" |
| **1366** | the SUPPORTED FLOOR — 1366×768 laptop at 100% = **1155px editor pane** | every `tableFrom` grid fits (`npm run check:grid-budget`); no sideways scroll in any grid |
| **1920** | desktop | unchanged from before your change — this is the regression check |

The 1366 row is not optional and is the one people skip: the client's "fabric bom lost its
css … if I set screen size as 90% it's working" (2026-09-03) was a desktop that was too
narrow, not a phone.

## Which primitive answers which element

The detailed recipe for each — props, the trap, the file — is in
`references/element-recipes.md`. The one-line answer:

| Element | Use | Phone behaviour you get for free |
|---|---|---|
| Record list | `MasterListShell` (pass `mobile={{title, subtitle, pill, meta, onView}}`) or `<DataTable>` | table `hidden md:table`; stacked cards below `md`, same rows, same actions |
| Card list / queue | `MobileCardList` (wrap in `md:hidden` AT THE CALL SITE only if a table covers desktop) | tap-to-edit card, text "View", two-step delete — 36px targets |
| Form fields | `FieldRow` + `<Field w=…>` in a capped `DetailSection` | flex-wrap: fields fall to the next line; never overflow |
| Line items | `ChildGrid` with `tableFrom="5xl"` **and** `renderMobileRow` | stacked labelled cards below the threshold, one frame (`flatRows`) |
| Filters | `FilterBar` / `useFacetFilter` + `FilterDrawer` | search goes `w-full` (`sm:w-64`), facets sit behind the `Filters` toggle, panel 1 → 2 → 3 → 4 cols |
| Tabs | `Tabs` (`components/ui/tabs.tsx`) | horizontal scroll strip, active tab scrolled into view |
| Sections of a record | `MasterFullScreen` rail | rail becomes a horizontal chip strip |
| Modal / sub-detail | `Sheet` (size per AGENTS.md "A sub-detail Sheet's size") | compact sheet → bottom sheet with handle + safe-area footer; `lg` → full screen |
| Confirm | `ConfirmDialog` / `DeleteConfirmButton` | — never `window.confirm` |
| Row / overflow menu | `DropdownMenu`, `RowActions` | portaled + fixed-positioned from the trigger (picker lists clamp to `vw` in `dropdown-panel.ts`) |
| Page title + actions | `PageHeader` (`actions=`) | header row is `flex-wrap`: actions drop under the title |
| Header toolbar | search `Input` + `DataIoToolbar` + `+ Add`, all `h-9` | row wraps; search goes `w-full` |
| Long text | `<Truncated>` | press-and-hold reveals (`touch={false}` where the control commits on mousedown) |
| Pagination | automatic in `DataTable` / `usePagination` | bar only past one page |
| Nav | `sidebar.tsx` (≥ md) / `mobile-nav.tsx` (< md) | nothing to do — never add a module-specific mobile menu |
| Text size in controls | inside `Input` / `Select` / `Textarea` (`text-base md:text-sm`) | no iOS focus-zoom. **Never retype it at a call site** (`--check text-size-noop`) |

If the element you need is not in this table, look in `components/ui/` and
`components/masters/` before building one — and if you do build one, it goes in
`components/ui/` with its phone behaviour inside it, not at its first call site.

## The process

### 1 · Inspect (before touching anything)

1. **Scope it.** List the files the module/page renders: its `page.tsx`, the `*-screen.tsx`
   / client component, and every local component it imports.
2. **Classify each visible element** against the table above: *primitive* (done, leave it)
   or *hand-rolled* (the work).
3. **Run the audit on those files:**
   ```bash
   python .claude/skills/raagam-responsive-ui/scripts/audit_responsive.py <paths…>
   python .claude/skills/raagam-responsive-ui/scripts/audit_responsive.py --changed   # vs master
   ```
4. **Look at it at the five widths** (see Verify §3) and write down what is actually
   broken — screenshot-level, not guessed. A primitive that looks wrong is a primitive
   bug: note it, do not patch it at the call site.

### 2 · Implement (in this order — stop as soon as it holds)

1. **Swap hand-rolled for primitive.** Raw `<table>` → `DataTable` / `ChildGrid`;
   `<div><Label/><Input/></div>` → `Field`; bare `fixed inset-0` div → `Sheet`;
   hand-made tab buttons → `Tabs`. This is usually the whole fix, and it brings the keyboard
   contract, required-holds and density along with it.
2. **Use the primitive's own responsive props** — `mobile={…}` on `MasterListShell`,
   `renderMobileRow` / `tableFrom` / `forceCards` + `flatRows` on `ChildGrid`, `size` on
   `Sheet`. Read the prop's doc comment first; several have a trap (e.g. `flatRows` alone is
   a no-op, `renderMobileRow` must forward `required`).
3. **Only then, layout classes on the wrapper YOU own** — mobile-first, desktop restored:
   - wrap, don't squeeze: `flex flex-wrap gap-2`, `min-w-0` on the growing child
     (a flex child without `min-w-0` refuses to shrink below its content and overflows);
   - stack, then row: `flex flex-col gap-3 md:flex-row md:items-center` (chrome) or
     `@container/x` + `@2xl/x:flex-row` (inside a pane);
   - cap, don't fix: `w-full max-w-[Nrem]` rather than `w-[640px]`; a literal width over
     ~22rem needs a breakpoint or container prefix;
   - columns: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, never a bare `grid-cols-3`;
   - hover-revealed controls also show on touch: `md:opacity-0 md:group-hover:opacity-100`
     (visible by default, hidden-until-hover only where there is a hover), plus
     `focus-within:opacity-100` for the keyboard.
4. **If the fix belongs in a primitive, fix the primitive** and say so in your summary —
   then check its other call sites at 1366 and 1920, because every one of them just moved.

**Never:**
- hide DATA on mobile with `hidden md:block` unless the same data is reachable another way
  (the card, the view sheet) — hiding chrome is fine, hiding a column's only copy is not;
- wrap a line-item grid in `overflow-x-auto` to "make it fit" — "a grid wraps; it never
  scrolls sideways" is standing (raagam-screen-layout rule 4). `overflow-x-auto` is fine
  around a read-only report table and around `DataTable` (already there);
- set a font size to make something fit — "compact" means spacing, not type
  (see memory: compact-means-spacing-not-type);
- add a density or height class to a control to fix a phone layout — the density scale is
  eight files in step (LAYOUT.md §10);
- write `sm:col-span-*` on a field — use the container variants (LAYOUT.md §2);
- duplicate a screen as a second mobile component.

### 3 · Verify

**Static — all must be clean in your files:**
```bash
python .claude/skills/raagam-responsive-ui/scripts/audit_responsive.py --changed
python scripts/audit_layout.py . --check text-size-noop --check grid-single-frame --check grid-required-mobile --check toolbar-size
npm run check:grid-budget      # every tableFrom grid you touched listed as ok BY NAME
npx tsc --noEmit && npx eslint <changed files>
npm run check:hooks            # a mobile branch is a classic place to put a hook below a return
```

**Visual — the five widths, every time.** Start `npm run dev`, then use the
`claude-in-chrome` skill (resize the window / device emulation) or the `run` skill. For each
of **375, 767, 768, 1024, 1366, 1920**:

- [ ] no horizontal scrollbar on the PAGE (`document.documentElement.scrollWidth <= innerWidth`)
- [ ] nothing clipped, overlapping, or cut to "— S…" without a `<Truncated>` reveal
- [ ] every list is cards below 768, a table at/above it — same rows, same actions
- [ ] every editable grid is a table at 1366 (or wraps in ONE frame), never scrolls sideways
- [ ] every action reachable: Save/Cancel footer visible above the keyboard and `mobile-nav`,
      row actions present on the card, filters openable
- [ ] tap targets ≥ 36px on touch (the card footer buttons, not a 16px icon)
- [ ] open each dialog/sheet: bottom-sheet on phone, fits, footer on screen, scrolls inside
- [ ] 1920 and 1366 look exactly as they did before the change (compare against `master`)

Then run the keyboard basics once at 1366 (Tab, Enter, Esc) — a moved or re-wrapped element
must not have left the `raagam-keyboard-contract`.

**Report what was checked, per width.** "Looks fine" is not a result; "375: list → cards,
filter drawer opens, Save visible; 1366: Budget grid table, no scroll" is.

## Audit script

`scripts/audit_responsive.py` — advisory by default (exit 0), `--strict` exits 1 on any
finding. Scans `app/` and `components/` (or the paths / `--changed` files you give it),
comment-stripped.

| Check | Flags |
|---|---|
| `dynamic-class` | a breakpoint / container variant built in a template literal — produces no CSS |
| `js-breakpoint` | `innerWidth <`/`>` a number, or `matchMedia("(min|max-width…")` — layout chosen in JS |
| `wide-fixed` | an unprefixed `w-`/`min-w-[…]` wider than 22.5rem (360px) — overflows a phone |
| `bare-grid-cols` | an unprefixed `grid-cols-3+` / `grid-cols-[…]` with no smaller base — forced columns on a phone |
| `hover-only` | `opacity-0` revealed only by `group-hover:` — invisible on touch |
| `raw-table` | a `<table>` in a file with no mobile alternative (`md:hidden`, `MobileCardList`, cards) |
| `nowrap-toolbar` | a `flex` row carrying 3+ `<Button>`s with no `flex-wrap` — pushes off a phone |

Exempt a line with `// responsive: exempt -- <reason>` on it or directly above it; exempt a
whole file with `// responsive-file: exempt -- <reason>` (e.g. a print view, a chart).
Findings are candidates, not verdicts — the reason is what makes an exemption honest.

The primitives that DEFINE the responsive behaviour (`data-table`, `child-grid`, `sheet`,
`master-full-screen`, `mobile-card-list`, `filter-bar`, `filter-drawer`, `tabs`) are skipped
unless `--include-primitives` — a bug there is found by looking at the screen and fixed once.

**Verified by being made to FAIL first** (2026-09-24): a fixture carrying one instance of
each shape raised all seven; its prefixed twins, a comment describing them, JSX prose with an
apostrophe and an exempted line raised none. **Baseline** on the whole repo that day: 38
candidates in 782 files (wide-fixed 7, bare-grid-cols 18, hover-only 2, raw-table 9,
nowrap-toolbar 2 — the last two are desktop-only row-action cells). A module you touched
should leave with zero in its own files, or an exemption per line saying why.

## What this skill does not own

| Concern | Owner |
|---|---|
| Surface choice, field widths, grid budget, section caps, footer | `raagam-screen-layout`, `erp-form-compact`, `doc/ui/LAYOUT.md` §1–§10 |
| Keys, focus, holds | `raagam-keyboard-contract` |
| Sub-detail sheet size | AGENTS.md "A sub-detail Sheet's size" |
| Pagination | AGENTS.md "Pagination" |
| Font / colour | `raagam-theme-presets` |

Cite those; do not restate them. This skill owns only **how the same UI behaves as the
width changes**.
