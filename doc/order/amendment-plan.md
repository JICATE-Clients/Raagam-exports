# amendment.md — implementation plan

> **For Claude:** execute this with the `executing-plans` skill, one phase at a time.
> Lane A's contract lands FIRST (see §6) — the other three lanes import it.

Source: `doc/order/amendment.md` (Garment Order Amendment System, 5 sections + the
developer acceptance checklist).

**Goal:** a merchandiser who needs to change an APPROVED order goes to one screen,
says who asked and what kind of change it is, gets exactly those fields unlocked —
enforced by the database, not by the screen — and the revised budget goes back for
re-approval, which re-locks the RE.

**Architecture:** the spec is ~70% standing already, in a shape the spec did not
predict. This plan is the REMAINDER, and its one structural move is that the
Amendment Protocol's existing record (`order_budget_revisions`, 0576 §7) becomes the
spec's **Amendment Entry** — rather than a second amendment history beside it. The
scoped unlock reuses 0576's own per-column jsonb allowlist, so "only the delivery date
is editable" is a database refusal and not a `readOnly` prop.

**Tech stack:** Next 16 (App Router, server actions, no TanStack), Supabase/Postgres
(RLS + trigger-enforced locks), Zod input schemas, `.mts` vector checkers as the test
suite.

---

## Status

| Lane | State |
|---|---|
| **A · Database** | ✅ **DONE.** `0604_order_amendment_scope.sql` applied 2026-09-20 15:05 IST. Its `$verify$` ran the behaviour half (not the skip branch) and an independent rolled-back probe confirmed all six transitions, including the discriminating one: the same Quantities INSERT is REFUSED under `delivery_date_ext` and ALLOWED under `qty_addition`. 91 scope rows, 6 types, 0 anon-callable functions, entry no mints `AMD/26-27/0001`. |
| **B · Contract & guards** | not started — Lane A's contract is published (see §3) |
| **C · Screens** | not started |
| **D · Propagation** | not started |

**Migration numbers: a parallel session is working in this range today.** It applied
0601 (`approval_sla_escalation`), 0602 (`factory_manager_and_escalation_flow`) and 0603
(`approval_my_queue_is_overdue`) between 14:37 and 14:55, and wrote their FILES after
this one's number had been chosen — so `ls supabase/migrations` showed 0601 free when it
was picked, and the collision only surfaced in the ledger. Check the LEDGER
(`supabase_migrations.schema_migrations`, newest first) and not only the directory before
choosing a number. Lane D's migration is **0605**, not 0602.

---

## 0 · What is ALREADY built, and is NOT rebuilt here

Re-stating a standing rule as a task is how a module gets written twice. Verified
against the tree on 2026-09-20.

