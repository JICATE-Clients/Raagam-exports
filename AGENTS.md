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

## CAPITALS (STANDING)

Field **values** are stored in capitals — stored, not merely displayed. Two halves, both
required: `<Input uppercase>` uppercases the keystroke *and* adds a CSS transform that
fixes rows saved before the rule (a value loaded from the DB and never re-typed cannot be
reached by a keystroke handler).

The write-side transform belongs in the **Zod schema** — `capsName()` / `capsTextNullable()`
in `lib/validation/formats.ts` — never only in the server action. `lib/data-io` parses
imports with the same `*Input` schemas and writes straight to Postgres, so an action-level
`.toUpperCase()` silently misses every spreadsheet import.

Exempt by construction, not by oversight: email and website, digit formats, `<Textarea>`
free text, passwords, uuids, read-only `(auto)` fields, search boxes, and workflow status
keys. Full rules and reasoning in `doc/ui/LAYOUT.md` §11; checked by
`python scripts/audit_layout.py . --check caps-input`.

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
