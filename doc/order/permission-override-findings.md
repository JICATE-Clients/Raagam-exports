# Permission Overrides — Phase 0 Findings

Discovery for `doc/email role system.md` (Jicate spec v1.0, 29-09-2026), §9 Phase 0.
Plan: `C:\Users\Admin\.claude\plans\d-github-raagam-doc-email-role-system-m-zippy-hopcroft.md`
(approved 2026-09-29). No code changed in this phase.

## 1. Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router), React 19, server components + server actions. No REST API layer. |
| Database | Supabase Postgres (not MySQL). Migrations are raw SQL in `supabase/migrations/NNNN_*.sql`; the last file is `0649_…`. Numbers come from the LEDGER, since a parallel session applies first (see memory). |
| ORM | None: `@supabase/supabase-js` over PostgREST, plus RPCs. |
| Tests | No unit framework. `scripts/check-*.mts` assertion scripts (78 of them, some inside `npm run build:check`), SQL smoke tests run in a rolled-back transaction, and in-migration `DO $$ … raise exception` self-checks. |

## 2. Auth and roles on the server

- `lib/auth/server.ts`: `getAppUser()` (request-cached), `requireUser()`, `requirePermission(module, action)`, `can(module, action)`.
- `profiles(id → auth.users, email, is_active, is_super_admin, employee_code)` (0001:29). **Email is not unique and not lower-cased**, so there is no FK; matching uses `lower(btrim(email))`.
- RBAC: `roles(name unique)` / `permissions(module, action)` / `role_permissions` / `user_roles(location_id nullable)`. Keys look like `orders:edit`. SQL uses `has_permission(module, action)` and `is_super_admin()`. Super admin is a boolean on the profile, not a role.
- Relevant role names: `Administrator`, `Managing Director`. The live DB has two profiles and both are super admins; the test logins `*.audit@raagam.test` exist from the 2026-09-22 RBAC audit.
- `profiles` RLS lets a user read only their own row (or all rows with `system_admin:view`), so names are resolved through `creator_names()` / `withCreators()`.

## 3. Order state machine

- **The lock is per RE No.** `garment_order_amendments.re_status ∈ {open, approved, amending}` (check constraint 0604:204). `order_lock_of()` (0576:181) returns a lock when any document of the same `sales_order_id` is `approved`.
- **How "approved" is reached:** approval run → `approval_apply_terminal` → `order_budgets.status='approved'` → `sync_re_status_from_budget` (0576:430).
- **`is_submitted` does not exist.** The budget has `order_budgets.status` (`draft|submitted|approved|rejected`).
- **Versions are not stored as a column.** "V{n}" = the count of entries with `outcome='reapproved'` (`lib/orders/amendments/v-final.ts:207`). "Rev #n" = `amend_no`, computed in `lib/orders/order-amendments/service.ts:135`.
- **Revision (amendment) entry:** a row of `order_budget_revisions`:
  - `entry_no`, `amendment_types text[]`, and the frozen `scope jsonb` = `{table: {columns|null, insert, delete}}`;
  - `order_snapshot` and `budget_snapshot` hold V0;
  - `outcome ∈ open|reapproved|abandoned|superseded|rejected`.
- **Raising a revision:** `open_order_amendment` sets the RE to `amending`.
- **Reject or Abandon:** `order_amendment_revert` restores V0 whole. This is why an override on an amending order would be destroyed (see Conflict C-3).

## 4. How a pending revision stores its proposed changes (R-19)

It stores no field list. The live rows **are** the proposal; V0 is in `order_snapshot`. `order_amendment_changes_of(entry)` (0618:258) derives the diff at read time.

## 5. Write paths and where the lock is enforced today

**Database (the real control):**
- `refuse_when_order_locked()` (body 0619:821-898) is attached to 47 tables (0576:339-425): the 3 parents, 23 Order Entry children, 14 Fabric BOM children and 5 Material BOM children. Its steps:
  - a bookkeeping-column allowlist;
  - step 0, the revert stand-down `reverting_txid = txid_current()`;
  - step 1, the hard lock (`order_lock_message`);
  - step 2, the revision scope (`order_amendment_of` + `order_amendment_refusal`).
