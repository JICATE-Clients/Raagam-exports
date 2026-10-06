# The Orders module is the reference implementation

Mapped end to end on 2026-10-06, after Sample Entry (`app/(app)/sales/sample-entry/`) was
built "matching the updated Order Entry interface" per its spec and came out wrong in every
child grid. Sample Entry had followed this skill's prose rules (widths, `forceCards` past the
budget, `[Click]` sheets) — but the prose had fallen behind what Order Entry actually draws,
so a screen that obeyed the skill still did not look like Orders. This file records the
SHAPES, with the file that owns each one, so the next module copies the code, not a summary
of it.

**How to use it:** find the row in "Which shape" below that matches the thing you are
building, open the precedent at the line given, and copy its props. If nothing matches,
say so and ask — never invent a fourth way. Line numbers drift; the `const` names and the
comment headings do not, so grep for those.

`OE` = `app/(app)/orders/_garment-order/garment-order-screen.tsx` (~24k lines — grep it,
never read it whole).

---

## Which shape

| You are building… | Precedent | Shape |
|---|---|---|
| ANY screen meant to look like Orders | `app/(app)/orders/layout.tsx` — the raagam skin | §0 |
| A document register / work queue | `BomQueue` (`components/orders/bom-queue.tsx`) — Fabric BOM, Material BOM, Budgets, Garment Orders | §1A |
| A register of entries with filters | Order Revisions `order-amendments/register-screen.tsx`, Budget Approval | §1B |
| A master (reference data) list | `MasterListShell` | the skill's tree |
| The record's header fields | OE "Order Info" (`orderInfoSection`) | §2 |
| A parent line with children UNDER it (style → coordinates, sizes, components) | OE `stylesGrid` + `componentsAndSizes(r)` | §3 |
| A simple flat line grid (combos, destinations, rates) | OE Combos, OE Quantities | §4 |
| A size-across matrix (size × colour, size × rate) | OE `assortGrid` + `components/orders/matrix-grid.ts` | §5 |
| One line's detail, too big for the row | OE Structure Details / Assortment `Sheet fullBleed` | §6 |
| A small `[Click]` picker/grid with no Save of its own | `StyleProcessSheet`, cmt-breakup, colour-loss | §6 |
| Many lines, ONE open at a time beside a rail of the rest | Material BOM items / Fabric BOM Manual — `ChildGrid masterDetail` | §7 |
| A subject list whose rows each unfold a grid (legacy `[+]`) | `ProcessFoldList` (`components/orders/process-fold-list.tsx`) | §7 |
| Grids that belong to one style, on a multi-style document | Style column / `StyleIdentityBand` | §8 |
| Computed, read-only figures | Budget `figure()`, Material BOM `derivedQtyCell` | §9 |

---

## 0. The skin — check this before anything else

Orders, Master Data and HR wear `[data-skin="raagam"]` (`app/globals.css`), switched on by
a `layout.tsx` that renders `<SkinProvider skin="raagam">` (`components/ui/skin`). It is
where the green field boxes, the green-outlined search and Filters, the light-blue primary
button and the rail/tab chrome come from. **None of it is in a screen file**, so a screen
copied line for line from Order Entry still looks like a different app on a route without
the provider — Sample Entry did, under `app/(app)/sales/`, which has no skin layout.

Fix: a `layout.tsx` on the new route (or module) with the same provider — Sample Entry's
is `app/(app)/sales/sample-entry/layout.tsx`. A provider, not a bare `<div data-skin>`:
a `Sheet` portals out of the wrapper and re-stamps the skin from React context. After
adding one, `.next-verify`'s generated route types go stale until the next `build:check`
(a `LayoutRoutes` error from `.next/dev/types` — not a source error).

---

## 1. Lists

**`MasterListShell` is the MASTERS list, not the Orders one.** Only two Orders screens use it
(advised-register, CAD Lifecycle with `menuAs: "icons"`).

### 1A. Work queue — `BomQueue`

