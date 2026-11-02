# Stock Statement · Stock Statement with Value — plan

Status: **BUILT 2026-11-02** — migration 0793 (applied), `/reports/stock-statement`, `/reports/stock-statement-value`. See "As built" at the end. Source: the client's brief pasted 2026-11-02
("Stock Statement vs. Stock Statement with Value Reports").

Two pages under **Reports ▸ Stores**, one data source, one service:

| Report | Slug | Shows | Who |
|---|---|---|---|
| Stock Statement | `/reports/stock-statement` | Quantities only. No rate or value column, and no rate in the payload | `reports:view` |
| Stock Statement with Value | `/reports/stock-statement-value` | The same rows plus PO Rate and Stock Value, with value summary cards | `reports:view` **and** a value permission (decision D1) |

---

## 1. What already exists (so we don't build it twice)

| Piece | Where | Gives us |
|---|---|---|
| `stock_ledger.lot_no` + stamp trigger | 0790 | A lot number on every GRN / DC / DC-receipt movement |
| `stock_ledger.bin_id`, one row per bin split | 0782 | Bin-level stock |
| `stock_lot_balances` view | 0790 | Qty and value per store · bin · item · lot, plus first-in date |
| Bin Stock & Aging report | `app/(app)/reports/bin-stock`, `lib/stores/bin-stock-report.ts` | Aging bands 0–30 / 31–60 / 61–90 / 90+ |
| Rejection store + rejection DCs | 0781 / 0791 (`store_type = 'rejection'`, `rejection_action` return / replace) | The Rejected vs Replacement split |
| Group kind RE / SWO / IWO / General per PO line | `grn_open_po_lines()` (0778) | The Group Type and Customer / Buyer filters |
| GRN stock-in rate = `po_line_items.unit_price` | 0351 stamp, `grn_post` | The approved PO rate is already on the receipt row |

**What's missing:** `stock_lot_balances` groups the GRN out of the result (no Stock
Reference column), and it can't tell you the vendor, order or group type of a lot.
It values stock as Σ(in value) − Σ(out value), which mixes the PO rate on receipts with
`resolve_item_rate()` on issues, so it isn't "qty × approved PO rate". Its age is
*first-in* age: a lot topped up yesterday still reads 120 days. It's `security_invoker`
on `stores:view`, but report pages gate on `reports:view` (raagam-report-data contract),
and under the ledger's RLS a reports-only user would get **zero rows**.

## 2. The core design: FIFO stock layers

One SECURITY DEFINER function returns **what is on hand now, one row per receipt layer
still holding stock**:

```
report_stock_layers(p_as_of date default current_date)
  → location_id, store_id, store_type, bin_id, item_id, lot_no,
    source_type ('grn' | 'opening' | 'transfer' | 'process_receipt' | 'adjust'),
    grn_id, grn_code, grn_date, po_id, po_code, po_line_id,
    master_vendor_id, group_kind ('re'|'swo'|'iwo'|'general'), order_id, order_no, customer_id,
    stock_status ('accepted' | 'rejected' | 'replacement' | 'processing' | 'transit'),
    qty_in, qty_on_hand, rate, in_date, age_days
```

How it works:

1. **Layers = inflow rows** of `stock_ledger` (`receipt`, `return`, `transfer_in`,
   `adjust_in`, opening) with `txn_date ≤ p_as_of`, keyed by store · bin · item · lot.
2. **Outflows** (`issue`, `transfer_out`, `adjust_out`) for the same key **consume the
   oldest layer first** (a window `sum() over (order by txn_date, created_at)` running
   total, the standard FIFO-in-SQL shape. No loop).
3. A layer from a GRN joins `grn_line_items → po_line_items → purchase_orders` for the
   PO, vendor, rate and group kind, reusing the same CASE as `grn_open_po_lines()`.
   **Lift that CASE into one SQL function `po_line_group(po_line_id)`** so the two
   can't drift apart.
4. **Gated twice:** `has_permission('reports','view')` inside the function (raises 42501
   with no session), and **`location_id = current_location()`** taken by the function
   itself, never passed by the screen (AGENTS.md "Locations": a SECURITY DEFINER report
   reads past RLS). A Super Admin "all units" view is decision D4.

Why FIFO and not simply extending `stock_lot_balances`:

- **GRN No becomes true.** Issues carry a lot but not a GRN. Lot numbers are vendor-typed
  (`roll_batch_no`) and can repeat, and many lines have none. FIFO attributes every
  remaining kg to the GRN it actually came in on.
- **Aging becomes true.** Age = days since *that layer* came in, so 30 kg left from a
  March GRN reads March even after a fresh receipt into the same lot.
