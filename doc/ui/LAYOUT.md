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

### The two caps, and why they differ

| Surface | Content cap | Pane padding |
|---|---|---|
| `Sheet` (fullScreen) | `max-w-[1180px]` | `px-6` |
| `MasterFullScreen` (rail editor) | `max-w-[1440px]` | `px-4` |

They are not a drift to be tidied away (client 2026-08-17). `max-w` + `mx-auto` is a **centring**
rule wearing a width-limit costume, and on a Sheet the two are the same thing. Put a 228px rail
down one side and they stop being: whatever the cap leaves over is split evenly into a gap *after
the rail* and a gap before the card's right edge, so the operator sees dead space on **both** sides
at once and reads it as padding. At 1180 that was 48px a side on a 1536-wide viewport — a 1920
monitor at Windows' 125% — and it **grew with the monitor**, reaching 120px a side at 1920 CSS.

1440 is picked so the cap stops biting up to ~1690 CSS px (every laptop, and the common
1920@125% desktop) while still catching a 4K or ultrawide, which is the only thing the cap is for.
Removing it entirely is not the fix: a field is a *fraction* of this width (§3's 12-col track), so
an uncapped `xs` field reaches ~388px on a 2560 monitor — wider than a full-size field.

**A capped content pane needs a capped FOOTER.** Both surfaces wrap their footer row in the same
`max-w`, because an uncapped footer leaves the primary Save button sitting to the right of the last
field it saves — by exactly the centring gutter, so the misalignment is invisible on a laptop and
grows with the monitor.


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
| `md` | 4 | 3 | — *retired on the masters, with one named exception below* |
| `lg` | 6 | 2 | **every field, inside a `SectionColumn`** |
| `xl` | 8 | 1 + a field | a **not-field** that shares its row — see below |
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

**The one named exception: Material ▸ Fabric ▸ Classification uses `md`** — three fields
(Structure, Type, Fabric Type) on one row inside a `SectionColumn`, asked for three times
(client 2026-08-04). In that ~584px column the 12-col track runs ~36.3px per unit, so `md`
renders at **181px** — narrower than the ~280px reference, but 36% wider than the `sm`
attempt that produced the starved-field bug above, and wider than the signed-off mockup's
own three-across row (`doc/ui/New Material Fabric - Organized Layout.html` lays Units of
Measure out as `repeat(3,1fr)` at ~175px in a column of the same width). Stacking the
sections was tried first and reverted the same day, because the client wants the
two-column page split kept. Recorded here because a screen quietly using a retired size is
how the next reader "fixes" it back — that already happened once. The arithmetic is in the
comment beside the fields (`material-master-screen.tsx`, `fabricDetails`).

**What stays wide.** `full` is for things that are not fields: a `ChildGrid`, a GSTIN fact
strip, a multi-line `Textarea`. A textarea in particular must never share a row — every
grid row is as tall as its tallest item, so the fields beside it end up floating above a
band of dead space. Address "Street" is a single-line `Input` for exactly this reason.

**`xl` (8) is the same category as `full`, for a not-field that SHARES its row.** A
`ChildGrid` beside a field, where `full` would push it onto a row of its own. The map used
to jump 6 → 12, so the only way to give a table more than half a row was to give it the
whole one — and half a row is not enough: Material ▸ Fabric ▸ Composition put its mixing
grid at `lg` (278px) and the Yarn picker inside it came out at ~150px, which the client
read as squeezed (2026-08-05). At `xl` the grid is 374px and the picker ~250px, beside a
`md` cell holding Using and Direct Purchase stacked. **Never use `xl` to make a FIELD
wider** — a field is ~280px and the sizes above are how you hit it. This exists because a
table is not a field.

**What this trades away.** E-Mail, Web site and long entity names now scroll inside a
~280px box instead of showing whole. That was the client's call, made with the trade-off
stated. Undoing it for one field means undoing it for the screen.

Reference: `components/masters/applicant-master-screen.tsx` — every field `sm`, with the
row arithmetic written into its `FIELD_SIZE` comment.

**Rows must still sum to 12.** A row totalling 13+ does not shrink; the last field wraps
onto a line of its own with the rest of that line left empty. Write the arithmetic into
the `FIELD_SIZE` map's header comment (see `material-master-screen.tsx`) — that comment is
what stops the next edit overflowing a row, because nothing in the build can catch it.

### A row is settled when it sums to 12 — under as well as over (client 2026-08-17)

The paragraph above is only half a rule. **Underfilling is the same defect as overflowing**
and it is the one that ships, because it looks like nothing: the fields do not stretch, so
the leftover columns sit at the end of the row as whitespace that reads as page padding.
That is exactly how it was reported — as "excess gap", pointed at a form, not at a grid.

**The COUNT picks the size, not a preference for small.** Six cells tile a 12-column row at
`xs`; eight tile it at `sm`. Style's header is eight fields and is right to stay `sm` (4 + 4);
Material BOM's is six and was wrong at `sm` (4 + 2, half a row short) and is right at `xs`.
Forcing one size on both would leave one of them ragged. Work out the tiling before picking
a span:

| Cells in the group | Flush arrangement |
|---|---|
| 3 | `md` ×3 |
| 4 | `sm` ×4, **or** `xs` `xs` `md` `md` when two of them hold text |
| 5 | `xs` ×4 + `md` |
| 6 | `xs` ×6 |
| 8 | `sm` ×4, twice |
| 10 | `xs` ×6, then `md` `xs` `xs` `md` |
| 11 | 6 + 5 leaves two columns spare — **split a merged cell or merge a pair** |

**When a group cannot tile, change the CELL COUNT, not the widths.** Order Entry's header is
the worked example and it went both ways: thirteen fields do not divide by six, so Pack and
Mult. Ord were merged into one cell to reach twelve (2026-08-14) — then `Yr` was withdrawn
the same day, nothing recounted, and eleven cells left the row two columns short. Splitting
the pair back apart restored 6 + 6. **The merge was arithmetic; when the arithmetic changes,
revisit it** rather than stretching some innocent field to `md` to plug the hole.

**Promote a field because its DATA wants the width.** Where a group genuinely cannot tile at
one size, the arithmetic says *how many* fields go up a size and never *which*. Logistic is
ten cells — six then four — so two take `md`: `Pay Terms`, which holds the longest value on
the row, and `Gross Value`, the total it ends on. Picking whichever field happened to be last
would be flush and arbitrary.

**Two things are exempt, and both are controls rather than data rows:** a `ChildGrid` sized
deliberately narrow (Style ▸ Coordinates is `lg` on purpose — see its comment), and a picker
paired with its action button, where filling the row only stretches whitespace inside a
`w-fit` button's cell. A grid whose cells come from a `columns.map()` cannot be settled
statically at all — its count is the column count.

### An unfilled field shows NOTHING (client 2026-08-17)

`DataPicker`, `Combobox` and `Select` all default their empty-state placeholder to an **empty
string**, and 209 hand-written `<option value="">` labels were blanked to match.

**This reversed twice in one day, and both reversals are the same lesson.** The field first read
"— Select Customer —": the noun there is *the label repeated with a verb*, since a picker is
`compact` inside a `<Field label>`, so the word already stands directly above the box, and in a
`ChildGrid` cell the column header says it a third time. It cost width it had not earned —
"— Select Merchand... —" ellipsed itself inside a 202px trigger, under a label reading
"Merchand.".

It then went to a bare `—`, defended as the app's existing "nothing chosen". **That defence
confused a table cell with a form field.** In a table a dash is right and stays right
(`created-columns.tsx`), because a column of blanks is ambiguous with a column that failed to
load. A form field already has a box, a border and a chevron saying "a value goes here", so the
dash is a mark meaning what the box already means — and sixty fields each drawing one is a screen
of dashes, which is what the client saw and rejected within the hour.

**The rule underneath: an empty control says nothing.** Emptiness is legible on its own; every
attempt to announce it costs width and adds a mark to scan past.

Three things this does NOT touch, and the boundary matters:

- **`All …` on a filter facet.** 31 `<option value="">All</option>` and ~25 variants survived
  deliberately. On a filter, "showing everything" is a *real selection* the operator needs to
  read; a blank filter dropdown reads as broken. `— Any —` and `— All locations —` kept their
  word and lost their dashes.
- **A label a control does not otherwise have.** A few dense inline grid rows use the empty option
  as the only label (`UOM`, `Item` in `dc-new-form` / `new-process-order-form`). Blanking those
  leaves an unlabelled box. `— Material —` and `— Account —` were de-dashed, not blanked.
- **An explicit `placeholder` that names a STATE OF THE RECORD** — not a hint about the field.
  Order Entry's Rejection Rule reads "No projection", because blank there is a state of the order
  and not an unanswered field. The same shape kept "Pick a Style first" on the Combo picker while
  blanking its other branch.

  **THIS CLAUSE WAS NARROWED ON 2026-08-19, AND THE NARROWING IS THE POINT.** It used to read
  "an explicit `placeholder` still wins" — a general escape hatch, which is how 352 of them
  survived a sweep whose whole subject was that an empty control says nothing. `placeholder`
  is not an exemption; **the two states above are the exemption**, and they are exhaustive
  until the client names a third. Everything else goes, including the ones that read as
  helpful: `"Why is this order being amended?"` restates a label, `"1"` shows a value the
  operator may mistake for a default, `"(auto)"` describes a field that is already `readOnly`
  and therefore already unreachable.

  A survivor carries a `// placeholder-blank: exempt -- <reason>` comment naming which state
  it reports. Checked by `python scripts/audit_layout.py . --check placeholder-blank`.

The picker's noun is not lost either — it still names the panel, the search box
("Search customers…"), the add button and every toast, all places where nothing else says it.

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
| a **rich master** (Country, Currency, Bank, Category, Yarn) | `onAddOverride` → a quick-create sheet (§5) | that entity's picker |
| a **transaction-scale master** (Customer, Vendor, Applicant, Employee, Location) | nothing — select-only | `record-picker.tsx` and friends |

The middle row is the one that gets skipped. A Country created name-only has no ISD code, which
the contact fields on half a dozen masters read off it; a Bank has no IFSC. If the record's other
fields *do* something, it does not get a name-only add.

**Delete always routes through the delete-or-deactivate guard**, never a raw delete: a value any
record references comes back deactivated with the referencing table named in the toast
(`deletedToast`). That guard is the reason Delete is safe to expose on a dropdown at all.

**A quick-create sheet and the list that opened it are never on screen together.** `startAdd` /
`startEdit` (`data-picker.tsx`) close the panel before calling the override. Do NOT reach for
z-index here: the panel sits at 150 and outranks every `Sheet` on purpose, because a sheet holds
pickers of its own — `CategoryQuickCreateSheet`'s Fabric Structure field is one — so raising the
sheet above the list only hides the list *inside* it. Left open, the category list painted over
the "New Category" box it had just opened (client 2026-08-06).

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
entity (`CountryPicker`, `CurrencyPicker`, `BankPicker`, `LevyPicker` …), with
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
  Material Attribute's supplies the attribute values the panel lines up. A class created from inside
  one of those forms selects itself and opens a form that does not exist. Materials' Fabric Type is the same shape
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
hits and would only gain an untriaged backlog. Six pickers are watched — `LookupDialogPicker`,
`CategoryPicker`, `ItemPicker`, `CountryPicker`, `BankPicker`, `CurrencyPicker`.
The last three were added while already clean; that is the point, since a picker is cheapest to
cover before it has a violation.

---

## 6. Child rows (line items)

Pick by **fields per row**, not by row count — a row runs out of width past ~5 real inputs.

| Fields/row | Pattern | `ChildGrid` prop |
|---|---|---|
| **1** | records flow **across** the row and wrap | `across` |
| ≤ 3 | dynamic add/remove rows | `inlineCards` |
| 2 – 5 | inline editable table | default |
| 6 – 8 | stacked rows, **one frame, hairline dividers** | `forceCards flatRows` |
| > 8 | stop inlining — open a row editor | — |

**`forceCards` NEVER TRAVELS ALONE (client 2026-08-19).** It stacks the row, which is
right, *and* draws a bordered box around each one, which the client rejected: a section
holding six lines drew seven frames. `flatRows` keeps the stack and the per-row band —
the row's identity and the ✕ that Ctrl+Del drives — and drops only the box and its 10px
of padding, so a hairline says where a row ends. See the `raagam-screen-layout` skill,
"The operator's five" rule 4, for why `listRows` is not the answer here.

**A ONE-CONTROL RECORD GOES ACROSS, NOT DOWN.** A size, a coordinate — the other three
layouts are all one-record-per-line by construction, and for a list of two-character values
that is the whole cost: at 36px a line plus a 32px Add button, six sizes is ~248px of a screen
whose other cells are 32px tall, against ~170px for the legacy screen doing the same list.
`across` lays each record in a cell of `FIELD_TRACK` and wraps, so six take one line and ten
take two (client 2026-08-14 on the Garment Order's Style(s) tab, 2026-08-17 on the Style
master). The label belongs to the `<Field label>` around the grid — this mode draws no header
band, because one header cannot head six columns of the same thing — and no ordinal, because
position already says it.

**↑/↓ then walk the list left to right**, which is the one thing to weigh before reaching for
it. That stays coherent only for a ONE-DIMENSIONAL list whose DOM order and visual order
agree; it is not the 2026-07-25 defect, where ↓ crossed out of a row's cells into a nested
panel's and landed on the wrong line. Nothing in this mode crosses a boundary.

**A grid that SHARES its row with a field adds `flushRows`.** An inline grid puts its first
control 31px down — an 18px header band, a 6px gap, and the row's own 7px card inset — while
a `Field` beside it puts its control at 14px, so the two read as misaligned (Material ▸
Fabric ▸ Composition, client 2026-08-05). `flushRows` takes all three out: the header band
gets `Label`'s exact metrics, the gap goes, and rows separate with a rule instead of a
border each. Opt-in — a grid that owns its whole row wants the cards.

**Such a grid gets exactly ONE band**, or the first row falls 14px below the field it is
meant to match. So `flushRows` drops the usual caption row and renders `label` *inside* that
single band while the grid is empty, handing the slot to the column headers as soon as a row
exists. That also fixes the state the operator sees first: column headers are gated on
`rows.length > 0`, so an empty inline grid used to start its "+ Add" button flush at 0 while
the field beside it started at 14.

**"`Label`'s exact metrics" MEANS IMPORTING THEM** — `LABEL_METRICS` from
`components/ui/label.tsx`, which `Label` itself consumes. The band retyped them for twelve
days (`leading-[14px] mb-1.5`) and was 8px out at the compact density every desktop editor
runs at: `Label` is `mb-0` there, not `mb-1.5`, and the `leading` never applied at all
because it sat on the flex parent while each header cell's own `text-xs` re-set the
line-height (hence `leading-[inherit]` on those cells). This paragraph, the prop's doc
comment and the code all read as correct throughout — a copied number is only ever right
until one of the two moves.

**A ONE-COLUMN grid beside a field also adds `hideIndex`**, which is the horizontal half of
the same alignment. The `#N` track costs `w-4` + the row's `gap-2`, so every cell and its
header sit **24px** right of the field in the row above — and right of the "+ Add" button
below, which hangs off the grid root and is never indented. Style ▸ Sizes read as unaligned
with the vertical half already fixed for exactly this (client 2026-08-17). The ✕ and Ctrl+Del
are untouched; what goes is an ordinal nothing stores. A multi-column grid keeps its numbers —
"row 3" is how a line of eight fields gets talked about — and so does any grid declaring a
`total`, whose caption renders in that slot.

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

### A grid says its name once, and says nothing when it is empty (client 2026-08-19)

Two bands the operator asked to have back, and they are the same mistake at two moments.

**The caption repeats the section.** `ChildGrid`'s `label` draws a band above the columns —
and the grid is already inside a `DetailSection` or a `FullScreenSection` whose title names
it, with the rail saying it a third time. 42 grids across 33 files pass one. **Omit `label`
whenever the surrounding section names the grid**, which is nearly always; the band
disappears with it, and `addLabel` is independent so the "+ Add row" button survives.

This was already the prop's documented advice ("OPTIONAL — omit it when the surrounding
`DetailSection` already names the grid") and 42 call sites did it anyway, which is the usual
lesson: **advice in a prop comment is not a rule**, because nobody reads a comment on a prop
they are not passing. The section below makes it checkable.

Two captions genuinely earn their band: a `flushRows` grid, where `label` renders *inside*
the single band it is allowed and is the only thing naming the control while it is empty;
and a grid that does NOT sit in a section of its own (two grids side by side in one section
need to say which is which).

**The empty state explains what the operator can see.** "No sizes in the Sizes master yet",
"Nothing to choose from" — a sentence of prose where a grid has no rows. It is the same
finding as §3's "an unfilled field shows NOTHING" one level up: emptiness is legible, and
announcing it costs a band and a line to scan past. It is also usually *false comfort* — the
grid seeds one blank row (rule 4b), so a genuinely empty grid is a rarer state than the
sentence implies.

So: no prose empty state on a grid. **The one exception is an empty state that reports a
CAUSE the operator can act on** and could not otherwise deduce — "No sizes in the Sizes
master yet" points at a different screen, and stays. "Nothing to choose from" points at
nothing and goes. The test is the same one §3 applies to a placeholder: does it name a state
of the data, or describe the box it is sitting in?

Checked by `python scripts/audit_layout.py . --check grid-caption`. Opt out per line with a
`// grid-caption: exempt -- <reason>` comment.

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

## 6b. Created Date / Created User (STANDING)

**Every listing of records ends with who made the row and when** — `Created Date`, then
`Created User`, immediately before Status and the row-actions column. Settled once in
`components/ui/created-columns.tsx`; six screens had six different answers before it.

- `MasterListShell` / `SimpleMasterScreen` → already spliced in, nothing to do.
- Rendering `DataTable` directly → `columns={withCreatedColumns(columns, rows)}`.
- Mobile card → `createdMeta(r)` as an extra muted line, **appended** to the screen's own
  meta, never replacing it — the card has room for both, and the desktop table shows both.
- `RecordViewSheet` → `...createdSection(viewRow)` last in `sections`.

`withCreatedColumns` is safe to add anywhere: it self-hides when the rows carry no
`created_at`, so a list whose service does not select the column is left exactly as it was.
It also strips a hand-rolled Created column — deliberately, and the audit below is how a
column that vanished gets diagnosed in seconds.

Never print `{r.created_by}`: it is a uuid on 132 tables and a verbatim legacy username on
7. `creatorName()` reads all the spellings and refuses to return anything uuid-shaped.

**Line-item tables are exempt** — the creator belongs to the document, not to its lines,
and the detail page above already shows it. Exempt by path (`[id]` routes, tab panels,
report views). Checked by `python scripts/audit_layout.py . --check created-columns`.

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

### A heading gets no explanatory sentence (client 2026-08-17)

`SectionBody` takes a `title` and nothing else. It used to require a `hint` too, so every section
of every rail editor carried a line of prose beside its name — "Order Info · Who this order is for,
and the styles it covers", "Address · Primary correspondence address for this customer". All 51 of
them were removed on the client's instruction, and the prop went with them.

**They were the section's own name expanded into prose.** Each one named the fields sitting
directly underneath it, to an operator who was already looking at those fields, on a surface where
the rail two inches to the left names the section a third time. The component's own comment had
already conceded the heading was "the most redundant thing on screen" and kept it only because
dropping it would take the hint with it — which made the hint the load-bearing half of a heading
that explains a thing the reader can see.

**A section that needs explaining has a labelling problem.** Fix the label, not by adding a
sentence under it.

**What survives is state, and it is conditional.** Exactly one of the 51 carried information the
screen could not otherwise give: Style ▸ Components said "Add coordinates first — a component is a
part of one of them" *while* the Coordinate picker had nothing to offer. That is a state message,
and state messages belong beside the control whose state they describe — it now renders in the
section body, only in that state. **This is the shape a new one must take**: a screen writes its
own line, where it can be conditional, rather than filling a slot that exists on every screen
whether or not there is anything to say.

**Removed, not deprecated.** Accepting `hint` and ignoring it would have been one edit instead of
fifteen, and it is the "dead config that reads as live" failure this repo records elsewhere: 51
strings that look maintained, that the next screen would copy, and that render nothing.

**`PageHeader`'s `description` STAYS, and that was asked and answered on the same day** — 375 call
sites, deliberately untouched. It looks like the same thing and is not: a list page has nothing
else saying what the screen is, and the line is the first thing a new operator reads, where a
section hint sat beside a rail already naming it. **Do not sweep it by analogy with this one** —
the analogy was put to the client explicitly and declined.

---

## 8. Keyboard

The contract lives in `.claude/skills/raagam-keyboard-contract` and is implemented once in
`lib/focus.ts`, wired globally by `components/shell/keyboard-nav-provider.tsx`. Screens do **not**
bind their own `onKeyDown` for field navigation.

- Tab → the next **FIELD**, and nothing else. It never opens a list, and it never stops on a
  button: not a ✕, not Save or Cancel, not a child row's Remove. It does not leave the surface
  either — off the last field it wraps. On a `MasterFullScreen` rail editor the "next field"
  after a section's last one is **the next section**, which opens with the cursor in its first
  field (Shift+Tab goes back, landing on the previous section's last field).
  Save is Enter off the last field or Ctrl+S, close is Esc, and **Ctrl+Del** removes the child
  row the cursor is on — those keys are what pay for the buttons leaving the Tab path, and the
  shortcuts sheet names all of them
- ↓ on a picker/dropdown → open its list · ↓/↑ otherwise → the field below / above, **spatially**
- ←/→ → the field left / right, once the text caret is at the edge
- Enter → pick the highlighted row if a list is open, tick a focused checkbox/radio, else
  **the next field** — and off the last field it saves. On a `MasterFullScreen` rail editor
  "off the last field" opens the next section first, exactly as Tab does, so Enter cannot
  commit a record that has not reached the later sections. Ctrl+S saves from anywhere
- Esc → close the list, then the surface (confirm if dirty), then leave the page
- In a child grid ↑/↓ stay Excel-like (row up/down) — except ↓ on a picker cell, which opens
  its list (`gridKeyNav` stands down without `preventDefault` so the provider gets the key)
- Navigation may not escape its scope: `[data-focus-scope]`, `[role="dialog"]`, `form`, `main`
- A control that owns a key must call `preventDefault()` — the global listener honours that and
  nothing else. React-level `stopPropagation()` will **not** stop it (React 19 delegates to
  `document`, the same node). This is load-bearing for Escape: a layer that closes without
  claiming the key also navigates the page away.
- Auto-generated / derived fields carry `tabIndex={-1}` so Tab skips them — write it as
  `<Field skipTab>` (or `SimpleField.skipTab` in the descriptor tier), not by hand. It also takes
  them out of the ↑↓←→ walk and the focus trap, which a Tab-only mechanism would not.
  **Do not reach for it to keep an ACTION off the Tab path** — Tab targets fields everywhere, so
  a ✕ or a row's Remove is already skipped, and `tabIndex={-1}` there only removes the control
  from the focus order for everyone. That mistake shipped twice.
- **`data-focus-optional` — an opt-in control, off the default typing path.** Tab and Enter step
  over it; ↑ ↓ ← → and the mouse still reach it, and Space/Enter on it then works normally. For the
  escape-hatch toggle an operator should reach for deliberately rather than trip over —
  Material ▸ Fabric ▸ **Direct Purchase**, which sat between Fabric Type and Using and, because
  Enter *ticks* a checkbox instead of advancing, was one habitual Enter away from clearing the
  mixing rows the operator had just typed. Not `tabIndex={-1}`, which would take it out of the
  arrow contract too and leave it mouse-only. Needs a surface `cycleTab` owns — a dialog, a
  `data-focus-scope` pane, or one with a footer region (`isEditorScope`) — and prefer to drop the
  marker once the operator has opted *in*, so the control that undoes the mode stays on the path.
  **Inside a child grid it works without that surface**, because there the grid owns Tab and
  `tabAlongRow` (`child-grid.tsx`) reads the marker itself — which it did not until Material
  Attributes ▸ **Blocked** kept catching the cursor between one attribute line and the next
  (client 2026-08-11). The grid applies it to the *destination* only, never to locating the
  cursor: filter the row axis and Tab from an arrowed-onto optional cell falls through to native
  order and lands on the row's ✕.

---

## 9. Checklist for a new master screen

- [ ] Fields ≤ 7? One `DetailSection`. 7-15? Titled sections. >15? Rail.
- [ ] Sections wrapped in `SectionGrid`; identity fields in `IdentityRow`
- [ ] `cols={12}` + `<Field size>` — sized to the data, no hand-written spans
- [ ] No `grid-cols-*`, `col-span-*`, `gap-*` or `<table>` written in the screen
- [ ] Child grids: mode chosen by fields-per-row (§6)
- [ ] List uses `MasterListShell` + `DataTable`, not a hand-rolled table + pagination
- [ ] Row actions via `actions` / `rowActionsColumn`, never a hand-written `header: ""` cell (§6a)
- [ ] Created Date / Created User via `withCreatedColumns` + `createdMeta` + `createdSection` (§6b)
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

### The header row

Density is about the inside of an editor. **The band above a list is the opposite case, and
it has one size: `md`.** Search box, `Filters`, `Download`, `+ Add <Entity>`, a `← Back`
link — every control in that row is `h-9`, because the row's fixed element is the search
`<Input>` and an `<Input>` is `h-9`. No screen chooses; there is no `size` prop on
`DataIoToolbar` to choose with.

This is written down because it drifted three ways at once (client 2026-08-05):

- `data-io-toolbar.tsx` hardcoded `size="sm"`, so **Download** sat 4px shorter than the
  **+ Add** button beside it — and a font size smaller, and 2px tighter on its icon gap.
  One component, 28 screens.
- `FilterBar` hit the same thing earlier and patched it with `size="sm" className="h-9"`.
  That fixed the height and nothing else, which is why it survived review looking
  deliberate. **A call site patching one property of a control's size is the shape §7's
  `text-base md:text-sm` no-op has** — same bug, one property along.
- Seven `app/(app)/**` clients went the other way and made their Add button `sm`. Matched
  within the screen, 4px short of the identical row on the other 21 — so a new screen
  copied from either neighbour inherited a different answer.

**`sm` is still right where the row is not a header.** A `+ Add line` inside a `ChildGrid`,
the bulk-selection bar, the report toolbar's view/export cluster: those are dense on
purpose and internally consistent, and `sm` at `h-8` is already the compact size — which is
why grid rows never showed this bug. They opt out per line with a
`toolbar-size: exempt -- <reason>` comment.

Checked by `python scripts/audit_layout.py . --check toolbar-size`, which recognises a
header row two ways — the innermost `<div>` around a `<DataIoToolbar>`, and a `PageHeader`
`actions={…}` expression — and reads the `<Button>` tag with the brace-aware `_jsx_open_tag`
rather than a regex. That is not fussiness: a naive `<Button[^>]*>` stops at the `>` inside
`onClick={() => …}`, and the first sweep of this rule missed 12 real header buttons for
exactly that reason.

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

### The Created Date filter (client 2026-08-01)

Every list screen with a Filters panel can filter by when a record was created. It is **built into
the shared primitives, not declared per screen**: `useMasterFilter` returns a `dateFilter` bundle
and `<FilterBar dateFilter={…}>` renders it as the last cell of the panel, so `MasterListShell`
and `SimpleMasterScreen` carry it to ~55 screens with no per-screen work. A screen that hand-rolls
its filter state uses `useCreatedDateFilter` (`lib/masters/use-created-date-filter.ts`) instead —
same vocabulary, same comparison.

The vocabulary itself is `lib/date-filter.ts`, and the whole range travels as **one string** so it
drops into the existing `Record<string, string>` facet shape:

| Value | Means |
|---|---|
| `""` | no filter |
| `today` · `yesterday` | that single day |
| `thisWeek` | **Monday** of the current week → today |
| `thisMonth` | 1st of the current month → today |
| `lastMonth` | the whole previous calendar month |
| `custom:FROM:TO` | either end may be empty — that is the "From Date" / "To Date" case |
| `custom::` | the Custom row is open but empty: a UI state, **not** a filter |

Five things here are load-bearing:

1. **`created_at` is a `timestamptz`, delivered in UTC.** `slice(0, 10)` files every record made
   before 05:30 IST under the previous day, so "Today" would silently hide the morning's work.
   `isoDateInTZ` (`lib/calendar.ts`) is the only correct way to get the day, and the timezone
   arithmetic lives there once — it used to be inside `lib/dashboard/range.ts`, which now
   re-exports it.
2. **Weeks start on Monday**, and the boundary is a calendar one: `thisWeek` is "this week", not
   "the last 7 days". The dashboard's rolling `week` is a KPI comparison window and stays a
   different thing on purpose.
3. **An empty Custom range must be representable.** Collapsing `custom::` to `""` would unmount the
   two date boxes on the same keystroke that revealed them. `resolveDateWindow` returns `null` for
   it instead, so it filters nothing and never lights the active-count badge — ask the resolver,
   never `!!value`.
4. **The filter appears only where the data carries the column.** It is derived from the rows, not
   declared: a service whose `.select()` lists columns by hand may not fetch `created_at`, and a
   filter that silently matches nothing is worse than no filter. Adding the column to the service
   makes the filter appear by itself — which is why `simple-master-service.ts` now selects a column
   no table displays, and says so.
5. **The facet is ONE grid cell that widens, never three loose ones.** It rendered as a fragment of
   three siblings until 2026-08-11, and the panel's auto-placement duly split it: with Item Class
   and Category ahead of it, "To Date" wrapped onto a row of its own and the range stopped reading
   as one control. The dropdown and its two boxes now sit inside a single item carrying
   `sm:col-span-2 lg:col-span-3`, because **a multi-column grid item is never split** — it moves to
   the next row whole. The `sm:grid-cols-3` inside only shares out the width the span claimed, and
   it keeps each box on the panel's own column rhythm rather than at a third of a cell.

Registers and transaction screens under `app/(app)` mostly have **no Filters panel at all** and are
therefore not covered; giving them one is a separate piece of work.

---

## 13. Disabled rows

**A master row that has been switched off is not offered for selection anywhere.**

It is *hidden*, not greyed — a greyed row still answers a search, and an operator typing
"SBI" should not find a bank the business has retired. The exception, and there is exactly
one, is the value the record being edited **already holds**.

### The two halves

| | Rule | Why |
|---|---|---|
| **Choosing** | a disabled row is absent from the list *and* from search | it is not a valid choice; offering it invites a save nobody wants |
| **Reading** | the row the record already points at stays, greyed, tagged `(inactive)`, unpickable | dropping it renders a filled field as empty, and the next save blanks the FK — silent data loss dressed up as tidiness |

The second half is the one that gets forgotten, and it is why this rule is applied in the
picker rather than in SQL. A `WHERE is_active` in the query satisfies "do not offer" and
breaks "still reads": the id is stored, but nothing in the list resolves it.

### Three column names, one reader

The schema disables a row three ways, all live, none being renamed:

| Column | Off when | Where |
|---|---|---|
| `inactive` | `true` | Associates — banks, countries, customers, `master_vendors`, employees, applicants, notifies, payment terms, account groups / heads, states. Renamed from `blocked` by migration `0315` |
| `blocked` | `true` | bins, brands, colors, commodities, components, compositions, divisions, processes, seasons, our_banks, garment styles, attribute lines |
| `is_active` | `false` | `config_lookups`, the Materials / HR simple masters, finance (cost heads, cost centres, `gl_accounts`), workers / staff, uoms, stores, buyers, profiles |

Read them through **`isInactive()`** (`lib/masters/inactive.ts`), never by hand.
`lib/masters/delete-guard.ts` already had to know all three to write the soft-disable patch;
this is the read side of the same fact.

### Where the rule is enforced

- **`DataPicker`** (`components/ui/data-picker.tsx`) hides any row whose `inactive` is set,
  keeping the one equal to its own `value`. Per instance — which matters in a grid, where
  one picker repeats down many rows and each has a *different* current value. A parent-level
  `.filter()` has to pick a single value to except and gets every other row wrong.
- **`RecordPicker`** takes `PickerItem = {id, code, name} & Deactivatable`, so it reads all
  three spellings off the raw service row. Call sites pass the row; there is nothing to map.
- **`<Combobox>` / `<Select>`** have no inactive state, so their call sites filter:
  `.filter((o) => !isInactive(o) || o.id === value)`. Precedents: the branch Country field
  in `bank-master-screen.tsx`, the HSN cell in `process-hsn-assign-screen.tsx`.

### What a screen must actually do

Almost nothing — but the flag has to survive the trip:

1. A service that returns option rows **selects its flag column**. Dropping `.eq("is_active",
   true)` in favour of selecting `is_active` is the usual change. Keep the SQL filter only
   where the list can *only* start a new document and never reopen one.
2. A normalizer that flattens a master to `{id, code, name}` carries it along.
3. A hand-rolled adapter passes `inactive: isInactive(row)`.

### Exempt, by construction

- **No disable column at all** — `ports`, `currencies`, `attribute_values` (a child of the
  Attribute row; the parent is what gets switched off), and the documents that ride the same
  shape (`sales_orders`, `shipment_plans`, `color_card_colors`).
- **Filters, not fields.** A picker that narrows a list — the order chooser on Prepare
  Advised Items — legitimately offers everything;
  searching for a since-retired buyer's old orders is a thing people do. The rule governs
  fields that *write* a value.
- **Master list screens** show active and inactive both, defaulting to All
  (`master-list-shell.tsx`). That is where a row gets switched back on.

Checked by `python scripts/audit_layout.py . --check picker-inactive`. Exemptions live in
`FLAGLESS_PICKERS` in that script, keyed `<file>#<variable>` and each naming its reason.

---

## 14. Truncated values

**An ellipsis is a promise that the rest is reachable.** A value clipped by `truncate` and
left there is a dead end — the `…` says text is missing and nothing gets it back. Reported
2026-07-31 against a Ship Type picker; it was never one field.

### The worst case has no ellipsis at all

A picker's closed trigger is a real `<input role="combobox">`, and deliberately so: `lib/focus.ts`
(`ownsArrowKeys`) and `child-grid.tsx` (`gridKeyNav`) recognise inputs, and a `<button>` trigger
would drop out of the keyboard contract. But a native input has **no `text-overflow`** — a long
value stopped mid-word and read as the whole thing. Nothing on screen said otherwise.

So an input trigger needs **both halves**, and one without the other is half a fix:

| Half | What it does |
|---|---|
| `text-ellipsis` on the input | makes the clipping *visible* — the operator learns there is more |
| the `Tooltip` wrapping it | makes it *readable* |

That is what the `truncate-reveal: exempt` comments in `data-picker.tsx` and `combobox.tsx`
say out loud: those two `text-ellipsis` classes are the rule being followed, not skipped.

### The mechanism

`<Truncated>` (`components/ui/truncated.tsx`) is the whole adoption surface:

```tsx
<Truncated className="text-[15px] font-semibold text-foreground">{title(row)}</Truncated>
```

It renders the `truncate` span itself, so the class comes **off** the call site. Props:
`text` (bubble content; omit it and the component reads the rendered `textContent`, which is
how it handles a `ReactNode` title), `children`, `className`, `side`, `touch`.

Underneath, `useOverflow` measures `scrollWidth > clientWidth` and re-measures on
`ResizeObserver`, `MutationObserver` and `document.fonts.ready` — a web font loading late is
enough to change the answer. **A value that fits gets no bubble**, which is the regression that
makes the whole feature feel broken if it slips. `useOverflow` is exported separately for the
case where the measured element is not a span: that is how the two `<input>` triggers are wired.

`Truncated` always renders the `Tooltip` wrapper and passes `disabled` when the text fits,
rather than wrapping only on overflow. Wrapping conditionally remounts the element being
measured and moves `className` onto a different box, so the measurement oscillates and never
settles. One extra span, a stable layout.

### Desktop and touch

Hover opens the bubble after 350 ms. On touch it is **press-and-hold** (450 ms), and the hold
swallows the tap that would otherwise also activate the control. The four policy constants
(`HOLD_MS`, `MOVE_SLOP`, `SWALLOW_TAP`, `AUTO_HIDE_MS`) sit in one labelled block at the top
of `components/ui/tooltip.tsx`; nothing else reads them.

Touch is **opt-in** (`touch` defaults to `false` on `Tooltip`, `true` on `Truncated`), because
the original component refused touch outright for a good reason — a bubble a tap cannot dismiss,
in an installed PWA. It now dismisses on auto-hide, on the next `pointerdown` anywhere, and on
scroll / resize / Escape.

**Pass `touch={false}` where the control commits on `mousedown`.** Picker option rows do
(`data-picker.tsx`), so a press-and-hold would reveal the value *and* pick the row — swallowing
the click cannot undo that. Those rows simply wrap on touch instead, where the list is a Sheet
with the vertical room.

### Not a modal

The tooltip deliberately does **not** call `useModalGuard` or `useUnsavedGuard`. A bubble is not
a modal, and an ungated flag feeding `lib/reload-guard.ts` permanently blocks the silent PWA
auto-update on that route (see AGENTS.md, "Auto-reload guard"). It must stay invisible to the
guard.

### Exempt

- **Chrome with a fixed vocabulary** — nav labels, toolbars, notification previews, search
  results, dashboard tiles, sheet chrome. Listed wholesale in `CHROME_TRUNCATION` in the audit
  script, each with its reason. A file there that starts rendering *values* comes back off it.
- **Responsive-only truncation** — `@2xl/editor:truncate` clips only at that container size and
  wraps below it, so the text is already readable somewhere. Routing it through `Truncated`
  would truncate it at *every* size and hide text that shows today.
- **`DataTable` cells** — the table sits in `overflow-x-auto` (`components/ui/data-table.tsx`)
  and scrolls. Nothing is hidden, so nothing needs revealing.

Anything else opts out per line with a `truncate-reveal: exempt -- <reason>` comment, on the
line or in the comment block directly above it. The judgement is "is this a value", and only
the file can answer that.

Checked by `python scripts/audit_layout.py . --check truncate-reveal`.

## 15. Near misses

**A duplicate check only ever fires on an EXACT match**, so the collision it cannot see is
the one a human actually makes. Type `TUTICORN` beside an existing `TUTICORIN` and the
field stays clean; a second port master is created for the same berth, and from then on
every Customer pointing at it is split across two records that mean one thing. §13's rule
about a disabled row never being offered is worth nothing if the operator can simply create
a second, spelled differently.

So a master with a duplicate check also **offers the close names it knows** — and offers
only the ones it can actually let you keep.

### A chip is a name that saves; a taken name is only ever text

`useSpellSuggest` returns two lists, and everything below follows from the split.

| | `suggestions` | `existing` |
|---|---|---|
| what it is | a name that is **not** a row yet | a name that already **is** a row |
| rendered as | chip (`<button role="option">`) | plain muted text |
| reachable with ↓ | **yes** | no — nothing focusable |
| clicking it | applies the name | nothing to click |
| why it is there | the operator can use it | it is the only warning a twin gets |

`names` is scoped exactly as the duplicate check is scoped, so a candidate that is already
a row is one the guard is about to reject. Offering it as a chip is offering a click that
cannot succeed — and on a screen with no `seed` that was *every* chip the strip could
produce: `COT` under Item Class YARN offered COTTON and POLYCOTTON, both already there
(client 2026-08-04).

The taken ones are still named, because that is the original job of the whole feature. The
guard fires on an exact match, so `INTARLOCK` typed beside an existing `INTERLOCK` is
invisible to it — and both of those are in the categories table right now.

### The error and the chips share the slot, two lines deep

| | Duplicate error | Suggestion chip |
|---|---|---|
| fires on | exact match | a free name near what was typed |
| component | `<DuplicateError>` | `<SpellSuggestHint>` |
| wired by | `dupFieldProps(error, id)` | `onKeyDown={nameSuggest.onKeyDown}` |
| blocks Save | **yes** | no |
| holds the cursor | **yes** (`data-dup-error`) | no |
| changes the text | no | only if a chip is accepted |

**They now show together, and `enabled` must not gate on `!dupError`.** The old rule
suppressed the strip during a duplicate because "the name it was collided with is the one
name it would be useless to suggest" — which is true, and is an argument for dropping *that
name*, not the strip. The two were the same statement only while every seed was empty. Once
a screen has a vocabulary they come apart: COTTON is useless, COTTON SLUB is exactly what
was wanted, and the duplicate is the moment it is wanted most. The error holds the cursor
in the field, so the chips beneath it are the way out of the hold.

Never three lines: the `existing` half stands down while the red error shows, since the red
line already says a name is taken and naming a second, different one there is noise.

**The chip must never become a hold.** SEWING ACCESSORY and SEWING ACCESSORIES can both be
correct rows. Wiring an advisory through `dupFieldProps` would pin the cursor on a value
that is right, which is the same failure §8's keyboard rules describe for `aria-invalid`.

### Keyboard

The strip is a list, so it answers the key §8 gives to lists: **↓ opens and moves into it**,
↑ moves back out to the field, Enter applies the highlighted chip and stays put, Esc
dismisses the strip only (one layer). The chips carry `tabIndex={-1}` — they appear and
vanish as the operator types, so leaving them in the tab order would make Tab out of Name
land somewhere different depending on whether a suggestion happened to be showing.

### Seeds

Candidates come from two places: the rows already on the screen, and an optional curated
`seed`. Seeds live in `lib/masters/name-vocabularies.ts` (places in `geo-names.ts`), one
named export per master, imported at exactly **one** call site.

They are hints, not data — never written to the database, never a validation whitelist. A
name absent from a list saves exactly as it always did. Their only job is the first row
typed into a thin table, which is when a house spelling gets set wrongly and forever.

**There is no default seed, and that is the whole rule.** The first version of this feature
defaulted to a fibre word list reachable from every screen; a Packing Accessories name was
"corrected" to COTTON (client 2026-07-28) and the client had the feature removed outright
two days later. A list named in an import cannot reach a screen that did not name it.

**The FALLBACK was the bug, not the map.** Category is the one screen whose field changes
meaning with another field — "which fibre" under YARN, "which packing item" under PACK — so
its seed is keyed by Item Class through `categoryNameSeed(code)`. It is safe for precisely
the reason gen 1 was not: an unlisted or missing code resolves to `[]`, never to whichever
list is first, so a Packing category cannot reach a fibre word. Read the map through that
function; never index it.

Where no real-world standard exists — Bin, Count, Gauge, Knitting Dia, and every party
master, whose names are real trading parties — pass `seed: []` and offer rows only. Note
what that now means: every candidate is a row, so nothing reaches the chips and the strip
becomes a pure "already exists" warning. That is the honest behaviour of a screen with no
vocabulary, not a gap to be filled by inventing one.

### Exempt

- **A field holding an ID or a code**, not a name — employee ID, bank account number, HSN
  code, leave-type code. A digit string has no spelling, so every chip it could produce is
  a different real record offered beside the one being typed.
- **A `<Textarea>`** — the strip claims ↓ and Enter, which inside a textarea already mean
  "move down a line" and "start a new line".
- **A name the system composes** — Yarn, Fabric, General and the attribute-driven accessory
  classes write their own Name from the answered fields. `material-master-screen.tsx` gates
  the hook on `nameIsComposed`: correcting the app's own output is not a typo fix, and the
  next keystroke would overwrite it anyway. The duplicate *error* still applies there.

Anything else opts out with a `spell-suggest: exempt -- <reason>` comment in the file.

Checked by `python scripts/audit_layout.py . --check spell-suggest`, which flags only
screens that already run a duplicate check — without one there is no field to attach to,
and `--check dup-check` is the finding that matters.
