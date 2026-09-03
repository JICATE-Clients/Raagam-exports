# Garment Stage Approval — spec

**Status: SPEC ONLY. Nothing built, no migration written.**
Client steer (2026-09-02): *"create workflow + which department + which role +
approval chain, inside what they need to do, based on the garment process."*

Chosen model, from two offered: **stage-gate the garment process** — the chain's
steps are a sign-off on a production stage, not a routing of a document. Workflow
keys stay a **code constant**, extended per screen, not operator-created.

Companion to `doc/rbac-approvals-plan.md` (which records what the two skills gave
us and what we refused). That document ends at the engine; this one is the first
subject that is not a document.

---

## 0. The headline

**This is mostly already built, and the missing piece is small and specific.**

Raagam already has the garment process, the departments that own each stage, a
per-order ladder of those stages with a status, and a screen that reads
"what does my department owe today". What it does not have is a **gate**:
`status → done` is typed on a dashboard by whoever opens it, with no sign-off, no
chain, and nothing recording what had to be true first.

So this spec adds one thing — *a stage cannot be called done until the department
that owns it signs it off, against a stated list of what to check* — and it adds
it by pointing the existing approval engine at the existing ladder.

| | Exists | Gap |
|---|---|---|
| The 10 garment stages, ordered | ✅ `ta_activities` (0035, seeded 0481) | — |
| Which department owns which stage | ✅ `ta_department_assigns` + `_lines` (0267) | — |
| Per-order stage ladder with status | ✅ `garment_order_amendment_ta_activities` (0481) | no "awaiting sign-off" state |
| "What does my department owe today" | ✅ `lib/ta/worklist.ts` | — |
| Approval engine (flows, runs, inbox, timeline, override) | ✅ 0500–0503, 0505 | no department dimension, no step tasks |
| **A stage that cannot be closed unilaterally** | ❌ | **this spec** |

---

## 1. What already exists, precisely

### 1.1 The process spine

`ta_activities` (0035) — the master. `short_name`, `name`, `department` (free
text), `sequence`, `default_offset_days`, `is_active`. Seeded by 0481:

```
1 FABRIC PLAN  2 ACCESSORIES BOM  3 YARN PURCHASE  4 KNITTING  5 DYEING
6 CUTTING      7 SEWING           8 PACKING        9 INSPECTION 10 SHIPMENT
```

### 1.2 Which department owns a stage

`ta_department_assigns` (0267): header carries `department_id` and `location_id`;
`ta_department_assign_lines` carries `activity_id` and `is_owner`. Maintained on
its own screen, `/orders/ta-department-assign`.

**An activity may be owned by more than one department** — `worklist.ts` says so
explicitly, and it is legitimate (two departments share a stage). Any rule here
must therefore be written for a SET of departments, never for one.

### 1.3 The per-order ladder

`garment_order_amendment_ta_activities` (0481), child of
`garment_order_amendments`:

| column | note |
|---|---|
| `row_uid` | **the anchor.** Not `id`, not `sno` — both die at the next save. See §3.1. |
| `activity_id` | → `ta_activities`, `on delete set null` |
| `days_required`, `target_date` | the plan (backward-scheduled) |
| `actual_date`, `status`, `notes` | **entered on the dashboard, never on the order's T&A tab** |
| `status` | `check (status in ('pending','in_progress','done'))` |

The three completion columns are carried across a save by the `writeChildren`
merge, keyed on `row_uid`. That merge is the reason `row_uid` exists.

### 1.4 The read half

`lib/ta/worklist.ts` + `lib/ta/worklist-actions.ts`. Three writers to `status`:

- `completeTaActivity(id, actualDate?)` → `status='done'`, `actual_date=date`
- `reopenTaActivity(id)` → `status='pending'`, `actual_date=null`
- `startTaActivity(id)` → `status='in_progress'`

All three update `.eq("id", id)` by primary key.

`worklist.ts` also records *why* T&A died last time, and it is the argument for
this whole spec:

