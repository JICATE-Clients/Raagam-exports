<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project conventions

## Auto-reload guard (STANDING)

A new deploy reloads the user's tab **automatically and silently** — no banner, no
button (`components/pwa/silent-updater.tsx`). The only thing stopping that reload from
destroying half-typed work is `lib/reload-guard.ts`, so every screen must declare itself:

- Any screen holding editable local state → `useUnsavedGuard(dirty || isPending)`.
  Include `isPending`: a reload landing mid-server-action loses the success toast and
  leaves the user unsure whether the save committed.
- Any hand-rolled overlay (a `fixed inset-0` div rather than `Sheet` / `MasterFullScreen`)
  → `useModalGuard(open)`. The guard's DOM scan only sees `role="dialog"` /
  `aria-modal`, so a bare div is invisible to it.

`Sheet`, `MasterFullScreen`, `SimpleMasterScreen` and `useFormDraft` already register,
so anything built on those is covered without doing anything.

## Tab lands on fields (STANDING)

**Tab moves between FIELDS and nothing else** — not a ✕, not a child row's Remove, not
Save or Cancel. One implementation, `cycleTab` in `lib/focus.ts`, delivered by the single
`document` listener in `components/shell/keyboard-nav-provider.tsx`, so every surface
answers the key identically and a new screen is correct without doing anything.

"A field" is `isFieldLike()` — the same predicate Enter-advance uses, and the same axis
`ROW_FIELDS` (`child-grid.tsx`) declares for the arrows. **All three movement keys read
one definition**, because when they disagreed the disagreement was visible inside a single
grid row: tabbing along it stopped on the Remove ✕ that ↑↓←→ and Enter both stepped over.

That bug is the whole reason this is written down. It was fixed once with `tabIndex={-1}`
on `ChildGrid`'s three layouts (2026-08-01) — and came straight back three days later,
because **~22 screens hand-roll a grid row instead of using `ChildGrid`**. A per-component
fix for a contract-level rule always leaves a remainder. **Never answer a keyboard
complaint with a per-screen or per-component patch**; fix `lib/focus.ts` and the whole app
changes at once.

The actions that left the Tab path each keep a key, and the shortcuts sheet says so:

- **Save** — Enter off the last field, or Ctrl+S.
- **Cancel / close** — Escape, one layer per press.
- **Delete a grid row** — **Ctrl+Del** on any cell (`gridKeyNav`). It drives the row's own
  ✕ with `.click()`, found by `[data-row-remove]` or an `aria-label` starting "Remove", so
  the 22 hand-rolled grids get it without being edited.
- **Add a grid row** — Enter on the last row, or the "+ Add" button. **Either way the
  cursor lands in the new row** (`landOnAddedRow`, one document listener). Only the
  keyboard half was ever built: the button added the row and kept the caret on itself, and
  because a "+ Add" is the LAST node of its section, the next Tab wrapped, hit the content
  edge and handed over to the NEXT SECTION — the row the operator had just asked for was
  skipped (client 2026-08-14). The landing finds the row by DIFFING the fields in the
  grid before and after, which is what makes it one rule for every shape: `ChildGrid`
  renders its "+ Add" as a sibling of `data-grid-body` and a hand-rolled grid keeps it
  inside, so pairing button to grid would need a rule each. A declining grid (`addSize`
  while the last size is blank) adds no field, so nothing moves — the refusal stays
  visible instead of being papered over by a cursor jump.
- Everything is still on the mouse, and still in screen-reader focus order — the ✕ is
  *reordered out of the typing path*, never removed from the document.

Three things that look like details:

- **Tab does not escape the surface.** It wraps inside the editor's field region, or hands
  to the next section of a rail editor (`registerContentEdge`, the one callback Enter also
  reads). On an overlay that is the focus trap; on a page form it is what makes the two
  behave the same. `Sheet` and `MasterFullScreen` no longer carry Tab handlers of their own.
- **Tab is claimed only on an editor** (`isEditorScope`: a dialog, a `data-focus-scope`
  pane, or a surface with a footer region). A list page, a filter bar and the app chrome
  keep native tab order — deliberately NOT gated on `canSubmitSurface`, whose
  "any form with a submit button" branch would cage the operator inside a search form
  (98 of the 99 unmarked forms in this repo have one).
- **Inside a child grid the GRID owns Tab** (`tabAlongRow`, `child-grid.tsx`): along the
  row's fields, on to the next row, declining at the last cell so Tab can still leave.
  That is the same exception the grid already has for ↑↓←→ and Enter, and it is what covers
  the **page-level** screens the gate above excludes — TA Plan / TA Style / TA Department
  Assign are page forms with hand-rolled grids, and they were three of the ~22.
- **A ROW'S NESTED GRID IS PART OF THE ROW**, and this is the one place Tab and the arrows
  read different axes on purpose. The arrows use `ownDescendants` — scoped to the nearest
  `data-grid-row`, because a nested panel's fields counting as columns of the outer row is
  what made ↓ from "End Value" land on the 2nd value of the *next* line (2026-07-25). Tab
  fell out of that same query and so **skipped the panel entirely**: on Material Attributes
  the values under a row were reachable only with the mouse (client 2026-08-05). Tab now
  walks `tabFieldsIn` — every field in the row in DOM order, its own cells then the panel
  beneath — and ↑/↓ still cross the boundary the way they always did, through
  `gridKeyNav`'s `fromChildGrid` hand-off.
- **An empty nested grid is entered by OPENING its first row** (`enterNestedGrid`). Its only
  affordance is an "+ Add" button, and Tab lands on fields, so there was nothing to tab into
  and nothing to stand on and press Enter — the FIRST value of a Material Attribute was
  mouse-only. Tab stepping off the row's last cell clicks the grid's `data-row-add` control
  and lands in the box it opens. Mark that button, the same way a row's ✕ carries
  `data-row-remove` for Ctrl+Del; forward only, and only while the nested grid holds no
  fields at all, so it can never stack blanks. The lesson underneath it: **replacing a
  grid's permanently-open blank row with a button removes the keyboard's only way in** —
  "Enter off the last value opens the next box" needs the operator to already be inside.

**Known remainder, enumerated not guessed:** a page-level editor that declares no marker
keeps native Tab *outside* its grids (~51 screens: the `planning/*-detail` family, the
`*-assign-screen` masters). `--check tab-page-form` lists them; each needs one
`data-focus-scope` on its form wrapper — a marker, never a handler.

Tab refuses to move in exactly two cases — a live duplicate-name error, and a blank
mandatory field (below). Full contract, reasoning and the accessibility trade-off in the
`raagam-keyboard-contract` skill; checked by
`python .claude/skills/raagam-keyboard-contract/scripts/audit_keyboard.py . --check tab-fields`.

## Mandatory fields (STANDING)

