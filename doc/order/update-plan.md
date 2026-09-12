# Audit & implementation plan: `doc/order/update.md`

**Method.** `update.md` is a generic, vendor-style technical spec (PascalCase table
names like `IWO_Header`, `Fabric_BOM`, `Order_Closure_Log`) — the same shape as a
spec audited in this repo on 2026-09-12 for "Fabric Allocation," where every
described behavior turned out to already be live under different real names, and
building the spec's literal schema would have forked the data model into a
duplicate, conflicting system. Five parallel audits (one per major area) checked
every requirement in `update.md` against the actual codebase before proposing any
new work. **Nothing below should be built without first reading its "already
built" mapping** — several sections need zero code, only data or wiring.

Real order root: `garment_order_amendments`. Latest applied migration: **0555**
(`0555_ta_approval_dispatch_details.sql`) — the next new migration is **0556**,
claimed by whichever gap is built first; renumber the rest at build time.

---

## 1. Executive summary

| Spec area | Verdict |
|---|---|
| §1 IWO header/numbering | Partially built — module exists, numbering format wrong |
| §1.3 / §7.1 MRP divisive loss formula | **Already built, exact match** (fixed 2026-09-11) |
| §1.4 IWO stock hard-lock / transfer | **Not built** — no reservation mechanism anywhere |
| §2 TBA flag + PO hard stop | **Already built** — on Material BOM (trims), not Fabric BOM |
| §2 TBA Checked-By/Approved-By release | **Not built** |
| §2 Merchandiser TBA Dashboard | **Not built** as a dedicated screen |
| §3.1 Packing carton numbering | Partially built |
| §3.1 Gross/Net weight | Columns exist, **orphaned** (not wired to UI/actions) |
| §3.1 Dimensions / CBM | **Not built** |
| §3.1 Size/Color breakdown + integrity check | **Not built** on Packing Advice |
| §3.2 Commercial Invoice screen | **Not found at all** — needs its own scoping pass |
| §3.2 Tiered/"Solid Price" pricing | **Not built** — no analog anywhere |
| §3.3 Solid vs Assorted Pack | **Already built** (Assortment tab, different name) |
| §3.3 Piece/Set → Coordinate_Count rows | **Not built** — genuinely different from anything existing |
| §4.1 WIP stop on Cancel/Inactive | **Not built** |
| §4.2 Force-Closure + log | **Not built** |
| §5.2 SQ formula | **Already built, exact match** (Approval Qty tab) |
| §5.2 Rejection allowance tiers | **Already built as configurable master data** — zero code |
| §6.1 Mandatory fields (PO No/Merchandiser/Description) | **Already built** |
| §6.1 Delivery Date future-date restriction | **Not built** (narrow gap) |
| §6.2 Auto-focus skip, duplicate Component prevention | **Already built** |
| §7.2 Fabric Print vs Component Print | **Already built structurally** (naming-only gap) |
| §7.3 Yarn-Dyed skip-Dyeing-stage automation | Partially built — math is right, auto-skip isn't |

**Bottom line:** of ~23 distinct requirements, roughly half need no code at all
(already built or configurable data), and the genuine gaps cluster into five
buildable units (§2 below) plus two that need a client/product decision before
anyone should scope them (Commercial Invoice, tiered pricing).

---

## 2. Section-by-section

### §1 — Internal Work Order (IWO)

**Already exists:** `internal_work_orders` / `iwo_lines` (migration 0024, extended
0125), UI at `app/(app)/orders/internal-work-orders/*`,
`lib/orders/internal-work-orders/{types,service,actions}.ts`. Captures Customer,
Style (legacy `garment_styles` FK), Item Class, one Delivery Date, optional
`sales_order_id` link.