| Spec § | Standing today | Remainder this plan builds |
|---|---|---|
| **1** Post-approval lock | `0576`+`0577`: `garment_order_amendments.re_status` (`open`/`approved`), one writer (`sync_re_status_from_budget`), `refuse_when_order_locked` on **47 tables** (3 parents + every child found by walking the FKs), a bookkeeping allowlist, `order_lock_of()` as the ONE definition of "locked", read server-side by `lib/orders/budget/lock.ts` + `lib/orders/order-locks.ts`, shown by `MasterFullScreen locked` + `LockScope` (`components/ui/field.tsx`) | the **third state** (`amending`) and the **scope** — today the lock is all-or-nothing per RE |
| **1** Error sentence | `order_lock_message()` (SQL) and `orderLockMessage()` (TS) raise the same words; vectors in `scripts/check-budget-amendment.mts` | the **wording** is the spec's, and it must point at the door we actually build (D6) |
| **2** Trigger events | `AMENDMENT_TYPES` (10 legacy values) + `AMENDMENT_SOURCES` (`INITIATED_OPTIONS`, "By Customer" / "By Us") in `lib/orders/budget/amendment.ts`, CHECKed on `order_budget_revisions` | the spec's **6 scoped types**, each with a field scope |
| **3 A** Header fields | `ReopenBudgetSheet` (`app/(app)/orders/budgets/reopen-budget-sheet.tsx`) already asks Source + Type + mandatory Reason; `reopen_order_budget()` writes them append-only in ONE transaction with the unlock | **Amendment Entry No**, the **RE No** entry point, and the move to a door a merchandiser can open (D1) |
| **3 B** Field-level scoping | — | the whole unit (§2) |
| **4** Propagation | `bom-status.ts` (`recalculate` state via `basisFingerprint`), `mergePulled` (`lib/orders/budget/pull-merge.ts`) + `submitBudget` refusing a budget the BOMs have outgrown, `order_budget_lines.from_bom` (0591) | the **BOM-freshness gate** at submit (today only `is_draft` is checked), the Recalculate panel, and closing the entry on re-approval |
| **4** Re-approval + PWA | approval engine LIVE (`0500`–`0505`, `0600`): `order_budget` wired, terminal trigger, inbox at `/approvals`, web push, multi-step flows configurable at `/approvals/flows` | nothing structural — **"Level 1 / Level 2" is flow DATA, not code** (§5.3) |
| **5** "Save updates the master order" | in the document model the amendment **is** the order row (`garment_order_amendments`, 0517), so saving it updates the master by construction | nothing — this answers the "apply-back" question left open on 2026-08-09 |

**Two things the spec assumes that are false today, and both are blockers:**

1. **A merchandiser cannot start an amendment.** `reopen_order_budget()` is gated on
   `orders:approve` — "undoing an approval is the approver's act". The spec's actor is
   the merchandiser. Phase 1 splits the two acts.
2. **`/orders/amendments` is not an amendment screen.** It is
   `GarmentOrderScreen purpose="amend"` — the same 19,000-line editor that enters an
   order, listing saved orders with no create. There is no header, no entry no, no
   reason, no type. Phase 3 puts a door in front of it.

---

## 1 · Six decisions, with a recommendation each

Nothing below is a coin toss; each has a cost on the wrong side. **D2 and D3 change
the shape of the work** — if either is answered the other way, re-cut the phases.

### D1 · Where is the amendment door? → **the Garment Order Amendment screen** — CONFIRMED 2026-09-20

The spec's own error sentence ("Please use Garment Order Amendment") makes this the
answer, and the built system disagrees with it: the only door today is **Reopen
(Amendment)** on the Budget screen, behind `orders:approve`. So the sentence would be
a direction naming a row the reader cannot open — worse than no direction (AGENTS.md,
"A LABEL IS ALSO WRITTEN DOWN IN THE PROSE, AND THE REGISTRY DOES NOT REACH IT").

So: **the merchandiser opens the amendment; the approver still approves it.** One RPC
per act, one permission each:

- `open_order_amendment(order, source, type, reason)` — `orders:edit`. Writes the
  entry, freezes the baseline, moves the RE to `amending` with the type's scope.
- Budget's **Reopen (Amendment)** stays exactly as it is (`orders:approve`) — it is
  the approver's own undo, it already works, and it records an entry too.

### D2 · Is the scoped unlock ENFORCED, or only rendered? → **enforced** — CONFIRMED 2026-09-20

AGENTS.md's own standing rule (`raagam-stated-vs-enforced`): a rule with no hold, no
star and no refusal is invisible. A UI-only scope means the DB lock is fully OFF for
the whole amendment window — so a stale tab, `lib/data-io`, or a second window edits
the price under a "Delivery Date Extension" and nothing objects.

It is enforceable **cheaply**, because 0576 already compares columns:

```sql
if (to_jsonb(NEW) - v_allow) = (to_jsonb(OLD) - v_allow) then return NEW; end if;
```

