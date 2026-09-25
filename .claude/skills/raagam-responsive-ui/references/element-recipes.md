# Element recipes

One section per element. Each gives: the primitive, the props that carry the phone case,
the trap, and what to do when the element is hand-rolled today. Read the primitive's own
doc comment before changing a prop — most of these props have a history recorded there.

---

## Lists of records

**Primitive:** `MasterListShell` (`components/masters/master-list-shell.tsx`) for a master;
`<DataTable>` (`components/ui/data-table.tsx`) for anything else.

- `DataTable` renders the table as `hidden md:table` and a stacked card per row below `md`,
  from the SAME `columns` — no second declaration, and it works from server components.
- `MasterListShell` requires `mobile={{ title, subtitle?, pill?, meta?, onEdit?, onView?, onDelete? }}`
  and renders `MobileCardList` under `md:hidden` itself. Pass `onView` wherever the desktop
  row has an eye — on a phone the card tap IS edit, so without it nothing is read-only.
- Append `createdMeta(row)` to `meta` (never replace the screen's own meta) — AGENTS.md
  "Created Date / Created User".

**Trap:** a column whose `cell` renders a wide control (a picker, an inline input) looks
fine in the table and is a full-width box in the card. Keep list cells read-only; editing
belongs in the Sheet / rail editor.

**Hand-rolled today** (`<table>` or a `.map()` of `<div className="grid grid-cols-6">`):
convert to `DataTable` columns. Keep `paginate={false}` if it is a document's lines
(AGENTS.md "Pagination").

## Card lists / queues

**Primitive:** `MobileCardList` (`components/masters/mobile-card-list.tsx`).

- `md:hidden` lives **at the call site**, never inside — a caller that wants cards at every
  width (Material BOM's queue) omits the wrapper.
- The track is a card WIDTH, not a column count — it fills whatever pane it gets. Don't
  add `grid-cols-*` around it.
- Footer actions are text buttons (`View`, two-step delete) because a 16px icon is not a
  touch target. Don't swap them back to icons for a phone.

## Form fields

**Primitive:** `FieldRow` + `<Field w=…>` inside a `DetailSection` with a definite
`max-w-[Nrem]` cap (`erp-form-compact`, `raagam-screen-layout` "BUILD IT COMPACT").

- `FieldRow` is `flex-wrap`: on a phone the 7-step widths (`num` 72 … `name` 288) all fit
  (the widest is 288 < 343px content), and fields simply fall to the next line. **There is
  nothing to add for mobile.**
- `size="full"` / `"xl"` for a textarea or grid that takes the row.
- Control text sizes (`text-base md:text-sm`) live inside `Input` / `Select` / `Textarea`.
  Retyping it at a call site is a no-op the audit already counts (`text-size-noop`).

**Trap:** a hand-typed `w-[420px]` on a field. The seven steps exist so no field is ever
wider than a phone; a literal width skips them. Use a step or `size="full"`.

**Hand-rolled today** (`<div className="grid grid-cols-3 gap-4"><div><Label/><Input/></div>…`):
convert to `Field`s. This also fixes required-holds and the keyboard contract — the
hand-rolled pair is structurally invisible to both.

## Line-item grids

**Primitive:** `ChildGrid` (`components/masters/child-grid.tsx`). Four modes:

| Want | Props |
|---|---|
| Table on desktop, cards below a pane width | `tableFrom="5xl"` (literal!) + `renderMobileRow` |
| Wraps at every width, ONE frame | `forceCards` **+** `flatRows` + `renderMobileRow` |
| Tiny grid (2–3 narrow cols) that fits even a phone | `tableAlways` with every column `width`ed |
| Header band + aligned fields, no gridlines | `inlineCards` |

`renderMobileRow` shape (copy it; it keeps the card and the table one declaration):

```tsx
renderMobileRow={(row, i) => (
  <FieldRow align="start" gap="tight">
    {columns.map((c, ci) => (
      <Field key={ci} label={c.header} required={c.required} w={fieldWidthStep(c.width) ?? "hug"}>
        {c.cell(row, i)}
      </Field>
    ))}
  </FieldRow>
)}
```

**Traps (each has shipped):**
- `flatRows` without `forceCards` is a silent no-op (`--check grid-single-frame`).
- `renderMobileRow` without `required={c.required}` on the `Field` draws a star with no
  hold behind it (`--check grid-required-mobile`).
- Dropping `renderMobileRow` as "redundant" gives unlabelled full-width boxes below the
  threshold.
- `overflow-x-auto` around a grid is banned — it wraps, it never scrolls sideways.
- Columns + 72px must be ≤ 1155px for `tableFrom="5xl"` (`npm run check:grid-budget`).

## Filters

**Primitive:** `FilterBar` (`components/ui/filter-bar.tsx`) for search + a facet panel;
`useFacetFilter` + `FilterDrawer` (`components/ui/filter-drawer.tsx`) for grouped facets.

- Search is `w-full sm:w-64` — full width on a phone, fixed on desktop. Don't override.
- Facets sit behind the `Filters` toggle (with its count badge); the panel is
  `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
- A cascading facet still narrows (AGENTS.md "Cascading filters") — unchanged by width.

**Hand-rolled today** (a row of 5 `<Select>`s): move them into `FilterBar` facets. A row of
dropdowns that does not wrap is the most common phone overflow in list screens.

## Tabs

**Primitive:** `Tabs` (`components/ui/tabs.tsx`). A horizontal strip that scrolls on its own
axis only, with the active tab scrolled into view (`scrollIntoView({inline:"nearest"})`).

**Trap:** wrapping tabs onto two lines on a phone breaks the "which tab am I on" reading;
the strip scrolls instead — this is the one place a sideways scroll is correct.

## Sections of a record

**Primitive:** `MasterFullScreen` rail. Below `md` the rail becomes a horizontal chip strip
(`md:hidden` on the collapse, never `hidden` — the strip is the phone's only section nav),
and the identity band stacks (`grid … md:grid-cols-[1fr_auto]`).

## Modals, sheets, sub-details

**Primitive:** `Sheet` (`components/ui/sheet.tsx`); `ConfirmDialog` for a yes/no.

- `size="lg"` / fullScreen: full screen at every width; content `px-4 md:px-8`, footer
  `sticky bottom-0` with `pb-[calc(…+env(safe-area-inset-bottom))]` so Save clears the iOS
  home bar.
- compact slide-over: **bottom sheet** below `md` (`inset-x-0 bottom-0 max-h-[88vh]
  rounded-t-2xl` + drag handle), right side panel `md:w-[420px]` at/above.
- `sm` / `md` dialog sizes: `max-w-md` / `max-w-6xl`, width-capped so they shrink on a phone.
- Pick the size by AGENTS.md "A sub-detail Sheet's size", not by the phone.

**Hand-rolled today** (`<div className="fixed inset-0 …">`): move to `Sheet`. If it truly
cannot be, it needs `useModalGuard(open)` (AGENTS.md "Auto-reload guard"), its own safe-area
padding, `max-h-[…vh] overflow-y-auto` on the body, and a full-width layout below `md`.

## Menus

**Primitive:** `DropdownMenu` (`components/ui/dropdown-menu.tsx`), `RowActions` /
`rowActionsColumn`. Portaled with fixed positioning from the trigger, so a menu is never
clipped by an `overflow-hidden` parent. Picker lists clamp to the viewport width in
`dropdown-panel.ts`.

## Page header and toolbar

- `PageHeader` is `flex flex-wrap … justify-between`: on a phone `actions` drop under the
  title. Put buttons in `actions`, not in a sibling row.
- The header toolbar (search · Filters · Download · + Add) is all `md` / `h-9`
  (AGENTS.md "The header row"). Its wrapper must be `flex flex-wrap gap-2`; on a phone let
  the search take `w-full` and the buttons wrap beneath it.
- Primary label + icon buttons: keep the label on desktop; hiding it below `sm`
  (`<span className="hidden sm:inline">`) is fine **only** when the icon has an
  `aria-label` — the topbar does exactly this.

## Long values

**Primitive:** `<Truncated>` (`components/ui/truncated.tsx`). Hover 350ms on desktop,
press-and-hold 450ms on touch. `touch={false}` where the control commits on `mousedown`
(picker option rows). Never a bare `truncate` on a value (`--check truncate-reveal`).

## Navigation

`sidebar.tsx` (≥ md) and `mobile-nav.tsx` (< md) are driven by the registry
(`lib/nav/module-groups.ts`). A new module is on the phone the day it is registered.
**Never** build a module-specific mobile menu, and remember the `main` area's `pb-20`
exists so content clears the bottom nav — a page that sets its own bottom padding to 0 hides
its last row under it.

## Dashboards, stats, charts

- Stat tiles: `grid grid-cols-2 gap-3 md:grid-cols-4` (2-up on a phone is fine for short
  numbers; never a bare `grid-cols-4`).
- Charts: give the container a width of `w-full` and a fixed HEIGHT; let the chart library
  size to the container. Shorten axis labels, don't shrink the font.
- Anything that is inherently wide (a Gantt, the T&A milestone grid, a print view) is the
  legitimate `overflow-x-auto` case — mark it `// responsive: exempt -- <reason>`.

## Report views and print

Read-only report tables may scroll sideways inside their own `overflow-x-auto` box on a
phone — they are documents, and reflowing a register into cards destroys the columns the
reader compares. Print views are exempt from all of this (`responsive-file: exempt`).