**Gap 1 — numbering.** Spec wants `IWO/[Unit]/[YY-YY]/[Serial]`; today's `code` is
`IWO-0001` via the generic `assign_code('IWO', seq_internal_work_order)` trigger.
The exact target pattern already exists for Sales Order SC No (migration 0395:
`fiscal_year_segment()`, a per-(location, FY) counter table, one composer
function). **Extend that pattern, don't invent a new one**: new
`iwo_no_counters(location_id, fy, last_no)` + `iwo_no_format()` +
`assign_iwo_number()` trigger, replacing `assign_code` on `internal_work_orders`.
**Decision needed:** SC No's FY segment is `2627` (no hyphen); the spec literally
asks for `26-27`. Confirm which before writing the migration.

**Gap 2 — Delivery Window / Season.** Only a single Delivery Date exists today, no
from/to range, no Season field. Two nullable columns, straightforward addition —
bundle into the numbering migration.

**Gap 3 — stock hard-lock + de-link/transfer (§1.4).** Genuinely new. No
reservation/locking concept exists anywhere in `lib/purchase/*` or `lib/stores/*`,
and `iwo_lines` doesn't even carry an `item_id` (free-text description/qty/unit
today). The "exact match on Item Class/GSM/Dia/Composition" comparison is
buildable once a transfer exists — those columns already live on
`order_fabric_bom_lines`. **This needs a data-model decision before any migration**:
does `iwo_lines` gain a real `item_id` FK, does a separate
`iwo_stock_reservations` table track locked qty, and what does "de-link" look like
on screen (a button on the IWO, or a step inside PO/GRN receiving)? Scope this as
its own follow-up conversation, not a migration to write today.

### §1.3 / §7.1 — MRP Divisive Loss Formula

**Already built and exact.** As of a 2026-09-11 change (`lib/orders/fabric-bom/yarn-process.ts`,
"THE FORMULA REVERSED"), `comboUplift()`/`comboUpliftBreakdown()` compute
`input = output / (1 - loss/100)`, compounding sequentially across
`order_fabric_bom_processes`' declared route (Knitting→Dyeing→Brushing→Stentering→Compacting,
seeded per migration 0492). This reproduces the spec's own worked example
(1460.029 → 1536.873 at 5% loss) to the decimal. `scripts/check-yarn-process.mts`
pins it. **Nothing to build here.**

**One real, live divergence to know about, not fix:** Material BOM (trims/accessories)
uses a *different*, multiplicative engine (`compoundLossFactor()` in
`lib/orders/material-bom/process-loss.ts`, `factor *= 1 + loss/100`) — a deliberate
2026-08-29 choice for how trims dyeing/printing actuals are costed. The spec doesn't
distinguish "IWO MRP" from "Material BOM," so if IWO's future MRP needs to cover
accessories too, someone must explicitly point it at the correct engine rather than
assuming one formula covers both.

**Precision gap:** nothing in this engine holds `Decimal(18,4)` — `uomPrecision()`
floors at 2 decimals today, driven by `uoms.decimal_places_allowed`. **Decision
needed:** is 18,4 a real client requirement or spec boilerplate? Raising the floor
globally would change rounding on every other module calibrated around 2dp.

### §2 — TBA (To Be Advised) Queue

**Already built — but on Material BOM (accessories/trims), not Fabric BOM.**
Real column: `material_bom_amendment_items.type` (text, `"To be advised"` /
`"Available Item"`, toggle added 2026-08-28). PO hard-stop:
`refuseUnsettledMaterials()` in `lib/purchase/bom-ceiling-service.ts`, wired into
**all four** PO write paths in `lib/purchase/po-actions.ts`. No `Fabric_BOM` table
exists in this schema at all, and `order_fabric_bom_lines` has no TBA-equivalent
column.

**Decision needed before building anything:** the spec's wording (GSM/Width/Color
as the specs being finalized) points at **fabric**, where no TBA mechanism exists
today at all. The only real implementation is on **Material BOM accessories**.
These are two different amounts of work:
- If the client means the existing Material BOM flow → build only the two gaps below.
- If the client genuinely wants a parallel TBA flag on Fabric BOM fabric lines →
  that is a second, larger buildout (new column on `order_fabric_bom_lines`, a
  second PO-gate check, a second dashboard filter) — do not start it without
  confirming scope.

