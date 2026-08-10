# The item fact model in detail

`report_item_movements` (migration 0352) is a `union all` view. One row = one
thing that happened to a material. Everything reporting shows is a projection.

## Columns

| Column | Meaning |
|---|---|
| `fact_id` | PK of the underlying row. Unique only within a `fact_source`. |
| `fact_source` | Table the row came from. |
| `fact_kind` | What happened — see the table below. |
| `direction` | `in` / `out` / `neutral`. Drives balance arithmetic. |
| `posts_to_ledger` | Whether this actually moved stock. **Filter on it before summing a balance.** |
| `txn_date` | The *document's* date. Never the posting instant. |
| `item_id`, `uom_id`, `quantity`, `rate`, `value` | The measure. |
| `store_id`, `location_id` | Where. `store_id` is null for document-only facts. |
| `party_type`, `party_id` | `vendor` or `buyer`. |
| `doc_type`, `doc_id`, `doc_code` | Drill-through target. |

## Fact kinds

| `fact_kind` | Source | Posts to ledger | Notes |
|---|---|---|---|
| `opening` | `stock_ledger` (`reference_type='opening_stock'`) | yes | Quantity only — no opening value column exists. |
| `ordered` | `po_line_items` | no | Demand placed. `value` = `amount`. |
| `received` | `stock_ledger` `receipt` | yes | What actually reached stock. |
| `grn_accepted` / `grn_rejected` | `grn_line_items` | no | As *documented*. See the GRN trap below. |
| `issued` | `stock_ledger` `issue` | yes | **This is consumption.** |
| `returned` | `stock_ledger` `return` | yes | |
| `transfer_in` / `transfer_out` | `stock_ledger` | yes | Written as two separate inserts, not one transaction. |
| `adjust_in` / `adjust_out` | `stock_ledger` | yes | The ledger is immutable; corrections are adjustments. |
| `planned` | `material_bom_amendment_items` | no | Per-piece BOM qty × order qty. A projection. |
| `sent_out` / `came_back` | `dc_line_items` | no | Material at a processor. Off-book. |

## Why GRN appears twice

The ledger's `received` rows and the `grn_accepted` document rows are both in
the model on purpose. GRN stock-in in `lib/purchase/grn-actions.ts` runs inside
a swallowed `try/catch` — the GRN stays posted even if the stock movement fails.
Carrying both lets `/reports/purchase-vs-receipt` show the divergence instead of
it staying invisible.

**But `grn_line_items` has no `item_id` of its own.** The material is reachable
only through `po_line_item_id → po_line_items.item_id`. A GRN line entered
without a PO link cannot be attributed to any material and is dropped from the
fact view. At the time of writing, *every* GRN line in the live database has a
null `po_line_item_id`, so `grn_accepted` reads 0 while `received` does not.
Adding `grn_line_items.item_id` is the single highest-value schema fix
outstanding.

## Valuation

`stock_ledger.rate` / `.value` are stamped by `stamp_stock_movement_defaults()`
(migration 0351), a BEFORE INSERT trigger. It defers to anything the caller
supplies, so a document that knows its price passes it explicitly:

- **GRN** → `po_line_items.unit_price`, and `grns.grn_date` as `txn_date`.
- **Opening / MRS / vendor return / CSP** → the document's own date.
- **Everything else** → `resolve_item_rate(item_id, as_of)`.

`resolve_item_rate()` walks a priority chain, and **the priority integers in
that function are a business decision, not a technical one**:

1. last actual PO `unit_price` on or before the date
2. `yarn_purchase_rate_items.rate` effective on or before the date
3. `items.budget_rate`

If none match, `rate` is null and `value` is null. Those rows still report a
correct **quantity** — they simply contribute nothing to a value total. The
Item Movement Ledger surfaces the count as "Without a rate" so the blind spot is
visible rather than silently understating consumption value.

## Dimensions

`report_item_dimensions` is one row per item: code, name, item class, category,
sub-category, HSN, material type, stock UOM, and

```
attributes jsonb   -- { "GSM": "180", "Width": "60" }
```

built by `jsonb_object_agg` over `item_attribute_values → material_attribute_lines
→ attribute_values`. This is why a new material attribute becomes a groupable
report dimension without a migration: the registry exposes it through
`attributeDimension()` and `columns.ts` resolves `attr:<Name>` keys against the
jsonb.

## Blind spots — real movement the model cannot see

These are declared in `REPORT_SOURCES` with `status: "gap"` so they are visible
in code, not just in prose.

| What | Why |
|---|---|
| Production consumption | `production_entries` holds garment piece counts. No `item_id`, no material issue, no ledger posting. |
| Finished-goods dispatch | `despatches` has no line items at all; `packing_list_lines` and `shipment_lines` carry colour/size/description but no `item_id`. Nothing leaves stock on dispatch. |
| Subcontract stock | Delivery challans never post movements, so material at a processor is off-book. |
| Wastage / scrap | No document exists. `categories.wastage_per` is a costing percentage, not a transaction. |
| Batch / lot / roll / shade | Not on the ledger or any line table. |
| Bin-level stock | The `bins` master exists; `stock_ledger` has no `bin_id`. |
| Cycle count | No physical-stock-take document. |

## Scoping and permissions

Single-tenant — there is no `org_id`/`company_id` anywhere. Scoping is
`location_id`, and `stock_ledger.location_id` is now stamped directly rather
than reached through `stores`.

Soft delete has **three** different flags depending on table vintage:
`items.is_active`, `categories.inactive`, `bins.blocked`. There is no
`deleted_at` in the entire schema and no uniform predicate.
