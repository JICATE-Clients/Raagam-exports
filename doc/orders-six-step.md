# The garment order flow — nine steps to six

Client requirement, 2026-08-10: the legacy system takes nine entries to get an order
from a style to an approved budget. The new app does it in six.

This file is the design. It exists because the reduction is **not** a UI consolidation —
five of the nine steps have no tables in this database, so "reduce to six" is really
"choose the shape of a rebuild that has to happen anyway".

---

## 1. What is actually there today

| # | Legacy step | Screen | Table | State |
|---|---|---|---|---|
| 1 | Style | `/orders/styles` | `garment_styles` (0124) | built · **blocked on 0392** |
| 2 | Order Entry | `/orders` | `sales_orders` (0006) | **live** |
| 3 | Material BOM | `/planning/material-bom` | `material_boms` (0368) | **no table** |
| 4 | Garment Process Plan | `/orders/garment-processes` | `order_garment_processes` (0019) | **live** |
| 5 | Shipment Plan | — | — | **does not exist anywhere** |
| 6 | Garment Order Plan | `/planning/garment-ppm` | `garment_ppms` (0370) | **no table** |
| 7 | Material Planning | `/planning/material` | (0371) | **no table** |
| 8 | Prepare Budget | `/planning/budgets` | `budgets` (0369) | **no table** |
| 9 | Approve Budget | same screen | same | **no table** |

Three steps are live and need no work. Step 1 needs one migration applied. Steps 3 and
6–9 are the Planning module, which **`0332` deliberately dropped**: "built from generic
ERP patterns instead of the VB.NET source of truth … so the module can be rebuilt
correctly." The nav already says so to operators — 27 entries carry
`status: "unavailable"` with that note.

### Why Planning never came back: six colliding migration numbers

The rebuild was written. It cannot be applied, because every number is taken:

```
0368_caps_ship_values.sql          0368_planning_bom_foundation.sql
0369_vendor_item_categories.sql    0369_planning_budgets.sql
0370_vendor_processes.sql          0370_planning_ppm.sql
0371_party_publishing.sql          0371_planning_material_planning.sql
0372_vendor_service_subcontract    0372_planning_production_planning.sql
0373_country_state_uniqueness      0373_planning_purchase_flow_wiring.sql
```

Six collisions from parallel sessions; the non-planning half is applied. So the module's
absence is a merge artefact nobody had to resolve, not a decision taken twice.

**They are not being renumbered and applied.** Between them those five files create
**~110 tables** driving ~20 screens — the nine-step shape at its most granular, and the
opposite of what was asked for. They stay unapplied, as reference for column names and
legacy semantics. Next free number is **0393**; do not add to the duplicated range.

---

## 2. The six

| New step | Merges | Why it is one entry |
|---|---|---|
| 1. **Style** | 1 | Unchanged. A reusable master, not per-order |
| 2. **Order Entry** | 2 | Unchanged. Already live |
| 3. **Material BOM** | 3 + 7 | The BOM says *what* per garment; Material Planning says *how much* and *by when*. The plan is the BOM × order quantity × dates — columns on a line, not a second document |
| 4. **Garment Process Plan** | 4 | Unchanged. Already live |
| 5. **Order & Shipment Plan** | 5 + 6 | Both are scheduling, and one derives the other: ship dates set production dates. Two screens means keying the same dates twice and letting them disagree |
| 6. **Budget** | 8 + 9 | Approve is a **status transition**, not a second entry — the standing rule is "one Save for the whole record; workflow buttons change status, never data" |

**Steps 1, 2 and 4 do not change.** The consolidation costs nothing on the three things
that already work, which is what makes it cheap.

---

## 3. What each new step needs

Deliberately small. The legacy table count is given to show what is being declined, not
as a target.

### Step 3 — Material BOM (replaces ~52 legacy tables)

```
order_material_boms        order_id, status, created_*        -- one per order
order_material_bom_lines   item_id, per_garment_qty, wastage_pct,
                           total_required, required_by, rate, source_component_id
```

The Material Planning half is `total_required`, `required_by` and `rate` — **derived
columns on the line**, not a second document. `total_required` comes from
`per_garment_qty × order qty × (1 + wastage)`, and the rejection/excess allowance already
has an engine (`rejectionFor`, tiers, `allowance_type`, 0389) which is wired only to Sales
▸ SQ Detail today. Reuse it; do not write a second one.

Seeded from the Style's components and fabrics — which is why this step needs **0392**.

### Step 5 — Order & Shipment Plan (replaces ~28 legacy tables)

```
order_plans            order_id, status
order_plan_shipments   sno, ship_date, qty, destination_id, mode
order_plan_milestones  activity_id, planned_date, actual_date   -- see the warning below
```

**WARNING — T&A already exists twice.** Migration 0006 has `ta_templates` / `ta_plans`
that *do* calculate dates, but only from `ship_date` and with no template editor; the
legacy TA sub-module (`ta_styles`, `ta_plan_docs`, six screens under `/orders/ta*`) has a
real template concept and nothing that explodes it into a dated plan. **Building
milestones here without deciding which stack survives creates a third.** Resolve that
before writing `order_plan_milestones` — it may be that this step owns shipments only and
delegates dates to whichever T&A stack wins.

### Step 6 — Budget (replaces ~12 legacy tables)

```
order_budgets        order_id, status ('draft'|'submitted'|'approved'|'rejected'),
                     approved_by, approved_at, remark
order_budget_lines   head_id, source ('material'|'process'|'cmt'|'other'),
                     qty, rate, amount
```

Prepare and Approve are one document and one screen. Approve is a transition on `status`,
gated on a real `approve` permission — `lib/auth/types.ts` declares one and nothing has
ever used it. The bar goes in the header, **never the footer**: `submitTargetOf` takes the
footer's last non-disabled button, so `Approve` after `Save` means Enter off the last
field approves the document.

Lines are sourced from steps 3 and 4, so this builds last.

---

## 4. Order of work

Dependencies, not preference:

1. **Apply `0392`.** Step 1 is dead without it, and step 3 seeds from Style components.
   Everything else waits behind this.
2. **Step 5 — Order & Shipment Plan.** The only one that needs nothing but `sales_orders`,
   so it is the only step buildable *today*. Settle the T&A question first.
3. **Step 3 — Material BOM.** Needs Style (components, fabric) and Order (quantities).
4. **Step 6 — Budget.** Needs 3 and 4 to have something to price.
5. **Nav.** Fold the 27 `unavailable` Planning entries down as each step lands. A screen
   that loses its row keeps its URL — a dissolved hub becomes a `redirect()` declared in
   `REDIRECTED` in `scripts/check-module-groups.mts`, never a deletion.

## 5. Rules this must not break

- One `styleProblems`-shaped rule module per step: pure, no imports, compiled into the Zod
  input via `superRefine` so a `lib/data-io` import cannot bypass it, and proved by a
  `scripts/check-*.mts` vector file **demonstrated failing first**.
- `MasterFullScreen mount="page"` for every one of these — they are documents, so they get
  a route, a rail, and `canSave` derived from `sectionValidity`.
- `revoke all on function … from public, anon` in one statement for any new function, and
  verify from the catalog: a migration reporting success proves nothing (0386).
- Created Date / Created User on every listing, with `withCreators()` on the service — the
  column half alone renders a dash in every row (143 services were in that state).
