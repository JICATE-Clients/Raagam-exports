# RBAC + Approvals — adoption plan for Raagam

Scoping the `erp-rbac-permissions` and `dynamic-approval-flow` skills to **this**
application. Both skills were written from a *different* production ERP; this
document records what we take, what we refuse, and why.

Status: **plan only — nothing built.** Open questions at the end.

---

## 0. The headline

The two skills land in Raagam very differently, and the plan is asymmetric
because of it:

| Skill | Raagam today | Verdict |
|---|---|---|
| `erp-rbac-permissions` | **already has a working RBAC** — relational catalog, one `stable security definer` gate, 712 RLS call sites | **Do NOT install. Harvest 4 ideas.** |
| `dynamic-approval-flow` | **has nothing** — 20 bespoke status columns, single approver, no engine | **Install near-verbatim, Tier 1.** |

Installing `erp-rbac-permissions` as shipped would create a *second* permission
gate function alongside `has_permission()`. That is pitfall #1 in the skill's own
`references/pitfalls.md`, described there as the most damaging thing that can be
done to this architecture. We are not doing it.

---

## 1. What Raagam already has (and the skill would have given us)

The foundation in `supabase/migrations/0001_foundation.sql` independently
arrived at most of the skill's non-negotiables:

| Skill non-negotiable | Raagam status |
|---|---|
| 1. One gate function | ✅ `public.has_permission(p_module, p_action, uid)` — sole check, 712 policy sites |
| 2. `STABLE` on policy functions | ✅ `language sql stable` on `has_permission` and `is_super_admin` |
| 3. `SET search_path` on `SECURITY DEFINER` | ✅ `set search_path = ''` on both |
| 4. One policy per command, predicate in `WITH CHECK` | ✅ the `do $$ foreach` loop emits read/insert/update/delete separately |
| 5. Value truthiness not key existence | ✅ n/a — relational join, no JSONB containment trap |
| 6. `p_` prefixed SQL parameters | ✅ `p_module`, `p_action` |
| 7. Never encode scope in a key | ✅ keys are `module:action`, no `_all_units` variants |
| 10. Test as a real user | ⚠️ unverified |

Because args are constants (`has_permission('sales','view')`) and the function is
`STABLE`, Postgres evaluates it **once per query**, not once per row. That
removes the only real argument for the skill's JSONB-grant storage model. **Keep
the relational model.**

### What Raagam is genuinely missing

1. **Granularity.** 15 modules × 6 actions = 90 keys, and *sub-modules inherit
   the parent*. Finance has 17 children — Bank Journals, Cheques, Bank Limits,
   Forward Contracts, Party Openings — all gated by the single key
   `finance:view`. The skill's sizing guidance for a full ERP is 100–200 keys;
   "under 50 means the model is too coarse to express real job roles." We are at
   90 nominal but far coarser in practice.
2. **Scope is stored and never read.** `user_roles.location_id` exists.
   `has_location_access()` was created in `0326` and is referenced by **zero**
   policies. Location scoping is declarative fiction today.
3. **A second, stranded permission model.** `ta_user_rights` (0269) captures
   per-user/per-activity rights that nothing enforces.
4. **No `PermissionGuard` component.** UI gating is 4 ad-hoc `usePermission()`
   calls plus ~30 prop-drilled `Perms` objects.
5. **Two enforcement idioms** for the same condition —
   `throw new Error("Forbidden")` vs `return { ok: false, error: "Forbidden" }`.
6. **No role-key.** `roles.name` is human display text an admin can rename.

Items 1, 2, 4 and 6 are what we take from the skill. Items 3 and 5 are cleanup
the skill's discipline implies.

---

## 2. Workstream A — RBAC hardening (additive, no rewrite)

Four changes. Every one is backward compatible with all 712 existing RLS
policies and all ~1,755 TypeScript call sites. Nothing existing is rewritten.

### A1. Sub-module granularity, additively

Add a nullable `entity` column to `public.permissions`, so the catalog can carry
`('finance', 'cheques', 'view')` beside `('finance', null, 'view')`.

