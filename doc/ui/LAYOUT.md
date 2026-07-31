# Raagam — Form & Screen Layout Contract

`DESIGN.md` covers colour, type and spacing **tokens**. This covers **layout**: how many
columns, how wide a field, when to group, which surface to open. It exists because the absence
of these rules is measurable — 92 master screens drifted into 29 different `grid-cols-*` values,
14 distinct `gap-*` values and three competing width systems, because every layout rule lived as
prose in a code comment citing a client call by date.

Rules here are backed by published research or a major enterprise design system. Sources are
cited so a future decision argues with the source, not with whoever wrote the screen.

---

## 1. The anatomy

Every master editor is the same nest of primitives. Compose these; do not invent new ones.

```
Sheet (fullScreen)  ──────────────────────── the surface, max-w-[1180px]
└── IdentityRow ──────────────────────────── who this record is (2-4 fields, no border)
└── SectionGrid ──────────────────────────── the page grid, 2 columns at ≥896px
    └── SectionColumn ────────────────────── OPTIONAL: one column, when which side
        │                                    a section lands on carries meaning
        └── DetailSection ────────────────── a titled bordered group, 5-7 fields
            └── Field size="xs|…|full" ───── one labelled control, sized to its data
```

| Component | File |
|---|---|
| `SectionGrid`, `SectionColumn`, `IdentityRow` | `components/masters/section-grid.tsx` |
| `DetailSection` | `components/masters/detail-section.tsx` |
| `Field` | `components/ui/field.tsx` |
| `ChildGrid` (repeating line items) | `components/masters/child-grid.tsx` |

**Screens never write their own `grid-cols-*`, `col-span-*`, `gap-*` or `<table>`.** If you need
a layout the primitives can't express, change the primitive.

> That last sentence is not a formality. `SectionGrid` and `IdentityRow` sat at **zero adopters**
> for months because neither could express the screen they were written for: `IdentityRow` welded
> a `0.85fr` onto the end of every row, but Material's HSN wants a fixed `10rem`; and
> `SectionGrid`'s auto-placement would have interleaved the sections, destroying the standing
> "LEFT = what the material is, RIGHT = how it's measured" rule. Both were fixed — `tracks` now
> takes the whole track list, and `SectionColumn` holds a column whose membership is meaningful.
> A screen that hand-rolls a grid is usually reporting a gap in a primitive, not being lazy.

Everything above is **layout**. It is orthogonal to **density** — the compact control heights and
tightened rhythm that turn a form from "fits a monitor" into "fits a laptop". Density is automatic
and needs no props; see **§10**.

### The fifth anatomy

There is one more, and pretending otherwise did not make it go away: **full-page bulk-assign
grids** — `tcs-assign`, `gst-assign`, `customer-gst-assign`, `material-hsn-assign`,
`process-hsn-assign`. These are neither a `Sheet` nor a `MasterFullScreen`: they edit one or two
columns across many existing rows, hold their edits in a dirty-row `Map`, and save a `changes[]`
batch. Consequences that are easy to get wrong, and that each of these files documents in a
comment:

- They inherit **no** modal guard, **no** autofocus and **no** Ctrl+S, so each must call
  `useUnsavedGuard` and `useRegisterShortcut("save", …)` itself — `submitSurface` cannot reach
  their Save button by DOM.
- They are outside `@container/editor`, so they get **no** compact density (§10).

Do not give them a form layout. Do add them to the list when auditing guards.

---

## 2. Columns

| Rule | Value |
|---|---|
| Page columns (`SectionGrid`) | **max 2**, 1 below 896px |
| Field columns inside a section | 12-col track, opt in with `cols={12}` + `<Field size>` |
| Never | split a semantically-sequential group across two columns |