**Gap 1 — Checked-By/Approved-By release workflow.** Nothing gates the toggle
flipping back to "Available Item" today. Given this repo already ported a full
`dynamic-approval-flow` engine (migrations 0500–0503, live for TA approvals since
0534), **prefer registering a new workflow key (e.g. `mba_tba_release`)** over
ad-hoc `checked_by`/`approved_by` columns — surface this choice to whoever owns
the spec before building either.

**Gap 2 — Merchandiser TBA Dashboard.** No dedicated screen exists;
`components/orders/bom-queue.tsx` only answers document-level status, not
line-level TBA. **Mirror the `ta-followup`/`ta-worklist` board pattern** (a flat,
cross-order worklist), filtered by the same `isUnsettledMaterialType()` predicate
the PO gate already uses — so the dashboard and the gate can never disagree about
what counts as TBA.

### §3.1 — Packing List Data

Screen exists: `app/(app)/orders/packing-advice/*`, tables `packing_advices`/
`packing_advice_lines` (0033, extended 0130).

**Gap 1 — Gross/Net Weight (cheap fix, no migration).** `gross_weight`/`net_weight`
columns already exist on `packing_advice_lines` since 0033 but are never read or
written by `types.ts`/the screen/`actions.ts`. Add to the Zod schema, the line's
`ChildGrid` cells, and the insert in `actions.ts`. Zero schema change.

**Gap 2 — Dimensions (L×W×H) + CBM.** Genuinely absent. New migration adding
`length_cm`/`width_cm`/`height_cm numeric(10,2)` to `packing_advice_lines`; CBM
computed as a pure derived function (never stored, matching the "Order INR Value"
derived-not-stored precedent) — `CBM = L×W×H / 1,000,000 × ctns`.

**Gap 3 — Size/Color breakdown grid + integrity check.** The real gap: the
screen's "Assort" button is explicitly disabled ("awaiting spec"). Needs a new
child table (`packing_advice_line_breakdowns`: line_id FK, combo/colour as TEXT —
never a style FK, per this app's established convention — size_id, qty), a nested
`ChildGrid` (per the line-items-are-ChildGrid rule), and a blocking integrity
check (`Σ breakdown qty = SC order qty`) wired through `lib/screens/validity.ts`'s
custom-check mechanism, the same way the existing Assortment breakup-equals-Qty
rule works. Note: Production's separate `packing_lists`/`packing_list_lines`
(migration 0207) already has this exact shape (carton×color×size×qty) but is a
different module (`production` permission, not tied to Sales Order quantity) —
worth checking whether that table should be reused/linked rather than duplicated,
before writing the migration.

### §3.2 — Commercial Invoice & Pricing

**Commercial Invoice screen: not found anywhere in the repo.** This needs a
dedicated scoping conversation before anyone estimates it — don't fold it into
this plan as a quick add.

**Price fetching "from Style Master OR Order Entry":** Style Master has zero
price/rate fields (confirmed by grep). Only the Order Entry Prices tab
(`garment_order_amendment_price_details`/`_style_prices`) is real, and it already
computes Gross Value, quantity-weighted Avg Rate, and INR conversion. The spec's
"Style Master" half of this sentence doesn't correspond to anything — flag as a
wording mismatch, not a gap.

**Tiered/"Solid Price" pricing:** no quantity-break pricing concept exists
anywhere. The existing Prices tab's "Pack-wise"/"Style-wise"/etc. modes are axis
choices, not run-size-dependent rates. **Genuinely new if wanted**, and it would
touch `order-value.ts`'s `styleRate()` lookup — a module other memory notes
describe as heavily hardened around a prior triple-counting bug. **Get explicit
confirmation this is wanted before touching it.**

### §3.3 — Pack Ratios / Coordinate Logic

**"Solid Pack vs Assorted Pack" — already built, different name.** This is the
Garment Order's own Quantities ▸ Assortment tab (`PACK_TYPE_OPTIONS`,
`assortModeOf`/`lib/orders/assort-weights.ts`). The spec's "Pack Ratios" and this
app's "Assortment Type" are the same real concept.

