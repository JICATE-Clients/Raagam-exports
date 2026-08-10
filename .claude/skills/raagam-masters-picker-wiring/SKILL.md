---
name: raagam-masters-picker-wiring
description: Raagam ERP convention for building Master Data children (Associates/Materials/HR/etc.) from legacy RP-Software screenshots. MUST be used whenever building or editing a /masters child screen, or wiring a legacy icon field. Enforces the rule that EVERY legacy picker icon — red ⓘ, blue ⓘ, green ⊕ — becomes a searchable DROPDOWN over stored data with inline Add/Modify/Delete (the shared `DataPicker`), never a plain text box, and that no field on the legacy form is dropped. Triggers on: "build the <X> child/master", "Associates ▸ <X>", "wire the icon fields", "red/blue/green icon", "config_lookups picker", "masters submodule".
---

# Raagam Master Data — icon-field wiring convention

When building a Master Data child (`/masters/<submodule>/<entity>`) from a legacy
RP-Software screenshot, follow this convention **every time, without being reminded**.

## The core rule (why this skill exists)

On every legacy form, fields marked with a small icon are **pickers over stored
data**, not free text:

- **red ⓘ** / **blue ⓘ** — a searchable list of existing rows, with (for config-list
  masters) **Add / Modify** available without leaving the form.
- **green ⊕** — same searchable list; the ⊕ just signals "add is available."

> **Changed 2026-07-29 — these are DROPDOWNS now, not dialogs.** Stored data used to
> arrive in three different shapes depending on when the field was built (a modal
> dialog, a nested Sheet, a plain dropdown), and one form could show all three. The
> client asked for one: `<DataPicker>` (`components/ui/data-picker.tsx`) — a
> `role="combobox"` field whose list drops down under it, filters as you type, and
> does Add / Modify / Delete in the panel. Every `*-picker.tsx` in
> `components/masters` is now a ~30-line adapter over it. **Do not build a new
> picker component; add an adapter.** See `doc/ui/LAYOUT.md` §5a.

**Therefore:**
1. **Never** render an icon field as a plain `<Input>`. It must be a `DataPicker`.
2. **Wire every field on the legacy form** — do not silently drop any. If a field
   can't be wired yet (needs a screenshot or a missing master), build it as a
   labelled placeholder and log it in `doc/masters-open-questions.md`, don't omit it.
3. Add/Modify inside the picker **writes through the real master**, so a value added
   in one form appears everywhere that master is used (legacy behaviour).

## Actions & buttons (build ALL of these — never drop them)

Two distinct action sets, both required:

**A. Inside every config-list picker** (`LookupDialogPicker` / `CountryPicker` /
`CurrencyPicker` / `BankPicker` — all adapters over `DataPicker`):
- **List mode:** type in the field to filter; a row is picked by click or Enter. Each row
  carries a pencil and a trash icon; the footer carries **+ Add**. Keyboard reaches them
  with **Ins** / **F2** / **Ctrl+Del** — there is no OK button and no double-click,
  because there is no dialog to confirm out of.
- **Add / Modify:** the panel body becomes a mini form (**Back** + **Save**) and turns
  modal — scrim, focus trap, `useModalGuard`. **Save** calls the master's `create*` /
  `update*` action, session-merges the row into the picker's local `extra` state,
  auto-selects it, and `router.refresh()`s. Gate `Add` on `canCreate`, `Modify` on
  `canEdit`; `canDelete` defaults to `canEdit`.
- A master with **real fields** (Country's ISD/ECGC, Bank's IFSC) does NOT use the
  name-only inline form — pass `onAddOverride` / `onEditOverride` and open a
  `Sheet size="sm"` quick-create instead, or the row is born incomplete.
- Select-only pickers (`ApplicantPicker` / `LocationPicker` / `EmployeePicker`) simply
  omit `manage`: search and ✕ clear remain, the CRUD icons do not render.

**B. The editor `Sheet` footer** (every master screen):
- **Cancel** — closes without saving.
- **Save as Draft** — calls the action with `is_draft: true`; gated on `canCreate` and
  the required field (usually `name`). Needs an `is_draft` column + a "Draft" `StatusPill`.
