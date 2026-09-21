# Fabric BOM T&A — Steps 6–11 · implementation plan

Spec: `doc/order/fabricbom tanda.md` (four modules). Written 2026-09-21 after
mapping the spec onto this repo. The spec is written against a generic ERP
(`orders`, `staff_users`, `order_fabric_bom_items`, `vendors`,
`fabric_process_stages`); several literal instructions would break here, so
this says what is built instead and why. Sibling of the trims plan
(`doc/order/materialbomtana-plan.md`, steps 12–17) and built the same way on
purpose — two trackers with two architectures would be two things to learn.

## 1. The four modules, and where each one stands

| Module | Spec | Status |
|---|---|---|
| 1 | Pre-production office milestones (6) | **Already built** — 0607, `doc/order/orderentry-workflow-plan.md` (parallel session). Not touched here. |
| 2 | Fabric T&A steps 6–11 | **Built by this plan.** |
| 3 | Colour-wise process loss | **Already built** — 0606 (2026-09-21), `lib/orders/fabric-bom/color-loss.ts`. Its "Weighted 4.54%" is the markup; the consistent figure 4.34% is printed (user confirmed). |
| 4 | Entry Register arithmetic | **Checked, not changed** — see §5. |

## 2. What Steps 6–11 ask for

| # | Step | Subject | Document here | Required qty |
|---|---|---|---|---|
| 6 | Yarn purchase orders | yarn | PO lines (`po_line_items.sales_order_id` + yarn item) | the yarn's stored `purchase_qty` on the current Fabric BOM |
| 7 | Yarn purchase receipts | yarn | posted GRN lines of those PO lines (accepted qty) | same |
| 8 | Knitting delivery | yarn | Process **Issue** lines of the yarn, on a `knitting` Process Order for the order | same |
| 9 | Knitting receipts | fabric | Process **Receipt** lines of the fabric, on a `knitting` Process Order | greige weight (the knitting stage's output) |
| 10 | Fabric process delivery | fabric | Process **Issue** lines of the fabric, on a non-knitting Process Order (dyeing, washing, finishing, printing…) | greige weight |
| 11 | Fabric process receipts | fabric | Process **Receipt** lines of the fabric, on a non-knitting Process Order | finished weight (Σ requirement `required_qty`, the cutting allocation) |

Done = settled quantity ≥ required × (1 − tolerance). The actual date is the
date of the document that crossed the threshold (spec §2.2 "Step 11 automatically
flags COMPLETED" — applied to every step, as the trims tracker does).

## 3. Decisions

1. **The documents are the Stores Process Orders, not Delivery Challans.**
   `process_orders.process_type` already says knitting / dyeing / washing /
   finishing / printing, and its Issues (material out) and Receipts (material in,
   with QC accept/reject) are exactly "DC to the knitter" and "greige rolls back".
   A Delivery Challan return records the SAME item coming back; knitting sends
   yarn and receives cloth, which only the process documents can express.
2. **Process Orders gain `sales_order_id`** (0609, nullable), set from an "Order
   (RE No)" select on the New Process Order form — the same link 0424 gave PO
   lines and the same control the PO form uses. A process order raised with no
   order still works exactly as before; it simply feeds no tracker.
3. **Grain: (order, yarn) for 6–8, (order, fabric) for 9–11.** Never a BOM line:
   the Fabric BOM deletes and reinserts its rows on every save. The spec's
   greige consolidation rule ("all colourways sharing a yarn merge into one
   knitting lot") is this grain.
4. **Derived on read, never stored.** Status, quantities, OVERDUE and actual
   dates come from the documents every time. The spec's
   `order_fabric_process_transactions` would be a second copy of the PO / GRN /
   process tables. The only stored input is what a person decides:
   `order_fabric_ta_marks` (tolerance 0–10 %, a manual done date, remarks, owner).
5. **Required quantities come from the Yarn & Fabric Requirement report's own
   computation** (`yarnFabricRequirementReport`) — yarn purchase, the knitting
   stage's output per fabric, and the Rule 2 cloth purchases — so the tracker
   can never disagree with the printed report. Finished weight is the stored
   requirement (kg). A refused slice withholds the figure (no auto-complete on a
   partial sum); the manual done date still works.
6. **Where the cloth comes from (0564) bypasses steps:**
   greige purchase → 6, 7, 8 bypassed and step 9 is judged by fabric GRNs;
   dyed purchase → 6–10 bypassed and step 11 is judged by fabric GRNs.
   A route with no step after knitting → 10 and 11 bypassed; step 9 is then the
   cutting gate.
7. **Targets: the order's own T&A tab wins, then back-scheduling.** Step 11 =
   DYEING's date on the order's T&A tab, else **Cutting start − 1 working day**
   (spec §2.2). Step 9 = KNITTING's date, step 7 = YARN PURCHASE's date, where
   the order has those rows. Otherwise each step is back-scheduled from the next
   in working days (Sunday off — the house rule for every T&A date): process
   7 days, greige dispatch 1, knitting 5, yarn issue 1, yarn lead 7. These are
   named constants in the engine and printed beside each target as "(default)".
8. **PO settled** = approved / partially received / received / closed (the
   trims rule). Drafts and pending approval move a step to In progress only.
   Issues count once `issued`; receipts once `posted`, at their ACCEPTED qty.
9. **Units:** every figure is kilograms — the Fabric BOM's requirement is always
   kg (0562) and yarn/fabric are bought by weight.

## 4. Build

- **0609**: `order_fabric_ta_marks` (+ RLS orders:view / orders:edit, anon
  revoked) and `process_orders.sales_order_id`.
- `lib/orders/fabric-ta/engine.ts` — pure; steps, targets, bypass, completion.
  Reuses `thresholdOf` / `crossingDate` from the trims engine (one rule).
- `lib/orders/fabric-ta/service.ts` — batched loads, every error checked.
- `lib/orders/fabric-ta/actions.ts` — `saveFabricTaMark`.
- **Orders ▸ Fabric BOM ▸ T&A tab** (`components/orders/fabric-ta/fabric-ta-tab.tsx`),
  after Fabric Process. It was first a sidebar row of its own (`/orders/fabric-ta`
  + `/[orderId]`); the client moved it into the Fabric BOM the same day
  (2026-09-21). Both old URLs now `redirect()` to `/orders/fabric-bom`. The tab
  fetches its own data (`loadFabricTaForGarmentOrder`), and tracks the order's
  CURRENT recorded BOM — it says so when the BOM open in the editor is a draft or
  an older revision. The cross-order queue went with the sidebar row.
- Stores ▸ New Process Order: Order (RE No) select.
- `scripts/check-fabric-ta.mts` (`npm run check:fabric-ta`), each rule made to
  fail first.

## 5. Module 4 (Entry Register) — checked against the engine, not changed

- **Compounded loss.** The spec writes `(1+L₁)(1+L₂)(1+L₃) − 1` but its own
  worked figure, 9.60 % for 2 % + 5 % + 2 %, is what `1 / ((1−L₁)(1−L₂)(1−L₃)) − 1`
  gives (the product form gives 9.24 %). The engine has used the division form
  since 2026-09-11, checked against the legacy PDF — it produces the spec's 9.60 %.
- **Its gross figure 2.609** does not follow from its own numbers under either
  form (2.375 × 1.0960 = 2.603). Not adopted.
- **Net Req Wt `/(1 − wastage)`** contradicts the stored rule `× (1 + wastage)`
  (0426, verified on every live row). Changing it moves every stored requirement
  and needs a client decision, not an inference from a spec whose worked example
  has no wastage in it.
- **"Formula injection" (× (1+L) on the order screen, ÷ (1−L) on IWO)** reverses
  the 2026-09-11 decision that unified both on ÷ (1−L). Not adopted without a
  fresh client call naming it.