Research says single-column, always: Baymard measured users completing a linear single-column
form **~15s faster** with fewer skipped fields, because multi-column forces a "which way do I
scan?" decision ([Baymard](https://baymard.com/blog/avoid-multi-column-forms), [NN/g
Top 10](https://www.nngroup.com/articles/web-form-design/), [Adam
Silver](https://adamsilver.io/blog/are-there-exceptions-to-the-avoid-multi-column-forms-rule/)).

Every enterprise system ships 2-4 columns anyway: SAP Fiori goes 2-column at L size "to have all
information on one screen and avoid scrolling" ([Fiori
Form](https://www.sap.com/design-system/fiori-design-web/ui-elements/form/)); Dynamics allows 3
per tab / 4 per section ([MS Learn](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/main-form-presentations)).

**Two is the reconciliation, and the unit matters.** We put *sections* side by side, not
*fields* — each section stays internally linear, so reading order is never ambiguous. Ant Design
draws exactly this line: multi-column is "explicitly prohibited within a single weakly-grouped
area", allowed only between independent groups ([Ant Design](https://ant.design/docs/spec/research-form/)).

### Why container queries, not `sm:` / `lg:`

Column count depends on the width the grid **got**, not the viewport. The same editor body is
~1180px in a full-screen sheet and ~440px inside a nested picker at an identical viewport width.
Breakpoints get the second case wrong every time.

| Container | Name | Threshold | Effect |
|---|---|---|---|
| `SectionGrid` | `@container/sections` | `@4xl` = 896px | sections go 2-up |
| `DetailSection` | `@container/section` | `@lg` = 512px | 12-col field track turns on |
| `IdentityRow` | `@container/identity` | `@2xl` = 672px | uneven tracks turn on |

This also removed a live landmine: `sm:col-span-2` meant "full width of a 2-col section" in ~80
places **and** "one sixth of a 12-col row" in `Field`. That collision is why `Field` had a single
adopter across 92 screens — nobody could migrate without silently shredding those 80 fields.
`@lg/section:col-span-2` cannot be confused with `sm:col-span-2`.

> Classes must be **static strings**. Tailwind v4 scans source text, so a computed
> `` `@lg/section:col-span-${n}` `` produces no CSS at all.

---

## 3. Field width

`<Field size>` inside `<DetailSection cols={12}>`.

| Size | Span | Fields/row | Use |
|---|---|---|---|
| `xs` | 2 | 6 | — *retired on the masters; see below* |
| `sm` | 3 | **4** | **every field, on a full-width section** |
| `md` | 4 | 3 | — *retired on the masters* |
| `lg` | 6 | 2 | **every field, inside a `SectionColumn`** |
| `full` | 12 | 1 | the things that are **not fields** — child grids, textareas, fact strips |

**ONE WIDTH, EVERY FIELD (client 2026-07-29).** The rule used to be "size to the data":
a 6-digit PIN took `xs`, a company name `lg`. The client reviewed the result on the
Applicant screen, pointed at the City · State · Pin · Country row and asked for the rest of
the module to match it — a screen of one repeated ~280px box reads as a grid, where mixed
2/3/4/6/12 spans read as ragged whitespace.

So the target is a **width**, not a span: **~280px**, four across a full-width sheet.
Which span produces it depends on the track the section sits in:

| Section sits in | Track | Use | Fields across the sheet |
|---|---|---|---|
| the sheet, stacked full width | ~1150px | `sm` (3) | 4 |
| one column of a `SectionGrid` | ~566px | `lg` (6) | 2 per column = 4 |

Getting this wrong is the commonest layout bug on these screens: `sm` inside a
`SectionColumn` is ~132px, *half* the reference, and the fields look starved rather than
compact. If a screen wants four genuinely-flush fields on one row, stack its sections full
width (`applicant`, `bank`, `courier-delivery`, `notify`) rather than splitting the sheet.

**What stays wide.** `full` is for things that are not fields: a `ChildGrid`, a GSTIN fact
strip, a multi-line `Textarea`. A textarea in particular must never share a row — every
grid row is as tall as its tallest item, so the fields beside it end up floating above a
band of dead space. Address "Street" is a single-line `Input` for exactly this reason.

**What this trades away.** E-Mail, Web site and long entity names now scroll inside a
~280px box instead of showing whole. That was the client's call, made with the trade-off
stated. Undoing it for one field means undoing it for the screen.

Reference: `components/masters/applicant-master-screen.tsx` — every field `sm`, with the
row arithmetic written into its `FIELD_SIZE` comment.

**Rows must still sum to 12.** A row totalling 13+ does not shrink; the last field wraps
onto a line of its own with the rest of that line left empty. Write the arithmetic into
the `FIELD_SIZE` map's header comment (see `material-master-screen.tsx`) — that comment is
what stops the next edit overflowing a row, because nothing in the build can catch it.

---

## 4. Grouping

| Field count | Structure |
|---|---|
| **< 7** | no grouping — a flat `DetailSection` |
| **7 – 15** | titled `DetailSection`s |
| **> 15** | tabs or the `MasterFullScreen` section rail |

Fields per section: **5 – 7**. Source: [Ant Design](https://ant.design/docs/spec/research-form/)
(the only published numeric thresholds found), corroborated by
[NN/g](https://www.nngroup.com/articles/form-design-white-space/) — break a 15-field form into 3
titled sections so it "feels like 3 short forms".

**No accordions.** NN/g: don't use them when users need most of the content — which is always
true of a master record ([NN/g](https://www.nngroup.com/articles/accordions-on-desktop/)).
Baymard adds that with collapsed form sections users can't tell whether hidden fields still
submit ([Baymard](https://baymard.com/blog/accordion-and-tab-design)). Sections stay visible;
use the rail to jump.

Max **2** levels of progressive disclosure ([NN/g](https://www.nngroup.com/videos/progressive-disclosure/)).

---

## 5. Which surface

| Fields | Surface |
|---|---|
| **≤ 8** | quick-create mini-sheet (`Sheet size="sm"`) — opened *from inside* another form |
| **> 8** | the full editor (`Sheet fullScreen`, or `MasterFullScreen` when >15 fields need a rail) |

Source: [SAP Fiori dialog usage](https://www.sap.com/design-system/fiori-design-web/v1-71/ui-elements/dialog/usage).
Dynamics draws the same two tiers — its Quick Create form is capped at one section / three
columns and cannot hold subgrids ([MS Learn](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/create-edit-quick-create-forms)).

`category-quick-create-sheet.tsx` and `yarn-quick-create-sheet.tsx` are the ≤8 tier. If one grows
past 8 fields it graduates to the full editor — it does not just get taller.

Avoid modals for tasks users perform **repeatedly** or that run >30s
([Smashing](https://www.smashingmagazine.com/2026/03/modal-separate-page-ux-decision-tree/)).

---

## 5a. Picking stored data

**Every field that references stored data uses `<DataPicker>` (`components/ui/data-picker.tsx`).
One shape, whole app (client 2026-07-29).** There is no second way to list data, and a screen
that hand-rolls one is a bug.

It used to be three ways, decided by nothing more than when the field was built: a modal
dialog (`lookup-dialog-picker`, 78 fields), a select-only modal (`record-picker`, 17), a nested
Sheet with CRUD (`lookup-picker`, 8), a dozen bespoke clones — while plain enums dropped a list
down under the field. One form could show all three: City opened a modal, Ship Mode dropped
down, Category opened a second Sheet.

### The shape

A `role="combobox"` input. Typing filters in place; the list is a portaled panel anchored to the
field. Add / Modify / Delete happen **in the panel** — the operator never leaves the form they
are filling to create the City they need.

| Mode | Modal? | Tab | Escape |
|---|---|---|---|
| **List** (browsing) | no | closes without choosing, focus moves on | closes the list only |
| **Form** (Add/Modify/Delete) | **yes** — scrim, focus trap, `useModalGuard` | trapped inside | back to the list |

The mode split is the design. A dropdown that traps Tab is a dialog in disguise; a form that
does not is one a stray click can discard.

Keyboard is the standing contract (`.claude/skills/raagam-keyboard-contract`) plus three keys
that only exist here — **Ins** add, **F2** modify, **Ctrl+Del** delete. They are the keyboard
path to the row icons, which Tab deliberately cannot reach in a non-modal panel.

**Touch** gets `Sheet size="sm"` instead of the anchored panel: same rows, same search, same
CRUD. A ~280px panel with 16px row icons is not hittable on a phone, and this ships as an
installed PWA.

### What "+ Add" does

| The entity is | Add | Where |
|---|---|---|
| a **config list** (City, State, Department, Ship Type …) | inline name-only form in the panel | `lookup-dialog-picker.tsx` |
| a **rich master** (Country, Currency, Bank, Commodity, Category, Yarn) | `onAddOverride` → a quick-create sheet (§5) | that entity's picker |
| a **transaction-scale master** (Customer, Vendor, Applicant, Employee, Location) | nothing — select-only | `record-picker.tsx` and friends |

The middle row is the one that gets skipped. A Country created name-only has no ISD code, which
the contact fields on half a dozen masters read off it; a Bank has no IFSC. If the record's other
fields *do* something, it does not get a name-only add.

**Delete always routes through the delete-or-deactivate guard**, never a raw delete: a value any
record references comes back deactivated with the referencing table named in the toast
(`deletedToast`). That guard is the reason Delete is safe to expose on a dropdown at all.

### Enums are not this

`<Select>` / `Combobox` over a fixed code list (AIR · SEA · ROAD, Yes/No) stays as it is. There
is nothing to create, and it already drops down and already searches.

### Which `<Select>`s must go (STANDING)

The sweep converted 78 fields and **missed several**, which shipped and the client found them.
The rule is not "most stored data"; the line is where the options come from:

| The `<option>`s are | Verdict | Because |
|---|---|---|
| mapped off **table rows** — `<option key={c.id} value={c.id}>` | **convert** | a row id in an option means a record, and a record can be added, renamed and deleted |
| a **module constant** — `MADE_TYPES`, `COUNTRY_GROUPS`, `BUSINESS_ENTITIES`, Yes/No, a status enum | leave | "Enums are not this" |
| a **list filter** — the block opens `<option value="">All …`, or it lives in `filter-bar.tsx` | leave | a filter edits the query, not the record; there is nothing to create |

A field select's blank first option reads `— Select —` / `— None —`; a filter's reads `All`. That
is the whole difference and it is worth keeping consistent, because it is the signal both a reader
and the audit go by.

Which adapter, by where the rows live: a `config_lookups` **kind** → `LookupDialogPicker`
(inline name-only Add/Modify/Delete). Its **own table** → the thin `DataPicker` adapter for that
entity (`CountryPicker`, `CurrencyPicker`, `BankPicker`, `CommodityPicker`, `LevyPicker` …), with
`onAddOverride` to a quick-create sheet if the record's other fields do something.
**Transaction-scale** (Customer, Vendor, Applicant, Employee, Location) → select-only.
Never a new picker shell — see `.claude/skills/raagam-masters-picker-wiring` for the full map.

Select-only is still a `DataPicker`: a field the operator may not create into drops the CRUD
icons, it does not drop back to a `<Select>`.

**A `<Select>` may stay only when converting it would break something, and the reason goes in the
file.** Three shapes have come up, all real — one about the form, one about the data, one about the
adapter:

- **The field decides which questions the form asks.** Every one of these is Item Class or a
  class-like parent, and that is the pattern rather than a coincidence: Materials' Item Class picks
  the whole form from the class code, Category's drives `showFabricStructure` and `showSubCategories`,
  Material Attribute's supplies the attribute values the panel lines up, the Commodity quick-create's
  classifies the row *into* a class other screens branch on. A class created from inside one of those
  forms selects itself and opens a form that does not exist. Materials' Fabric Type is the same shape
  one level down — Shade and the Mixing grid gate on `"melange"` / `"yarn dyed"`, so a value added
  does nothing and a value *renamed* breaks both silently. **A field that selects the form's shape
  cannot also be a field the operator extends from inside that form.**
- **The column is not a row id.** Process HSN writes `processes.hsn_code`, a plain `TEXT` column,
  so the option's value is a code string and `DataPicker`'s `value`-is-the-row-id contract does not
  fit.
- **The adapter cannot express a value the field needs.** Material HSN writes `items.hsn_id`, a uuid
  FK — the data is a textbook picker case — but the field must be able to go back to **null**, and
  clearing is half of what a bulk assign screen does. `LookupDialogPicker` passes `clearable={false}`
  and an `onChange` of `(id) => onChange(id ?? "")`, which never emits null; that is right for the
  ~78 config-lookup fields it serves, which clear by picking something else. So the two HSN screens
  stay `<Select>`s for two *different* reasons — Process because of its column, Materials because of
  the adapter. Check which one you have before reusing either as precedent.

None of the three is a licence to leave a field alone because a picker is more work, and "the
operator should not create these" is not among them — that is a select-only `DataPicker`.

Named exemptions live in `STRUCTURAL_SELECTS` in the audit, keyed on the field's own name — its
`id=`, its `aria-label`, or the helper's name where the element has neither — never a line number,
which any edit above it moves. Exemptions are per **field**, not per file: a new stored-row
`<Select>` added to one of these screens is still flagged. The audit repeats each reason because it
strips comments before it runs, so it cannot read the very thing that justifies the exemption. Put
the reason in **both** places.

**A field whose conversion is undecided goes in `OPEN_QUESTIONS`, not `STRUCTURAL_SELECTS`.** Two
today, and both could convert tomorrow: Materials' `uomSelect`, where `uoms` has no picker and one
would have to carry `limitTo` — a list narrowed by *another* field's rows, which no existing picker
does; and the pair of Material HSN selects, where a bare `DataPicker` **does** support `clearable`,
so only the per-row cost of hundreds of instances argues against it. Nothing structural forbids
either. They are silenced rather than left flagged for a reason worth stating: a check carrying a
permanent known hit teaches people to skim output that should be empty, and a skimmed audit protects
nothing. The separate set is what stops "silenced" reading as "settled" — these entries are debts to
pay, not exemptions to defend, and each disappears the day its blocker does.

Checked by `python scripts/audit_layout.py . --check stored-select`.

**Where that check is blind, so nobody discovers it the hard way.** It keys on `value={….id}`, which
is what lets the two HSN screens come out differently — and it means **a `<Select>` storing a natural
key from a real table is invisible to it.** Code-keyed is not the same as not-stored-data:
`CurrencyPicker` is the live proof, since `currencies`' primary key *is* the code. So a code-keyed
select can still deserve a picker, and nothing static tells it apart from Process HSN's free `TEXT`
column — only a human reading the column type can. Reviewing a new screen, look at the column, not
just at the audit's silence.

### The right component with no permissions is the same bug (STANDING)

**Pass `canCreate` / `canEdit` / `canDelete` to every managed picker.** They all default to
**false**, so a `<LookupDialogPicker>` handed none of them renders a list with no pencil, no bin
and no "+ Add" — on screen, indistinguishable from the plain `<Select>` this section exists to
remove, while passing any check that hunts for a `<Select>`. Employee's Category, Department and
Designation shipped exactly that way, beside a Team field on the same row that had them.

One of the three is enough to declare intent; `canDelete` defaults to `canEdit`. They are the
**host screen's** permissions standing in for "may I maintain this shared list" — an Employee
editor passes its own `perms`. Opt a single field out with `canDelete={false}`, not by passing
nothing.

**Structural select-only is a different thing, and it is marked by the missing scoping prop —
not by missing permissions.** `<ItemPicker>` builds its CRUD bar from
`quickCreateClassId && (canCreate || canEdit || canDelete)`: with no item class, a quick-created
yarn would have nothing to belong to, so the three rate screens omit `quickCreateClassId` and
perms there would be dead code. `quickCreateClassId` **with** no perms is the bug — the author
asked for the bar and silently did not get one. `<CategoryPicker>` is **not** symmetrical: only
its Add is gated (`canAdd = canCreate && !!itemClassId`), so `canEdit` / `canDelete` light up the
pencil and bin with or without `itemClassId`. Omitting all three there always loses something.

Checked by `python scripts/audit_layout.py . --check picker-perms`, over **masters, orders and
sales** — every managed-picker call site in the repo. It covers a wider tree than `stored-select`
on purpose: this one sits at zero, so a new tree is free insurance, while `stored-select` has live
hits and would only gain an untriaged backlog. Seven pickers are watched — `LookupDialogPicker`,
`CategoryPicker`, `ItemPicker`, `CountryPicker`, `BankPicker`, `CurrencyPicker`, `CommodityPicker`.
The last four were added while already clean; that is the point, since a picker is cheapest to
cover before it has a violation.

---

## 6. Child rows (line items)

Pick by **fields per row**, not by row count — a row runs out of width past ~5 real inputs.

| Fields/row | Pattern | `ChildGrid` prop |
|---|---|---|
| ≤ 3 | dynamic add/remove rows | `inlineCards` |
| 2 – 5 | inline editable table | default |
| 6 – 8 | collapsible / stacked card per row | `forceCards` |
| > 8 | stop inlining — open a row editor | — |

Source: [Ant Design](https://ant.design/docs/spec/research-form/); SAP agrees at ~8 — inline
creation only for tables "without a large number of columns"
([SAP](https://help.sap.com/docs/ABAP_PLATFORM_NEW/468a97775123488ab3345a0c48cadd8f/cfb04f0c58e7409992feb4c91aa9410b.html)).

Inline edit is for fast, low-risk single-field changes. Anything touching several related fields
or needing cross-field validation gets a deliberate save
([NN/g](https://www.nngroup.com/articles/data-tables/)).

**No scroll-in-a-box (client 2026-07-25, enforced 2026-07-30).** A child grid never gets its
own `max-h-… overflow-y-auto`. The rows open in full and the editor pane — the one scroller on
the screen — takes the height. Where a list can genuinely run long, `ChildGrid`'s `pageSize`
pages it; the pager self-hides when everything fits.

The retired rule was "cap the row area so the Add button stays pinned", and it read worst
exactly where it was used most: a Contact card is a ~6-field sub-form, so on Consignee a
**single** contact did not fit inside `max-h-56` and had to be scrolled to be read
(client 2026-07-30). A capped box also hides how many rows exist, puts a second scrollbar a few
millimetres from the page's own, and traps the wheel. `ChildGrid.maxBodyHeight` no longer
exists — if a comment cites it, that comment predates the pager.

Still legitimately capped, because none of them is a form: dropdown and picker panels, the
notifications popover, and overlays sized against the **viewport** (`max-h-[80vh]`).

---

## 6a. Row actions (STANDING)

Every listing table ends with the same cell, and **no screen writes it.**
`components/ui/row-actions.tsx` owns it — three ghost icon buttons, right-aligned:

| Action | Icon | Behaviour |
|---|---|---|
| View | `Eye` | Read-only sheet. **No Edit button inside it** — View is a dead end. |
| Edit | `Pencil` | Opens the editor (or starts the inline row edit). |
| Delete | `Trash2` | Two-step: the cluster becomes `Delete? [Cancel] [Confirm]`. |

Extras — Duplicate, Export row — go behind a `⋮` (`menu`). **Delete never does.** It is a
first-class icon with its confirm inline, because burying the one irreversible action one click
deeper than the reversible ones inverts the risk.

**Icons, not text links,** and the reason is consistency rather than taste: `data-picker.tsx`
already renders row CRUD as `Pencil` ("Modify (F2)") and `Trash2` ("Delete (Ctrl+Del)"), so a
picker row and a table row now read identically. It also gives every table ONE action-column
width. Discoverability comes from `components/ui/tooltip.tsx` plus an `aria-label` carrying the
record's name — `label` is not optional decoration, it is what stops a screen reader announcing
"Edit" forty times with no way to tell the rows apart.

**How to declare it:**

- On `MasterListShell` → pass `actions={{ onView, onEdit, onDelete, menu }}`. The shell appends
  the column, gates it on `perms`, derives aria-labels from `mobile.title`, and feeds the mobile
  card the *same* handlers — so a View cannot exist on desktop and be missing on mobile.
- On `SimpleMasterScreen` → nothing to do; the engine owns the cell. Add `view` to the
  descriptor to light up the eye.
- Rendering `DataTable` directly → `rowActionsColumn((r) => <RowActions … />)`. Never write
  `{ header: "", align: "right", cell: … }` by hand; that is what produced six different action
  dialects and four ways of confirming a delete across 131 files.

**THE EYE IS ON BY DEFAULT — a screen gets a View by doing nothing.** There are three
derivations, and they win in this order:

1. **`onView`** — the screen's own sheet (`MaterialViewSheet`, the 9 bespoke masters).
2. **Columns-derived** — `MasterListShell` pairs each `header` with its `cell(row)`, so FKs
   arrive already resolved by the screen's own renderers.
3. **Row-derived** — `lib/record-pairs.ts` reads the record itself. This is the one every other
   table gets, and it shows the fields the list does *not*: humanized keys, dates through
   `fmtDate`, `*_id` UUIDs and empty values dropped, joined relations flattened to their name,
   child collections reduced to a row count.

`view={false}` on `RowActions` opts out — for a grid whose columns already *are* the whole
record, where the sheet would just repeat the row back.

This default is not a convenience, it is the mechanism. The first attempt made the eye opt-in;
**102 of 111 tables promptly shipped without one**, which is the exact gap this section exists to
close. The row is what the view is built from because `rowActionsColumn` already receives it —
`DataTable` would be the natural home (it alone knows the columns) but cannot hold client state:
42 **server** components render it and pass `cell` functions in `columns`, and functions cannot
cross the server→client boundary.

**Mobile does not use this cell.** Tables are `hidden md:block`; phones get `MobileCardList`,
whose footer uses `DeleteConfirmButton` and a text "View" — a 32px icon is not a touch target,
and this ships as an installed PWA.

**Never** `window.confirm`. The two-step is the app's only delete confirmation. And never a raw
delete: `lib/masters/delete-guard.ts` decides delete-vs-deactivate server-side, which is why the
button cannot promise which one happens — `deletedToast` reports which one did.

Checked by `python scripts/audit_layout.py . --check row-actions`.

---

## 7. Labels, spacing, validation

**Labels: top-aligned, `font-medium`, never bold.** Penzo's eye-tracking: label above = ~50ms
saccade; left-aligned = ~500ms. **Bold pushed 50ms → 80ms (+60%)** by visually competing with the
input border ([UXmatters](https://www.uxmatters.com/mt/archives/2006/07/label-placement-in-forms.php)).
`components/ui/label.tsx` is already correct — leave it.

**Spacing is 1:4:8** — 4px label→control, 16px between fields, 32px between sections
(Law of Proximity; a label must sit nearer its own control than the next field —
[NN/g](https://www.nngroup.com/articles/form-design-white-space/)). Owned by `DetailSection` and
`Field`. Screens do not set their own.

**Validation: on blur, reward early / punish late.** If a field is currently valid, validate on
blur. If it is currently *invalid*, re-validate on every keystroke so it clears the instant it's
fixed ([Baymard](https://baymard.com/blog/inline-form-validation),
[Konjević](https://medium.com/wdstack/inline-validation-in-forms-designing-the-experience-123fb34088ce)).
Never validate mid-typing in an empty field — it reads as yelling before the user submitted
anything. Add positive confirmation (a green check) on format-constrained fields — GSTIN, PAN,
IFSC, PIN (see `lib/validation/formats.ts`).

**Never disable the Save button.** A disabled button hides *why* it's disabled. Run validation on
click and focus the first invalid field instead ([Primer](https://primer.style/product/ui-patterns/saving/),
[Atlassian](https://atlassian.design/patterns/forms/)).
> Not yet true of `master-full-screen.tsx` — it still disables on `!canSave`. Open item.

**Mobile:** controls are `text-base md:text-sm`. `text-sm` alone zooms the iOS viewport on focus.
Already handled inside `Input` / `Select` / `Textarea` — **do not** re-type it at the call site
(~499 such no-op classNames already exist; don't add more).

---

## 8. Keyboard

The contract lives in `.claude/skills/raagam-keyboard-contract` and is implemented once in
`lib/focus.ts`, wired globally by `components/shell/keyboard-nav-provider.tsx`. Screens do **not**
bind their own `onKeyDown` for field navigation.

- Tab → next field, and nothing else — it never opens a list. On a `MasterFullScreen` rail
  editor the "next field" after a section's last one is **the next section**, which opens with
  the cursor in its first field (Shift+Tab goes back, landing on the previous section's last
  field); on the last section Tab carries on to the footer's Cancel/Save
- ↓ on a picker/dropdown → open its list · ↓/↑ otherwise → the field below / above, **spatially**
- ←/→ → the field left / right, once the text caret is at the edge
- Enter → pick the highlighted row if a list is open, tick a focused checkbox/radio, else
  **save the record**
- Esc → close the list, then the surface (confirm if dirty), then leave the page
- In a child grid ↑/↓ stay Excel-like (row up/down) — except ↓ on a picker cell, which opens
  its list (`gridKeyNav` stands down without `preventDefault` so the provider gets the key)
- Navigation may not escape its scope: `[data-focus-scope]`, `[role="dialog"]`, `form`, `main`
- A control that owns a key must call `preventDefault()` — the global listener honours that and
  nothing else. React-level `stopPropagation()` will **not** stop it (React 19 delegates to
  `document`, the same node). This is load-bearing for Escape: a layer that closes without
  claiming the key also navigates the page away.
- Auto-generated / derived fields carry `tabIndex={-1}` so Tab skips them — write it as
  `<Field skipTab>` (or `SimpleField.skipTab` in the descriptor tier), not by hand. It has to be a
  real `tabIndex` on the control: under the v3 contract Tab is **native**, so no `data-` attribute
  and nothing in `lib/focus.ts` can take a control out of the Tab order.

---

## 9. Checklist for a new master screen

- [ ] Fields ≤ 7? One `DetailSection`. 7-15? Titled sections. >15? Rail.
- [ ] Sections wrapped in `SectionGrid`; identity fields in `IdentityRow`
- [ ] `cols={12}` + `<Field size>` — sized to the data, no hand-written spans
- [ ] No `grid-cols-*`, `col-span-*`, `gap-*` or `<table>` written in the screen
- [ ] Child grids: mode chosen by fields-per-row (§6)
- [ ] List uses `MasterListShell` + `DataTable`, not a hand-rolled table + pagination
- [ ] Row actions via `actions` / `rowActionsColumn`, never a hand-written `header: ""` cell (§6a)
- [ ] Pickers via `record-picker` / `lookup-picker`, never a bespoke dialog
- [ ] Tested at 375px: one column, no horizontal page scroll
- [ ] Derived / auto-generated fields carry `<Field skipTab>` (§8)
- [ ] Every free-text `<Input>` carries `uppercase`; the schema uses `capsName` (§11)

---

## 10. Density

> Numbered last only to keep the §-citations in existing code comments valid. Read it before §9.

Everything above decides **where a field goes**. This decides **how much room it takes**. The two
are independent: a screen can be on the 12-col track and still waste a third of a laptop screen on
padding, which is what "compact" fixes.

**You do not opt in.** There are no density props. Every control inside an editor surface is
already compact; the job when writing a screen is simply not to break it.

### The container

```
@container/editor          declared on the CONTENT wrapper of the two editor surfaces
                           sheet.tsx (fullScreen, size="lg") · master-full-screen.tsx
@2xl = 672px               above this width, compact turns on
```

**It is a container query, not `md:`, and that is the whole design.** The same wrapper is ~1180px
in a full-screen editor and ~440px inside a nested picker dialog *at an identical viewport width*.
A breakpoint would shrink the picker's controls too. Because 440px and every phone sit below
672px, **touch targets stay 36px wherever there isn't room to be dense**, with no prop, no
`hidden md:block`, and no mobile-specific branch.

Two consequences worth knowing before you go looking for a bug:

- **Footers are outside the container.** On both surfaces the footer is a sibling band of the
  content wrapper, so Save / Cancel keep `h-9`. That is intentional — they are the primary action
  and sit alone on a line, not beside a field.
- **A screen with no editor surface gets no density at all.** The bulk-assign tier (§1) and the
  31-screen `SimpleMasterScreen` tier are outside it. `SimpleMasterScreen` looks compact only
  because it hard-codes `h-8`, which means it will *not* track any future change to this scale.

### The scale

| File | Base → compact |
|---|---|
| `ui/input.tsx`, `ui/select.tsx`, `ui/combobox.tsx`, `masters/picker-classes.ts` | control `h-9` → `h-8` |
| `ui/textarea.tsx` | `py-2` → `py-1.5` (a textarea has no height to compact — padding is its share) |
| `ui/button.tsx` | `size="md"` / `"icon"` `h-9` → `h-8`; `sm` is already 32px, `lg` is a standalone CTA |
| `ui/label.tsx` | `mb-0.5` → `mb-0`, line box 16px → 14px (≈4px per field) |
| `masters/detail-section.tsx` | `p-2.5` → `p-2`, `space-y-2` → `space-y-1.5`, header `min-h-5` → `min-h-4` |
| `ui/field.tsx` (`FIELD_TRACK`) | row gap `gap-y-2` → `gap-y-1.5` |
| `masters/child-grid.tsx` | same padding + gap as `DetailSection`, deliberately, so a grid and a section side by side line up |
| `masters/master-full-screen.tsx` (`SectionBody`) | title + hint stack → one line; ~54px of heading chrome → ~32px |

**Keep these in step.** They are one scale expressed in eight files; change one height and fields
stop lining up with the pickers beside them. `gap-x-3` is deliberately *not* on the scale — that
gutter is what stops two adjacent controls on a 12-col row reading as one control.

Type sizes do **not** compact: controls stay `text-base md:text-sm`, labels `text-xs`. 11px was
tried and rejected as below a readable floor for all-day data entry.

---

## 11. Letter case

**Field values are stored in CAPITALS.** Not displayed in caps — *stored*. Client rule since
2026-07-23, extended to the whole application 2026-07-29.

This existed for six days as an inline comment (`// names stored in CAPS`) repeated in ~30 server
actions and nowhere else. That is the same failure mode §1 documents for the layout contract, so
it is written here and checked by `scripts/audit_layout.py --check caps-input`.

### The two halves, and why you need both

| Half | Where | Fixes |
|---|---|---|
| Type-time | `<Input uppercase>` mutates the value in `onChange` | what the operator types now |
| Display | the same prop adds a CSS `text-transform` | rows **already** saved in mixed case |

The CSS half is not decoration. A value loaded from the database and never re-typed cannot be
reached by a keystroke transform — without it, a record saved before the rule existed keeps
showing lower case forever.

### Where the write-side transform belongs

In the **Zod schema**, via `capsName()` / `capsTextNullable()` (`lib/validation/formats.ts`) —
never only in the server action.

The action is not the only write path. `lib/data-io/actions.ts` parses a spreadsheet import with
the *same* `*Input` schemas and writes `parsed.data` straight to Postgres, so an action-level
`.toUpperCase()` never sees an import. Every bulk import was storing mixed case despite thirty
hand-copied uppercase calls, and no screen showed it.

Validate before you transform: `.min()` cannot be chained after a Zod transform, and a
whitespace-only name should fail as empty rather than succeed as `""`.

### What is NOT uppercased

These are exemptions by construction, not oversights — do not "fix" them:

| Exempt | Why |
|---|---|
| email, website | `transform: "none"` in `formats.ts`. Case can be significant, and a shouted email reads as broken |
| digit formats — phone, PIN, account, Aadhaar | `uppercase` is a no-op; they carry their own transform |
| land line, mobile, WhatsApp, fax, ISD | same reason; the check matches these on the bound field name |
| `<Textarea>` free text | no `uppercase` prop exists on it. A shouted paragraph is unreadable |
| passwords | obviously |
| uuids and ids | Postgres renders uuids lower case; an uppercased one will not match |
| read-only / derived fields | `(auto)` is a hint, not data — uppercasing makes it read as a value |
| search boxes | the query is not stored; caps only changes how the toolbar looks |
| workflow status keys | `draft` / `in_progress` are internal state, rendered through `StatusPill` with their own labels |

`ValidatedInput` handles its own casing: it applies the format's transform on change, and carries
the CSS half only for `transform: "upper"` kinds (GSTIN, PAN, TAN, CIN, IEC, IFSC, SWIFT, currency,
yarn count).

> **A gap the check cannot see.** Those contact fields are exempted by *name*, which means a
> plain `<Input value={form.land_line}>` is indistinguishable from a properly-wired
> `<ValidatedInput format="landline">`. Several masters still use the bare `Input` and so get no
> validation at all — Brand's Website and Phone were two, found only because the CAPS sweep made
> the odd one out visible. The fix is to convert them, never to add `uppercase`.

### Fixed value lists

A dropdown's members are field values too. `["air","sea","road"]` and `["AIR","ROAD","SEA"]` both
existed for ship mode, in different modules, for the same concept — migration `0368` settled that
in favour of caps. When a list is pinned by a Postgres `CHECK`, the constraint, the `z.enum` and
the const array move **together**, and any render-time re-casing gets deleted rather than left.

---

## 12. Dates and times

**DD/MM/YYYY everywhere** (client 2026-07-29). One pair of formatters owns it — `fmtDate` and
`fmtDateTime` in `lib/format.ts`. Do not format a date at a call site.

Both are built by hand rather than through `toLocaleDateString`, for two reasons worth keeping:

1. **A locale is a request, not a guarantee.** `en-IN` renders DD/MM/YYYY on most runtimes, but
   the result depends on the ICU data the runtime ships, and server render and browser hydration
   do not always agree. A fixed business format should not be negotiated with a locale database.
2. **Timezone.** A Postgres `date` column arrives as the bare string `"2026-07-29"`.
   `new Date("2026-07-29")` reads that as UTC midnight, so `getDate()` at a negative UTC offset
   returns the 28th. `fmtDate` formats the string directly when it matches `YYYY-MM-DD`, so no
   instant is involved and nothing can drift. Only real timestamps go through `Date`, where
   local-time conversion is the point.

### What is deliberately NOT DD/MM/YYYY

| Where | Renders | Why |
|---|---|---|
| `lib/dashboard/range.ts` `today()` | `2026-07-29` | **a computation, not a display.** The string is compared against `date` columns and fed back into queries. Reformatting it breaks every dashboard range *silently*, because the strings still compare — just wrongly |
| `monthLabel` (`range.ts`, `analytics-dashboard.tsx`) | `Jul`, `Jul 26` | chart axis labels. Twelve `01/07/2026`s along an axis is unreadable |
| `components/dashboard/hero.tsx` | `Monday, 29 July 2026` | prose in a greeting, and the weekday is the useful part |
| `hero.tsx` hour extraction | — | picks the hour for "Good morning". A computation |
| `lib/data-io/export.ts` filenames | `2026-07-29` | ISO sorts correctly and is safe in a filename |

### The native date input

`<input type="date">` — ~160 of them — renders in the **browser's** locale, not the page's. No
HTML attribute, CSS rule or React prop can change that; the element's `value` is always ISO
`yyyy-mm-dd` regardless of what it displays. A machine set to US English shows MM/DD/YYYY and
there is nothing in this codebase that can override it.

Forcing DD/MM/YYYY in the pickers means replacing the native control with a masked text input plus
a calendar popover — a real component, not a formatting change. Until that exists, the guarantee is
**display is DD/MM/YYYY everywhere the app draws the date itself**; the pickers follow the machine.