- **Save** — calls create/update with `is_draft: false`; disabled while pending / until
  required fields are filled. Shows "Saving…" during the transition.
- The **list row actions** are **Edit** (opens the Sheet on that row, gated on `canEdit`)
  and **Delete** (gated on `canDelete`); the toolbar has **+ Add \<Entity\>** (gated on
  `canCreate`). Hide each button when its permission is false.

## Pick the backing + picker (reuse map — do NOT build new picker shells)

Decide what each icon field references, then reuse the matching shared component in
`components/masters/`:

| Legacy field kind | Backing | Shared picker | Add/Modify? |
|---|---|---|---|
| Simple **Code + Name** list (City, State, Department, Designation, Team, Ship Type, Payment Term, Category, Item Class, Fabric Structure, …) | `config_lookups` **kind** | `LookupDialogPicker` (`kind`, `label`, `options`, `value`, `onChange`, `canCreate`, `canEdit`, `canDelete`, `isSuperAdmin`, `adminOnly`, `required`) | ✅ inline |
| **Country** | `countries` table | `CountryPicker` | ✅ inline |
| **Currency** | `currencies` (PK = code) | `CurrencyPicker` (value = code) | ✅ inline |
| **Bank** | `banks` (master-detail) | `BankPicker` (header-only Add/Modify; preserves branches) | ✅ inline |
| **Applicant** slot | `applicants` | `ApplicantPicker` | select-only |
| **Location** | `locations` (GST entities, System-owned) | `LocationPicker` | select-only |
| **Manager / self-ref** | same table | `EmployeePicker` (or clone; `excludeId` = self) | select-only |
| **Ac Head / GL account** | `gl_accounts` | `getAccountsForPicker()` + existing GL picker | per-picker |
| **Levy / other rich reference master with its own dedicated screen** | its own table (e.g. `levies`) | a thin adapter over `DataPicker` (e.g. `LevyPicker` in `components/masters/lookup-picker.tsx`) | select-only |

**All of them render `<DataPicker>` (`components/ui/data-picker.tsx`).** Each
`*-picker.tsx` does one job: map that master's rows to `PickerRow[]`
(`{id, label, sublabel?, disabled?}`) and, if the field may create, hand over a
`ManageConfig`. That is the whole adapter — usually ~30 lines.

