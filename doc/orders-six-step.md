# The garment order flow

Client requirement, 2026-08-10: the legacy system takes nine entries to get an order from
a style to an approved budget. The new app does it in fewer, and **the client names the
steps**. They have named them three times, and all three are theirs:

| | |
|---|---|
| **2026-08-10** | Style · Order Entry · Material BOM · Fabric BOM · Budget · Budget Approval |
| **2026-08-14** | …Garment Process Plan · Fabric Plan · Budgeting, with Prepare and Approve collapsed into the last |
| **2026-08-17** | …Fabric BOM · Fabric Plan · Budgeting · Approval — the BOM is back as a step of its own, and Approve is uncollapsed again |
| **2026-08-17b** | Garment Process Plan comes OUT — "only 7 are needed" |

**So it is seven: Style · Order Entry · Material BOM · Fabric BOM · Fabric Plan ·
Budgeting · Approval.**

The count was never the client's claim — the sequence was.
The 08-14 list read as six only because Fabric BOM had gone missing under Fabric Plan's
name: the Order Setup hub carried a card labelled "Fabric Plan" whose href was
`/planning/fabric-bom`, so the step the client asks for by name had no card and the card
standing in its place named a different step. The live list is
`lib/nav/module-groups.ts`; this file is the design behind it.

It exists because the reduction is **not** a UI consolidation — five of the nine legacy
steps have no tables in this database, so "reduce the entries" is really "choose the shape
of a rebuild that has to happen anyway".

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
| 3 | **Material BOM** | legacy 3 + 7 | **built 2026-08-13** (`0418`) |
| 4 | **Fabric BOM** | split out of legacy 3 | **built 2026-08-17** (`0426`) |
| 5 | **Fabric Plan** | legacy 5-6, reinterpreted | **built 2026-08-17** (`0427`) |
| 6 | **Budgeting** | legacy 8 | **built 2026-08-17** (`0428`) |
| 7 | **Approval** | legacy 9 | **built 2026-08-17** (same table) |

**Garment Process Plan was step 4 on the 08-14 list and is not a step now**
(client, 08-17). Its row moved back to Order Execution, where it had been
cross-listed all along. Which is exactly the position §"Garment Process Plan is
live and is NOT one of the six" below argued for on 08-10 — the section was
briefly wrong and is right again, and it is left standing rather than rewritten
because the reasoning in it is what the client's second answer confirms.

**Fabric Plan is the 08-17 addition and is NOT in this file's original design.** The
client's answer to what it covers, asked directly: the PROCESS ROUTE — yarn purchase,
knitting, dyeing, stentering, compacting — with each stage's loss and whether it is
in-house or out-processed. That is what makes the boundary with step 5 real rather than
verbal: **Fabric BOM is finished fabric, Fabric Plan walks backwards from it to the yarn.**
Put knitting loss on the BOM as well and the same loss is charged twice, on the largest
line in the order, looking entirely plausible on both screens.

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

### Step 5 — Fabric BOM · fabric by component and colour (replaces ~6 legacy tables)

> **BUILT — and the sketch below is not what shipped.** `0426` is the schema of record;
> read its header. Two things changed: the seed is the ORDER's combo tree, not the Style's
> component mapping (so `garment_style_id` is not a column); and there are no `status` /
> `approved_by` / `approved_at` columns, because `doc/prd.md` is explicit that a BOM needs
> no approval — the BUDGET is what gets approved. The original sketch:

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

### Steps 7 & 8 — Budgeting and Approval (replaces ~12 legacy tables)

> **BUILT — and the sketch below is not what shipped.** `0428` is the schema of
> record. Two changes: a budget covers MANY orders (`order_budget_orders`), not
> one; and `amount` has no column, because `qty`, `rate` and `amount` are three
> numbers stating two facts. The original sketch:

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
2. ~~**Step 3 — Material BOM.**~~ **DONE, 2026-08-13 (`0418`).** It is `/orders/material-bom-amendment`,
   and it hangs off `garment_order_amendments` rather than `sales_orders` — the production target it
   multiplies (qty + excess + approval + projection) lives on the Approval Qty tab (`0413`), and the
   20-column order scaffold cannot reach it. The requirement is STORED, not projected, because a
   quantity controller needs a number that cannot move under the purchaser's feet and because
   `report_item_movements` is SQL that would otherwise have to re-derive the maths in plpgsql.
   `required_by` carries legacy step 7. Engine + vectors: `lib/orders/material-bom/requirement.ts`,
   `npm run check:bom-requirement`.
3. ~~**Step 4 — Fabric BOM.** Needs `0392`.~~ **DONE, 2026-08-17 (`0426`).** It is
   `/orders/fabric-bom`, and — like step 3 — it hangs off `garment_order_amendments`
   rather than `sales_orders`. **It did NOT need `0392` in the end**, because it does not
   seed from the Style master at all: `0408` · `0409` · `0410` moved the whole fabric tree
   onto the ORDER (combo → structure → component, with composition, GSM and
   solid/melange/yarn-dyed), and that tree is what the operator actually filled in for
   this order. Seeding from `garment_styles` would re-fetch a template the order has
   already been amended away from. §3 step 4 below is superseded on that point.
   Engine + vectors: `lib/orders/fabric-bom/requirement.ts`, `npm run check:fabric-bom`.
4. ~~**Step 6 — Fabric Plan**, then **step 7 — Budgeting**, then **step 8 — Approval**.~~
   **ALL THREE DONE, 2026-08-17.**

   - **Fabric Plan** (`0427`) is `/orders/fabric-plan`. It solves each stage
     BACKWARDS from the BOM requirement — `input = output / (1 - loss/100)`, not
     `output x (1 + loss)` — because loss is stated forward and the requirement is
     known at the end of the chain. Engine + vectors:
     `lib/orders/fabric-plan/route.ts`, `npm run check:fabric-plan`.
   - **Budgeting** (`0428`) is `/orders/budgets`, and it GROUPS ORDERS. §3 below
     is superseded on that point: it sketched one order per budget, and doc/prd.md
     is explicit that budgeting covers "various orders which are grouped
     together". Its fabric and material lines are PULLED from the two BOMs'
     stored requirements rather than re-derived. Engine + vectors:
     `lib/orders/budget/totals.ts`, `npm run check:budget-totals`.
   - **Approval** is `/orders/budget-approval`, a queue over the SAME table —
     which is what §"A separate STEP is not a second DOCUMENT" always said, and
     is unchanged by the 08-17 revision that un-collapsed the two steps.
     It is gated on `orders:approve`, the permission `lib/auth/types.ts` has
     declared since 0001 and which nothing had ever used. `0428` seeds the
     permission row and grants it to no role: who may approve is the client's
     decision, taken on the Roles screen.
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
