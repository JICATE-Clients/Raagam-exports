# Opening Stock — the order decides the items (BUILT 2026-11-05, migration 0812)

Source: a pasted brief, "Opening Stock UI & Logic Update" (Material Store + RE number
narrows the item list; General Store / GENSTK opens every item).

## 1. What the brief asks vs what 0801 already does

| Brief | Today (0801, `/purchase/opening-stock`) | Gap |
|---|---|---|
| Doc No `OPN-0001` | `OPN-` series, chip on the frame's title row | — |
| Date, Stock Type (Accepted …) | Opening Date + Stock Type on header row 1 | — |
| Store (Material / Yarn / Purchase) | Store on header row 1; Rejected/Replacement lock it to the Rejection store | — |
| Group Code: RE-13 / SWO-05 / GENSTK | Group Type (General · Order/RE · IWO · SWO) + Order No picker | — |
| **RE picked → only that RE's planned items** | **Every item in the master is offered** | **YES — the one real gap** |
| GENSTK → any item, any class | General → every item | — |
| Item Class filter | "Item Class (filter)" on header row 2 | — |
| Rate pre-filled from budget rate | Item's `budget_rate` fills an empty Rate | — |
| Ledger tagged with order or GENSTK | `stock_ledger.garment_order_id` / `iwo_id` (0802); both null = General. "GENSTK" is a label, not a row | — |
| Posted = locked | Post is final; posted entry opens read-only | — |

So the work is **one rule**: when the Group Type is an order (RE / IWO / SWO), the line's
Item list is that order's requirement plan, not the item master.

## 2. The rule

- **Source of "planned items"** = `po_requirement_lines(array[order_id])` — the same
  function Raise PO and Stock Transfer already read. Its `source_id` is
  `garment_order_amendments.id` for an RE and `internal_work_orders.id` for IWO/SWO,
  which is exactly the id `opening_stock_group_options()` hands the Order No picker. No
  new mapping.
- **General** → every active item (unchanged), Item Class filter still applies.
- **Order with no requirement yet** (no Material/Fabric BOM) → the Item list is EMPTY with
  one line under the grid: *"RE-13 has no requirement plan yet — build its BOM, or enter
  this stock as General."* Never fall back to the full list (same reason as the Nominated
  vendors rule: a silent fallback makes the restriction advisory).
- **Each option shows the plan beside it**: `COTTON 30s · Req 5,261 kg · Bal 261 kg`, so
  the storekeeper can see they are booking against a real line.
- **Changing the order** keeps lines whose item is in the new plan and blanks the item on
  the rest (with a toast "3 lines cleared — not in RE-14's plan"). Bins/qty stay so typing
  is not lost.
- **The item a saved line already holds always survives** the filter (as Disabled rows).
- **Server guard** (stated vs enforced): `opening_stock_save` refuses a line whose item is
  not in the order's requirement when `group_kind <> 'general'`:
  *"Line 2: COTTON 40s is not in RE-13's requirement plan."* `lib/data-io` and a stale tab
  hit the same wall.

Not in scope (unchanged decisions): Opening stock does not reduce Raise PO's "to order"
balance — that is the deferred phase-2 advisory chip. Rate stays the item master budget
rate (the brief says "Item Master budget rate"), still editable.

## 3. Screen (unchanged frame, one row of behaviour added)

```
┌ Opening Stock Balance  [OPN-0001]  Draft ───────────────────────────────────────────┐
│ Opening Date   Stock Type                  Store              Remarks                │
│ [05/11/2026]   [Accepted|Rejected|Repl.]   [Material Store ▼] [                    ] │
│ Group Type     Order No                    Buyer              Item Class (filter)    │
│ [Order / RE ▼] [RE-13                  ▼]  KIABI (read-only)  [All classes        ▼] │
│                                                                                      │
│  #  Item ▼ (RE-13 plan only)      Bin · Qty     Lot    Ref No  Ref Dt  Bags  Qty  Rate  Value │
│  1  COTTON 30s · Bal 261 kg       MAT01 · 120   L-01   …                   120  210  25,200 │
│  2  [blank tail row]                                                                  │
│                                                                                      │
│  ⓘ shown only when the order has no plan:                                            │
│    "RE-13 has no requirement plan yet — build its BOM, or enter this stock as General."│
└──────────────────────────────────────────────── Lines 1 · Value 25,200   [Save] [Post] ┘
```

Layout stays exactly the 0801 grid (144 / 288 / 200 / 288 header columns, 1128px line
grid) — the brief's mock-up is a different arrangement of the same fields, and the
screen was already aligned to GRN / Raise PO's document frame (screenshot 4030).
With General picked, the Order No column shows `GENERAL STOCK` read-only as today.

## 4. Build steps

1. **Service** `lib/stores/opening-stock/service.ts` → `getOpeningOrderItems(orderId)`:
   `rpc("po_requirement_lines", { p_source_ids: [orderId] })`, grouped by `item_id`
   (required, balance, uom). Copy the shape of `stock-transfer-actions.ts`, but return
   the error instead of `[]` on failure (a failed query is not an empty plan).
2. **Editor** `opening-stock-editor.tsx`: load the plan when `header.orderId` changes;
   `itemOptions` filters to it when `header.kind !== "general"`; empty-plan sentence;
   clear-out-of-plan on order change. Hooks above any early return.
3. **Migration 0812**: a BEFORE INSERT/UPDATE trigger on `opening_stock_lines`
   (`opening_stock_line_in_plan`) rather than re-creating `opening_stock_save` — every line
   goes through that insert, and copying 0801's body risks erasing a peer's edits.
4. Verify: RE with BOM → only its items; RE without BOM → empty + sentence; General → all;
   switch RE → out-of-plan lines cleared; direct RPC with an off-plan item → refused.
   `npm run build:check`.