**"Piece"/"Set" → Coordinate_Count generates N rows — not built, and not the same
thing as anything that looks similar.** The closest-sounding existing feature
(Style Master's `UNIT_KIND_OPTIONS` gating `COORDINATE_LIMITS` for BOM Coordinates)
answers a completely different question — garment structure/costing, not carton
composition — and nothing in the app takes a typed count and spawns that many
rows dynamically. **Flagging explicitly so this isn't mistaken for a rename**: if
wanted, it's new UI behavior on the Packing Advice screen, unrelated to
`COORDINATE_LIMITS`.

### §4 — Order Lifecycle & Closure

**Both halves are genuinely absent — the one section with almost nothing already
built.** `cancelOrder`/`completeOrder` (`lib/orders/cancellations/actions.ts`,
`lib/orders/completions/actions.ts`) only log a reason and flip
`sales_orders.status`; nothing reads order status anywhere in
`lib/orders/bom-explosion/*` or `lib/orders/material-bom/requirement.ts` to gate
Knitting/Dyeing/Cutting issuance. No `order_closure_log` table, no force-closure
threshold concept, zero hits repo-wide for any of it.

**Before writing a migration, two decisions are needed:**
1. **What counts as "issuance" to block?** This repo's BOM/requirement modules
   don't currently model issuance at all — identify which actual screen(s) record
   material being issued to Knitting/Dyeing/Cutting (likely under Production) before
   a status guard can be added anywhere meaningful.
2. **What does "remaining qty" mean for force-closure?** Remaining unshipped
   pieces, or unconsumed material? This is a business-logic decision, not a schema
   gap — `lib/orders/amendments/qty-balance.ts`'s existing order/breakup balance
   arithmetic is not directly reusable for a WIP-remaining test.

**Once scoped**, the schema is simple: `order_closure_log` (order_id,
closure_type, remaining_qty, remaining_pct, created_by/created_at per the
Created Date/User STANDING rule) plus a status guard at whichever issuance
point(s) get identified.

### §5.2 — Rejection & Allowance Logic

**SQ formula — already built, exact match.** `totalProductionQty()`/
`productionTarget()` in `lib/orders/amendments/approval-qty.ts` computes
`qty + excessQty + approval + projectionQty` — the spec's Order Qty + Excess% +
Rejection Allowance + Approval Allowance, term for term. (A second, narrower `sq_details.sq_qty`
path exists that omits `approval_qty` — don't conflate the two; the full 4-term
formula lives on the Approval Qty tab, not SQ Detail.)

**Rejection allowance tiers — already built as fully configurable master data,
zero code needed.** `garment_rejection_rule_lines` already has exactly
`from_value`/`to_value`/`rejection_allowance`/`allowance_type` ('flat'|'percent').
The spec's 4 tiers are just 4 rows to seed:

| From | To | Allowance | Type |
|---|---|---|---|
| 1 | 10 | 4 | flat |
| 11 | 50 | 3 | flat |
| 100 | 500 | 3% | percent |
| 500 | (unbounded) | 2% | percent |

**Do not seed these yet.** The spec's own table has an unfilled gap (51–99
pieces has no tier), and `rejectionFor()` deliberately returns `null` — never a
silent 0 — for an unmatched quantity. This exact failure class (a client-supplied
tier table producing a gap or a backward step) already caused a real incident
here, recorded in memory, and a `min_pieces` floor built to paper over it was
reverted twice at the client's explicit word. **Get the 51–99 answer from
whoever owns this spec before entering any rows.**

### §6 — UI and Validation Rules

**Almost entirely already built**, as expected given this repo's extensive
standing keyboard/mandatory-field contract (AGENTS.md):
- PO Number, Merchandiser (filtered by Designation), and Description (per style
  line) are each already `required` through the full four-enforcer pattern
  (star, hold, `sectionValidity`, server Zod).
- Auto-focus skip (Location/Unit + Date → Customer) already works via
  `autoFilledField`/`data-focus-optional`.