- The budget lines are covered by `refuse_when_budget_approved()` (0576:540) on `order_budget_orders` / `order_budget_lines`.

**TypeScript pre-checks:**

| Module | Call site | Guard |
|---|---|---|
| Order Entry | `lib/orders/amendments/actions.ts:2104` (create), `:2242` (`updateAmendment`), `:2415` (delete) | `assertOrderWritable(id, "order")` |
| Fabric BOM | `lib/orders/fabric-bom/actions.ts:123` `orderLockProblem` → create 2575, update 2646, delete 2701; recalc 3165 | `"fabric_bom"` / `assertOrderRecalculable` |
| Fabric BOM (CAD seed) | `lib/orders/cad/actions.ts:487` | `"fabric_bom"` |
| Material BOM | `lib/orders/material-bom-amendment/actions.ts:83` → 1491, 1532, 1564; recalc 1631 | `"material_bom"` / `assertOrderRecalculable` |
| Budget | `lib/orders/budget/actions.ts:357` `assertEditable` (draft/rejected only) + `refuseOutOfBudgetScope` / `budgetScopeProblem` | — |

- **No save is one transaction.** Each is a series of PostgREST calls, and grids are saved by delete-and-reinsert (`writeChildren`). The code says so directly at `amendments/actions.ts:2129`.
- All save actions use `createClient()` (user JWT), so the triggers see `auth.uid()`.

## 6. Calculated fields and manual mode (R-8)

- **Derived columns** (`BOM_DERIVED_SCOPE`, `amendment-entry.ts:328`):
  - Fabric: `order_fabric_bom_requirements` (all), `order_fabric_bom_yarns.purchase_qty`, `order_fabric_bom_yarn_stages.process_qty`, and the header `computed_*`.
  - Material: `material_bom_amendment_requirements` (all) and the header `computed_*`.
- **These are written only by** `recalculateFabricBomDerived` / `recalculateMaterialBomDerived`. They are not user inputs anywhere.
- **Manual mode** exists per Fabric BOM manual entry only: `calc_mode 'direct' | 'calculated'`. In direct mode, `grams` is typed.
- **Result:** R-8 already holds structurally, and the override adds nothing to it.

## 7. Staff Master

- `employees` (0243): `department_id`, `designation_id` → `config_lookups(kind='department'|'designation')`, plus `email`.
- It links to a login only through `profiles.employee_code = employees.code`.
- **The spec's values do not exist in the data.** Seeded designations are MERCHANDISER and CAD DESIGNER; departments are CUTTING, SEWING, CHECKING, IRONING, PACKING and INSPECTION. Merchandising/Planning/IT and Senior Merchandiser/Systems Architect appear nowhere.

## 8. Module keys: spec → Raagam (reused per spec §3.1)

| Spec key | Raagam key | Label (Raise Revision) | Area |
|---|---|---|---|
| `order_entry.qty_add` | `qty_addition` | Quantity Addition | order |
| `order_entry.qty_cancel` | `qty_cancellation` | Quantity Cancellation | order |
| `order_entry.price_change` | `price_change` | Price Change | order |
| `order_entry.delivery_ext` | `delivery_date_ext` | Delivery Date Extension | order |
| `order_entry.combo_color` | `combo_colour_change` | Combo / Color Change | order |
| `material_bom` | `material_bom` | Material BOM | material_bom |
| `fabric_bom` | `fabric_bom` | Fabric BOM | fabric_bom |
| `order_budget` | `order_budget` | Order Budget | budget |

- The three module keys are `AMENDMENT_MODULES` keys. Their revision kinds are `material_bom_revision` / `fabric_bom_revision` / `budget_revision`.
- Constants: `ORDER_CHANGE_KINDS` and `AMENDMENT_MODULES` in `lib/orders/amendments/amendment-entry.ts`.