The call site keeps a `PageHeader` (title + `actions={<Button size="md">+ New X</Button>}`)
and hands everything else to `BomQueue`: search, counted Status facet, the
Pending · Updated · Draft `ToggleGroup` (`StatusSegment`), the cards, the Created pair.
Props: `quickStatus`, `quickDraft`, `fitUpdated`, `onOpen`, `lockReason`, `onReports`,
`canDelete`. The Updated pile is `OrderQueueTable` (`components/orders/order-queue-table.tsx`):
RE No as a `<button className="font-mono text-xs font-medium text-primary">`, then Customer,
PO No, the module's columns, `withCreatedColumns`, `RowActions view={false}` with
`lead={<RowIconAction icon={FileText} label="Reports">}`, and greyed Edit/Delete via
`editDisabledReason` / `deleteDisabledReason` fed from `lockReason`. Figures in a list use
`FigureCell` (right, `font-mono tabular-nums text-xs`).

### 1A′. A document list on the Garment Orders pattern (what Sample Entry copies)

The Garment Orders list (`garment-order-screen.tsx`, the `mode === "list"` return):

- `PageHeader actions` holds the create button, worded **"New <Thing>"** (not "+ Add …"),
  plus any secondary outline button.
- `FilterBar leading={quick.segment}` — the **Pending · Updated · Draft** box
  (`useQuickStatus(wordOf, { countRows })` from `components/orders/bom-queue.tsx`, with
  `wordOf` at MODULE level so its identity is stable; counts are taken over every OTHER
  filter). `right` reads "`n of N <Word>`".
- `<DataTable compact …>` with `text-xs` cells, the number a `font-mono text-xs
  font-medium text-primary` link, dates `tabular-nums text-xs`, figures `block text-right
  font-mono tabular-nums text-xs`. No sideways scroll — trim columns until it fits.
- **No Status column** — the box answers it. **No eye** (`view={false}`): the number link
  opens the record, and the eye's slot is the Reports icon (`lead={<RowIconAction
  icon={FileText} className="text-primary" …/>}`) once the record has a report.
- The empty state names the word ("No … are Draft — the counts above show which word they
  are in").

### 1B. Register — FilterBar + hugged DataTable

```tsx
<PageHeader title="…" actions={<Button size="md">+ New …</Button>} />
<FilterBar leading={quick.segment} search onSearch searchPlaceholder
           activeCount onReset panel={facets.panel} right={`${n} of ${total}`} />
<div className="w-fit max-w-full">
  <DataTable columns={hugCreated(withCreatedColumns(cols, rows))} rows={rows} />
</div>
```

`quick` = `useQuickStatus(wordOf, {…})` (bom-queue.tsx) — the word lives in `?status=` via
`history.replaceState`, no refetch. Facets = `useFacetFilter`. Status = `StatusPill tone=`
(never `ui/badge`). Group lines = `DataTable spanRow`.

### List → editor

`mode: "list" | "edit"` state, `MasterFullScreen mount="overlay" open={mode === "edit"}`,
deep link through `useOpenIntent` (`?open=<id>`, stripped after opening), embedding into
the Revision workspace through `useEmbeddedEditor` + `<EmbeddedEditorWait>`.

**Do not copy** the legacy small clients (excess-orders, price-confirmation, contract-review,
due-date, order-booking, pack-ratios): "+ New" in a bare `flex justify-end`, a hand-typed
"Created" column, `DetailSection cols={12}` + `<Field size="sm">`. They predate every rule
above.

---

## 2a. The editor's mount and header band

Order Entry is `mount="page"`, rendered INSTEAD of the list (`if (mode === "edit") return
…` — every hook above it), inside `<div className="flex h-full flex-col gap-4">`, under a
band the screen draws itself:

```tsx
<div data-focus-region="header" className="mb-3 flex w-full flex-wrap items-baseline gap-x-6 gap-y-2 max-md:gap-x-2">
  <Button variant="ghost" size="sm" aria-label="Back to list" className="h-10 w-10 shrink-0 px-0 text-lg md:hidden">←</Button>
  <div className="flex min-w-0 shrink-0 items-baseline gap-2 …">
    <dt className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Edit Garment Order</dt>
    <dd className="m-0 text-sm font-semibold text-foreground">{number}</dd>
  </div>
  <div aria-hidden className="h-px min-w-[2rem] flex-1 self-center bg-border" />
  <div className="flex shrink-0 items-center gap-3">{/* figures */}<Button variant="outline" size="sm">← Back to list</Button></div>
