# The garment order flow — nine steps to six

Client requirement, 2026-08-10: the legacy system takes nine entries to get an order from
a style to an approved budget. The new app does it in six, and **the client named the
six**:

> Style · Order Entry · Material BOM · Fabric BOM · Budget · Budget Approval

This file is the design. It exists because the reduction is **not** a UI consolidation —
five of the nine legacy steps have no tables in this database, so "reduce to six" is
really "choose the shape of a rebuild that has to happen anyway".

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

Steps 3 and 6–9 are the Planning module, which **`0332` deliberately dropped**: "built
from generic ERP patterns instead of the VB.NET source of truth … so the module can be
rebuilt correctly." The nav already says so to operators — 27 entries carry
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

**They stay unapplied.** Three reasons, the third being the one that would have bitten
silently:

1. Between them those five files create **~110 tables** driving ~20 screens — the
   nine-step shape at its most granular.
2. Four of the steps they implement are **not in the client's six** at all.
3. **`fabric_boms.style_id` references `public.styles`** — the *Sales* style table
   (0005), not `public.garment_styles` (0124) which is the Style master step 1 builds.
   Applying 0368 as-is would point Fabric BOM at the wrong master, which is the same
   class of defect as the `state_id` and `payment_term` FK repoints (0355 · 0375). The
   rebuild must reference `garment_styles`.

They are kept as reference for column names and legacy semantics. Next free number is
**0393**; do not add to the duplicated range.

---

## 2. The six

| # | Step | Was | Build state |
|---|---|---|---|
| 1 | **Style** | legacy 1 | live · blocked on `0392` |
| 2 | **Order Entry** | legacy 2 | **live, unchanged** |
| 3 | **Material BOM** | legacy 3 + 7 | build |
| 4 | **Fabric BOM** | split out of legacy 3 | build |
| 5 | **Budget** | legacy 8 | build |
| 6 | **Budget Approval** | legacy 9 | build |

### What the client dropped, and what that buys

**Shipment Plan, Garment Order Plan and Material Planning are gone from the flow.** That
is the whole simplification — four scheduling documents collapse into columns on a BOM
line (`required_by`) and the order's own dates.

It also **removes the T&A problem**. T&A exists twice in this repo — `0006`'s
`ta_templates`/`ta_plans` calculates dates but only from `ship_date` and has no template
editor, while the `/orders/ta*` sub-module has real templates and nothing that explodes
them into a dated plan. A Shipment/Order Plan step would have had to pick a winner or
become a third stack. Dropping the step means that decision is no longer in the way of
anything, and T&A stays where it is.

### Garment Process Plan is live and is NOT one of the six

`/orders/garment-processes` works today over `order_garment_processes` (0019) — a thin
table: `sales_order_id, sequence, name, mode ('in_house'|'outsourced'), notes`.

Leaving the numbered flow is not deletion. **The screen keeps its URL and its sidebar
row under Order Execution.** It stops being a step every order must pass through and
becomes optional, which is what "reduce the number of entries" means. If it is later to
disappear entirely it becomes a `redirect()` declared in `REDIRECTED` in
`scripts/check-module-groups.mts`, never a struck route.

### A separate STEP is not a second DOCUMENT

Budget and Budget Approval are two steps, as the client asked. They are **one table**.

Approval is a transition on `order_budgets.status`, and the approval step is a *screen* —
a queue of submitted budgets — not a second record. This is not a reinterpretation of the
request: it is how the app already does approvals (`/orders/approve-amendments` is exactly
this shape, over the amendment's own status), and it is how the legacy design did it too —
`0368`'s `material_boms` and `fabric_boms` both carry
`status check (status in ('draft','submitted','approved','rejected'))` with `approved_by`
and `approved_at` **on the same row**.

Two records would mean the approved figures could drift from the budget they approved.

---

## 3. What each new step needs

Deliberately small. Legacy table counts are given to show what is being declined.

### Step 3 — Material BOM · sewing and packing materials (replaces ~31 legacy tables)

```
order_material_boms        sales_order_id, status, approved_by, approved_at
order_material_bom_lines   item_id, per_garment_qty, wastage_pct,
                           total_required, required_by, rate, amount
```

`total_required` = `per_garment_qty × order qty × (1 + wastage)`. The excess/rejection
allowance **must reuse `rejectionFor`** (tiers, `allowance_type`, 0389), which is complete
and correct and wired only to Sales ▸ SQ Detail today. A second excess calculation is how
two screens start reporting different quantities.

`required_by` is the whole of legacy step 7 (Material Planning): a date on a line, not a
document.

**Buildable without `0392`** — trims and packing items come from the order, not from the
Style's fabric mapping.

### Step 4 — Fabric BOM · fabric by component and colour (replaces ~6 legacy tables)

```
order_fabric_boms        sales_order_id, garment_style_id, status, approved_by, approved_at
order_fabric_bom_lines   component_id, item_id (the fabric), colour_id,
                         consumption_per_garment, uom_id, wastage_pct,
                         total_required, required_by, rate, amount
```

Separate from Material BOM because fabric is bought by **colour and structure** and is the
dominant cost, while trims are per-garment counts. That is the client's split, and the
legacy schema agrees — `fabric_boms` and `material_boms` are distinct documents there too.

Seeds from the Style's components → fabric mapping, so this step **needs `0392`**.
`garment_style_id` references **`garment_styles`**, not `public.styles`.

### Steps 5 & 6 — Budget and Budget Approval (replaces ~12 legacy tables)

```
order_budgets        sales_order_id, status ('draft'|'submitted'|'approved'|'rejected'),
                     approved_by, approved_at, remark
order_budget_lines   head_id, source ('fabric'|'material'|'process'|'cmt'|'other'),
                     qty, rate, amount
```

Lines are sourced from steps 3 and 4 (and optionally the process plan), so this builds
last. Approval is gated on a real `approve` permission — `lib/auth/types.ts` declares one
and nothing has ever used it.

**The Approve bar goes in the header, never the footer.** `submitTargetOf` takes the
footer's last non-disabled button, so `Approve` after `Save` means Enter off the last
field approves the document.

---

## 4. Order of work

Dependencies, not preference:

1. **Apply `0392`.** Step 1 is dead without it and step 4 seeds from Style components.
2. **Step 3 — Material BOM.** The only step buildable *today*: it needs `sales_orders`
   and the item masters, both live.
3. **Step 4 — Fabric BOM.** Needs `0392`.
4. **Step 5 — Budget**, then **step 6 — Budget Approval** (a queue over the same table).
5. **Nav.** Fold the 27 `unavailable` Planning entries down as each step lands, and
   re-shape the Orders sub-modules around the six.

## 5. Rules this must not break

- One `styleProblems`-shaped rule module per step: pure, no imports, compiled into the Zod
  input via `superRefine` so a `lib/data-io` import cannot bypass it, and proved by a
  `scripts/check-*.mts` vector file **demonstrated failing first**.
- `MasterFullScreen mount="page"` for all four new screens — they are documents, so they
  get a route, a rail, and `canSave` derived from `sectionValidity`.
- `revoke all on function … from public, anon` in one statement for any new function, and
  verify from the catalog: a migration reporting success proves nothing (0386).
- Created Date / Created User on every listing, with `withCreators()` on the service — the
  column half alone renders a dash in every row (143 services were in that state).
- Disabled master rows never offered; the value a record already holds always survives.
