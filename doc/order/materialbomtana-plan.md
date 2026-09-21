# Material BOM (Trims) T&A — Steps 12–17 · implementation plan

Spec: `doc/order/materialbomtana.md`. Written 2026-09-21 after mapping the spec
onto this repo. The spec was written against a generic ERP (`orders`,
`staff_users`, `order_material_bom_items`, `vendors`); several of its literal
instructions would break here, so this plan says what is built instead and why.

## 1. What the spec asks for (the outcome, not the DDL)

For every sewing or packing trim on an order's Material BOM, a six-step store
schedule:

| # | Step | Document | Target | Done when |
|---|------|----------|--------|-----------|
| 12 | Sewing trims PO | PO | in-house − vendor lead time | PO qty ≥ required × (1 − tol) |
| 13 | Sewing trims GRN | GRN | **Cutting start − 1** | received ≥ required × (1 − tol) |
| 14 | Sewing process DC | DC out | in-house | sent ≥ required × (1 − tol) — **only if the trim needs job-work** |
| 15 | Sewing process GRN | DC return | in-house | returned ≥ required × (1 − tol) — same condition |
| 16 | Packing trims PO | PO | in-house − vendor lead time | as 12 |
| 17 | Packing trims GRN | GRN | **Packing start − 1** | as 13 |

Steps 14/15 are **BYPASSED** (shown greyed, kept out of the work queue) when the
trim needs no processing. Completion stamps an actual date automatically.
QA-MAT-01…03 are the acceptance tests.

## 2. What already exists (mapped 2026-09-21)

- **Material BOM**: `material_bom_amendments` → `material_bom_amendment_items`
  (lines) → `material_bom_amendment_requirements` (stored per-slice requirement).
  The BOM that answers for an order = newest *recorded* (`is_draft = false`)
  amendment across the order's garment-order documents.
- **Sewing vs packing** is already mandatory data: the material's item class,
  `config_lookups(kind='item_class')` code `SEW` / `PACK`.
- **Job-work**: line flag `send_out` (0466) + BOM process rows
  `material_bom_amendment_processes`; DCs raised from the BOM
  (`createDcFromBom`) carry `dc_line_items.mba_amendment_id`; returns go through
  `recordDcReturn`, which bumps `returned_qty` and **records no date**.
- **PO / GRN**: `po_line_items.sales_order_id + item_id` (0424) is the only link
  from purchasing to an order; GRN lines hang off PO lines; `postGrn` posts.
- **The required quantity** the PO gate already caps against: the BOM's Final
  Quantity per material (MOQ + Round-To applied per trim colour, then summed) in
  `bomCeilingForOrder`.
- **Order T&A ladder** already has the two in-house milestones (0561):
  `SEWTRIM` dated N working days before `CUT` start, `PACKTRIM` before `PACK`
  (N defaults to 2, editable per order).
- **Nothing** for steps 6–17 exists; 0607 (other session) built the six office
  milestones only. No tolerance column and no item lead time exist anywhere.

## 3. Decisions (user may adjust)

1. **One schedule per (order, material), not per BOM line.** The spec's
   `material_bom_item_id … ON DELETE CASCADE` would erase the schedule on every
   BOM save: the BOM editor deletes and reinserts its lines, so line ids change
   each time. And a PO/GRN line names only order + material, so receipts cannot
   be split between two BOM lines of the same thread anyway. This is also the
   PO ceiling's grain.
2. **Derived on read, not stored.** Targets, quantities, status, OVERDUE and the
   actual date are computed from the real documents (PO, GRN, DC) every time the
   screen opens. The spec's `order_material_store_ledger` would be a second copy
   of documents this ERP already holds, and a copy drifts. OVERDUE is derived,
   the same rule 0607 uses.
   **The actual date is the date of the document that crossed the threshold**
   (the GRN date, not "the day a job noticed"). It is the more truthful stamp,
   and it survives a late-posted GRN.
3. **Trim class is read from the material's item class** (SEW / PACK); no new
   enum. A line whose material is neither is not a trim and is skipped.
4. **Needs job-work** = any live BOM line of that material has *Send Out*
   ticked, or the BOM has a process row for it. Packing trims never get 14/15
   (spec §5 code: `isSewing && isProcess`).