**A field the record cannot be saved without HOLDS THE CURSOR while it is blank**
(client 2026-08-04). Tab, Shift+Tab, Enter and the arrows all refuse; the operator fills
it in or presses Escape. This is the legacy RP-Software behaviour, and it reversed the
earlier rule — the contract used to say a blank required field must let Tab straight
through, so a change that "fixes" it back is undoing this deliberately.

**One declaration, four enforcers, and they cannot drift apart.** `required` is stated
once — `<Field required>`, a picker's own `required` prop, or `ChildGridColumn.required` —
and from that one prop come the red `*`, the `data-required-empty` marker that holds the
cursor (`useRequiredHold` in `components/ui/field.tsx`), the Save button, and the server
action. Never stamp the marker by hand, and never key a hold off `aria-invalid`: that is
live for a half-typed GSTIN as well as an empty box, so it would cage an operator on a
value they are getting right.

**Requiredness is often a property of the field FOR A CASE, not of the column.** Count is
mandatory on a Yarn and meaningless on a General, so it cannot live in the Zod field types
— and the schema only sees `item_class_id`, a uuid, not the class code that decides it.
`missingRequiredMaterialFields(input, classCode)` in `material-types.ts` is the shape:
one exported function the screen, the Save button and both actions call. It can also be a
property of the field FOR A STATE — Fabric's Using is mandatory until Direct Purchase is
ticked, at which point the screen hides it, and **requiring a hidden field is a record that
cannot be saved with nothing on screen to say why**. That lives in the same function
(`stateRequired`), never in a second rule beside it.

**A PORTALED SURFACE STARTS WITH A CLEAN REQUIRED SCOPE.** `RequiredScope` is React
context, so it follows the RENDER tree — and a quick-create sheet is rendered by the picker
that opened it. Put that picker in a mandatory `ChildGrid` cell (the grid wraps every cell
in a scope) and every empty field *inside the sheet* inherited "required", stamped
`data-required-empty`, and held the cursor: on New Yarn, opened from Fabric ▸ Composition ▸
Yarn \*, the **optional** Purity refused to let Tab past and announced "Yarn is required"
(client 2026-08-06). `Sheet` and the `DataPicker` panel each reset the scope at their
portal boundary, so this is fixed for every sheet at once — never per screen, and never by
marking the inner field optional, which is not a thing the context can express.

**A GRID THAT RENDERS ITS OWN ROW MUST DECLARE `required` TWICE.** `ChildGrid`'s
stacked-cards layout calls `renderMobileRow(row, i)` *instead of* the `columns.map()` that
wraps each cell in `RequiredScope` — so on such a grid `ChildGridColumn.required` never
reaches the control. With `forceCards` there is no width at which it starts working again.

The trap is not that it does nothing; it is that it does **half**. `c.required` still draws
the header `*`, so a screen that declares it and forgets the control ships **a star with
nothing behind it** — the exact star/hold divergence the "one declaration" rule above exists
to make impossible, arriving through the one prop that is supposed to guarantee it. It is
invisible to `--check required-star`, which looks for a hand-typed asterisk; here the
declaration is real and the star is legitimate.