## 9. Field → key map for Order Entry (§4.4)

This map already exists as `AMENDMENT_SCOPE_SEED` (`amendment-entry.ts:362`), mirrored by the SQL seed `order_amendment_scopes` and held together by `check:amendment-scope`. The override uses each kind's seed **without** 0627's whole-document overlay:

- `delivery_date_ext`: header `delivery_date` only.
- `price_change`: header `ex_rate, avg_rate, gross_value, currency_code, cd1..3_pct/days`, plus `style_prices`, `price_details` and `charges` (whole).
- `qty_addition` / `qty_cancellation`: header `excess_pct, gross_value`, plus quantities, assort lines and sizes, approval qtys, country sizes and style sizes (whole), plus `BOM_DERIVED_SCOPE`.
- `combo_colour_change`: combos, combo structures and components, dyeings, prints, structures, style coordinates, price details and approval qtys (whole), plus `BOM_DERIVED_SCOPE`.
- Anything not listed stays locked under every override.

## 10. UI locations

- **Lock UI:** `MasterFullScreen locked={{message, open?, action?}}` (`components/masters/master-full-screen.tsx:577`), with the banner at L1732. `UnlockScope area` / `LockScope` are in `components/ui/field.tsx:123-193`.
- **Order Entry** lock branches: `garment-order-screen.tsx:23530-23554`. The unlock is `open: openAreasOf(scope)`.
- **Lock loaders:** `lib/orders/order-locks.ts` (`orderLocks`, `orderAmendmentStates`).
- **Raise Revision:** `app/(app)/orders/order-amendments/new/raise-amendment-screen.tsx`.
- **"Next" box:** `app/(app)/orders/order-amendments/[entryId]/entry-screen.tsx:311-451`. It exists only inside a revision.
- **The warnings "Rates missing" and "BOMs out of date" don't exist as those strings.** The nearest are `budget-summary-bar.tsx:179` ("{n} rates missing") and the recalculate wording in entry-screen.
- **Reports:**
  - `lib/orders/order-reports.ts` (`ORDER_REPORTS`) and the report kit `components/orders/report-kit.tsx` + `lib/orders/report-pdf-kit.ts`.
  - The standalone catalog `lib/reports/catalog.ts` + `ReportView`.
  - The existing audit viewer `/admin/audit` (`record_audit`, 0041). It does not cover the order tables, and delete-and-reinsert would make it noisy there.

## 11. Conflicts with the spec (decided in the plan; any can be changed)

- **C-1. Postgres, not MySQL.** The REST endpoints become RPCs + server actions.
- **C-2. Keys reuse the Raise Revision kinds** (§8 above).
- **C-3. No override while the RE is `amending`, or while the budget is `submitted`.** Reject reverts whole modules to V0, which would silently wipe an override edit. This replaces R-19's per-field block, and AC-8 becomes "refused".
- **C-4. The grantee must already hold `orders:edit`.** Row RLS gates writes by permission. Matrix row 2 (Draft + no role + override) is not supported.
- **C-5. Atomicity is per statement, not per save.** A write and its audit row are atomic. A save that fails halfway is recorded `failed`. Concurrency is controlled by one open override commit per RE, not `FOR UPDATE`.
- **C-6. D-6 direction.** Delivery date later-only is enforced in the trigger. Qty direction is checked in the server action (delete-and-reinsert grids).
- **C-7. D-3 expiry** is always required, maximum 30 days. There is no permanent grant, because there is no designation to key it on.
- **C-8. User picker.** It lists active logins holding `orders:edit`. Department and Designation are optional filters, not mandatory ones.
- **C-9. Managers** are `system_admin:edit` or the Managing Director role. The report is readable by those plus `system_admin:view`. D-1, D-4, D-5, D-8 and D-9 stay at their defaults.
- **C-10.** "Commit Changes (Override)" replaces **Save**, not the Revision "Next" box. The dialog previews the sections changed; the field diff comes after the save.

