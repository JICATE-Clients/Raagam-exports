---
name: raagam-report-data
description: "Raagam ERP's item reporting contract — every material report is a slice of ONE fact source (report_item_movements), never bespoke SQL, and every new child sub-module must register its fields so purchased / received / consumed / returned / closing stock stay answerable per item, item class, category, sub-category and material attribute. This skill should be used when building or changing anything under app/(app)/reports, when touching lib/reports/* (registry.ts, columns.ts, rollup.ts, item-service.ts, catalog.ts), when writing a migration that adds a table carrying an item_id + a quantity, when a new master/transaction child is built and its data must reach reports, and whenever a report shows wrong totals, blank values, un-summable Excel columns, or a 'forbidden' error. Triggers on: \"add a report\", \"report fields\", \"consumption report\", \"purchase report\", \"stock as of\", \"group by category/attribute\", \"register the child in reports\", \"ReportConfig\", \"report_item_summary\"."
---

# Raagam item reporting contract

An ERP is judged on whether its numbers reconcile. Every material figure this
system shows — purchased, received, rejected, consumed, returned, transferred,
closing stock, and the value of each — has to come from the same place, or two
screens will disagree and neither will be trusted.

That place is **`report_item_movements`** (migration 0352). Everything else in
reporting is a projection of it.

## The one rule that governs everything

**Never write per-report SQL against transaction tables.** A new item report
selects dimensions and measures from `lib/reports/registry.ts` and calls an
existing RPC. If the number you need genuinely is not in the fact model, you
extend the fact model — you do not add a second source of truth.

The reason is not tidiness. `stock_ledger` RLS demands
`stores:view AND can_access_store()`, which a reports-only user does not have,
so any direct query silently returns **zero rows** rather than an error. The
SECURITY DEFINER RPCs are the only door in.

## The pipeline

```
stock_ledger (txn_date, uom_id, rate, value, location_id)  ┐
po_line_items · grn_line_items · MRS · opening · returns   ├─► report_item_movements
csp · BOM amendments · delivery challans                   ┘   + report_item_dimensions
                                    │
                report_item_summary · report_item_ledger · report_item_stock_as_of
                                    │  (SECURITY DEFINER, gated on reports:view)
                            lib/reports/item-service.ts   ("server-only")
                                    │  plain rows across the RSC boundary
                    registry.ts ──► columnsFromFields() ──► ReportConfig ──► <ReportView>
                   (no closures)      (client only)          (closures)
```

## The contract

| Concern | Rule |
|---|---|
| Source of truth | `report_item_movements`. One row per movement, every source. |
| Grain | `report_item_summary` returns item × store × month. Never coarser in SQL. |
| Grouping | Rolled up in TS by `rollup.ts`. There is **no** dynamic `group by` in SQL. |
| Balances | `report_item_stock_as_of` only. `stock_balances` holds *today* and nothing else. |
| Dates | `txn_date` (the document's date). **Never** `created_at` — that is the posting instant. |
| Value | `rate`/`value` on the movement, stamped at post time or resolved by `resolve_item_rate()`. |
| Permission | `reports:view` on the page **and** inside every RPC. |
| Field list | `lib/reports/registry.ts`. Columns are derived from it, never hand-listed. |

## Before writing any report code

1. **Read `references/fact-model.md`.** It lists every `fact_kind`, which
   sources post to the ledger and which are document-only, and the blind spots.
   Reporting an off-book source as if it moved stock is the easiest way to
   produce a number that cannot be reconciled.
2. **Check the measure already exists.** `ITEM_MEASURES` covers ordered,
   opening, received, GRN accepted/rejected, consumed, returned, transfers,
   adjustments, planned, processor in/out, closing, and the value of each.
3. **Check `references/traps.md`.** Every entry there shipped as a real defect.

## Adding a report

1. **`lib/reports/catalog.ts`** — add a `ReportDefinition`. The `/reports` grid
   *and* the nav both map over it, so one edit registers both. Do not hand-add
   nav children; that is what used to drift.
2. **`app/(app)/reports/<slug>/page.tsx`** — Server Component:
   `await requirePermission("reports", "view")`, `readItemFilters(params, …)`,
   call `lib/reports/item-service.ts`, render `<PageHeader>` + `<Stat>` KPIs +
   `<ItemReportFilters>`, then pass **only the plain rows array** to the client
   wrapper.
3. **`app/(app)/reports/<slug>/<slug>-report.tsx`** — `"use client"`. Build the
   `ReportConfig` with `columnsFromFields(...)` and render `<ReportView>`.
4. **Attach the caveats.** If a measure on screen has a `caveat` in the
   registry, render it under the table. A number without its provenance is
   worse than no number — see the GRN note in `purchase-vs-receipt-report.tsx`.
5. **Verify** the table, chart, PDF, Excel and Print agree, and that Excel's
   numeric columns actually SUM.

## Adding a child sub-module — the standing rule

This is step 8 of the child build recipe in `raagam-masters-picker-wiring`, and
it is not optional. A child that records material movement but never reaches
reporting is invisible: the stock reconciles wrongly and nobody finds out.

1. If the new table carries an item FK **and** a quantity, add a `ReportSource`
   to `REPORT_SOURCES` in `lib/reports/registry.ts`.
2. Set `status` honestly — `wired` (feeds the fact view), `off_book` (reported
   but posts no stock movement), or `gap` (cannot be reported yet, with a `note`
   saying why). **Declaring a gap is correct; omitting the table is not.**
3. If `wired`, add the branch to the `report_item_movements` union in a new
   migration, and add any new `ReportField`s to `ITEM_DIMENSIONS` /
   `ITEM_MEASURES`.
4. If the child posts to `stock_ledger`, pass the document's own date as
   `txn_date` (and a `rate` when the document knows the price).
5. Run the audit below.

Material **attributes** need none of this: they are read live from
`attribute_values` and returned as the `attributes` jsonb on every fact row, so
a new attribute becomes a groupable dimension with no code change at all.

## Auditing a change

```bash
python .claude/skills/raagam-report-data/scripts/audit_reports.py .
```

It sweeps the migrations for tables carrying an item FK + a quantity column and
flags any that `REPORT_SOURCES` does not mention. Findings are heuristics to
inspect, not verdicts — a lookup table with a `quantity` column is not
necessarily a movement source.

## Verifying reporting work

Each of these has caught a real defect:

1. **Reconcile against the raw ledger.** Sum `qty_in`/`qty_out` from the fact
   view over all time and compare with `sum(quantity)` grouped by
   `movement_type` on `stock_ledger`. They must match exactly.
2. **Check the balance identity.** `opening + in − out = closing` per item and
   store, using `report_item_stock_as_of` at both ends of the period.
3. **Call the RPCs with no session.** They must raise `forbidden` (42501), not
   return rows. Running them through the Supabase MCP does exactly this.
4. **Back-date a document.** Post a GRN with a `grn_date` in a past month and
   confirm it lands in that month, not the current one.
5. **Open the Excel export and select a numeric column.** If the status bar
   shows no sum, a `value()` returned a formatted string.