> four screens captured a schedule (TA Activities, Department Assign, TA Styles,
> TA Plans) and **nothing ever read it back**, so nobody maintained it.

A gate is the strongest read-back there is: the schedule stops being a report and
becomes a permission.

---

## 2. The department landmine — read this before writing any SQL

**"Department" is spelled three ways in this schema, and two of them are live.**

| spelling | target | used by |
|---|---|---|
| `ta_activities.department` | free **TEXT** | legacy fallback, matched case-insensitively by `worklist.ts` |
| `ta_department_assigns.department_id` | **`config_lookups`** (kind `department`) | ✅ the real mapping |
| `employees.department_id` (0243) | **`config_lookups`** | ✅ the user's department |
| `departments` (0259) | its own rich master | **nobody, in this area** |

`config_lookups` is the live spelling on both sides that matter, and the two live
sides already agree. **`departments` (0259) is the trap**: it is the table whose
name matches the question, and picking it silently makes every join return
nothing. That is the `lookup-compat FK mismatch` class this repo has already been
bitten by twice (see `raagam-lookup-compat-fk-mismatch`, `raagam-state-fk-landmine`),
and 0259's own header warns it is deliberately distinct.

**Rule for this build: department is `config_lookups.id` where `kind='department'`.
Never `public.departments`.**

### 2.1 There is no user → department link in RBAC

`user_roles` is `(user_id, role_id, location_id)`. No department, and
`profiles` has no `department_id`. The only link that exists is the walk
`worklist.ts:230` already performs:

```
profiles.employee_code  →  employees.code  →  employees.department_id  →  config_lookups
```

**This must become ONE declaration with two readers, not two answers.** §4.3.

### 2.2 It is dead on arrival until somebody tags the accounts