## 12. Side finding (out of scope)

0588 widened the trigger's allowlist so an approved RE could convert a "To be advised" Material BOM line (`convertAdvisedItem`, `lib/orders/advised/actions.ts:43`). The 0604, 0616 and 0619 rewrites of `refuse_when_order_locked` use a constant allowlist without that branch, **Confirmed live 2026-09-29:** `pg_get_functiondef` of the live function contains no `advised` branch, so the conversion is refused on approved REs. Not fixed here; it needs its own change.

Also from the live DB: `pg_trigger` holds **45** triggers named `trg_order_lock`, against 47 in 0576's attach list. Phase 3 must attach nothing new and must reconcile the count before relying on "every table".

## 13. Phase log

**Phase 1 — schema + catalog (2026-09-29, applied to live as 0650).**
- `supabase/migrations/0650_permission_overrides.sql` creates:
  - the tables `user_email_permission_overrides`, `override_grant_history`, `override_commits`, `override_row_log` and `override_audit_trail`;
  - the key catalog `permission_override_kind()`;
  - the gates `can_manage_permission_overrides()`, `can_view_permission_overrides()` and `my_override_email()`.
- **Every table is RLS read-only.** There are no write policies and no table write grants, and the history, raw log and audit trail are append-only through an immutability trigger.
- **Inert until Phase 3:** neither lock trigger reads these tables yet, so the order lock behaves exactly as before.
- **TS twin:** `lib/orders/overrides/override-modules.ts` (keys, key→kind/area, `overrideScopeOf` without the 0627 overlay, expiry/reason rules, grant status).
- **Check:** `npm run check:permission-overrides`, now inside `build:check`. It was made to FAIL three ways before being trusted: a key dropped from the SQL CHECK, a missing revoke, and a TS mapping pointed at legacy `bom_revision`.
- **Verified on the live catalog:** RLS is on for all five tables; `anon`/`PUBLIC` can execute none of the new functions; `authenticated` holds read-level table grants only. A rolled-back dry run confirmed five refusals: a direct write refused, history immutable, an un-normalised email refused, an unknown key refused, and a second open commit per RE refused.
- **Side note:** `check-anon-grants.sql` CHECK 1 lists 188 functions, all `btree_gist` extension internals (none SECURITY DEFINER, none app code). The check does not exclude extension-owned functions, and AGENTS.md's "none today" predates the extension.

**Phase 2 — resolution, grants, commits (2026-09-29, applied to live as 0651).**
- **Resolution:**
  - `my_active_overrides()`;
  - `order_override_scope(order, so)`: the caller's open commit on an approved, not-amending RE; keys still active right now; seed scope with no 0627 overlay;
  - `budget_override_commit(budget)`.
- **Grants:** `override_grantee_candidates()`, `grant_permission_override()` (upsert + history in one tx) and `revoke_permission_override()` (soft).
- **Commits:**
  - `override_commit_open()`: reason, live keys, approved and not amending, one open commit per RE. Your own stale commit is closed `failed`; others' stale ones are closed `expired` after 30 min.
  - `override_commit_close()`: owner only.
- **The field-level diff:** `_override_commit_finalize()` works on the net effect per row. Same row id gives per-column rows. Delete-and-reinsert twins cancel on 0618's volatile-key rule. The remainder is paired by position when the counts match, otherwise reported as row added/removed. `BOM_DERIVED_SCOPE` columns are labelled `(recalc)`.
- **Still inert:** no trigger reads any of this until Phase 3.
- **TS:** `lib/orders/overrides/{types,service,actions}.ts` (the `grantOverride` / `revokeOverride` doors). `check:permission-overrides` now also holds 0651's TTL, max days and recalc list to TS; it was made to fail twice first.
- **Verification:**
  - 0651's own `$verify$` block tests the diff: header field, paired grid field, recalc label, transient row dropped, idempotent close.
  - `scripts/permission-override-smoke-test.sql` (dry run, always rolled back) with real test logins: **29/29 ok**. It covers AC-4, 5, 10, 11, 12, 13, 14, C-3, C-4, C-5, D-3, R-16, R-17 scope, RLS own-read, and no-commit-no-scope.
  - The live DB was confirmed clean afterwards.