So declare it on the control inside the row as well — `<Field required={c.required}>` around
each cell, or `required` on a hand-rolled `<Input>`. **Every screen doing this today already
gets it right, and that is the point**: four of them (Order Amendment, MBA, Attribute,
Material Attribute) each rediscovered the rule independently and each left a comment warning
the next reader. Four hand-written workarounds for one gap is what a missing check looks
like. It cannot be fixed in the primitive — a per-COLUMN declaration is not something the
grid can route into a row the screen renders itself — so it is enforced instead, by
`python scripts/audit_layout.py . --check grid-required-mobile` (verified by being made to
FAIL first, against a screen with the control's `required` removed). Opt out per file with a
`// grid-required-mobile: exempt -- <reason>` comment.

**A HOLD REFUSES MOVEMENT AND NEVER REFUSES CHOOSING.** This is the half that is easy to
get wrong and fatal when you do: refusing a key the control uses to *pick a value* does not
make the rule stricter, it makes it **unsatisfiable** — the operator can neither fill the
field nor leave it, and the only way on is the mouse. It shipped that way once. The first
cut exempted ↓-opens-a-list and nothing else, so on a held Item Class you could open the
list, walk down it, and **Enter would not pick anything** (client 2026-08-04).

`keyFills` in `lib/focus.ts` is the rule, with vectors in `scripts/check-keyboard-holds.mts`:

- **an OPEN list owns ↑ ↓ and Enter** — moving the highlight and picking are both filling;
- **a CLOSED list opens on ↓** — the only keyboard route to reaching a value;
- **a native `<select>` fills on ↑ ↓** — it has no popup, the arrows *are* the value;
- **Tab is in none of those branches** — leaving an open list without choosing is exactly
  the departure being refused, so an open list must never become an escape hatch.
- **Ctrl+Del still removes a child-grid row.** A blank mandatory cell in a row the operator
  should not have added is otherwise a dead end: they cannot fill it, leave it, or reach
  its ✕, which Tab has not visited since it began landing on fields only.

Do not confuse `keyFills` with `ownsArrowKeys` beside it. That one asks "does this control
handle ↑/↓ itself?", and a **child-grid row answers yes** — but moving a row is still
moving, so a hold that reused it would let ↑/↓ walk straight out of a held cell.

Escape, the mouse and every other Ctrl/⌘ shortcut stay live too, as under the duplicate
hold. **A `readOnly` field never holds** — it has no exit, which is why a composed name
(Material's) requires its *sources* instead and fills itself.

**Marking a field `required` is no longer cosmetic.** The test is not "should this usually
be filled?" but "must the record be unsaveable without it?" — the `*` now stops the
operator dead. `lib/data-io` imports are the one door this does not reach: they write
straight to Postgres, so an entity whose importable `fields` cannot express a complete
record still lets a half-filled row in (see the note on `materials` in
`lib/data-io/entities.ts`).

## Created Date / Created User (STANDING)

**Every listing of records shows who made the row and when** — two columns, in that
order, last before Status and the row actions. Wording, order, formatting and the uuid
guard live in `components/ui/created-columns.tsx` and nowhere else.

Six screens grew their own before that file existed and no two agreed: "Created Dt" vs
"Created Date" vs plain "Created", `created_by_name` vs raw `created_by` vs
`creator.full_name`, `fmtDate` on five and `fmtDateTime` on the sixth, one that put the
User first — and **four that printed a 36-character uuid at the operator**. `creatorName()`
refuses to return anything uuid-shaped; that is the regression the file exists to prevent.

- `MasterListShell` and `SimpleMasterScreen` splice it in themselves, so anything built on
  them is already correct.
- A raw `<DataTable>` asks for it in one call: `columns={withCreatedColumns(columns, rows)}`.
  **It is safe to add anywhere** — `hasCreatedInfo` returns false when the rows carry no
  `created_at`, so a list whose service does not select the column is left unchanged rather
  than growing a column of dashes. It also STRIPS a hand-rolled Created column, deliberately.
- The same record shown three ways uses the same three helpers: `createdColumns` /
  `withCreatedColumns` (desktop table), `createdMeta` (mobile card, one muted line —
  *appended* to the screen's own meta, never substituted for it), `createdSection`
  (`RecordViewSheet`, which drops the User line when it is unknown because the sheet hides
  empty pairs; a table cell has to show the dash).

**The data half is `withCreators()`** (`lib/created-by.ts`), called on the list return in the
service. Not a PostgREST embed: `profiles_read_own` lets a user select only their OWN
profile row, so `creator:profiles!created_by(full_name)` resolves to null for every record
made by anyone else — it looked right only while `created_by` was NULL everywhere.
`creator_names()` is `SECURITY DEFINER` and returns nothing but id + name.

**THE COLUMN CHECK PASSING MEANS NOTHING ON ITS OWN.** `creatorName()` refuses to print
anything uuid-shaped, so a service that hands back a raw `created_by` gives you the right
column, correctly wired, with a dash in every row — not an error, not a missing column,
just empty (client 2026-08-05). It was true of **143 list functions across 74 files**: the
column half was swept app-wide on 2026-08-04 and the data half only in `masters`. Two ways
to be wrong, and the second is the one that hides:

- the list return is not wrapped in `withCreators()`;
- a **hand-written `select()` names `created_at` but not `created_by`** — the call is there,
  the code reads as correct, and `withCreators` has nothing to resolve. Five services were
  in exactly that state (Material HSN, Process HSN, TCS, Customer GST, Vendor GST), and the
  sales registers were worse: they **rebuild** each row field by field, so the column has to
  be selected *and* copied across. A re-mapped row drops a column as silently as a select
  that never asked for it.

Both are checked by `python scripts/audit_layout.py . --check created-by-data`, over `list*`
functions in a server service. A `get*` that returns ONE record has no array to resolve; an
options feeder, a work queue and the audit log itself are genuinely exempt and say so with a
`// created-by: exempt -- <reason>` comment.

**Nothing recovers a row created before the column existed.** 154 tables carry `created_by`
and every one now defaults to `auth.uid()` (0383 · 0388), but only 5 tables hold any values —
everything else predates the default and reads "—" for as long as those rows exist. That is
0383's stated rule, not a bug to chase: inventing a creator is a lie in an audit column.

`created_by` holds three different things and all three must keep working: a `profiles`
uuid (106 tables), a uuid that is always NULL (26 tables from 0333/0334, declared with no
default), and a **verbatim legacy username** on the 7 `text` tables — "SELVARAJ", "admin"
(0290, deliberate: those are not Auth accounts). They fail the uuid test, are never sent to
the RPC, and reach the screen unchanged.

**Line-item tables are exempt** — a PO line has no creator worth a column; the document
above it does, and its detail page shows that. The exemption is by path (`[id]` routes,
tab panels, report views), so it cannot rot into "whatever a screen felt like".
Checked by `python scripts/audit_layout.py . --check created-columns`.

## CAPITALS (STANDING)

Field **values** are stored in capitals — stored, not merely displayed. Two halves, both
required: the keystroke is uppercased *and* a CSS transform fixes rows saved before the
rule (a value loaded from the DB and never re-typed cannot be reached by a keystroke
handler).

**CAPITALS ARE THE DEFAULT, AND THAT REVERSED ON 2026-08-18.** `Input` and `Textarea`
capitalise unless a call site passes `uppercase={false}`; before that date `uppercase` was
opt-IN, and a screen got capitals only if its author remembered.

The reversal is the client's, and the measurement is why it went in the primitive rather
than across the screens: **873 of 968 `<Input>` under `app/(app)` carried no `uppercase`**
(client 2026-08-18, screenshot 2348: "make it like how masterdata module"). The proof that
a per-call-site rule cannot hold sat inside ONE file — `amendment-screen.tsx` had it on
Pack Description and not on Styles Details ▸ Description. Never answer this with a sweep of
call sites: a screen written next month has to be correct without knowing the rule exists.

**THE `<Textarea>` EXEMPTION IS WITHDRAWN**, deliberately. This section used to list
"`<Textarea>` free text" as exempt by construction, and the reasoning was sound — a
paragraph in block capitals is harder to read, and prose is not a value anything matches
on. The client was shown that argument and chose capitals anyway. The later instruction
wins, so a reader who finds the old rule quoted elsewhere is holding something this
supersedes; restoring it needs a new client decision, not a tidy-up.

The write-side transform belongs in the **Zod schema** — `capsName()` / `capsTextNullable()`
in `lib/validation/formats.ts` — never only in the server action. `lib/data-io` parses
imports with the same `*Input` schemas and writes straight to Postgres, so an action-level
`.toUpperCase()` silently misses every spreadsheet import. **That half is still MASTERS-ONLY
by design**: `lib/data-io/entities.ts` describes master entities and nothing else, so orders
and planning have no import path for a schema transform to defend. Adding one to ~800
schemas would guard a door that does not exist — but the moment an entity is added to
data-io, its text fields need the transform in the same change.

**Exempt, and now each exemption has a mechanism rather than a memory.** The primitive
exempts by `type` (`email`, `url`, `password`, `search`, `tel`, the date/number family, the
non-text controls) and whenever the field is `readOnly` — a derived `(auto)` value was not
typed, and re-casing it misreports what is stored. `ValidatedInput` is immune by
construction because it always passes an explicit flag, which is what keeps every
`format="email"` / `format="website"` master field safe; to capitalise one of those you edit
its FORMAT SPEC, not its call site.

What still needs a hand-written opt-out, each carrying a `caps-input: exempt -- <reason>`
comment: a **website box not typed `url`** (a URL path is case-sensitive, so capitals break
the link), an **email box not typed `email`**, a **hand-typed uuid**, a **search box** (a
query is not a stored value — including the one in `data-picker.tsx`, which sits behind ~160
pickers), and **LC / PO terms**, the client's own carve-out: those clauses are read by a
bank and by suppliers, where capitals change how the text reads rather than how a value is
stored. Addresses and the company document footer were offered the same carve-out and the
client declined it.

Full rules and reasoning in `doc/ui/LAYOUT.md` §11; checked by
`python scripts/audit_layout.py . --check caps-input`, which since the flip asks the
INVERSE question — not "which field forgot to opt in" but "which field opted OUT without
saying why".

## Disabled rows (STANDING)

A master row switched off is **not offered for selection anywhere**. Not greyed — gone
from the list, and from search, so it cannot be reached by typing its name.

The schema spells the flag three ways: `inactive` and `blocked` (true = off) and
`is_active` (false = off). Read it through `isInactive()` in `lib/masters/inactive.ts`,
never by hand — that is the same fact `lib/masters/delete-guard.ts` already has to know
to write the soft-disable patch.

**The one row that survives is the one the record already holds.** It stays on the field,
greyed and tagged `(inactive)`, and cannot be re-picked. Dropping it would show a filled
field as empty and blank the FK on the next save — silent data loss dressed up as tidiness.

Enforced in the primitives, so a picker cannot forget: `DataPicker` hides any row whose
`inactive` is set, `RecordPicker` reads all three spellings straight off the row
(`PickerItem` is `{id, code, name} & Deactivatable`). What a screen must do is small:

- Adapters pass `inactive: isInactive(row)`; `RecordPicker` call sites just pass the row.
- **Services must SELECT the flag column** — an option list that filters `.eq("is_active",
  true)` in SQL satisfies half the rule and breaks the other half, because the value a
  record already holds then resolves to nothing. Keep the SQL filter only where the list
  can *only* ever start a new document.
- A `<Combobox>` or `<Select>` over stored data has no inactive state of its own, so
  filter its options at the call site: `.filter((o) => !isInactive(o) || o.id === value)`.

Two exemptions, both narrow: a table with no disable column (`ports`, `currencies`,
`attribute_values`), and a picker that FILTERS a list rather than setting a value —
narrowing a search to a since-retired buyer is legitimate. Master **list** screens show
both by design; that is where a row gets switched back on.

Checked by `python scripts/audit_layout.py . --check picker-inactive`; exemptions live in
`FLAGLESS_PICKERS` there, each naming its reason. `doc/ui/LAYOUT.md` §13.

## Cascading filters (STANDING)

**A filter facet narrows to the facet beside it.** A Category dropdown standing next to an
Item Class dropdown offers only that class's categories — never the full list. This is the
**filter-bar half of the `cascading-picker rule`**, which the form fields have obeyed since
0223 and which nothing stated for a filter.

The two halves are not the same statement, and that is why one of them rotted. A form
field's narrowing is done by the CALLER that knows the parent class ("the cascading-picker
rule puts the narrowing at the caller"), so the rule reads as being about props. A filter
facet has no caller — the screen owns both facets — so every screen re-derived it, and
three of them didn't (client 2026-08-11):

- **Material Attributes** offered CHAMBRAY and COLLAR under Item Class = PACKING
  ACCESSORIES. The screen already HAD the cascade — `scopedCategories`, feeding the
  editor — but the Filters panel keeps its own state (`filterValues.itemClass` vs the
  editor's `itemClassId`), so one rule reached one of two consumers.
- **HSN Assign to Materials** never declared `item_class_id` on its local `CatOpt`, so the
  facet could not scope itself even though the page was handing it whole category rows.
- **The item-report filter bar** — one component behind Item Ledger, Item Movement and
  Purchase vs Receipt. `getItemReportFilterOptions()` selected `id, name`, so the client
  had nothing to scope BY. **The data half again**: same shape as the `created_by` sweep,
  where the column half passing said nothing about whether the value arrived.

Four things a screen must get right, all four learned from those three:

- **Scope the options** to the selected class, in a `useMemo` beside the facet.
- **Clear a held value that falls out of scope** — but ONLY when it really is out of
  scope, so narrowing the class around a category already picked keeps it. `setFilter` is
  a functional update, so the two calls in one handler compose safely; `activeCount` is
  derived per render, so the badge cannot desync.
- **With no class chosen, prefix each option by its class.** Category names repeat across
  classes (COTTON is a Yarn and a Fabric), and two identical options the operator has to
  guess between is the other half of the same bug.
- **Narrow the unscoped list to what the screen can hold.** Material Attributes only ever
  carries Pack and Sew (the page filters through `isAccessoryClass`), so a Fabric category
  there is not merely unhelpful — no selection could make it match a row.

**An empty REPORT is the dangerous one.** On a master list a mis-scoped filter shows an
empty table, visibly wrong. On a report it shows an empty report, which reads as "nothing
moved in this period" — a real and unremarkable answer. The failure is indistinguishable
from a legitimate result, so it gets believed rather than reported.

A filter facet stays exempt from the "Disabled rows" hiding above — narrowing a search to
a since-retired row is legitimate, and that exemption is unchanged by this section.

Checked by `python scripts/audit_layout.py . --check cascade-filter`, which fires when a
file declaring an Item Class facet still maps the raw `categories` array into options. It
was verified by being made to FAIL first, against all three screens at their pre-fix
commit, before being trusted. Opt out per file with a `// cascade-filter: exempt --
<reason>` comment.

## Nominated vendors (STANDING)

A **nomination** is the customer telling us which vendor may supply them
(`customer_nominated_vendors`, `list_kind` = 'nominated' | 'recommended', maintained on the
Customer master). Wherever a document line carries a **supply type**, that word is a
constraint, not a label: a line marked nominated must not be able to name a vendor the
customer never approved.

One rule, one place — `nominatedVendorOptions()` in `lib/masters/vendor-nominations.ts`,
rendered by `<NominatedVendorPicker>`. Never re-derive it at a call site.

- `nominated` / `recommended` → only that customer's list of that kind.
- **Blank supply type → NOTHING, with a line saying to pick the type first.** This is the
  rule's whole history: MBA tested `supplyType !== "Nominated"`, a new row starts blank, and
  the first dropdown an operator opened listed every vendor. A guard phrased as "restrict
  only in case X" leaks through every state that is not X.
- Local · Import · purchase · others → every vendor. That is *our* sourcing decision.
- Empty-and-explain, never fall back to the full list: a silent fallback makes the
  nomination list advisory and the operator never learns it needs filling in.

Supply-type enums **disagree on case** — `"Nominated"` in MBA, `"nominated"` in Orders and
Planning. The rule lower-cases; compare with `===` at a call site and the filter compiles,
runs, and quietly matches nothing.

Two things a screen must get right beyond calling the helper:

- **The vendor a row already holds always survives** the filter (`currentValue`) — same
  reason as "Disabled rows" above.
- **The FK must point at `master_vendors`**, not the purchase-side `public.vendors`
  (0376 · 0377 · 0379 · 0380). The picker hands back a master id; the wrong FK rejects
  every save.

Orders are the awkward case: `sales_orders.buyer_id` → `buyers`, while nominations hang off
`customers`. `buyers.customer_id` (0380) links them and is **nullable** — unlinked, the field
offers everything and says why, rather than claiming the party nominated nobody.

## Dates (STANDING)

**DD/MM/YYYY.** `fmtDate` / `fmtDateTime` in `lib/format.ts` own it — never format a date at
a call site, and never reach for `toLocaleDateString`.

Two things that look like dates and must NOT be reformatted: `lib/dashboard/range.ts`
`today()` returns `YYYY-MM-DD` because it is **compared against `date` columns and fed back
into queries** (reformatting it breaks every dashboard range silently — the strings still
compare, just wrongly), and chart axis labels stay short (`Jul 26`).

`<input type="date">` renders in the **browser's** locale and cannot be overridden from the
page — its `value` is always ISO. Pickers follow the machine until someone builds a masked
date component. `doc/ui/LAYOUT.md` §12.

## Duplicates (STANDING)

**A master says "already exists" WHILE the operator types** — never only after Save.

Two halves, both required, and they must agree:

- **On screen** — `useDuplicateName` (`lib/masters/use-duplicate-check.ts`), rendered via
  `dupFieldProps(error, id)` on the input and `<DuplicateError error id />` under it, with
  `|| !!dupError` on the Save button. On a `SimpleMasterScreen` this is the one-line
  `dupCheck` descriptor instead; the engine does the rest.
- **On save** — `checkDuplicateName` (`lib/masters/dup-guard.ts`) in the create *and*
  update action. The screen check is a courtesy; this one is the guard. `lib/data-io`
  imports reach the action directly, so a screen-only check protects nothing.

**Use `useDuplicateName`, never the bare `useDuplicateCheck`, on a screen that has `rows`.**
It scans the rows already on screen SYNCHRONOUSLY, and that is not an optimisation — the
cursor hold is a keydown-time test, so a check that only answers 300 ms later has already
lost. The operator types a colliding name, tabs straight away, and the message paints under
a field they have left: "already exists" showing beside a cursor that moved is exactly how
the rule was reported broken (client 2026-08-01). The local pass answers in the SAME render
as the keystroke, so Tab is refused before it can move.

A late answer is no longer silent either — it **fetches the cursor back** to the field
(the catch-up in `components/shell/keyboard-nav-provider.tsx`), which is what keeps the
rule true for the checks only the server can answer. Being held is still better than being
pulled back, so the local half is the fix and the catch-up is the net. Where the rows
genuinely are not on screen — a quick-create sheet opened from a picker — say so with a
`// dup-check: server-only -- <reason>` comment.

**Pass `label` whenever the column is not a name** ("code", "description", "GST number"),
or the message reads "use a different name" while pointing at something else.

**A duplicate error HOLDS THE CURSOR** (`data-dup-error`, see the `raagam-keyboard-contract`
skill). So it is only ever for an error that genuinely blocks Save — an advisory stays
plain amber text and is not wired through `dupFieldProps` (see the GSTIN note in
`consignee-master-screen.tsx`). And picking the wrong column does not just word a message
badly, it cages the operator: **never check `employees.name`** — two workers legitimately
share a name; the identity there is the employee ID.

**Auto-generated codes do not make a master safe.** `generateUniqueCode` *suffixes on
collision* (`COTTON` → `COTTON2`), so a `unique(code)` constraint can never fire and the
name goes unchecked. The name guard belongs OUTSIDE the `if (!code)` branch, always.

Genuinely exempt, with a `// dup-check: exempt -- <reason>` comment in the file: dated or
versioned documents (rate cards, levies, work timings, holidays) where a second row on a
later effective date is how a revision is entered. Checked by
`python scripts/audit_layout.py . --check dup-check`, and the hold half — the props reach
the input, and the check is fast enough to be read at keydown — by
`python .claude/skills/raagam-keyboard-contract/scripts/audit_keyboard.py . --check dup-hold`.

## Near misses (STANDING)

**The duplicate check fires on an EXACT match, so the near miss is the one that gets
through.** Type `TUTICORN` beside an existing `TUTICORIN` and nothing objects — and now
every Customer pointing at that berth is split across two masters that mean the same
thing. So a master that runs a duplicate check also **offers the close names it knows**:
`useSpellSuggest` + `<SpellSuggestHint>`, or `spellSuggest` on a `SimpleMasterScreen`
descriptor.

**A CHIP IS ONLY EVER A NAME THAT SAVES.** `names` is scoped exactly as the duplicate
check is scoped, so a candidate that is already a row is a candidate the guard is about to
reject — offering it is offering a click that lands on "already exists". On a screen with
no vocabulary that was *every* chip it could produce: typing `COT` under Item Class YARN
offered COTTON and POLYCOTTON, both already there (client 2026-08-04). `useSpellSuggest`
now returns two lists and the split is the rule — `suggestions` are free names, rendered as
chips and reachable with ↓; `existing` are taken names, rendered as inert text with nothing
focusable in them.

**The taken ones are still SAID, because that is the original job.** The guard fires on an
exact match, so `INTARLOCK` typed beside an existing `INTERLOCK` is invisible to it — and
both of those are in the categories table today. Naming it is what catches the twin; it
just stops pretending to be a fix.

**Do NOT gate `enabled` on `!dupError`.** The old rule suppressed the whole strip during a
duplicate, reasoning that "the name it collided with is the one name that is no use". That
is right, and it argues for dropping *that name*, not the strip — the two were the same
statement only while every seed was empty. COTTON is no use; COTTON SLUB is the point, and
a duplicate is when the operator most needs it. The error even holds the cursor in the
field (`data-dup-error`), so the chips beneath it are the way out. At most two lines: the
red error and the chips, with the "already exists" half standing down while the red one
shows.

**Advisory, never a hold.** The chip is not wired through `dupFieldProps`, so it never
sets `data-dup-error`: SEWING ACCESSORY and SEWING ACCESSORIES may both be correct rows,
and holding the cursor on "close to something" cages the operator on a right answer. It
also never edits the text on its own — the typed name saves as typed unless a chip is
accepted. Keyboard is ↓ into the strip, ↑ back out, Enter applies, Esc dismisses; the
chips are `tabIndex={-1}` so an appearing strip never changes where Tab lands.

**A seed belongs to ONE master and is never defaulted.** Vocabularies live in
`lib/masters/name-vocabularies.ts` (and `geo-names.ts` for places) with a named export per
master, imported at exactly one call site. They are not data and not a whitelist: a name
absent from a list saves exactly as before, and nothing there is ever written to the DB.
This is the whole history of the feature — the first version *defaulted* its seed to a
fibre word list, a Packing Accessories name was "corrected" to COTTON (client 2026-07-28),
and the client had it removed outright two days later. A seed named at the call site
cannot reach a screen that did not ask for it.

**What was wrong there was the FALLBACK, not the map.** Category names are keyed by Item
Class — `categoryNameSeed(code)` in `name-vocabularies.ts`, the one keyed lookup in the
file, all 7 classes, ~262 names — because the field means "which fibre" under YARN and
"which packing item" under PACK. It is safe for the reason gen 1 was not: an unlisted code
resolves to `[]`, never to "whatever the first list happens to be", so the fibre words are
unreachable from a Packing category. Read it through the function; never index the map.

**THE BOUNDARY: a field is only ever offered its own subject's words.** `candidates` —
`[...seed, ...names]` — is the whole boundary and the only one there is. On a Category
under Item Class YARN that means the yarn vocabulary and the yarn categories that already
exist; nothing from FABRIC, nothing from PACKING, nothing from outside the app. The one way
to break it is to widen `candidates` at a call site, so don't: no merged all-classes list,
no fallback for a class with no vocabulary. Proved exhaustively by
`scripts/check-name-suggest.mts`, which probes each class with every prefix of every word
every other class knows (1136 probes × 7) and asserts nothing outside comes back.

**NO EXTERNAL SOURCE IS EVER ON THE KEYSTROKE PATH** — asked and measured (2026-08-04).
Against Datamuse, the best of the free general-English options: `viscos` returns VISCOUS,
VISCUS, DISCOS and **never VISCOSE**, so it would "correct" a fibre to a real English word
that is a different material — the 07-28 bug from a word list you cannot edit. `cot*` ranks
COTTON ninth behind COTERIE and COTILLION, and no general dictionary holds a compound trade
name at all (COTTON SLUB, POLYCOTTON, CVC). Two structural reasons on top of the ranking:
the strip is read at **keydown**, so an answer 300 ms later has already lost the cursor
(same argument as `useDuplicateName` under "Duplicates"); and `candidates` being a
compile-time constant is what makes THE BOUNDARY assertion in `check-name-suggest.mts` a
**proof** rather than a spot-check. A runtime lookup, a DB-backed vocabulary table and an
in-app vocabulary master all cost that proof — none of them is the way to grow a list.

**A BUILD-TIME MINER IS THE WAY TO GROW ONE** (2026-08-04). `npm run mine:vocab` runs
`scripts/mine-name-vocabularies.mts` offline and by hand: it reads the official GST HSN
master (`tutorial.gst.gov.in`, the nomenclature this business already invoices under),
Wikidata's fibre and fabric subclass trees (CC0) and Wiktionary's fabric category
(CC BY-SA 4.0), partitions them onto item classes, and writes `scripts/out/vocab-proposals.md`
with **every box unticked**. `-- --apply` appends only what a human ticked, re-sorted and
de-duplicated, preserving the map's comments. Runtime is untouched, so the distinction that
matters is *when* a source is consulted, not whether one is: a wrong word in review costs a
glance, a wrong word in Datamuse cost a corrected fibre name in production.

Three things that file learned the hard way, all in its comments: the **HSN partition is a
declared table** (`vocab-sources/hsn-chapter-map.mts`, longest prefix wins) because a chapter
under the wrong class is the 07-28 bug with an official-looking citation beside it; the
official workbook contains **40 malformed codes whose leading zero was eaten**, so `504005`
(animal guts, chapter 05) reads as chapter 50 silk and duly proposed BLADDERS AND STOMACHS as
a yarn — caught by requiring a code's 4-digit parent heading to exist, not by a blocklist; and
`normName` **strips no punctuation**, so nothing in the existing checks would have rejected a
90-character legal definition as a name. Sanitising is the miner's job, and it reports a
reject histogram so the rules can be tuned from evidence.

Still grow the lists by hand too — they are meant to be edited, and no source holds a
compound trade name, so COTTON SLUB, POLYCOTTON and CVC will always come from the trade.

**Rows-only is still a correct answer, but it can no longer offer anything.** Where no
real-world standard exists (Bin, Count, Gauge, Knitting Dia, and every party master — those
are the names of real trading parties), `seed: []` / `spellSuggest: true` is right, and the
strip there becomes a pure warning: every candidate is a row, so nothing reaches the chips
and the "already exists" line is all it says. That is the honest behaviour, not a
regression. Inventing a vocabulary to fill it is how the first version died.

Genuinely exempt, with a `// spell-suggest: exempt -- <reason>` comment: a field holding an
ID or code rather than a name (employee ID, account number, HSN code, leave-type code); a
`<Textarea>`, where the strip would claim the ↓ and Enter that mean "next line" and "new
line"; and a name the SYSTEM composes — `material-master-screen.tsx` gates the hook on
`nameIsComposed`, because correcting the app's own output is not a typo fix. Checked by
`python scripts/audit_layout.py . --check spell-suggest`, which flags only screens that
already have a duplicate check (without one there is no field to hang the chip on).

## Truncated values (STANDING)

**An ellipsis is a promise that the rest is reachable.** A value cut off by `truncate` and
left there is a dead end. Render it through `<Truncated>` (`components/ui/truncated.tsx`),
which writes the `truncate` span itself — so the class comes *off* the call site — measures
the box, and reveals the whole value on hover (350 ms) or press-and-hold (450 ms) only when
something is actually hidden. A value that fits gets no bubble.

**A picker or `<Select>` trigger needs both halves.** It is a real `<input>` on purpose (so
`lib/focus.ts` and `child-grid.tsx`'s grid nav own its keys), and a native input has no
`text-overflow` — the value used to stop mid-word with **no `…` at all**, uniquely invisible.
`text-ellipsis` makes the clipping visible; the tooltip makes it readable. Both, or neither
works. Already done in `data-picker.tsx` / `combobox.tsx`, so all 19 adapters inherit it.

Two things that look like details and are not: pass `touch={false}` where the control
commits on `mousedown` (picker option rows — a long-press would reveal *and* pick), and the
tooltip must never register with `lib/reload-guard.ts` — a bubble is not a modal, and an
ungated flag there permanently blocks the silent auto-update on that route.

Exempt: chrome with a fixed vocabulary (listed in `CHROME_TRUNCATION` in the audit script),
responsive-only truncation that wraps at smaller sizes, and `DataTable` cells (the table
scrolls). Anything else opts out per line with a `truncate-reveal: exempt -- <reason>`
comment. Full rules in `doc/ui/LAYOUT.md` §14; checked by
`python scripts/audit_layout.py . --check truncate-reveal`.

## The header row (STANDING)

**Every control in the band above a list is `md` (`h-9`)** — search box, `Filters`,
`Download`, `+ Add <Entity>`, a `← Back` link. Not a preference: the row's fixed element is
the search `<Input>`, and an `<Input>` is `h-9`. `DataIoToolbar` has no `size` prop to
choose with, deliberately — the row's size is the row's, not the caller's.

It drifted three ways at once before this was written down (client 2026-08-05), and each
one is a different lesson:

- **`data-io-toolbar.tsx` hardcoded `size="sm"`**, so Download stood 4px shorter than the
  Add button beside it — plus a font size smaller and 2px tighter on its icon gap — on 28
  screens. One component, so one edit fixed all 28; the Add side was copy-pasted into 21
  files, so **the fan-out is always on the hand-rolled half**.
- **`FilterBar` hit it first and patched it**: `size="sm" className="h-9"`. The height came
  out right and nothing else did, which is exactly why it read as deliberate for months.
  **A call site patching one property of a control's size is the bug `--check
  text-size-noop` exists to catch**, one property along.
- **Seven `app/(app)/**` clients went the other way** and made their Add button `sm`.
  Self-consistent, 4px short of the identical row elsewhere — so there was no single right
  answer to copy, and a new screen inherited whichever neighbour it was cloned from.

**`sm` is still correct where the row is not a header** — a `ChildGrid` `+ Add line`, the
bulk-selection bar, the report toolbar. Those are dense on purpose and internally
consistent, and `h-8` is already the compact size, which is why grid rows never showed
this. Each opts out per line with a `toolbar-size: exempt -- <reason>` comment.

Checked by `python scripts/audit_layout.py . --check toolbar-size`. It recognises a header
row exactly two ways — the innermost `<div>` around a `<DataIoToolbar>`, and a `PageHeader`
`actions={…}` expression — and **deliberately does not guess at a bare
`<div className="flex justify-end">`**, which is a header row on one screen and a form
footer on the next. It also does not exempt the two declaring components: skipping
`data-io-toolbar.tsx` would have made the check pass while the actual cause sat untouched.
`doc/ui/LAYOUT.md` §10.

## The sidebar lists SUB-MODULES (STANDING)

**A module's sidebar shows groups and standalone screens — never a screen that
lives under another screen in the same list.** Two levels in the sidebar, the
third on the page. Master Data always had this shape (five sub-modules;
Materials' ~40 entities live on its hub) and every other module was a flat dump
of leaf screens until 2026-08-07, when the client reported the two as
conflicting.

Four distinct ways the lists were wrong. The third looks like a detail; the
fourth survived the first regrouping and is the one this section exists to stop
recurring:

- **A sub-module beside its own child.** Purchase listed `Indents` and
  `Indent Approval` as equals — the second is `/purchase/indents/approval`, a
  route *beneath* the first.
- **A family flattened into its members.** Planning's 20 rows are really 6 BOM
  screens and 6 PPM screens plus strays, with no BOM or PPM row to hold them.
- **The module repeated as its own first child.** Production listed
  `Production Board → /production`, Logistics `Shipments → /logistics`, Reports
  `All Reports → /reports`. The module label already navigates there
  (`sidebar.tsx`), so those were two rows opening one page.
  **This is about ROWS, and a hub CARD is not a row.** A sub-module that leaves
  out the screen its own work starts on just sends the operator hunting — Orders
  ▸ Order Entry listed Order Booking, Pack Ratios and Excess Orders but not
  Garment Orders, the screen an order is entered on (client 2026-08-08). So a
  group child MAY be the module root, and `owningNavHref` skips it when
  resolving: without that, visiting `/orders` matches the leaf, highlights the
  *sub-module*, and `parentStrong` drops off the module row — the operator lands
  on Orders and the sidebar tells them they are in Order Entry.
  **A group child may also be a screen ANOTHER group owns**, marked
  `cardOnly: true` — Order Entry lists Order Amendment because raising one is
  Order Entry work, while the row stays under Amendments beside the other three
  amendment screens. The flag is what keeps a second *listing* from becoming a
  second *row*: `owningNavHref` skips it (or the operator lands on the screen
  with the wrong sub-module lit) and `moduleLeafItems` skips it (or the command
  palette offers the same screen twice under two group labels). Both halves are
  asserted — a `cardOnly` child must resolve to somewhere OTHER than the group
  listing it, and never to nothing, which would mean the second listing
  orphaned it. **Cross-list, never re-parent**: moving the row instead would
  strand Order Amendment away from Material BOM / Process / Approve Amendment.
- **A LEAF THAT IS ITSELF A HUB.** The inverse of the first one, and it hides
  where the first is obvious. The 08-07 regrouping registered
  `/orders/garment-orders` as a leaf of Order Entry, described as "Create and
  track garment orders through their lifecycle" — the file was a 14-card
  `HubCard` grid duplicating `/orders`, right down to the same `PageHeader`
  title, and its own "All Orders" card pointed back at `/orders`. So the
  operator clicked a sidebar row, got cards, clicked a card, got the same cards,
  and the third click returned them to where they started; the 14 screens behind
  it were in no sidebar row and no search result (client 2026-08-08). **Every
  other assertion passed** — the route existed, resolved to its group and was in
  search — because "the route exists" is not "the route is a screen". Assertion
  8 in `check-module-groups.mts` is what catches it: a leaf's `page.tsx` may not
  import `HubCard` or `GroupHub`. Verify a new assertion by making it FAIL
  before trusting it; this one was, against a leaf pointed at a known hub, and
  it was the only check of the eight that fired.
  **A hub is fine as a GROUP** — `/orders/garment-orders` is one again (below).
  The rule is about a *leaf* rendering cards, so the fix for "this leaf is a hub"
  is to register it as a group, never to keep it a leaf and hide the import.

**A screen that loses its sidebar row keeps its URL.** A dissolved hub becomes a
`redirect()`, never a deletion, and it is declared in `REDIRECTED` in the check
script rather than quietly struck from `OLD_NAV_LEAVES` — the assertion "nothing
the old nav reached is orphaned" is only worth running while removing an entry
from it stays deliberate. The redirect target is asserted too, so a declaration
cannot outlive the file. `REDIRECTED` is empty today; keep the table, not the
habit of emptying it.

**GARMENT ORDERS IS BACK, AS A GROUP** (operator request, 2026-08-08). It was a
redirect for one day. What was wrong with it was never that the landing page
existed — an operator who has used the 14-step flow for years looks for it — but
that its card list was a hand-maintained literal, which is how its 14 screens sat
on the page and in no sidebar row simultaneously. So it returns as a registered
sub-module: `slug: "garment-orders"`, rendered by `GroupHub` from the same
registry the sidebar reads, and **every child marked `cardOnly`**. That is what
makes the restoration cheap — it adds exactly one sidebar row, and not one screen
changes owner, gains a second search hit, or leaves the flow group (Order Setup,
Order Entry, Amendments, …) that owns it. The amendment screens reach the
operator two ways on purpose: down the flow, or off the hub.

**AND THE HUB NESTS ONE HUB.** Its ten cards include `Amendments`, which opens
`/orders/changes` — so the four amendment screens are the FOURTH level: module
row, Garment Orders row, Amendments card, screen (operator request, 2026-08-08).
That is a card opening another card list, which is the shape assertion 8 exists
to ban, so the assertion was narrowed rather than waived: a hub-to-hub link is
allowed **only** when the target is a REGISTERED group of the same module and the
card is `cardOnly`. Both halves earn their place — registered means the nested
hub has its own sidebar row and its own search entries, so nothing is reachable
by cards alone; `cardOnly` means it did not steal them. What stays banned is
unchanged and is the thing that actually broke: **a card grid nobody declared**.

Permitting hub-to-hub links removed a loop that used to be structurally
impossible, so it is now asserted. Assertion 8 rejects a hub carrying a card
pointing at itself, and **assertion 9 walks the hub graph for longer cycles** —
A cards to B, B cards back to A, and the operator circles. Verified by making it
fail (a `/orders/garment-orders` card added to Amendments →
`hub cycle in /orders: /orders/garment-orders → /orders/changes →
/orders/garment-orders`) before being trusted.

Two things that came back with it. `/orders` is deliberately both the module row
and this hub's first card — assertion 5 tests the module root FIRST for exactly
this reason, since it is `cardOnly` *and* legitimately owned by no row in the
table (the module row owns it), and testing `cardOnly` ahead of it fails a
correct registry. And `Material BOM` (`/orders/material-bom`) was a card on the
legacy hub and is **not** restored: the route has never existed here, so it was a
dead tile — assertion 2 would now catch it, which is the point of registering the
cards instead of hand-writing them.

**One declaration, three readers.** `lib/nav/module-groups.ts` is the registry;
`nav.ts` derives `children` from it, `GroupHub` renders each hub page's cards
from it, and `nav-search.ts` reads it for the screens the sidebar now hides.
That is the same lesson `lib/reports/catalog.ts` records — the nav list and the
landing grid were once two hand-edited literals nothing kept in sync.

Four things that are not obvious and each cost something to learn:

- **Grouping does NOT move the leaf routes.** `/planning/fabric-bom` stays where
  it is; a group slug is a new route that renders tiles. Re-parenting would
  break every deep link and bookmark for no gain.
- **Which is why `owningNavHref` exists.** The sidebar highlights a child by
  prefix, and a leaf is not a path beneath its group — so without the registry
  lookup, `/planning/fabric-bom` highlights no sub-module and the operator loses
  their place. Master Data never needed it: its entities really do nest
  (`/masters/materials/yarn`).
- **Search must not shrink with the sidebar.** Nav search walks a module's
  `children`; once those are groups, "Fabric BOM" and every leaf-keyed
  `SECTION_ACTIONS` entry ("/hr/workers" → "New Worker") stop being findable.
  `moduleLeafItems()` is what puts them back, and it is asserted, not assumed.
- **Hubs are static pages, not one `[group]` route per module.** Four modules
  already own a dynamic segment at that level (`/orders/[orderId]`,
  `/stores/[storeId]`, `/sales/[opportunityId]`, `/logistics/[shipmentId]`), and
  Next.js refuses two slug names for one dynamic path — so a generic `[group]`
  beside them is a build error, not a style choice.

Sales and Reports keep a literal list: Sales already listed five sub-modules,
Reports is derived from the report catalog. Checked by `npm run check:nav`,
which asserts a hub page per group, a real route per leaf, no row beneath
another row, no row duplicating its module root, every leaf resolving back to
its group, every leaf still in search, and nothing the old flat nav reached
being orphaned.

## Browser autofill (STANDING)

**The browser's memory is not a master list.** Chrome remembers every value ever typed
into a field and re-offers it as a plain white dropdown. On this app that is wrong three
ways (client 2026-08-01):

- It **looks authoritative and isn't.** Next to a field whose real options come from a
  master table, a browser-remembered `RAAGAM TEXTILS` reads exactly like a stored row —
  and picking it writes a value no master has.
- It **leaks between operators.** A shared shop-floor machine offers the previous user's
  customer names, party addresses and salary figures to the next one.
- It **steals ↓.** A field's list opens on ↓ (`raagam-keyboard-contract`); while Chrome's
  popup is up, Chrome eats ↓ to walk *its* suggestions. The contract breaks on exactly the
  fields where it matters most.

Off by default in the primitives, so a screen cannot forget: `Input`, `Textarea`, the
native branch of `Select`, `DataPicker` and `Combobox` all set `autoComplete="off"` plus
the `data-1p-ignore` / `data-lpignore` / `data-form-type` trio — the password managers
ignore `autocomplete` and read only their own opt-outs.

Two things worth knowing:

- **`<Select>` needs it for a different reason.** A dropdown has no typing to remember, so
  there is no popup — but Chrome will fill one from the saved address profile, silently
  rewriting a State or Country nobody touched.
- **The one legitimate opt-in is a value that belongs to the person, not the business** —
  the login screen's `email` / `current-password`, so password managers still work. Just
  pass `autoComplete`; the caller's spread wins, and the `data-*` trio drops itself so the
  opt-in isn't cancelled out by the manager opt-outs.

A **raw lowercase element is where this rule leaks**, since it inherits none of the above.
Raw text fields have stayed at one — the mobile search field in
`components/shell/mobile-nav.tsx`, which sets the attributes by hand — but the leak that
actually happened was a raw **`<select>`**: four of them across two Planning detail screens
(Fabric Consumption, Material Excess Plan) hand-rolled `<select className="…">` instead of
the primitive, so they carried no opt-out at all. Anything hand-rolled must set the
attributes itself or use `Input` / `Textarea` / `Select`.

Checked by `python scripts/audit_layout.py . --check autofill`, which reads
comment-stripped source (half a dozen files describe an `<input>` in prose) and skips the
types with no suggestion list — checkbox, radio, file, date. Opt out per line with an
`autofill: exempt -- <reason>` comment; the login fields above are the shape that earns one.

## Function grants (STANDING)

**No function in schema `public` is executable by `anon`.** This app has no logged-out
surface — every `.rpc()` runs behind a session and the anon key is only the transport key.
So a function reachable without a login is always a mistake, and for a `SECURITY DEFINER`
one it is a hole straight through RLS.

**A new function is born anon-callable by TWO independent grants**, which is the whole
reason this keeps happening:

- `=X/owner` — Postgres's own built-in `EXECUTE TO PUBLIC` on every new function.
- `anon=X/owner` — Supabase's default privileges, a *separate direct grant*.

Revoking one leaves the other standing, and the migration reads as a lockdown either way.
So it is always both, in one statement — the idiom 0042 · 0352 · 0382 already use:

```sql
revoke all on function public.foo(text, uuid) from public, anon;
```

`revoke … from public` alone is exactly what 0383 wrote, and `creator_names()` stayed an
unauthenticated name oracle until 0385 came back for the other half. 0386 then found eight
more functions in the same state.

**0387 closed the default, so this should not recur** — but only in its GLOBAL form.
`alter default privileges … IN SCHEMA public revoke execute on functions from public` runs,
succeeds and does *nothing*: a new function's ACL starts from Postgres's built-in default
and pg_default_acl entries are merged **on top**, so a schema-scoped entry can only add. It
was in 0386 for an hour, silently. Drop the `in schema` clause and the same statement works.

**A function that genuinely should answer a logged-out caller must now say so in writing**
(`grant execute on function public.foo() to anon;`) and justify it in its migration. There
are none today.

**Verify from the catalog, never by reading the migration.** Both bugs above applied
cleanly and reported success — `{"success": true}` means the SQL ran, not that it achieved
its stated goal. `scripts/check-anon-grants.sql`; both checks must return zero rows. Note
its CHECK 2 exists because CHECK 1 cannot catch a broken default on its own — the functions
it inspects were fixed by hand, so it passes while the *next* one is still born open. That
is precisely how 0386 asserted its own success and shipped a no-op.