`worklist.ts` notes that *the profiles in this database have no `employee_code`
at all*. Department routing therefore resolves to nobody until a person fills
that in — the same ordering trap as 0482 on Order Info ("seed the designation, a
PERSON tags the employees, THEN 0478").

**So the department dimension must fail loudly, not quietly.** See §4.3 and §7.

---

## 3. The model — one run per stage row

### 3.1 The subject, and why it is not a primary key

```
workflow_key  = 'garment_stage'
subject_table = 'garment_order_amendment_ta_activities'
subject_id    = the row's row_uid        ← NOT its id
context.amendment_id = the owning amendment
```

**`subject_id` cannot be the row's `id`.** `writeChildren` deletes and re-inserts
the ladder on every save of the order, so `id` changes and any run pointing at it
is orphaned — destroying exactly what 0481 was written to protect.

**And `row_uid` alone is not enough either.** Its unique index is
`(amendment_id, row_uid)`, scoped per amendment *deliberately*, "so copying an
order keeps each document's anchors to itself" (0481) — meaning **a copied order
reuses row_uids**. A terminal callback keyed on `row_uid` alone would, on a
copied order, write the decision onto the wrong document.

So the identity is the pair, and the second half rides in `context`:

```sql
update public.garment_order_amendment_ta_activities
   set ...
 where amendment_id = (NEW.context->>'amendment_id')::uuid
   and row_uid      = NEW.subject_id;
```

This is the one place this subject differs in shape from Order Budget, and it is
worth a comment in the migration saying why.

### 3.2 Why not one run per order

The obvious first design is one run per order whose ten steps are the ten stages.
It breaks twice, and both are fatal:

- **`steps_snapshot` is frozen at run start** (by design — "never re-read the flow
  to keep this current"). The order's T&A ladder stays editable on the Style tab,
  so the snapshot diverges from the live ladder the first time anyone adds or
  removes a stage. A run would then be gating stages the order no longer has.
- **It flattens the chain.** One stage would be one step, so CUTTING could never
  be signed by Cutting Head *and then* QC — which is the whole of "approval
  chain" in the client's request.

It also forces the ladder sequential, when ACCESSORIES BOM and YARN PURCHASE
legitimately run in parallel.

### 3.3 What a run therefore is

- **run** = "is CUTTING cleared on RE/26-27/0041?"
- **steps inside it** = the chain for that stage — Cutting Head → QC → PM
- **flow chosen by criteria** = which chain this stage gets (§5)
- **terminal** = last approval writes `status='done'` on that ladder row

Cost: ~10 runs per order. That is the real price of this grain and it lands on
the inbox. §7 lists the mitigations.

---

## 4. Schema and function changes

Five migrations, in this order. Numbers are indicative — take the next free ones.

### 4.1 `05xx` — the awaiting state

The ladder cannot currently say "this stage is waiting on a signature":
`status` is `pending | in_progress | done`, so a stage under approval is
indistinguishable from one being worked on.

```sql
alter table public.garment_order_amendment_ta_activities
  drop constraint garment_order_amendment_ta_activities_status_check,
  add  constraint garment_order_amendment_ta_activities_status_check
       check (status in ('pending','in_progress','awaiting_approval','done'));
```

**0481 says these values are "copied verbatim from `ta_plan_activities` (0401) —
one spelling of one state machine."** Honour that: either widen both tables, or
state in the migration why only one moved. Do not let the two drift silently.

*Alternative considered and rejected:* derive the awaiting state by joining
`approval_runs` on every dashboard render. More honest (one source of truth), but
it costs a join on the hottest read in the module and makes the status column
lie by omission. A stored value with a trigger that maintains it is the
established shape here (`target_date` breaks the same rule for the same reason).

### 4.2 `05xx` — step fields

`approval_flows.steps` is JSONB validated by `approval_validate_steps()`. **That
trigger is the real contract** (`lib/approvals/types.ts` says so); adding fields
to the TypeScript type alone does nothing.

Three new optional step fields:

| field | type | meaning |
|---|---|---|
| `department_id` | uuid (config_lookups) or null | narrows the step's role holders to that department |
| `instruction` | text or null | **"what they need to do"** — shown to the approver |
| `checklist` | text[] | the must-confirm lines |

Validation to add: `department_id` parses as a uuid; `checklist` is an array of
non-empty strings; `instruction` has a length ceiling. Reject unknown keys as the
trigger already does.

### 4.3 `05xx` — `public.user_department(uuid)` and the scope key

**One declaration, two readers.** Extract the profile→employee→department walk
into a single SQL function and make both the engine and `worklist.ts` read it —
otherwise the gate and the worklist can disagree about which department someone
is in, which is the worst possible divergence here.

```sql
create or replace function public.user_department(p_user uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select e.department_id
    from public.profiles p
    join public.employees e on e.code = p.employee_code
   where p.id = p_user
   limit 1
$$;
revoke all on function public.user_department(uuid) from public, anon;
grant execute on function public.user_department(uuid) to authenticated;
```

`revoke ... from public, anon` — **both**, in one statement. `revoke from public`
alone is a no-op against Supabase's separate `anon=X/owner` grant; that is 0383's
bug, found again by 0385 and 0386. See AGENTS.md § Function grants.

Then `approval_rbac_users_with_role` gains a department branch beside its
existing location branch:

```sql
v_department text := p_scope->>'department_id';
...
AND ( v_department IS NULL
      OR public.user_department(ur.user_id)::text = v_department )
```

**A user with no department is EXCLUDED when a department is demanded.** This is
the opposite of `worklist.ts`'s default, which returns null freely and shows an
unlinked user *every* department's work rather than none. Both defaults are
right for their surface — a worklist that silently empties is unusable; an
approval queue that silently widens is a hole. **Say so in the migration
comment**, because the two functions sitting next to each other with opposite
defaults will otherwise read as a bug.

Consequence, and it is the one that will bite first: until accounts carry
`employee_code`, **every department-scoped step resolves to zero approvers.**
`approval_start_run` already refuses to create a run with no approvers on step 1
(0502) — which is the loud failure we want, not a stranded run. Verify that is
what actually happens before shipping.

### 4.4 `05xx` — the terminal branch

`approval_apply_terminal()` (0505) gains a branch. **Its `ELSE` raises**, so this
must land before any run starts — that ordering is the function's whole point.

```sql
IF NEW.subject_table = 'garment_order_amendment_ta_activities' THEN
    IF NEW.status = 'completed' THEN
        update public.garment_order_amendment_ta_activities
           set status      = 'done',
               actual_date = coalesce((NEW.context->>'actual_date')::date, current_date)
         where amendment_id = (NEW.context->>'amendment_id')::uuid
           and row_uid      = NEW.subject_id;
    ELSIF NEW.status = 'rejected' THEN
        -- back to in_progress: the work was done and found wanting, which is
        -- not the same as never claimed. See OPEN Q2.
        update ... set status = 'in_progress', actual_date = null where ...;
    END IF;
```

`actual_date` is taken from `context` and only falls back to `current_date` —
work is routinely logged the morning after it was done, which
`completeTaActivity` already accounts for. The approval date is *not* the
completion date and conflating them would misreport the plan.

Guard the update the way the budget branch does: if it touches zero rows, raise.
A ladder row deleted while its run was open must be a loud failure.

### 4.5 `05xx` — seed flows

A catch-all `garment_stage` flow at low priority so nothing strands, plus one
worked example per stage the client names. Follow 0503's shape.

---

## 5. Criteria — what the flow can key on

`approval_start_run` takes `p_context jsonb`; `approval_criteria_matches` reads
it. The start seam must pass everything a flow could plausibly branch on, because
adding a key later means re-writing flows:

```jsonc
{
  "amendment_id":        "…",   // REQUIRED — the terminal callback needs it (§3.1)
  "activity_id":         "…",
  "activity_short_name": "CUT", // the natural criteria key: one flow per stage
  "activity_sequence":   6,
  "department_id":       "…",   // owner, resolved via ta_department_assign_lines
  "order_id":            "…",
  "order_qty":           12000, // so a big order can demand a longer chain
  "buyer_id":            "…",
  "item_class":          "…",
  "days_late":           3      // so a late stage can escalate
}
```

`p_scope` carries `{ location_id, department_id }` — location because
`approval_resolve_flow` already narrows flows by it, department because §4.3
reads it.

Criteria stay a **flat AND**, as the engine ships. When you need OR, add a second
flow at a higher priority. One stage, one flow, is the expected shape.

---

## 6. UI

### 6.1 Flow builder — `/approvals/flows`

The step grid grows from `Step | Approver role | Type` to:

```
Step | Department | Approver role | Type | Instruction | Checklist
```

Four things this repo's rules force, none optional:

- **`ChildGrid` stacked-cards must declare `required` twice.** `renderMobileRow`
  bypasses the `columns.map()` that wraps each cell in `RequiredScope`, so
  `ChildGridColumn.required` draws the header `*` and reaches nothing —
  a star with nothing behind it. Checked by
  `python scripts/audit_layout.py . --check grid-required-mobile`.
- **The checklist is a nested grid inside a row.** So: its "+ Add" carries
  `data-row-add` (Tab entering an empty nested grid opens its first row), its
  remove carries `data-row-remove` (Ctrl+Del), and Tab walks `tabFieldsIn`
  across the row and the panel beneath it. See the `raagam-keyboard-contract`
  skill.
- **The Department picker hides disabled rows** and keeps the one the step
  already holds, tagged `(inactive)` — `isInactive()`, never a hand-rolled flag
  read. `--check picker-inactive`.
- **Department and Role cascade.** Picking a department narrows the role list to
  roles actually held by someone in it; with no department chosen, show every
  role. This is the filter-bar half of the cascading-picker rule
  (`--check cascade-filter`) and the reason it is worth doing is that a step
  naming a department/role pair nobody holds is a run that strands.

### 6.2 The approver's surface

The inbox row and the action bar must show the step's `instruction` and
`checklist` — otherwise the fields are write-only and the builder is theatre.
`components/approvals/approval-action-bar.tsx` is where the ticks live.

Whether ticking is *binding* is **OPEN Q3**.

### 6.3 The T&A dashboard

- A stage the operator can no longer close directly shows **"Submit for sign-off"**
  where it showed "Mark done".
- A stage in `awaiting_approval` shows who it is with, linking to the run.
- **The legacy path survives, gated on "this row has no run"** — the same trick
  0505 used for budgets. **Every order already in flight has no run and never
  will**; removing `completeTaActivity` outright would leave a queue of stages
  nobody can close. Delete the legacy branch only once no ladder row predates
  this change.

---

## 7. What will go wrong, and what catches it

| risk | mitigation |
|---|---|
| **Inbox flooded** — ~10 runs per order | Group the inbox by order; consider auto-approving stages whose flow names no approver. Measure before optimising. |
| **Every department step resolves to nobody** (§2.2) | `approval_start_run` refuses a run with no step-1 approvers. Verify this by test before shipping, not by reading the code. |
| **Two writers to `status`** | Gate the legacy writers on `run is null`, as 0505 did. |
| **Copied order writes to the wrong row** | The `(amendment_id, row_uid)` pair, §3.1. This is the defect a `row_uid`-only key would ship silently. |
| **`departments` (0259) used instead of `config_lookups`** | §2. Every join returns empty; no error. Worth a one-off grep in review. |
| **A stage marked done out of sequence** | Not currently prevented, and this spec does not prevent it either — see OPEN Q2. |
| **An unapplied migration** | 0500–0503 are **written and NOT applied** (client's choice), and the smoke test has therefore never run. This spec builds on them. Applying them is a prerequisite, not a step. |

Add to `scripts/approval-smoke-test.sql`: a department-scoped step resolving to
zero approvers must **raise**, and a copied amendment must not receive the
original's decision.

---

## 8. Build order

| # | Lands | Depends on |
|---|---|---|
| 0 | **Apply 0500–0505 and run the smoke test** | — |
| 1 | `user_department()` + department scope key + `worklist.ts` re-pointed at it | 0 |
| 2 | `awaiting_approval` status | 0 |
| 3 | Step fields (`department_id`, `instruction`, `checklist`) + validator | 0 |
| 4 | `garment_stage` in `WORKFLOWS` + terminal branch | 2, 3 |
| 5 | Start seam on the dashboard + legacy gating | 4 |
| 6 | Builder UI columns | 3 |
| 7 | Action-bar instruction + checklist | 3, 4 |
| 8 | Seed flows | 6 |

1–3 are independently useful: **the department dimension and step instructions
serve Order Budget, Amendment, Indent and PO on the day they land**, before any
stage-gate exists. If the stage-gate is deferred, that work is not wasted.

---

## 9. OPEN — client decisions

**Q1. What starts a stage run?**
(a) the operator claims it on the dashboard ("submit CUTTING for sign-off"), or
(b) it starts automatically when the previous stage is approved.
(b) makes the ladder self-driving but opens runs on stalled orders that nobody
asked for; (a) keeps the operator in charge but means a stage can sit unclaimed.

**Q2. A rejected stage — does it block the next one, or only reopen itself?**
Nothing today stops SEWING being marked done before CUTTING. Blocking is a
genuinely new rule and would need a predecessor check the ladder does not
currently have.

**Q3. Is the checklist binding?**
Advisory text the approver reads, or every box must be ticked to approve — with
the ticks recorded against the run, so it can be shown later what was confirmed?
Binding means a new `approval_step_confirmations` table.

**Q4. Does department NARROW the role, or REPLACE it?**
"Cutting Head **in** Cutting" (stricter, but dies if roles are thin) vs
"anyone in Cutting" (survives thin roles, weaker control).

**Q5. Which stages are gated at all?** Gating all ten is ~10 runs per order.
The client may only want sign-off on three or four (e.g. DYEING, CUTTING,
INSPECTION). A flow that names no approver could pass straight through, which
would make this configurable rather than a build-time choice.

**Q6. Does `ta_plan_activities` get the same treatment**, or does the gate live
only on the order's ladder? 0481 says the two share one state machine.