**Phase 3 — enforcement (2026-09-30, applied to live as 0653 + 0655).**
- **0653 adds the override to both lock triggers.**
  - `refuse_when_order_locked` is 0619's body verbatim plus one branch *inside* the hard-lock step. `order_override_scope()` is asked only when the lock is already about to refuse, so an open order's save makes no extra lookup.
  - `refuse_when_budget_approved` is 0576's body plus the same branch.
  - Every write let through is logged to `override_row_log` in the same statement (R-7).
  - It also adds: D-6 delivery-date direction in the trigger; a log-only trigger on the approved budget's header, which the database never locked; refusing to raise a revision while an override commit is open (C-5); and a stand-down while a budget is with the MD (0652's pending state, C-3).
- **0655 closes two gaps found by reading the save paths.**
  - A budget override save could never succeed: the commit lookup went through `order_budget_orders`, which the save deletes and re-inserts. The commit now records `budget_id`.
  - Cascaded child deletes (quantities → assort lines → sizes) went unlogged. They are now logged to the caller's single open commit (logging only).
  - An override cannot link an order that another approved budget already locks.
- **Check:** `check:permission-overrides` now scans for the latest migration defining each trigger and asserts that every line of 0576 / 0619 / 0653's bodies survives in it, in order. It was made to fail by dropping the revert stand-down. It also asserts the override is asked only inside the hard-lock branch, and carries vectors for qty direction and the plain scope parser.
- **TypeScript:**
  - `lib/orders/budget/lock.ts`: `orderOverrideOf()`; `assertOrderWritable` / `assertOrderRecalculable` return `override` once the order reads as locked.
  - `lib/orders/overrides/commit.ts`: `saveUnderOverride()` (open → the unchanged save → close committed/failed) and `budgetOverrideCommitOf()`.
  - `updateAmendment`, `updateFabricBom`, `updateMaterialBomAmendment` and `updateOrderBudget` take an optional `override`. Without it they are byte-for-byte the old save.
  - Order Entry feeds the override scope into the existing header/grid narrowing, recalculates BOM derived rows for quantity/combo keys, and pre-checks quantity direction.
  - The budget's `assertEditable` accepts approved plus an open `order_budget` commit on UPDATE only; an override never deletes.
- **Verified** with dry runs against real data, always rolled back and confirmed clean:
  - trigger block 17/17 (AC-1, 2, 7, 9, 15, 17 ×2, D-6, R-17, budget line + header log, C-5, close audit, closed commit);
  - pending-MD 4/4;
  - the real 32-line budget rewrite, audited as exactly one field;
  - the two-level cascade logged completely;
  - the Phase 2 regression still green.
- **Build gates:** tsc, eslint, check:permission-overrides, embeds, amendment-scope, amendment-modules and hooks all green.

## 14. Side findings from Phase 3 (not fixed — each needs its own decision)

- **Delete-and-reinsert saves need `orders:delete`, and a role without it DUPLICATES rows.**
  - `order_budget_lines` / `order_budget_orders` delete policies require `has_permission('orders','delete')`, and the Order Entry child grids likely do too.
  - The save needs only `orders:edit`. For a Merchandiser (edit, no delete), RLS silently turns each DELETE into 0 rows and the INSERTs then add a second copy.
  - This predates overrides and may be the cause behind memory's "Doubled rows — OPEN".
  - For overrides it means a grantee also needs `orders:delete` for any grid-rewriting key.