</div>
<MasterFullScreen mount="page" open dirty={dirty} modeLabel={null}
  footer={{ …, extra: <button className="text-xs font-medium text-danger">{n} to fix</button>, stepper: true }} />
```

`stepper: true` shows **Next** until the last section (Save + Save as Draft there); `extra`
is the red "N to fix" link. No `header` prop — the band replaces it.

## 2b. Inherited, read-only values

Values a section only SHOWS (owned by another section) are a label · value `<dl>` band in
`StyleIdentityBand`'s type — `dt text-[10.5px] font-semibold uppercase tracking-[.08em]`,
`dd text-sm font-medium` with `<Truncated>`, a hairline filling the rest — placed OUTSIDE
the section's width cap so it runs on one line, and listing ONLY the values that exist —
eight labels over seven dashes says nothing (user 2026-10-06: "just show one details").
Never a row of read-only `<Input>`s.

A yes/no on a form is a `Toggle` (Order Entry's Pack, Multi Style), not a two-word
`Segmented`.

## 2. The header section (OE "Order Info")

- The record's own name is the first rail row (operator's rule 1).
- Rows are `<FieldRow nowrap gap="row">` of `<Field w=… required>`. Pickers are
  `RecordPicker compact` inside the `Field`.
- **A minted / read-only value is NOT given a width box.** RE No leaves `w` off and sizes to
  its content: `className="w-auto min-w-[5.5rem] field-sizing-content max-sm:w-full"`. A
  read-only `Input` at `w="code"` / `w="term"` is a box shaped like something to type into.
- It is the ONLY section OE wraps in `<SectionBody title>`. Every other section passes its
  grid bare (OE ~19780: "NO WRAPPER") — the rail row already names it.
- `sectionDone` is a map built with `has(rows)`, so a SEEDED blank row never lights the
  dot. A minted number never marks a section done; what the operator supplies does.

---

## 3. A parent line with children under it — OE Styles

This is the shape Sample Entry missed most.

```tsx
<ChildGrid<StyleRow>
  columns={styleColumns}
  rows={styles}
  forceCards listRows frameless pageSize={5} keepOne
  hideAdd={!form.mult_ord}
  renderMobileRow={(r, i) => (/* RowRemoveChip + one FieldRow nowrap + componentsAndSizes(r) */)}