- **The value becomes exactly the brief's formula:** each layer's qty × that layer's
  own approved PO rate.

The balance identity still holds, because the function only *partitions* the ledger
balance: Σ `qty_on_hand` per store · item = `report_item_stock_as_of` for the same date.
That's the verification step (§7).

## 3. Stock Status, in rules

| Status | Rule |
|---|---|
| **Accepted** | store_type `purchase` / `material` / `surplus` |
| **Rejected** | store_type `rejection`, and the rejection DC line's `rejection_action = 'return'` (going back on a Debit Note) |
| **Replacement** | store_type `rejection`, `rejection_action = 'replace'` (the vendor will resend) |
| At Processor | store_type `processing` (Process / Production DC legs, 0784–0788) |
| In Transit | store_type `transit` (between Raagam HO, Unit 2 and Unit 3) |

The last two aren't in the brief, but the Value report's "Fabric / Processing Stock
Value" card needs them, and leaving them out would make the Total disagree with the
ledger. They show as their own status words.

**Pending QC is not stock** (0791: nothing posts until the inspector decides), so it
isn't a row. A note under the table reads "N lines awaiting QC — not yet in stock" and
links to Stores ▸ Pending QC, so the operator isn't left looking for goods they know arrived.

Status colours go through `statusTone()`: Accepted success, Rejected danger, Replacement
warning, At Processor info, In Transit neutral.

## 4. The two screens

### Stock Statement (quantity)

Columns, in this order: Unit · Store · Item Class · Item · UOM · GRN No · Lot No · Bin ·
Qty · Status · Age (days, banded pill as Bin Stock does) · In Date.

- **No rate or value anywhere, including the RSC payload, Excel and PDF.** The service
  for this page never selects them. A hidden column still ships the number to the browser.
- A no-lot layer shows "—". A non-GRN layer shows its source word ("Opening", "Transfer")
  in the GRN No column, never a blank.
- KPIs on top: lots on hand, Accepted qty, Rejected qty, Replacement qty, and the four age
  bands (count of lots).

### Stock Statement with Value

Same rows, plus PO Rate and Stock Value (`qty_on_hand × rate`) after Qty.

Summary cards:

- **Yarn Stock Value**: item class YARN, every status except Rejected / Replacement,
  stores *and* at processor.
- **Fabric / Processing Stock Value**: item class FABRIC, including at processor.
- **Total Inventory Asset Value**: everything Accepted + At Processor + In Transit.
  **Rejected and Replacement values are shown as a separate card, not added in.** A
  rejected lot is a claim on the vendor, not an asset, and putting it in the total would
  overstate inventory (decision D3).
- "Without a rate": the count of layers whose rate is null (opening stock has no value
  column, so those layers fall back to `resolve_item_rate()`, and when that is null too
  they contribute qty but no value). Same blind-spot rule as the Item Movement Ledger.

### Shared header filters (both pages)

Group Type (RE · SWO · IWO · General) · Customer / Buyer · Vendor · Item Class · Order No
/ PO No, plus Store, Status and As-of date. Built on the existing filter drawer, with
**cascading facets** (AGENTS.md): Customer narrows Order No, Group Type narrows both, and
an out-of-scope held value is cleared. Item Class options come from the live master
(there are 7 classes, not the 4 in the brief).

A layer with no PO (opening, transfer) matches **only** Group Type = General and an empty
Vendor / Order filter. It never silently drops out of an unfiltered total.

Both pages: full-width listing, paginated, Excel numeric columns are raw numbers
(`value()` returns a number, `format` displays), `fmtDate` for dates, report letterhead
on PDF/Print.

## 5. Files

| File | What |
|---|---|
| `supabase/migrations/08xx_report_stock_layers.sql` | `po_line_group()`, `report_stock_layers()`, `revoke … from public, anon`, grant to authenticated |
| `lib/reports/stock-statement-service.ts` | `"server-only"`; two exports, `stockStatement(filters)` (no rate) and `stockStatementValue(filters)`; coerces numerics; resolves names in one parallel round trip |
| `lib/reports/catalog.ts` | Two entries, module `stores`, beside Bin Stock |
| `app/(app)/reports/stock-statement/page.tsx` + `-report.tsx` | Server page + client `ReportConfig` |
| `app/(app)/reports/stock-statement-value/page.tsx` + `-report.tsx` | Same, with value columns and cards |
| `lib/reports/registry.ts` | `stock_layer` source declared `wired`; `grn_no`, `lot_no`, `bin`, `stock_status`, `age_band` dimensions |
| `lib/stores/bin-stock-report.ts` | Later: re-point at `report_stock_layers` so Bin Stock & Aging uses the same FIFO age (D5) |