5. **In-house target reads the order's own T&A tab.** The order already shows
   "SEWING TRIMS INWARD" / "PACKING TRIMS INWARD"; a second rule for the same
   date would disagree with it. Fallback where an order has no trim row:
   CUT/PACK start − 1 working day, which is the spec's rule. To make new orders
   match the spec's "−1", the migration moves SEWTRIM/PACKTRIM's default Days
   from 2 to 1 (only where still at the seeded 2). **Existing orders keep their
   saved Days.**
6. **Working days everywhere** (Sunday off), the house rule for every T&A
   date. The spec's `subDays` is calendar days.
7. **Lead time** = the trim vendor's `lead_days` for that category on the
   Vendor master (largest across the material's lines), else **7** (the spec's
   default). Today no vendor has one set, so 7 is what runs.
8. **Tolerance** defaults to **0 %** (complete only when fully received), and
   can be set per step, 0–10 %, on the tracker.
9. **PO "issued"** = approved / partially received / received / closed. Draft
   and pending-approval count as *In progress*, not done. Cancelled POs count
   for nothing.
10. **Free-issue trims** (every line of the material is Supply Type = Free
    Issue) → the PO step is BYPASSED: the buyer supplies them.
11. **A manual "Done on" date** per step covers what the system cannot see (a
    PO raised outside the ERP, a free-issue receipt with no GRN). It wins over
    the derived status, and the tracker says it was manual.

## 4. Build

**Migration 0608** (number re-checked against the ledger before applying):
- `order_trim_ta_marks`: (sales_order_id, item_id, step_code) unique;
  `tolerance_pct` 0–10, `assigned_staff_id` → employees, `done_on`, `remarks`,
  created/updated audit. RLS read `orders:view`, write `orders:edit`.
- `dc_line_items.returned_on date`, stamped by a trigger whenever
  `returned_qty` rises (catches every writer), so step 15 has a real date.
- SEWTRIM / PACKTRIM `default_offset_days` 2 → 1 (decision 5).

**Code**
- `lib/orders/trim-ta/engine.ts`: pure, client-safe. `trimSchedule(input)`
  produces the steps for one material; step vocabulary, threshold and status
  live here and nowhere else.
- `lib/purchase/bom-ceiling-service.ts`: the Final Quantity rollup is extracted
  as `finalQuantityByItem` and reused. One rule, two readers.
- `lib/orders/trim-ta/service.ts`: batched loads for every order with a
  recorded BOM (or one order), feeding the engine; every query checks `error`.
- `lib/orders/trim-ta/actions.ts`: `saveTrimTaMark` (tolerance, done-on,
  remarks, assign-to-me / release).
- **Material BOM ▸ Trims T&A** — a section (tab) of the Material BOM editor,
  NOT a screen of its own (client 2026-09-21: "not a separate child — move it
  inside Material BOM as a tab"). A first cut shipped it as
  `/orders/trims-ta` + a sidebar row the same day; both were removed before
  release. It shows the order's in-house dates (sewing / packing), then every
  material × its steps, bypassed steps greyed. Each step opens a small sheet
  to set tolerance, a manual done date, remarks, or to assign it to yourself.
  It reads the RECORDED BOM (the one the PO gate uses), so grid edits appear
  after Save; its own edits save immediately and never mark the BOM dirty.
  Loaded through `loadTrimTaForGarmentOrder` (`lib/orders/trim-ta/actions.ts`).
- `scripts/check-trim-ta.mts` (`npm run check:trim-ta`): QA-MAT-01…03 plus
  tolerance, overdue, fallback, free-issue, manual and crossing-date vectors,
  each shown failing against a mutation first.

## 5. Not in scope (named, not forgotten)

- Auto-ticking the order ladder's SEWTRIM/PACKTRIM rows when every trim is in.
  That table is saved by delete-and-reinsert, and a trigger stamp would race
  the save (0607's header explains why).
- Fabric steps 6–11 (`doc/order/fabricbom tanda.md`); the other session's
  lane.
- Push alerts for overdue trims (0607 has a sweep; one can be added later).