- **Quantity lines carry their own `delivery_date`.** The Delivery Date Extension seed (0604) opens only the header's, so the override inherits that. Whether a line-level date extension belongs to that key is a seed decision for revisions and overrides alike.
- **D-1 kept blocking for the budget.** `updateOrderBudget` still runs `refuseUnreadyOrders` (the BOM freshness gate) under an override. A budget re-priced on stale BOM figures is what the MD should not find, so it stays blocking unless decided otherwise.

**Phase 4 — admin screen (2026-09-30).**
- **Admin ▸ Access Control ▸ Permission Overrides** (`app/(app)/admin/permission-overrides/{page,permission-overrides-screen}.tsx`). It is registered in `lib/nav/module-groups.ts` (the access group), and `app/(app)/admin/page.tsx` has a card.
- **Page gate:** `can_view_permission_overrides()`, not `system_admin:view`, because the MD may manage without that permission. The manager-only doors show only for `can_manage_permission_overrides()`.
- **List:** a `MasterListShell` register with User, Module, Status (computed in the service, never `Date.now()` in render), Expires, Granted By, Reason, and the Created pair (spliced by the shell). It has Status and Module filters and inline icon actions: Renew, Revoke and History. There is no ⋮ and no Delete (R-12).
- **Grant sheet:**
  - optional Department / Designation filters, shown only when logins are linked to the Staff Master;
  - a user picker that shows non-order-editors disabled with the reason (C-4) and never offers yourself (D-5);
  - an Expires datetime-local field (IST in the field, UTC sent), 1/3/7-day quick picks and the 30-day cap;
  - module checkboxes worded as Raise Revision;
  - a mandatory reason.
  - Errors show under each field on Save.
- **Other sheets:** Revoke takes a mandatory reason. History lists the grant history.
- `useUnsavedGuard` is keyed on typed content.
- `lib/orders/overrides/actions.ts` gains `loadGrantHistory`; the service gains `canViewOverrides`.
- **Verified:**
  - tsc, eslint, check:nav, check:nav-paths, check:hooks and check:permission-overrides all green. audit_layout and audit_keyboard show 0 findings in these files (three were fixed: a redundant caps opt-out, the Created pair on the history table, and `size="full"` outside a track).
  - In the browser (localhost:3000, title checked): the sidebar row lights up and the list renders. The grant sheet lays out within its cap; Quick was widened from `term` to `name` after it clipped. The picker disables non-editors and omits self, empty Save puts each message under its field, and there are no console errors.
  - No grant was submitted through the UI: grants are never deleted, so a test row would stay in the live history. The RPCs behind it are covered by the smoke test (29/29).

**Phase 5 — editor override mode (2026-09-30).**
- **Shared pieces:**
  - `components/orders/override-commit.tsx`: `OverrideBanner` and `useOverrideCommit()`, the "Commit Changes (Override)" sheet (mandatory reason, which modules the save uses, and the in-place / audited / no-PO sentences).
  - `lib/orders/overrides/editor-state.ts`: `overrideEditState()`, which returns null after one RPC for a user with no grant.
  - `areaOverride()` in override-modules. It is non-null only when `raiseFor[doc]` exists (approved; not pending, not amending) and the caller holds a key for that editor.
- **Wired into Order Entry, Fabric BOM, Material BOM and Budget** (page/loader passes `overrideState`):
  - a hook above every early return;
  - `locked` gains an override branch first — the banner plus `open`: the keys' sections for Order Entry, every section for the BOMs and the budget;
  - Save becomes `doSave(o?)`, and the dialog confirm calls it with `{reason, keys}` → update action `override`;
  - saveLabel reads "Commit Changes (Override)";
  - no Save-as-Draft under an override;
  - the budget's `editable` is also true for approved + an `order_budget` key (submit stays hidden because `canTransition(approved→submitted)` is false).
- **Verified:** tsc clean, check:hooks 0, eslint 0 errors (the 25 warnings are pre-existing unused vars). In the browser as the admin (no grant), Fabric BOM loads and the approved BOM shows the unchanged lock banner with no console errors (AC-17 UI).
- **Override mode itself is left to the user to test** (user 2026-09-30).