So when a backing master doesn't fit `ConfigLookup`'s `{code, name}` shape (Levy's
`{entry_no, description}`, an account's `{name, account_type}`), write the mapping and
reuse `DataPicker`. **Never invent a new picker shell** — that is how the codebase
ended up with three of them and a duplicated `LookupDialogPicker` export.

Note `PickerRow.sublabel`: it is where a code, a class or a type goes when the old
dialog showed it as a second column. Labels stay name-only (codes are hidden from the
UI); the sublabel is muted beside it.

**Prefer a `config_lookups` kind** for any new simple list (add it to `LOOKUP_KINDS`
+ `LOOKUP_KIND_LABELS` in `lib/masters/extras-types.ts` **and** widen the kind CHECK
in a new migration — re-add ALL existing kinds + the new one). Only build a dedicated
table when the master carries real extra columns (symbol, branches, addresses).
**Select-only** (no inline Add) when the target is a rich/managed/self table — the
user creates those on their own master screen.

## Cascading (parent-scoped) pickers

When a legacy form has a hierarchy — Item Class → Category → Attribute is the
canonical example, but the rule applies to any parent/child master pair —
**every downstream picker's option list must be filtered by the parent's
selected id**, never the full/global list:

- `categories.item_class_id` and `attributes.item_class_id` both FK to the
  single real `config_lookups(kind='item_class')` list. A Category or
  Attribute picker fed the *unfiltered* `categories`/`attributes` array is a
  bug even if it's wired as a proper dialog picker — filter to
  `rows.filter(r => r.item_class_id === selectedItemClassId)` before handing
  it to the picker.
- Disable or show an empty/placeholder state on the child picker until its
  parent has a value ("Pick an Item Class first"), and **clear the child's
  selected value whenever the parent changes** — a stale child value scoped
  to the old parent is worse than an empty one.
- Never model the parent field as a per-screen free-text column or a
  duplicated `as const` string array (e.g. a local `ITEM_CLASSES` list) —
  that silently drifts from the real master and can't cascade anything.
  Always resolve it to the one real `config_lookups` kind (or dedicated
  table) that every other screen referencing it already uses — check
  `config_lookups` kinds and existing `*_id` FK columns before assuming a
  field needs a new list.
- If the child target is a rich table with its own dedicated master screen
  (like `categories` or `attributes`), write a thin select-only wrapper
  around `DialogListPicker` (see `CategoryPicker`/`AttributePicker` in
  `lookup-picker.tsx`) that takes the already-scoped rows as a prop — do not
  filter inside the wrapper itself, the caller scopes it.

## Standard child build recipe

Mirror the closest existing child (Applicant = master-detail w/ tabs; Notify = flat +
contact grid; Employee = flat, no grid; Bank = master-detail). For each new child:

1. **Migration** `NNNN_<entity>_master.sql` (find next free number: `ls supabase/migrations | tail`).
   Table(s) + `set_updated_at` trigger + indexes on FKs + RLS gated on
   `has_permission('masters', 'create'|'edit'|'delete')`. Widen the `config_lookups`
   kind CHECK here if adding kinds. Seed fixed legacy lists idempotently.
2. **`lib/masters/<entity>-types.ts`** — interface + Zod `*Input` (`nullableText`,
   `uuidN = z.string().uuid().nullable().default(null)`); fixed dropdowns as `as const` arrays.
3. **`lib/masters/<entity>-service.ts`** (`import "server-only"`) — `list<Entity>()`;
   embed FK display rows or pass kind-filtered lookup lists to the screen.
4. **`lib/masters/<entity>-actions.ts`** (`"use server"`) — create/update/delete;
   child grids sync = **delete-all-then-reinsert** (`normalize*` drops blank rows +
   renumbers `sno`); `rev()` revalidates `/masters`, `/masters/<submodule>`, `/masters/<submodule>/<entity>`.
5. **`components/masters/<entity>-master-screen.tsx`** — **every icon field → its picker
   from the map above**; fixed dropdowns = `Select`; Yes/No radios/checkbox.
   **The screen's SHAPE is `raagam-screen-layout`'s** — which surface to use, sections,
   field width, `ChildGrid`, the list shell, and the Cancel / Save as Draft / Save footer
   with its derived `canSave`. Start from a template in that skill's `assets/` rather
   than from this line; it used to describe the footer here, which made two places to
   keep true.
6. **Wire-up** — `lib/masters/submodules.ts`: flip the child `todo`→`{type:"custom", custom:"<key>"}`.
   `app/(app)/masters/[submodule]/[entity]/page.tsx`: add an `else if (child.custom === "<key>")`
   arm (re-read this file first — it is edited by a parallel session).
7. **Register in reporting** — if the new table carries an item FK **and** a quantity,
   add a `ReportSource` to `REPORT_SOURCES` in `lib/reports/registry.ts` and any new
   `ReportField`s to `ITEM_DIMENSIONS`/`ITEM_MEASURES`; if it posts to `stock_ledger`,
   pass the document's own date as `txn_date`. Then run
   `python .claude/skills/raagam-report-data/scripts/audit_reports.py .` — it must exit
   clean. A child that records material but never reaches reporting is invisible: stock
   reconciles wrongly and nobody finds out. See the **`raagam-report-data`** skill.
8. **Verify** — `npx tsc --noEmit` clean; `npx eslint <new files>` clean **except** the
   known repo-wide `react-hooks/set-state-in-effect` mount-guard trip (`useEffect(() =>
   setMounted(true), [])`) shared by every picker — that is the house pattern, not a
   regression. Apply the migration when the Supabase MCP is connected (else note it as
   unapplied). Log any un-wirable field / assumption in `doc/masters-open-questions.md`.

## Coordination notes

- `submodules.ts`, `[submodule]/[entity]/page.tsx`, and `extras-types.ts` are **shared
  hot files** edited by a parallel session — always re-read immediately before editing.
- Migration-number collisions with the parallel lane are resolved by renaming the LOCAL
  file to the next free number (remote version name may differ — accepted drift).
- Keep the `raagam-masters-phase1` project memory in sync after each child is built.