/>
```

- The row draws ONE `<FieldRow nowrap gap="row">` of `<Field w={STYLE_FIELD_W[col.header]}
  required={col.required}>` — Style `term`, codes `code`, Unit / Qty `num`, and Description
  GROWS (`flex-[1_1_7rem]`) instead of taking a fixed `name`.
- **Under that row, inline, is the composition line** (`componentsAndSizes(r)`): Coordinates
  as a nested `ChildGrid narrow frameless`, Sizes as `MultiSelect compact framed gridded
  required` (required on the Field AND the control) in a strict `w-[220px]` column **with
  `panelClassName="w-[27rem]"`** — the list must be wider than its box, or `gridColumns={6}`
  crushes six ticks into 220px and every label reads "X…" (Sample Entry shipped without it;
  user 2026-10-06: "while selecting the size it came like squeezed"), Components as a nested grid in a
  `data-grid-style="sheet"` wrapper with `seedRow`. These are children OF THE LINE, so they
  live under the line — not on another rail section, and not behind a `[Click]` sheet.
- Only the BIG sub-detail (Process) is a `[Click]` → `StyleProcessSheet` (`size="md"`,
  `alignToPane`, `origin`, `SubSheetFooter`).
- **Unit (PCS/SET) starts BLANK and `required`** — no default. PCS seeds a PIECES coordinate
  and the coordinate cell stays editable; it is never greyed out or replaced by "—".
- Accordion: `openStyleKey`. A row folds once it names a style; the folded row shows Style +
  a `Truncated` summary (unit · qty · sizes) and its blocking problem in red.
- The row's ✕ is `RowRemoveChip` (`components/masters/child-grid.tsx`), so Ctrl+Del still
  finds `data-row-remove`.

`listRows` + nested grids is the arrangement `lib/focus.ts` understands as "a row with a
nested grid" (`tabFieldsIn`, `enterNestedGrid`, `fromChildGrid`) — traps.md #11.

---

### 3a. Unit (PCS / SET) — reuse `lib/orders/styles/rules.ts`, never restate it

"The logic from Order Entry" for a unit (user 2026-10-06) is a short list, all of it in
`rules.ts`: `COORDINATE_LIMITS` (PCS 1, SET 2–6), `coordinatesFull` (hide "+ Add
coordinate" at the cap — rows counted, blanks included), `pieceCoordinateId` (PIECES by
CODE), `coordinateCountMessage` (the count sentences), and OE's `answerUnitKind`: PCS on a
line with no coordinate writes PIECES into the first row; SET or blank only records the
answer, seeding and clearing nothing. Unit starts blank, is `required`, and is never
defaulted — not on load, not in the payload (a draft saves NULL). The line also owes "Name
at least one coordinate." and "Tick at least one size." (Sizes `required` on Field AND
control). Unit drives nothing else in Order Entry — not Combos, not quantity wording.

### 3b. Billable — a per-line flag with four consequences (Sample Entry, user 2026-10-06)

In Product Info ONLY, below Tech Pack and Accessories Reqd (the legacy Define Styles place).
It was briefly also a Toggle cell on the Styles row and the user withdrew it the same day:
"no more billable in style". While No: the billing
fields stay ON SCREEN, greyed — a `<fieldset disabled className="contents">` disables the
pickers (they have no `disabled` prop) and `opacity-50` on each Field, because the raagam
skin draws a disabled box like a live one. The Quantities rail row is REMOVED (filter the
`sections` array), not `disabled`. While Yes: Quantities carries a computed Value column
(PO Qty × Price, with its total) and a Currency · Price · Gross Value row under the grid,
Order Entry's Avg Rate / Gross Value shape — and with no currency chosen the figure is
bare, never `fmtMoney`'s INR fallback.

### 3c. "Copy Order Entry's Quantities" means the WHOLE tab (Sample Entry 0685)

When a screen is asked for Order Entry's Quantities, a look-alike grid is not it (user
2026-10-06: "copy to here same"). The tab is: the **Multi Order** switch (adds PO No,
`uppercase={false}` + caps exemption); ONE grid for the document — Country · Ref No ·
[PO No] · Consignee · PO Qty (with the red "Assort: N — use" link) · Delivery Dt ·
Earlier Shipment Dt (follows Delivery only while blank or still a week before) ·
Assortment Type · Details, all but Details `required`; Avg Rate · Gross Value · INR Value
under it; Next refusing to leave Quantities while the PO totals disagree (`stepGuard`). The
Assortments sheet carries Single / Multiple Style, Ratio For, and on an assorted-size type
Ctns · Inners · Pcs/Pack with Qty = cartons × inners × ratio.

**Reuse `lib/orders/amendments/qty-balance.ts`** — pure, no imports — for the arithmetic
and the balance / cross-tab sentences, through a small adapter (Sample's sizes are keyed by
name). Where the target stores quantities per style, keep the storage and make Ref No a
pick of styles that MOVES the row. The columns it lacks are additive and nullable (0685);
check the storage BEFORE promising the copy — Sample's 0683 tables could not hold
Multiple Style lines, ratio counts or a PO No.

## 4. A flat line grid — OE Combos / OE Quantities

The SPREADSHEET look (client 2026-10-03), opt-in per grid via a wrapper marker:

```tsx
<div data-grid-style="sheet" className="[&_table]:table-fixed">
  <ChildGrid<QtyRow>
    columns={quantityColumns}          // UNIQUE name — check:grid-budget prints it
    rows={rows}
    tableFrom="5xl"                    // or tableAlways for a ~300px grid
    keepOne
    removeHeader="Actions"             // a sheet grid names every column, this one too
    totalsLabel="Total PO Qty"
    addLabel="+ Add …"
  />