That is a per-column allowlist. A scope is the same mechanism with a bigger
allowlist: `v_allow := bookkeeping || scope_columns(type, TG_TABLE_NAME)`, plus a
per-table verdict for INSERT and DELETE. **The grain is (table, columns)** — six types
× ~10 tables each, declared once in SQL and read by the trigger and the screen.

### D3 · Auto-propagation: silent recompute, or stale-and-gate? → **stale-and-gate, with one-click recompute** — CONFIRMED 2026-09-20

The spec says "automatically recalculates". Taken literally that overwrites
**hand-authored** work: Fabric BOM ▸ Manual entries are typed, and a budget line with
`from_bom = false` is the merchandiser's own.

The repo already chose the safe half twice — `bomStatusOf` → `recalculate` (danger
tone, "Open it and save again") and `submitBudget` refusing a budget the BOMs have
outgrown. So: **derived figures recompute on demand and automatically at each
document's save; authored rows are flagged, never rewritten; and nothing can be
re-approved while a downstream document is stale.** That is the spec's intent (the
approver never sees pre-amendment figures) without its literal danger.

> **Flag to the client:** "Automated Downstream Propagation" will show as
> *"3 documents need recalculating"* with a button, not as numbers changing by
> themselves. Approval is blocked until they are clean, so no stale figure can be
> approved either way.

### D4 · Does the amendment ENTRY need its own approval? → **no; the revised budget carries it**

Spec §4.3 approves the *revised budget*, and `order_budget` is the one subject wired
to the engine. `order_amendment` is seeded in `0503` and unwired;
`/orders/approve-amendments` is the legacy `approval_status` screen over the document.
Wiring a second approval would allow an amendment that is approved while its budget is
not — a state nothing reads. Out of scope, recorded in §8.

### D5 · Where does the Amendment Entry live? → **extend `order_budget_revisions`**