New **overload** — same semantics, different signature, which the skill
explicitly permits (`pitfalls.md` §1: *"give it a different signature, not
different semantics"*):

```
has_permission(p_module, p_action, uid)              -- existing, untouched
has_permission(p_module, p_entity, p_action, uid)    -- new
   → true if the entity-level grant exists
   → OR if the module-level grant exists  (parent implies child)
```

The fallback is what makes this safe: a screen that adopts an entity key keeps
working for every role that only holds the module key, until an admin
deliberately narrows it. Rollout is therefore per-screen and reversible.

**Which screens get entity keys is a business decision, not a technical one.**
See open question Q1. Candidate shortlist from the survey: Finance (17
children), HR & Payroll (14), Purchase (13), Stores (10).

Key format: `module.entity:action`. The skill's warning applies — pick one
separator and never mix, or the catalog ends up holding both spellings of the
same permission, one of which grants nothing. We use `.` between module and
entity, `:` before action, matching the existing `PermissionKey` template type.

### A2. Turn on scoping — location first

Adopt the skill's polymorphic model, adapted to our dimension names:

```
roles.scope_rules  jsonb    -- {"location":"own"|"all"|"granted"}
user_scope_grants(user_id, dimension, scope_id)
has_scope(p_dimension, p_scope_id, uid) → boolean
```

Dimension mapping (skill → Raagam):

| Skill | Raagam | Column | Notes |
|---|---|---|---|
| `unit` (factory) | **`location`** | `location_id` on ~20 tables (0326) | HO + Unit 2. The tenancy axis. |
| — | **`store`** | `store_id` | **already enforced** via `store_access` + `can_access_store()` |
| `vendor` | `vendor` | `vendor_id`, 26 files | phase 2 |
| `customer` | `customer` | `customer_id`, 23 files | phase 2 |
| `consignee` | `consignee` | `consignee_id`, 4 files only | too thin — skip for now |
| — | — | `unit_id` | ⚠️ **false friend — this is UoM**, not a factory |

Two specific fixes this enables:

- **Fold `store_access` into `user_scope_grants`** as `dimension='store'`. It is
  already exactly `(user_id, store_id)`. This also fixes the conflation the
  survey flagged: `can_access_store()` currently treats `stores:approve` as
  "may see every store", i.e. an *action* standing in for a *scope*. Under
  `scope_rules` that becomes `{"store":"all"}`, which is what it actually means.
- **Wire `has_location_access` into policies, or delete it.** A helper nothing
  calls is worse than no helper: it reads as protection during review.

The skill's guidance that head office is `{"location":"all"}` and not its own
dimension matches how `0326` already models it (`location_id IS NULL` on masters
= globally visible). Good — no change of shape needed.

**Pitfall to enforce in review** (skill #4/#9): once RLS scopes by location,
*delete* any `.eq('location_id', …)` added "for safety" in app code. It silently
overrides `scope_rules` and breaks every cross-location user. Filter in app code
only for user *intent* (the Topbar switcher), never for authorisation.

### A3. `roles.role_key`

Add a unique slug beside `roles.name`. Display names are admin-editable; the
approval engine in Workstream B routes steps *by role*, and a flow that
references "Managing Director" as text breaks the day someone renames it to
"MD". This must land **before** any flow is seeded.

Backfill: `Administrator → administrator`, `Managing Director → managing_director`,
`Manager → manager`, `Merchandiser → merchandiser`.

### A4. App-layer cleanup

- Copy the skill's `PermissionGuard` / `RoutePermissionGuard` shape (adapted to
  our `usePermission(module, action)` hook) and replace the ~30 prop-drilled
  `Perms` objects. **Three branches — loading, denied, allowed.** The skill's
  pitfall #3: a guard that renders "denied" while the context is still loading
  shows a refusal that was never made, and users file bugs about permissions
  that actually work.
- Settle on one server-action idiom. Recommend the `Result` form
  (`return { ok: false, error: "Forbidden" }`) — it reaches the toast layer;
  a thrown error hits the error boundary.
- Retire `ta_user_rights`, or migrate it to entity-level keys from A1. It should
  not stay as a captured-but-unenforced second model.

---

## 3. Workstream B — Approval engine (install Tier 1)

Raagam has no engine, so there is nothing to reconcile. The skill installs close
to as-shipped. The customization is concentrated in exactly one file, by design.

### B1. The shim is the whole integration

`assets/sql/00_rbac_shim.sql` is the only SQL file we edit. Four functions:

| Adapter | Raagam binding |
|---|---|
| `approval_rbac_user_has_permission(uuid, text)` | **split then delegate** — `'orders:approve'` → `has_permission('orders','approve', uid)`. Once A1 lands, also handle `'finance.cheques:approve'`. |
| `approval_rbac_is_super_admin(uuid)` | one-line delegation to `public.is_super_admin(uid)` ✅ |
| `approval_rbac_users_with_role(text, jsonb)` | **the real work.** We have `users_with_role(p_name)` (0040) but it takes a display name and has no scope. Rewrite against `roles.role_key` (A3) + `user_roles.location_id`. |
| `approval_rbac_resolve_dynamic(text, uuid, jsonb)` | **leave it raising.** See below. |

The skill's four semantics decisions for `users_with_role`, applied to us:

- Super admins **excluded** from queues (they can still override; a super admin
  in every queue makes every queue useless).
- Expired grants excluded — n/a today, `user_roles` has no `expires_at`.
- Inactive users excluded — `profiles.is_active` ✅.
- **`location_id IS NULL` matches everything** — treated as a global grant. This
  is already precisely what `user_roles.location_id NULL` means in Raagam
  (`0001`), so our existing data is correct under the default. This is the
  decision the skill notes the source system got wrong twice; we get it free.

On `resolve_dynamic`: it ships raising on every unknown resolver, on purpose.
An unimplemented resolver that returns *empty* creates a run sitting in nobody's
queue that generates no error and is never chased — the bug that left 54 of 60
live applications hanging in the source system. Raagam has no reporting-manager
structure (`department_id` exists on 13 files but no manager edge), so we ship it
raising and add resolvers only when a flow genuinely needs one.

### B2. Scope columns

`approval_flows` ships three typed scope columns. Bind:

- `scope_a_id` → `location_id`
- `scope_b_id` → `division_id` (exists, minimal — 5 mentions)
- `scope_c_id` → leave NULL, reserve

The skill warns these are typed and renaming them later is a migration. Decide
once, here.

### B3. Pilot workflow — `purchase_indent`

`0362_indent_approval_enrichment.sql` already added
`user_approved_by/at` + `md_approved_by/at` to `purchase_indents`, ported from
legacy `FrmIndentApproval.vb`. It is a **hardcoded two-role chain that no
TypeScript currently writes to** — a genuine two-step sign-off, schema'd,
unwired, with a legacy screen to check behaviour against.

That makes it the ideal first flow: real requirement, no migration of live
behaviour, and it proves the multi-step path rather than a degenerate one-step
case that would have worked with an RLS check alone.

Then, in rough order of value:

| Workflow key | Subject table | Today | Why it wants a flow |
|---|---|---|---|
| `purchase_indent` | `purchase_indents` | 2 unwired columns | **pilot** |
| `over_budget_confirmation` | `over_budget_confirmations` | 1-step, wired | amount-conditional routing |
| `rate_amendment` | `purchase_rate_amendments` | 1-step | value threshold |
| `contract_review` | `contract_reviews` | 1-step, `pending/approved/rejected/revision` | has a *return* path already — maps to the engine's `return` action |
| `garment_order_amendment` | `garment_order_amendments` | 1-step | |
| `price_confirmation` | `price_confirmations` (0361) | 1-step | |
| `hr_leave` | `leaves` (0213) | 1-step | classic 2-step |
| `payroll_run` | payroll (0013) | `draft→calculated→approved→locked→paid` | money |

**Do not migrate all twenty at once.** Each keeps its own status column; the
engine's terminal callback stamps it. That is the skill's model — the engine
owns the *routing*, the subject row keeps owning its *state*.

### B4. What we deliberately skip

- **`approval_requests` + `decide_approval_request()`** from
  `erp-rbac-permissions`. It stages a payload so the target row does not exist
  until approval. Every Raagam approval acts on a row that *already exists*
  (draft → submitted → approved). Wrong shape for us. Skipping it removes a whole
  parallel model.
- **`maker-checker.md` §"Multi-step chains"** — the `step`/`total_steps`/
  `approver_permissions[]` extension. Both skills say not to build it; if you
  need sequential sign-off you need the engine.
- **All of Tier 2** (delegation, SLA sweeper, quorum, flow versioning,
  materialised inbox) until its trigger condition is actually observed. Note
  especially: SLA columns and the SLA sweeper ship together or not at all — a
  deadline column no code reads lies to the admin who set it.

### B5. Reuse that already exists

`lib/notifications/notify.ts` already fans out by permission:

```ts
await notify({ permission: { module: "finance", action: "approve" } }, {...})
```

That is the approval inbox's notification half, already built and already
web-push capable. The engine's `approval_my_queue` becomes the badge source; the
existing notify path delivers.

---

## 4. Sequencing

Each step is usable before the next exists.

| # | Step | Migration | Depends on |
|---|---|---|---|
| 1 | `roles.role_key` + backfill | 0378 | — |
| 2 | `user_scope_grants` + `scope_rules` + `has_scope()` | 0379 | — |
| 3 | Fold `store_access` → `user_scope_grants` | 0380 | 2 |
| 4 | Location policies on the ~20 `location_id` tables | 0381 | 2 |
| 5 | `permissions.entity` + `has_permission/4` overload | 0382 | — |
| 6 | Entity keys for the first module (Finance?) | 0383 | 5, **Q1** |
| 7 | Approval shim (bind + self-test) | 0384 | 1, 2 |
| 8 | Approval core schema + functions + smoke test | 0385–0386 | 7 |
| 9 | TS + components + `/approvals` inbox + builder | — | 8 |
| 10 | Wire `purchase_indent` (start call + terminal callback) | — | 9 |
| 11 | Admin UI: scope grants, role editor upgrade | — | 2 |

Steps 1–4 and 5–6 are independent and can run in either order or in parallel.

**Migration numbering:** start at **0378**. The tree already contains 21
duplicated prefixes (`0035`, `0256`, `0257`, `0259`, `0262`, `0264`, `0270`,
`0283`, `0287`, `0292`–`0294`, `0299`, `0338`, `0339`, `0368`–`0373`), where
ordering falls back to alphabetical-by-filename and is therefore nondeterministic
in intent. Do not add to that.

---

## 5. Gates

Nothing proceeds past a failed gate.

1. **Shim self-test.** The shim ends in a `DO` block asserting all four functions
   exist with the right return types and each executes. If it raises, stop —
   a mis-bound shim fails at 2am with a stranded run instead of at migration time.
2. **Smoke test passes before any UI is written.** `99_seed_smoke_test.sql` rolls
   itself back.
3. **Tested as a real user**, never `service_role`. Everything passes as
   `service_role` because it bypasses RLS entirely:
   ```sql
   BEGIN;
   SET LOCAL role authenticated;
   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
   SELECT has_permission('purchase','approve'), has_scope('location','<uuid>');
   SELECT count(*) FROM purchase_indents;
   ROLLBACK;
   ```
   Permission true + scope true + zero rows = the policy filters on a different
   column than expected.
4. **No key registered without being granted** in the same migration. A key
   granted to nobody is a feature only super admins can reach — and because they
   *can*, it passes every test the developer runs.
5. **`approvals.flow.manage` granted to a real role before go-live.** An engine
   nobody can administer is a lockout discovered at the worst moment.
6. **Access context invalidated after every role/grant mutation.** Invisible in
   testing, obvious in production.

Coverage query, run before each release:

```sql
-- Tables with RLS on but no policy (denies everyone)
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid);
```

---

## 6. Open questions

**Q1 — Which modules need sub-module granularity?** Finance's 17 children all
share `finance:view` today. The skill's framing is the useful one: ask per job
title *"what should this person be unable to do?"* — the negative question
surfaces far more than the positive one, which reliably answers "everything they
need". Business input required.

**Q2 — Is location scoping real?** Is there an actual person who must see HO
data but not Unit 2 (or vice versa)? If not, step 4 is speculative and we should
defer it and keep `location_id` declarative. `0326` says merchandising is
centralised and location enters at order confirmation — which suggests the split
is real for Logistics/Finance but not Sales.

**Q3 — The `purchase_indent` chain shape.** Legacy has user → MD with an
`approval_type` of `full`/`part`. Does MD approval depend on indent value? Is
there a threshold below which user approval is final? This is the flow's
`criteria` JSONB and it is a business rule.

**Q4 — Who administers approvals?** Which role receives `approvals.flow.manage`
and `approvals.run.view_all`. Getting this wrong is the lockout.

**Q5 — Retire or enforce `ta_user_rights`?**
