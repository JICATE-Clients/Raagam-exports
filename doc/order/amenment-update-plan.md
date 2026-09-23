# amenment update.md — implementation plan (2026-09-23)

Source: `doc/order/amenment update.md`. Builds ON the register / scoped unlock /
variance / MD gate of 0604 · 0616–0618 (`amendment-plan.md`) — nothing there is
rebuilt. This file maps every line of the new spec to where it is met.

## What the new spec changes

| Spec | Built before (09-22) | Remainder built here |
|---|---|---|
| §1 register lists only orders with `amendment_no >= 1` | register also listed every amendable order with "nothing raised yet" | drop never-amended orders from the register |
| §1 `[+ Raise Amendment]` opens an **Order Picker Modal** | the button went straight to `/new` (a page, user 09-22) | the button opens a picker modal; picking lands on the page pre-picked (the page stays — user's own decision) |
| §2 **Module Category** multi-select: Order Entry · Material BOM · Fabric BOM · Order Budget | six *change* categories, which opened both BOMs whenever quantities/combos moved, and never touched the budget | the four MODULES are the primary choice; the change kinds survive as Order Entry's detail ("PO Qty, Delivery Date, FOB Price, Color Combos") |
| §2 rule 1 "unlock ONLY the selected modules" | a quantity change opened both BOMs whole; the budget was fully editable | BOM authored tables open only when that module is ticked; the budget's own heads (Expense / Income / CMT, and a rate already approved) only when Order Budget is ticked — enforced in SQL for the BOMs, in the budget action + screen for the budget |
| §2 rule 2 per-module validation | freshness gate (no stale BOM at submit) | Order Entry → style-qty = quantities re-verified at submit; Fabric BOM → the Fabric BOM must have been recalculated (saved) after the entry opened; Order Budget → the margin delta vs baseline is recalculated and stored on the entry at submit |
| §3.1 automatic recalculation | stale-and-gate: "open it and save again" | a BOM that is NOT ticked is still recalculated — its DERIVED rows only (requirements, yarn purchase / process weights, header basis) — automatically after every Order Entry save and on demand; the scope opens exactly those derived tables/columns for the untouched BOM |
| §3.2 Manual Entry Needed banner + amber/red cell + one-click jump | budget's "N rates missing / Next missing" (inside the budget only) | one list of gaps (unrated budget lines, BOM recalculation refusals, colourways with no fabric plan) in the spec's wording, on the entry page and the budget, each with a deep link that lands on the exact cell (`?open=<budget>&line=<key>&field=rate`) |
| §4A DRAFT / PENDING_MD_APPROVAL / APPROVED / REJECTED | Draft / Pending approval / Rejected-while-open / Approved / Abandoned / Superseded | the four spec states; REJECTED is now a CLOSED outcome |
| §4A REJECTED → "order reverts to previous approved baseline (V_previous)" | deliberately NOT built (reject left the entry open) | `order_amendment_revert`: the order, both BOMs and the budget are restored from the V0 snapshots in one transaction, run by the approval's own terminal trigger; failure degrades to the old behaviour and is recorded, never loses the reject |
| §4B operational reports read V_final | reports read live rows | at raise, every per-order report is rendered by its OWN loader and frozen as V_final; while the order is amending every report route and sheet serves the frozen copy, with a banner and a "show proposed" switch |
| UX: status badges `Waiting Amendment` / `Pending MD Approval` | none on the order list | a pill on the order list and in the PO / process-order refusals |

## Decisions (made, with the reason)

1. **Modules are derived from the kinds, not a second column.** Each kind belongs to
   one module (`qty_*`, `price_change`, `delivery_date_ext`, `combo_colour_change` →
   Order Entry; new `fabric_bom_revision`, `material_bom_revision`,
   `budget_revision`). One array on the entry answers both "which modules" and
   "which kinds", so they cannot disagree. Legacy `bom_revision` = both BOMs.
2. **Derived-only recalculation, not an unlock.** Rewriting an untouched BOM's
   authored rows (its save is delete-and-reinsert) would need the lock lifted;
   rewriting only derived rows needs a scope that opens only derived rows — a
   static allowlist, still enforced by the trigger.
3. **Reject reverts; Abandon reverts too.** Once a restore exists, "abandon with
   changes leaves the RE open" (0616) was a workaround for its absence. Abandon now
   discards the changes and re-locks V_n.
4. **V_final is the report's own output, frozen** — not the loaders re-pointed at
   snapshot rows (they use nested PostgREST embeds; an emulator would be a second
   query engine). Same loader, same figures, captured at the one moment the live
   rows ARE the approved version.
5. **Existing open entry AMD/26-27/0002** keeps its frozen scope (both BOMs open)
   and has no budget snapshot or frozen reports: its reject falls back to the old
   behaviour, and its reports show live data with a banner saying so.

## Not built, and why

- **Cutting Job Card / Material Procurement List** do not exist as reports. The
  V_final rule is generic over `ORDER_REPORTS`, so either inherits it the day it
  is registered (`check:order-reports` requires the capture).

## Status — built 2026-09-23

| Spec line | Where it is met | Verified by |
|---|---|---|
| §1 register = amended orders only | `register-screen.tsx` (`lines` drops orders with no entry) | — |
| §1 Raise → Order Picker Modal | `register-screen.tsx` (`Sheet size="sm"` + `DataPicker` → `/new?order=`) | — |
| §2 four Module Categories, Order Entry's detail | `raise-amendment-screen.tsx`, `AMENDMENT_MODULES`, `kindsForSelection`, `raiseAmendmentInput` | tsc |
| §2 rule 1 unlock only picked modules (BOMs) | 0619 seed re-cut; `BOM_DERIVED_SCOPE`; trigger | 0619 `$verify$` steps 1–3; `check:amendment-scope` 3b (made to fail first) |
| §2 rule 1 unlock only picked modules (budget) | `lib/orders/budget/amendment-scope.ts` → screen (`rateLock`, `LockScope`) + `updateOrderBudget` / `submitBudget` | 0619 `$verify$` step 4 (marker) |
| §2 rule 2 Order Entry → style qty re-verified | `amendmentSubmitProblem` (`submit-gate.ts`) at submit | — |
| §2 rule 2 Fabric BOM → recalculated before submit | `amendmentSubmitProblem` (computed_at ≥ entry opened) | — |
| §2 rule 2 Order Budget → margin delta vs baseline | `submitBudget` → `order_amendment_record_submission` (`amended_kpis`) + run context | — |
| §3.1 automatic recalculation | `recalculateFabricBomDerived` / `recalculateMaterialBomDerived`, run by Order Entry's save (`recalculateDownstream`) and the entry page's Recalculate | dry run = stored rows on every fresh live BOM (2 fabric, 2 material) |
| §3.1 budget cards recompute live | already built (`budgetFigures` per render) | — |
| §3.2 Manual Entry Needed + amber cell + jump | `manual-entry.ts`; budget screen banner + `data-manual-entry` amber rate cell + `?budget=&line=&field=`; entry page banner (budget gaps + BOM refusals) | tsc |
| §4A DRAFT / PENDING_MD_APPROVAL / APPROVED / REJECTED | `entryStatusOf` / `entryStatusLabel`, register + entry page | — |
| §4A REJECTED → revert to V_previous | `order_amendment_revert` in `approval_apply_terminal`; Abandon too | 0619 `$verify$` step 5–6 (negative probe fails without the revert); a real reject through `approval_runs` (rolled back) |
| §4B operational reports read V_final | `captureVFinal` at raise; `vFinalFor` on `/gos`, `/requirement`, `/fabric-requirement`, `/reports/[report]`, both editor sheets | `check:order-reports` 3b (made to fail first) |
| UX badges Waiting Amendment / Pending MD Approval | order list RE Status; PO refusal (`refuseReopenedBudget`) | — |
| GRN UX section | 0620 + `purchase/grn/*` | 0620 `$verify$` (7 rolled-back probes) |
| T&A UX section | T&A section of `garment-order-screen.tsx`, `work-flow-panel.tsx` | `check:hooks` |

Open for the client: the Store Keeper role lacks `materials_purchase:create`
(0615 left it out on purpose), so a store keeper cannot yet reach the GRN screen.
