# Order close-out and the Surplus Ledger

**Status: SPEC ONLY. Nothing here is built, and one thing has to be decided
before any of it can be.**

Client, recording of 2026-08-25, on the two terminal states of a garment order:

> **Cancellation** — if an order is cancelled mid-run the system flags the RE
> Number, immediately stops all downline processing, and excludes the order from
> active production reports.
>
> **Completion** — once an order ships, marking it "Completed" triggers a stores
> close-out routine. It identifies any remaining raw yarn, fabric roll KGs or
> accessory lots in the bins — often over-purchased because of MOQ roundups —
> automatically releases these leftovers from the RE Number, and moves them to
> the factory's general **Surplus Ledger** so they can be re-allocated to other
> active orders.

The cancellation half is being built (see "What shipped alongside this"). The
completion half is written down here rather than built, because of one fact.

---

## THE BLOCKER: stock is not tagged to an order

`stock_ledger` (`0010_stores.sql:34-50`) and `stock_balances` (PK
`(store_id, item_id)`) carry **no `sales_order_id`**. `stock_balances` is keyed on
store and item and nothing else.

So the question the routine has to ask first — *"what is still in the bin for
RE No HO/RE/26-27/0001?"* — **is not a question this schema can answer.** Not
slowly, not approximately: no column distinguishes a kilo bought for one order
from a kilo bought for another once both are in the same bin.

`stock_ledger` does carry an untyped polymorphic pair:

```sql
  reference_type      text,   -- e.g. grn, sales_order, audit
  reference_id        uuid,
```

**The comment names `sales_order` and no call site has ever written it.** Every
actual writer — `lib/stores/extras-actions.ts:136,271,368,394,497`,
`lib/stores/process-actions.ts:189,334`, `lib/purchase/grn-actions.ts:395`,
`lib/finance/pnl-actions.ts:116`, `lib/hr/payroll-actions.ts:388` — writes
`opening_stock`, `material_requisition`, `vendor_return`, `csp_receipt`,
`process_order`, `grn`, `po_rollup` or `payroll_run`. The pair is also un-indexed
and is not a foreign key, so it is a note, not a link.

**The one order-to-material link that does exist stops one level above stock.**
`po_line_items.sales_order_id` (`0424:58-64`) and
`purchase_indent_lines.sales_order_id` (`0035:14`) record which order a purchase
was *for*. The moment the GRN posts, that link is dropped and the quantity lands
in an anonymous `(store_id, item_id)` bucket.

### Two smaller blockers behind it

- **No lot / roll / batch identity anywhere.** `grep -E "roll_no|lot_no|batch_no"`
  over `supabase/migrations/` returns **zero hits**. The words appear only inside
  material names (`BAND ROLL`, `BLACK HM ROLL`) and process names
  (`BATCH ATTACH`). Stock is a quantity per item per store. The client's phrasing
  — "fabric roll KGs, accessory lots" — describes things this database cannot
  name individually.
- **`bins` is a master that nothing references.** The table exists
  (`0308_new_master_tables.sql:174`) and **`bin_id` appears in zero other tables
  and zero lines of code.** "Still in the bins" is not expressible today.

---

## What it CAN be built on

Everything below exists, is applied, and is sound. This is not a green-field
build; it is one missing dimension away from being a short one.

| # | Asset | Where | Why it matters |
|---|---|---|---|
| 1 | `order_completions` | `0123_orders_completions.sql:9-20` | The trigger point already exists — an operator already records a completion, with a date and a `GCM-nnnn` code |
| 2 | `apply_stock_movement` | `0010_stores.sql:62-89` | Append-only ledger with balance maintenance and a negative-stock block. Release must be a pair of movements, never an UPDATE |
| 3 | `transfer_out` / `transfer_in` + `counterparty_store_id` | `0010_stores.sql:38-42` | The mechanical move to Surplus needs **no new movement type** |
| 4 | **A seeded Surplus Store** | `0010_stores.sql:182` — `('ST-SUR','Surplus Store','surplus')` | The destination bucket physically exists already |
| 5 | `po_line_items.sales_order_id` | `0424:58-64` | Lets purchased-for-this-order be *reconstructed* even with no stock dimension |
| 6 | `resolve_item_rate()` | `0351_report_ledger_enrichment.sql:46` | Values the released surplus without inventing a costing rule |
| 7 | BOM requirement tables | `0418`, `0426` | The planned side of "issued vs required", which is what makes a leftover a leftover |

---

## What it would cost

Adding `sales_order_id` to `stock_ledger` is the easy half. The expensive half is
that **`stock_balances` has to be re-keyed** from `(store_id, item_id)` to
`(store_id, item_id, sales_order_id)`, and `apply_stock_movement` rewritten to
maintain it — which touches **every stock writer in the application**.

That number is stated here so the client chooses with the price visible, rather
than discovering it after a "just add a trigger" estimate.

**A cheaper shape exists and should be costed against it.** Leave stock anonymous
and make the surplus figure **derived** — purchased-for-order (from
`po_line_items.sales_order_id`) minus issued-to-order — recorded as a document at
completion rather than as a live balance. It answers the client's actual sentence
without re-keying anything, and it is wrong only if two orders' stock is
physically commingled *and* separately tracked, which today it is not.

---

## Open questions for the client

1. **Is the Surplus Ledger a table or a view?** A real document, or simply
   "balances in store `ST-SUR`"? The word "ledger" suggests the first; the
   existing Surplus Store row suggests the second.
2. **Is release per-lot or per-quantity?** Per-lot needs a lot table that does not
   exist. Per-quantity is buildable today.
3. **Does re-allocation need its own document?** "Re-allocated to other active
   orders" is an action someone performs; it has no table, no action and no
   screen. Note `0332` **dropped** the only two allocation tables this repo ever
   had (`process_allocations`, `sq_allocations`).
4. **Does a CANCELLED order release its stock too?** The client described release
   only under Completion. A cancelled order's material is at least as stranded —
   but releasing it automatically presumes the cancellation is final.
5. **What happens to material still out at a process** under a delivery challan
   when the order completes? It is neither in a bin nor consumed.

---

## A cautionary precedent, on purpose

`0363_po_completions.sql` builds **PO Completions**, labelled in the nav as
*"Close out a completed purchase order"* (`module-groups.ts:866`). It is
`po_completions` + `po_completion_items` and **it has no stock effect whatsoever**
— a close-out document that closes nothing out.

That is the shape to avoid here. A completion routine that records an intention
and moves no stock will read as built, satisfy a demo, and leave the bins exactly
as full as they were.

---

## What shipped alongside this

The cancellation half needs no schema change:

- a single `assertOrderOpen()` guard called from the downline write actions, since
  **no action anywhere read the parent order's status before creating work**;
- the order pickers that still offered cancelled orders (the purchase-indent one
  filtered nothing at all);
- the **"Completed" vs `closed`** vocabulary split — the column keeps `closed`,
  every operator-facing string says Completed.

**Reports are NOT covered and cannot be.** `lib/reports/registry.ts` is item- and
stock-dimensioned; there is no sales-order dimension, so "exclude the order from
active production reports" has nothing to attach to. That is a report-engine
change, not a filter.
