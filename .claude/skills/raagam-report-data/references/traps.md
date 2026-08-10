# Failure modes

Every item here is a real defect this codebase has shipped or was one edit away
from shipping. None are obvious from reading the code.

## The report returns zero rows and nothing looks wrong

**Symptom:** a report renders an empty table for a user who can clearly see the
stock screens.
**Cause:** something queried `stock_ledger` (or a view over it) directly. Its RLS
requires `stores:view` **AND** `can_access_store(store_id)`. RLS filters rows, it
does not raise — so a reports-only user gets a clean, empty, wrong answer.
**Fix:** go through a SECURITY DEFINER RPC. This is also why
`report_item_movements` and `report_item_dimensions` are `REVOKE`d from
`authenticated` — so nobody can accidentally read them from the client.

## Excel totals read as zero

**Symptom:** the on-screen table looks right; selecting the column in Excel shows
no sum.
**Cause:** a `ReportColumn.value()` returned `fmtMoney(...)` — a string. The
Shipment P&L report did exactly this before `format` existed.
**Fix:** `value()` returns the raw number, `format` handles display. Screen and
PDF apply `format`; Excel deliberately does not.

## Every period report is wrong after a back-dated document

**Symptom:** a GRN dated last month appears in this month's figures.
**Cause:** `stock_ledger` originally had only `created_at`, the posting instant.
**Fix:** `txn_date` and the `stamp_stock_movement_defaults()` trigger. The
trigger defaults it to `current_date`, which is right for an ad-hoc movement and
**wrong** for a document — so any posting path with a document date must pass it
explicitly. Historic rows were backfilled from `created_at::date`, which is a
proxy, not the truth.

## Numbers arrive as strings and silently concatenate

**Symptom:** a total renders as `"12""34"` or sorts alphabetically.
**Cause:** PostgREST returns Postgres `numeric` as a string to preserve
precision. `1 + "2"` is `"12"` in JS.
**Fix:** coerce in the service layer. `lib/reports/item-service.ts` and
`lib/analytics/service.ts` both do this on every measure.

## The balance is right today and wrong for any past date

**Symptom:** an opening balance for last quarter matches today's stock.
**Cause:** `stock_balances` is a *cached current* balance maintained by a
trigger. It has no history.
**Fix:** `report_item_stock_as_of(p_as_of)` replays the ledger. It is the only
correct way to get an opening figure.

## A posting fails with "Insufficient stock" from a report change

**Symptom:** editing reporting code breaks GRN posting.
**Cause:** `apply_stock_movement()` is an AFTER INSERT trigger that hard-blocks
any movement driving a balance negative. Anything inserted into `stock_ledger`
is subject to it, including backfills and test data.
**Fix:** never insert `issue`-direction rows to test reporting. Read the view.

## GRN accepted reads 0 while stock clearly went up

**Cause:** `grn_line_items` has no `item_id`; the material comes via
`po_line_item_id`. Lines without a PO link cannot be attributed and are dropped.
Every GRN line in the live DB currently has a null `po_line_item_id`.
**Fix:** none available in reporting — this needs `grn_line_items.item_id`.
Until then the report must *say so* on screen, which
`purchase-vs-receipt-report.tsx` does.

## Stock reconciles but the totals feel too low

**Cause:** production, despatch, packing, shipment and delivery challans never
post movements. Material consumed in production and finished goods dispatched
are both invisible to stock.
**Fix:** none in reporting. Declared as `status: "gap"` in `REPORT_SOURCES`.

## Consumption value is understated and nobody notices

**Cause:** `resolve_item_rate()` returned null — no PO, no yarn rate, no budget
rate — so `value` is null and contributes nothing to a sum, while `quantity`
contributes fully.
**Fix:** surface the count. The Item Movement Ledger shows "Without a rate" as a
KPI for exactly this reason. Never let a null rate quietly reduce a total.

## The nav and the reports grid disagree

**Cause:** they used to be two hand-edited literal arrays — one in
`app/(app)/reports/page.tsx`, one in `components/shell/nav.ts`.
**Fix:** both map over `lib/reports/catalog.ts`. Do not re-add a hard-coded nav
child.

## A `ReportConfig` built on the server throws at render

**Symptom:** "Functions cannot be passed directly to Client Components".
**Cause:** `ReportConfig` holds closures (`column.value`, chart accessors).
**Fix:** the server page passes the plain rows array; the `"use client"` wrapper
builds the config. `registry.ts` is closure-free precisely so it *can* cross.

## `union all` branch drops a column and the view still compiles

**Symptom:** a branch's values land in the wrong columns.
**Cause:** Postgres matches union branches positionally. Omitting one value in
one branch shifts everything after it, and it only errors if the types clash.
This happened while building 0352 (`posts_to_ledger` missing from the BOM
branch).
**Fix:** count the columns per branch against the first branch's alias list
before applying.

## Soft-delete filters miss rows

**Cause:** there are three flags by table vintage — `items.is_active`,
`categories.inactive`, `bins.blocked` — and no `deleted_at` anywhere.
**Fix:** check the actual column. Do not assume.

## Opening stock is double- or triple-counted

**Symptom:** an item's opening balance looks like a multiple of the real figure,
and the multiple equals the number of months in the period.
**Cause:** a balance belongs to an item × store, but `report_item_summary` rows
are item × store × **month**. Attaching the balance to every month's row makes
it count once per month as soon as anything sums those rows.
**Fix:** `getItemMovement()` attaches the balance to the earliest row of each
item × store and zeroes it on the rest, so plain summation stays correct.
Anything adding a new per-entity (rather than per-period) measure must do the
same.

## Grouping by a mixed-unit dimension produces a meaningless number

**Symptom:** a category total sums kilograms and metres.
**Cause:** rolling up past the item level discards the UOM.
**Fix:** `item-movement-report.tsx` keeps `stock_uom_code` in the grouping key
only for item-level groupings. For coarser axes, prefer the **value** measures,
which are unit-agnostic.