## 6. Phases

1. **SQL**: `po_line_group()` + `report_stock_layers()`. Verify (§7) before any UI.
2. **Stock Statement**: quantity page, filters, KPIs, Excel/PDF.
3. **Stock Statement with Value**: value columns, cards, "without a rate".
4. **Converge**: Bin Stock & Aging reads the same layers. Dashboard tile for the three
   value cards (decision D2).

## 7. Verification (each one has caught a real defect before)

1. Σ `qty_on_hand` per store · item = `report_item_stock_as_of(today)`. Must match exactly.
2. Back-dated GRN: as-of a date before it, the layer is absent; after, its age counts from `grn_date`.
3. Partial issue: 50 kg in on GRN-A, 30 kg on GRN-B, issue 60 → A has 0 left, B has 20, B's age.
4. Rejection on a GRN with `rejection_action = 'replace'` → Replacement row in the Rejection store.
5. Call the RPC with no session → 42501.
6. View the quantity page's response payload: no `rate` / `value` key anywhere.
7. Excel: select the Qty and Value columns → the status bar sums.

## 8. Decisions needed from the client

- **D1. Who sees value?** Recommend a new permission `stores_valuation:view` (Accounts,
  MD, Admin), checked on the Value page and inside the value branch of the service. A store
  operator with `reports:view` then sees quantities only, which is the brief's intent
  ("without revealing prices"). Note that today's **Bin Stock & Aging already shows Value
  to anyone with `stores:view`**, so it would need the same gate.
- **D2. "Executive Dashboard Summary Cards".** Cards on the Value report itself (in this
  plan), or also tiles on the MD dashboard? Recommend: report first, dashboard tile in
  Phase 4.
- **D3. Rejected / Replacement value in the Total?** Recommend kept out, shown as its own card.
- **D4. Units.** One unit at a time (the topbar switcher, the standing rule). Should a
  Super Admin get an "All units" option with a Unit column? Recommend yes, Super Admin only.
- **D5. FIFO age.** Confirm that age = days since the remaining stock's own GRN, not since
  the lot's first receipt. This changes the existing Bin Stock figures slightly.

---

## As built (2026-11-02)

- **SQL (0793):** `report_stock_layers__all_units` (FIFO engine, plpgsql), `report_stock_statement__all_units`
  (layer → GRN line → PO → group/customer/vendor/status), wrappers `report_stock_statement` (no rate),
  `report_stock_statement_value` (+ rate, value), `report_stock_pending_qc`, `can_view_report_screen`.
  The `__all_units` functions are revoked from `authenticated`; anon can execute none.
- **App:** `lib/reports/stock-statement-service.ts` (server-only), `stock-statement-types.ts` (client-safe),
  `stock-statement-page.ts` (as-of + unit name), `components/reports/stock-statement-view.tsx` (shared view),
  two pages, two `REPORTS` entries (module `stores`, beside Bin Stock).
- **Filters:** the shared drawer — Group Type, Customer / Buyer, Vendor | Item Class, Store, Status, Age; Order No /
  PO No is the search box (also matches GRN, item, lot). As-on date is a GET param (`?asOf=`).

How each decision landed:

- **D1** — no new permission module. The Value report is its own SCREEN, so Roles & Permissions can tick
  Stock Statement without Stock Statement with Value. The database checks the same grant
  (`can_view_report_screen('/reports/stock-statement-value')`), so the rates cannot be fetched around the page.
  A role on plain module-level `reports:view` sees both — to hide value from store staff, switch their role's
  Reports to screen mode and leave the Value report unticked.
- **D2** — cards on the report only. Dashboard tile not built.
- **D3** — Rejected / Replacement value is its own card, excluded from Total Inventory Value.
- **D4** — NOT built as proposed: 0681 already decided that super admins are narrowed to the unit they are in
  ("all locations" = they can switch to any). The report follows that rule.
- **D5** — FIFO age. Bin Stock & Aging still reads `stock_lot_balances` (first-in age); converging it is open.

Verified: layers = ledger balance per store · item on live data; no session → 42501; anon has no EXECUTE;
FIFO dry-run (rolled back) — 50 + 30 in, issue 60 → 0 / 20, a lot-named issue takes its own lot first,
an as-of before a receipt omits it. NOT verified: a screen-mode role being refused the Value report (needs a
test role), and the pages in a browser.

Not done: `grn_open_po_lines()` keeps its own copy of the group CASE (two copies — change both together).