- Duplicate Component prevention within a Style's Coordinate already works,
  offer-side and save-time. (No literal "Family" field exists in this schema —
  closest analog is Coordinate; get a naming clarification rather than assuming
  a build gap.)

**One genuine, narrow gap: Delivery Date has no future-date restriction.** It's
already mandatory, just not bounded (contrast with the entry Date field, which
has `max={today()}`). Three small changes: `min` on the date input, a Zod
`superRefine` check, and a `sectionValidity` entry so a violation blocks Save
with a message pointing at the field. **Decision needed first:** is today itself
an allowed delivery date, or must it be strictly after today?

### §7.2 — Printing Workflow Differentiation

**Already built structurally**, just under no single "print type" enum:
- Fabric Print = Fabric BOM's process route, `is_print`-flagged stages whose
  `loss_pct` compounds into the fabric requirement chain.
- Component Print = Style ▸ Process's "Component Process" type, which carries no
  loss column and is explicitly never read by the BOM requirement calc.

The loss-isolation the spec actually cares about already holds; the only gap is
naming/vocabulary, not behavior.

### §7.3 — Yarn-Dyed Workflow Trigger

**Partially built.** The Yarn-Dyed flag, the yarn-dyeing loss stage, and the
compounding math (mathematically equivalent to "applied before Knitting" since
the `/(1-L)` factors commute) all exist and are already correct.

**Not built:** nothing automatically removes a Dyeing stage from a yarn-dyed
fabric's route, or auto-instantiates the yarn-dyeing requirement — today the
planner is trusted to simply not add a Dyeing row by hand. Extend
`processesForFabric()` (`lib/orders/fabric-bom/processes.ts`) with an
`isYarnDyed` param that withholds Dyeing-flagged processes from the offered
list — same idiom as its existing `printDeclared` gate — never deleting an
already-saved row.

---

## 3. Open questions — need an answer before scoping the affected work

1. **TBA scope**: does the client mean the existing Material BOM (trims) flow, or
   a genuinely new, parallel Fabric BOM fabric-line TBA mechanism?
2. **Rejection allowance 51–99 piece gap**: what tier applies?
3. **Delivery Date**: is same-day delivery allowed, or must it be strictly future?
4. **IWO number format**: FY segment as `2627` (matches existing SC No precedent)
   or literally `26-27` as the spec states?
5. **Force-closure "remaining qty"**: unshipped pieces, or unconsumed material?
6. **Is Decimal(18,4) a real requirement** for MRP weights, or spec boilerplate?
   (Current engine floors at 2dp app-wide.)
7. **Is tiered/"Solid Price" pricing actually wanted?** No analog exists; touches
   a hardened pricing engine.
8. **Commercial Invoice screen**: confirm this needs a full new module — nothing
   like it exists today — before scoping.
9. **TBA release workflow**: full `dynamic-approval-flow` registration, or two
   ad-hoc `checked_by`/`approved_by` columns?
10. **IWO stock transfer**: what does "de-link" look like on screen, and does
    `iwo_lines` need a real `item_id` FK?

## 4. Suggested build order (once the above are answered)

**Cheap, no-decision-blocked, do first:**
- Packing Advice Gross/Net Weight wire-up (columns already exist)
- Yarn-Dyed auto-skip-Dyeing-stage extension

**Cheap, one decision each:**
- Delivery Date future-date restriction (Q3)
- Rejection allowance tier seeding (Q2)
- IWO numbering fix (Q4)

**Medium, needs a data-model call:**
- Carton Dimensions + CBM
- Merchandiser TBA Dashboard (once Q1 is answered)
- TBA Checked-By/Approved-By workflow (Q9)

**Larger, needs real scoping before estimating:**
- Order Closure controls (Q5 + issuance-point identification)
- Packing Advice Size/Color breakdown grid + integrity check
- IWO stock hard-lock/transfer (Q10)
- Commercial Invoice screen (Q8)
- Tiered pricing (Q7)