</div>
```

`app/globals.css` "SPREADSHEET GRID" turns the gridline into the box and drops the control's
own box; focus draws an inset outline, errors keep a red inset.

- **NO CELL SETS ITS OWN HEIGHT** (OE header above `quantityColumns`, client 2026-08-21).
  No `className="h-8"` on a cell's Input/Select. Pickers carry `h-9 @2xl/editor:h-8` (a
  container query); a flat `h-8` opts an input out of it and the row stands 4px uneven.
  Numbers: `type="number" className="text-right"` and nothing else.
- **A header's longest word is a width floor**: at `hug` (88px) "ASSORTMENT" and
  "DESTINATION" ran into the next column — give those `range` and let a one-word column pay.
- **Widths are the compact steps**, arithmetic in a comment above the const: OE Quantities is
  Country `range`, Ref No `hug`, Consignee `code`, PO Qty `num`, dates `code` (a date input
  clips its calendar below ~120px), Assortment Type `code`, Details `hug`. `party` (200px)
  is for a party's NAME in a header field, rarely a grid cell — a long value ellipses and the
  picker reveals it on hover.
- **Re-cut until it is a table.** OE Quantities went from cards BACK to a table on 2026-10-03.
  Ten columns is not a reason for `forceCards`; ten `party` columns is a reason to re-cut.
- A gated row button (`Details`) is `Button size="sm" data-row-open aria-disabled` inside a
  `Tooltip` that says what to fill first (`assortGateFor`). The gate is real: it opens
  nothing until the row can be assorted.
- Derived totals that are not a column sum go UNDER the grid in a `FieldRow` of read-only
  `field-sizing-content` fields (Avg Rate / Gross / INR) — not a sentence.

---

## 5. A size-across matrix — `matrix-grid.ts`, NOT `ChildGrid`

Size × colour (Assort) and size × rate (Prices) are drawn as a CSS-grid matrix from
`components/orders/matrix-grid.ts`:

- track: identity column(s) · `sizes.map(s => sizeColPx(label, digits))px` ·
  `minmax(12px,1fr)` · sticky Qty column;
- `MATRIX_HEAD`, `matrixCell("min-h-9")`, `MATRIX_FOOT` (sticky totals band),
  `MATRIX_SIZE_TOKEN` headers; sticky left identity and right Qty; `overflow-x-auto
  rounded-lg border`;
- **a size column is sized for what is in it** (`sizeColPx`) — never a flat `num` 72px;
- computed squares are `text-sm tabular-nums text-muted-foreground` spans, not read-only
  Inputs;
- **it never folds to cards.** It is the one sanctioned horizontal scroll, inside its own
  frame, because the sizes ARE the axis. `forceCards` past N sizes turns a matrix into a
  stack of boxes with no shared header — the exact thing Sample's Combos and Assortment did.

The row height is a parameter (`matrixCell()`): Assort is `min-h-9`, Prices 26px, both client
rulings. Do not hard-code one.

**Under a matrix that must add up to a target, the balance strip** — "`14 of 20 allocated ·
6 remaining`", `rounded-md border bg-surface-muted text-xs tabular-nums`, red when over
(OE `assortGrid`; Sample's `allocation-strip.tsx`), then the `data-row-add` button `mt-3`.
It shows in every state, balanced too — never an amber sentence that appears only once
wrong.

**"Started" means a figure was typed, never that a seeded line carries a name.** Sample's
Assortment seeds one line per combo WITH its name, and `assortStarted` tested
`!isBlankAssortLine` — so merely opening the sheet made Done refuse and the entry's Save
report "holds 0 pcs". Test the quantities only.

---

## 6. Sub-detail sheets

| Shape | Size | Extras |
|---|---|---|
| Small picker/grid, nothing of its own to save | `sm` (`md` only if its content is a `ChildGrid`) | `alignToPane`, `origin={rect}`, `SubSheetFooter` — AGENTS.md "A sub-detail Sheet's size" |
| One line's whole detail (Structure Details, Assortment) | `fullBleed` | `SubSheetFooter blockedReason onBlocked` — Done REFUSES while out of balance (`assortBalanceMessage`); no `alignToPane`/`origin` |
| Reports | `lg` | — |
| A decision (Budget Approval) | `lg fullBleed` | `headerActions={<ApprovalActionBar …/>}` |

- **THE ONLY THING ABOVE THE GRID IS THE GRID'S OWN TITLE** (OE ~24072, 2026-08-19). The
  Assortment once had a band of read-only context fields (Country, Pack, Type, Qty, Date, Style
  Ref) above its matrix; it was removed. Context goes in the sheet `title`
  ("Assortment — SOLID COLOUR · SOLID SIZE"), not in disabled inputs.
- The carton block (Master CTN, No of Cartons) was withdrawn from Assort the same day — do not
  bring it back from a spec that still lists it without asking.
- A combo cell inside a sheet is a `Combobox` scoped to that style's combos with
  `withHeldOption`, not a native `<Select>`.
- `SubDetailSheet` / `useSubSheetOrigin` (`components/orders/sub-detail-sheet.tsx`) exist to
  make the four sub-detail props automatic and have no callers yet — prefer them in new code.

---

## 7. One-open-at-a-time detail

- **`ChildGrid forceCards flatRows foldRows masterDetail defaultOpenKey={rows[0]?.key}`** —
  a rail of folded rows beside the open one (Material BOM items, Fabric BOM Manual with
  `railAlways railWidthPx={180}`, IWO Material BOM, CAD pattern). Always name the first row in
  `defaultOpenKey`.
- **`ProcessFoldList`** — the legacy `[+]`: a subject list whose rows each unfold a grid
  (Budget, Fabric BOM, IWO Fabric BOM). Its header says why `ChildGrid` cannot draw a panel
  under a TABLE row.
- **`BomSliceGrid`** — Material BOM combination bands.
- A hand-rolled multi-open fold is the `useAccordion` rule's target (AGENTS.md "Folds are
  accordions").

---

## 8. Which style a grid belongs to

OE has **no style switcher**. On a multi-style document:

- a grid whose rows each belong to a style carries a **Style column**, shown only when there
  is more than one style (`comboStyleColumnNeeded`);
- with one style, the column drops and a **`StyleIdentityBand`**
  (`components/orders/style-identity-band.tsx`: S No · Style Ref · Style · Article) sits above
  the grid as its caption;
- Quantities is ONE document-level grid; Ref No on each row names the style.

A `ToggleGroup` of style names above a grid (Sample's `switcher()`) hides every other style's
rows and makes "which style is this?" a question about chrome rather than a column. Use
`ToggleGroup` for a VIEW switch (Progress, Profit Check, the queue box), not for choosing the
parent of a grid's rows.

---

## 9. Computed figures

- Budget `figure()`: `<span className="tabular-nums text-sm">{fmtNumber(v)}</span>`, or
  nothing when refused, with the refusal under its own field via `FieldError`.
- Material BOM `derivedQtyCell`: `bg-info-soft text-info tabular-nums text-right`, UOM as a
  `text-[10px]` suffix; no data → a muted `—` whose `title` gives the reason; before the
  parent is chosen → "Pick an order" in the cell itself, never a prose empty state.
- A read-only `<Input>` for a computed value is the wrong primitive: it looks typeable and it
  takes a field's width.

---

## 10. The editor header band

`header={{ initials: "FB", title: reNo ?? code ?? "New …", badges: <span className=
"text-[11px] font-medium text-warning">● Unsaved</span>, meta: [customer, ref, style, …]
.filter(Boolean).join(" · "), right: <>Reports · Copy from… · Submit</> }}`. A workflow
action (Submit, Send to MD) goes in `header.right`, never the footer (shells.md, keyboard
reason). Header buttons are `size="md"` (Fabric BOM); Material BOM / Budget's `sm` Reports
button is the drift, not the rule.

Locked: `locked={override ? { message: <OverrideBanner/>, open: sections.map(s => s.key) }
: lockMessage ? { message, action: <RaiseRevisionLink orderId/> } : false}`, Save labelled
"Commit Changes (Override)" and no draft under an override.

---

## Known drift inside Orders (do not copy)

- `scorecards/page.tsx` uses `Segmented` as a view switch — that is `ToggleGroup`'s job.
- `fabric-bom-screen.tsx` / `iwo-fabric-bom-screen.tsx` `<Button className="h-7">` fail
  `check:button-shape`; `yarn-dyed-panels.tsx` dodges it with `[&_td_button]:h-7`.
- Document tables that page: Material BOM ▸ Requirement, IWO Material BOM ▸ Requirement and
  the four panels of `orders/order-tabs.tsx` lack `paginate={false}`.
- Budget's `canSave: validity.canSave && editable` is hand-assembled.
- IWO lists skip `hugCreated` and the `w-fit` wrapper.
- ~7 grids are named plain `columns`; `check:grid-budget` prints names, so give every grid a
  unique `…Columns` const.