It already holds `source` + `amendment_type` + a mandatory `reason` + the frozen
`baseline` + who + when, is append-only (no INSERT policy; the RPC is the only door),
and its FK is `ON DELETE RESTRICT` so it outlives its budget. A new table would be a
**third** amendment history in a repo whose own memory records the cost of the first
two (`order_amendments` delta vs `garment_order_amendments` document — "Building on the
document side without reconciling gives a third amendment history").

Adds: `entry_no` (AMD-0001, per financial year), `garment_order_id` (the RE the entry
is against — `budget_id` becomes nullable, for an entry a merchandiser opened),
`scope` jsonb (the resolved scope, frozen at open), `closed_at` / `closed_by` /
`outcome`. The table keeps its name; its comment says it is the Amendment Entry.

### D6 · The lock sentence → **the spec's headline, and keep the facts**

Spec: *"Selected Budget Has Been Approved. Direct edits are disabled. Please use
Garment Order Amendment."* Today: *"RE 12 is locked — its budget B-3 was approved on
18/09/2026. Reopen the budget (Amendment Protocol) to change it."*

New, in all three places that must agree (SQL `order_lock_message`, TS
`orderLockMessage`, and the vectors):

```
Selected budget has been approved — RE 12, approved on 18/09/2026.
Direct edits are disabled. Please use Garment Order Amendment.
```

Sentence case, because the app's voice is sentence case everywhere else and the spec's
Title Case is a screenshot artefact. The RE No and the date stay: the operator reading
this has several orders open. All existing fallbacks (no RE No, no budget code, no
date) keep their branch.

---

## 2 · Phase 1 — the scoped lock · `0604_order_amendment_scope.sql` (Lane A)

**This is the contract. It lands, applies and verifies before Lanes B/C/D start**
(`raagam-parallel-import-breaks-dev`: the producer lands a compiling module first).

### 1.1 The third RE state

```sql
alter table public.garment_order_amendments
  add column if not exists re_amendment_id uuid
    references public.order_budget_revisions(id);

alter table public.garment_order_amendments drop constraint if exists chk_goa_re_status;
alter table public.garment_order_amendments
  add constraint chk_goa_re_status check (re_status in ('open', 'approved', 'amending'));

-- 'amending' with no entry is the state whose scope cannot be read.
alter table public.garment_order_amendments
  add constraint chk_goa_amending_has_entry
  check (re_status <> 'amending' or re_amendment_id is not null);
```

`sync_re_status_from_budget()` gains ONE rule: **an `amending` order is not dragged
back to `open`** by a budget status write. Two writers on one column is the divergence
0576 exists to prevent; `amending` is strictly narrower than `open`, so the
amendment's own RPCs own that transition and the budget trigger stands down on it.

`re_status_at` and the bookkeeping allowlist gain `re_amendment_id`, or the status
write is refused by the very lock it is setting (0576 §4's own trap).

### 1.2 The scope vocabulary — ONE declaration, in the database

```sql
create table public.order_amendment_scopes (
  amendment_type text not null,
  table_name     name not null,
  -- NULL = every column of this table; otherwise only these.
  columns        text[],
  allows_insert  boolean not null default false,
  allows_delete  boolean not null default false,
  primary key (amendment_type, table_name)
);
```

Seeded for the spec's six types, `amendment_type` CHECKed against the widened
`order_budget_revisions` list so a scope for a type nobody can pick cannot exist.

| Type | Tables opened (abridged — the migration is exhaustive) |
|---|---|
| `qty_addition` / `qty_cancellation` | parent (`excess_pct` + the qty columns) · `…_quantities` + `…_assort_lines` + `…_assort_line_sizes` (I/U/D) · `…_approval_qtys` · `…_country_sizes` · **and the BOM tables** (see below) |
| `price_change` | parent (`cd1_pct` … `cd3_days`) · `…_style_prices` · `…_price_details` · `…_charges` |
| `delivery_date_ext` | parent (`delivery_date`) **only** — and nothing else. This is the spec's worked example and the assertion the plan is judged on |
| `combo_colour_change` | `…_combos` · `…_combo_structures` · `…_combo_components` · `…_dyeings` · `…_prints` · `…_structures` · `…_style_coordinates` |
| `bom_revision` | `order_fabric_boms` + its 14 children · `material_bom_amendments` + its 5 — and **not** the order parent |

Two rules the seed must obey, both read off 0576's own excluded list:

- **A quantity change opens the BOM tables too.** A new colourway with no fabric plan
  is an order that cannot be made, and the alternative — amend, then amend again for
  the BOM — is two entries for one change. (Open question 3.)
- **T&A stays out of every scope**, exactly as it is out of the lock: T&A is
  execution, and its whole life starts after approval.

### 1.3 The trigger reads the scope

`refuse_when_order_locked()` gains one branch. `order_lock_of()` already returns the
locking order; it now also returns `re_status` and `re_amendment_id`, so the trigger
can ask the frozen scope:

```
approved   -> refuse, with the D6 sentence
amending   -> v_allow := bookkeeping || this type's columns for THIS table
              INSERT / DELETE refused unless the scope allows it
              a table absent from the scope refuses everything
open       -> pass
```

An out-of-scope write gets its **own** sentence, because an operator inside an
amendment who is told "locked" reads it as a bug:

```
This amendment is a Delivery Date Extension — Prices are not open to it.
Close it and raise a Price Change amendment, or change the type.
```

### 1.4 The two RPCs

- **`open_order_amendment(p_order, p_source, p_type, p_reason)`** → `orders:edit`.
  One transaction: mint `entry_no`, freeze `baseline` (the approved budget's, same
  `budgetBaseline()` shape), resolve and freeze `scope`, set **every document of the
  RE** to `amending` + `re_amendment_id` (the lock is per RE No, not per document —
  0576 §2). Refuses: an RE that is not `approved`; an RE already `amending` (naming
  the open entry); a blank reason; a type with no scope rows.
- **`close_order_amendment(p_entry, p_outcome)`** → called by
  `approval_apply_terminal()` (0505) when the revised budget is approved, and by the
  operator to abandon. Sets `closed_at` / `closed_by` / `outcome` and returns the RE
  to `approved`.

Both: `SECURITY DEFINER`, `set search_path = ''`, and
`revoke all on function … from public, anon` — **both halves in one statement**
(0383's bug; a `revoke … from public` alone left `creator_names()` an
unauthenticated name oracle until 0385).

### 1.5 `$verify$` — a BEHAVIOUR probe, rolled back

**The 0577 lesson is the gate on this phase** (`raagam-tg-argv-zero-based`): a catalog
check cannot tell a guard that refuses from one that returns early, and 0576's own
`$verify$` asserted its triggers EXISTED and passed while 44 of 47 were no-ops. So,
inside one rolled-back transaction against a throwaway order:

1. approve → an Order Entry write **raises**, with the D6 sentence;
2. open a `delivery_date_ext` amendment → the parent's `delivery_date` **updates**;
3. …and a `…_style_prices` write on the same row **raises**, naming the type;
4. …and an INSERT into `…_quantities` **raises** (not in scope);
5. open a `bom_revision` instead → an `order_fabric_bom_lines` INSERT **succeeds**
   and the parent's `delivery_date` **raises**;
6. close → the Order Entry write **raises** again.

Each assertion is made to FAIL first — by seeding its scope row wrong — before the
migration is trusted.

---

## 3 · Phase 2 — the vocabulary, mirrored and proved (Lane B)

**Create `lib/orders/amendments/amendment-entry.ts`** — client-safe (no `server-only`;
the screen reads it), the single TS mirror of §1.2:

```ts
export const AMENDMENT_ENTRY_TYPES = [
  { value: "qty_addition",        label: "Quantity Addition" },
  { value: "qty_cancellation",    label: "Quantity Cancellation" },
  { value: "price_change",        label: "Price Change" },
  { value: "delivery_date_ext",   label: "Delivery Date Extension" },
  { value: "combo_colour_change", label: "Combo / Color Change" },
  { value: "bom_revision",        label: "BOM Revision" },
] as const;

/** Which UI AREAS a type opens — the screen's half of the scope. */
export const AMENDMENT_AREAS: Record<AmendmentEntryType, readonly AmendmentArea[]>;
export function areaInScope(type: AmendmentEntryType, area: AmendmentArea): boolean;
/** The refusal the screen shows — word for word what the trigger raises. */
export function outOfScopeMessage(type: AmendmentEntryType, area: AmendmentArea): string;
```

- The **legacy 10 types stay CHECKed** on `order_budget_revisions`, so every row
  Budget ▸ Reopen has written since 0576 still reads back. Only the six are OFFERED.
- `AMENDMENT_SOURCES` is reused unchanged — "By Customer" / "By Us" is already
  `INITIATED_OPTIONS`, imported and not retyped, so the two screens cannot drift.

**Rewire `lib/orders/budget/lock.ts`**: `assertOrderUnlocked(orderId)` becomes
`assertOrderWritable(orderId, area)`. Each of its call sites passes the area it is
about to write — `lib/orders/amendments/actions.ts`, `fabric-bom/actions.ts`,
`material-bom-amendment/actions.ts`, `cad/actions.ts`, `advised/actions.ts`,
`budget/actions.ts`. **No call site may pass a constant "any"**: a guard phrased as
"restrict only in case X" leaks through every state that is not X (the
nominated-vendor rule's whole history).

**New gate · `scripts/check-amendment-scope.mts`** (`npm run check:amendment-scope`,
added to `build:check`). Three assertions, each made to fail first:

1. **The TS mirror and the SQL seed agree** — every type, and for each type the same
   set of areas. Parsed out of `0604`'s seed literal, so drift is a build failure and
   not a comment.
2. **`delivery_date_ext` opens exactly one field.** The spec's worked example; a scope
   that quietly grew is a scope that stopped meaning anything.
3. **No scope names a T&A table**, and none names `order_budget_lines` — a budget line
   is not amended, it is re-pulled.

---

## 4 · Phase 3 — the door, and the scoped screen (Lane C)

Read the **`raagam-screen-layout`** skill's "BUILD IT COMPACT THE FIRST TIME" and the
**`raagam-keyboard-contract`** skill before writing a line of this. A screen is
width-laid-out from its first commit, not compacted afterwards.

### 4.1 `UnlockScope` — the one primitive that may lift a lock

`LockScope` (`components/ui/field.tsx`) is documented as *"A lock only ever ADDS: an
unlocked scope inside a locked one stays locked"* — so a scoped unlock **cannot** be a
nested `LockScope locked={false}`. Change the context value from `boolean` to
`{ locked: boolean; open: ReadonlySet<string> }` and add:

```tsx
/** The ONE exception to "a lock only ever adds": an area the open amendment names. */
export function UnlockScope({ area, children }: { area: string; children: ReactNode })
```

It lifts the lock **only** when `area` is in `open` — a set the surface receives from
the server (the frozen scope), never derived in the browser. Outside an amendment
`open` is empty, so nothing about any existing screen changes. `useLocked()` keeps its
signature, so the ~10 primitives that read it are untouched.

### 4.2 The Garment Order Amendment door · `app/(app)/orders/amendments/`

`page.tsx` stops being a one-liner over `GarmentOrderScreen`. It becomes the header
the spec asks for, and the editor opens **beneath** it once the entry exists.

| Field | Control | Rule |
|---|---|---|
| Amendment Entry No | `<Input readOnly>` | `(auto)` until saved. `readOnly` sets `tabIndex={-1}` itself and never capitalises — a derived value was not typed |
| Date | `<Input readOnly>` | system date, `fmtDate` → DD/MM/YYYY |
| Order Ref No (RE No) | `<DataPicker>` | **only `re_status = 'approved'` orders.** An unapproved order needs no amendment; offering it is the "blank supply type → NOTHING" leak. The empty state says why |
| Responsibility Origin | `<RadioGroup>` | `AMENDMENT_SOURCES`, `required` |
| Amendment Type | `<Select>` | `AMENDMENT_ENTRY_TYPES`, `required`. Changing it after open raises a **new** entry, not an edit — the scope is frozen (open question 2) |
| Reason / Remarks | `<Textarea required>` | mandatory → **holds the cursor** while blank (`useRequiredHold`). `spell-suggest: exempt -- a Textarea: ↓ and Enter mean next line / new line`. Capitals stay the default: the `<Textarea>` exemption is withdrawn |

Then **Open Amendment** → `open_order_amendment`. The editor below renders with
`locked` + `open = AMENDMENT_AREAS[type]`, and every section the scope does not name
shows `outOfScopeMessage` in its header rather than looking editable and failing at
Save.

Layout: `FieldRow` + `<Field w=…>` off the seven steps of `lib/ui/sizes.ts`, a definite
`max-w-[Nrem]` cap with its arithmetic in a comment. Six fields is one row of 12 plus
the Textarea. The header row's controls are all `md` (`h-9`).

**`check:hooks` is not optional here.** The amendment door sits above
`garment-order-screen.tsx`, which returns early at `if (mode === "list")` and has
recorded the hooks rule five times in its own comments. Every hook goes above the
branch; where a memo only walks the order's own rows, make it a plain `const`.

### 4.3 The entry list, and the banner

- A list of entries under the door: Entry No · Date · RE No · Type · Origin · Reason ·
  Status (Open / Re-approved / Abandoned), ending in **Created Date + Created User**
  via `withCreatedColumns(columns, rows)`, with `withCreators()` on the list return in
  the service **and `created_by` named in the `select()`** — the half that silently
  gives a column of dashes.
- `// dup-check: exempt -- a dated amendment entry; a second entry on the same RE is how a revision is raised`
- `lib/orders/order-locks.ts` gains the `amending` case, so the three editors' banner
  reads *"Amendment AMD-0007 is open — Delivery Date Extension. Only the delivery date
  can be changed."* instead of the locked sentence. Same grain, same words as the
  refusal (that file's own standing rule).
- `check:nav-paths`: the new prose names **Orders ▸ Amendments ▸ Order Amendment**,
  which must resolve against `lib/nav/module-groups.ts`. It does today — do not
  reword it without re-running the check.

---

## 5 · Phase 4 — propagation and re-approval (Lane D)

### 5.1 Close the freshness hole at submit

`refuseUnreadyOrders` (`lib/orders/budget/actions.ts:148`) checks only
`is_draft = false`. **`mergePulled` compares the budget to the BOM, and the BOM to
nothing** — so a Fabric BOM computed for the pre-amendment quantities agrees with the
budget pulled from it, and an amended order can be re-approved on old figures. That is
acceptance criterion 4 failing silently, which is the worst way for it to fail: an
empty variance reads as "nothing moved", a real and unremarkable answer.

Fix: `refuseUnreadyOrders` also reads `bomStatusOf(bom, orderBasisNow)` and refuses
`recalculate` / `unresolved`, naming the order and the document:

```
Recalculate before sending this for approval — RE 12: the Fabric BOM was
computed for 4,800 pcs and the order now says 5,400.
```

Nothing new is computed. `bomFreshness`, `computed_basis_hash` and `computed_for_qty`
all exist and are stamped at each BOM's save; they are only **asked**.

### 5.2 The propagation panel

On the amendment door, after Save: one row per downstream document with its
`bomStatus` tone and a **Recalculate** action that opens the document and re-saves it
(the existing save is what re-stamps `computed_basis_hash`). Authored rows — Fabric BOM
▸ Manual entries, budget lines with `from_bom = false` — are **listed, never
rewritten** (D3). Budget lines use the existing **Refresh from BOMs**.

### 5.3 Re-approval closes the entry · `0605`

`approval_apply_terminal()` (0505) already branches per `subject_table`, and its ELSE
branch RAISES. Its `order_budgets` branch gains: on `approved`,
`close_order_amendment(entry, 'reapproved')` for the RE's open entry — **in the
trigger, not in the action bar**, for 0504's own reason (a callback in the action bar
covers the happy path and leaves the document saying "submitted" for ever in the two
cases nobody watches: `approval_cancel` and the service-role sweeper). `re_status`
returns to `approved` and the RE is re-locked.

**"Level 1 / Level 2" is not code.** The engine is multi-step and `/approvals/flows` is
where a second step is added; `0503`'s catch-all has one. Hardcoding a second level
would be a second answer to "who approves this". Action: document it, and add the step
as **data** if the client wants it — with a live holder, since a catch-all routed to a
role with zero holders is the stranded-run defect `0600` was just written for, and the
live DB has only two profiles and both are super admins (which
`approval_rbac_users_with_role` filters out).

---

## 6 · The four lanes, and what each publishes

Sequenced, not simultaneous — Lane A's migration and Lane B's mirror are the contract
the rest import. **Another session edits this tree** (`raagam-shared-working-tree`):
each lane commits its own files only, and `git status` is read before every commit.

| Lane | Owns | Blocked until | Publishes first |
|---|---|---|---|
| **A · Database** | ✅ **APPLIED 2026-09-20** (ledger 20260920150527). `0604`: the scope table + seed, the two RPCs, the trigger branch, `sync_re_status_from_budget`, the `$verify$` behaviour probe | — | the seed literal + the RPC signatures (§1.2 / §1.4), **applied**, `$verify$` green |
| **B · Contract & guards** | `lib/orders/amendments/amendment-entry.ts`; `lock.ts` → `assertOrderWritable` + every call site; `order-locks.ts`; `check-amendment-scope.mts`; the D6 sentence in TS + its vectors | A's seed | the types, `areaInScope`, `outOfScopeMessage` |
| **C · Screens** | the amendment door + entry list + its service/actions; `UnlockScope` in `field.tsx`; the scoped rendering on Order Entry / Fabric BOM / Material BOM / Budget | B's module | — |
| **D · Propagation** | the `refuseUnreadyOrders` freshness gate; the propagation panel; `0605`'s terminal-callback branch; the flow-data note | A's RPCs | — |

Lane C is the long one; B and D run beside it once B's module lands.

---

## 7 · Gates — a phase is done when these are green

Every new check is **verified by being made to FAIL first**, against the pre-fix
state, before it is trusted. That is this repo's standing rule and the reason 0576
shipped 44 no-op triggers behind a passing `$verify$`.

```
npm run check:amendment-scope     # new — the TS mirror vs the SQL seed (§3)
npm run check:budget-amendment    # extended — the D6 sentence, the entry's baseline
npm run check:hooks               # the door sits above the 19,000-line editor
npm run check:nav-paths           # the new prose's ▸ paths resolve
npm run check:grid-budget         # every grid touched must appear as an `ok` line BY NAME
npm run check:embeds              # any new select() over a twice-FK'd table
python scripts/audit_layout.py . --check created-by-data --check created-columns \
        --check dup-check --check spell-suggest --check caps-input --check toolbar-size \
        --check truncate-reveal --check grid-required-mobile --check picker-inactive
python .claude/skills/raagam-keyboard-contract/scripts/audit_keyboard.py . \
        --check tab-fields --check dup-hold
npm run build:check               # the gate
```

Plus, once per phase: `0604`'s and `0605`'s `$verify$`, and
`scripts/check-anon-grants.sql` (both new RPCs are `SECURITY DEFINER`; both checks
must return zero rows).

### Acceptance criteria → where each is met

| Spec checklist item | Met by |
|---|---|
| Direct edits blocked when `Budget.status === 'APPROVED'` | 0576 / 0577 (standing) + `$verify$` step 1 |
| The error sentence on a locked order | D6, in SQL + TS + the vectors |
| Screen captures RE No, Origin, Type, Reason | §4.2 |
| Saving updates Material BOM, Fabric BOM and Budgeting figures | §5.1 + §5.2 — as a refusal-until-recalculated, not a silent rewrite (D3) |
| Amended budgets reset to Pending and need a fresh cycle before re-locking | `reopen_order_budget` (standing) + §5.3 |
| *(added)* only the Type's own fields are writable, **in the database** | §2, `$verify$` steps 2–5, `check:amendment-scope` |

---

## 8 · Deliberately NOT built, and why

- **A second approval on the amendment entry** (D4) — `order_amendment` stays unwired
  in the engine. An entry approved while its budget is not is a state nothing reads.
- **The `order_amendments` delta model** (0006) — untouched. This plan adds no third
  history; it puts the spec's entry on the record that already exists (D5).
- **A hardcoded Level 1 / Level 2** — flow data (§5.3).
- **Silent recompute of authored rows** — D3.

---

## 9 · Open questions for the client

1. **Who may open an amendment?** The plan gives it to `orders:edit` (the
   merchandiser). If it should be the approver's act, D1 collapses back to the Budget
   screen and Phase 3 loses its door.
2. **Can the Amendment Type change after opening?** The plan says no — the scope is
   frozen, and a different change is a different entry. Cheap to allow, expensive to
   audit.
3. **A quantity amendment opens the BOM tables (§1.2).** Confirm: one entry covering
   the order and its BOMs, or two entries?
4. **`entry_no` series** — AMD-0001 continuous, or per financial year like the RE No?
   The plan assumes per financial year.
