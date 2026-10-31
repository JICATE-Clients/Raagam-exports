# Process DC & Production DC — build plan (2026-10-31)

Status: Production DC BUILT 2026-10-31 (0784, Stores ▸ Production DC: send · Incoming · receive · print). Process DC BUILT 2026-10-31 (0786, Stores ▸ Processing ▸ Process DC: Pending orders · At Vendor · Returned · Draft, send against a Process Order, print). Process Receipt BUILT 2026-10-31 (0787: output item, input used, loss % vs allowed — warn, never block — draft bill at the order rate flagged `exception` on excess loss). Stores ▸ Process Issues / Process Receipts retired (redirect to Process DC). Reports (Phase 4/5) next.
User decisions 2026-10-31: Process Order mandatory before a Process DC; allowed loss % per process = soft warning + variance flagged on the draft bill; U2 / U3 mirror HO's stores + In Transit per unit. Asked for in the GRN spec (§5 "DC Workflows"): a **Process DC**
for job work (yarn / fabric out to a dyer, knitter, printer, embroiderer) and a
**Production DC** for moving material between Raagam HO, Unit 2 and Unit 3.
Written against the database as it stands after 0782.

## 0. What already exists — every table below holds ZERO rows today

| Area | Today | Problem |
|---|---|---|
| **Purchase ▸ Delivery Challans** | `delivery_challans` + `dc_line_items` (0008, 0445–0448). Vendor = **master vendor**. Raised by hand or from a Material BOM process row. Posting moves stock as a TRANSFER into the unit's processing store (`post_dc_stock`, 0447), one transaction. Returns recorded per line. | No link to a process order, no rate, no expected return, no print. Return = the SAME item back; a dyer returns *dyed* fabric (a different item) and loses weight. |
| **Stores ▸ Process Orders → Process Issues → Process Receipts** | `process_orders` (process type, rate, RE / IWO link) + `process_material_issues` + receipts (0364, 0708). | Vendor FK points at the **legacy `vendors`** table: a master vendor cannot be saved (the same bug 0445 fixed for DCs and 0777 for GRNs). The issue posts stock as `issue` (consumption, not a move), through an admin client, "best-effort": the issue can save with no stock moved. |
| **Stores ▸ Transfers** | Store → store inside ONE unit, written as two separate inserts. | Not one transaction (half a transfer is possible). Cannot cross units, and unit isolation means the receiving unit could not see it anyway. |
| **Stores ▸ Inter-dept Delivery** | `interdept_deliveries`: department → department inside a unit. | Not inter-unit. Keep as it is. |
| **Stores** | Only Raagam HO has stores (purchase, processing, material, rejection, surplus). | Unit 2 and Unit 3 have **none**: nothing can be received there until their stores exist. |
| **Rejection / Replacement DC** | `vendor_returns` (0780–0781), raised by a GRN. | Done. Out of scope here. |

So there are two job-work paths that do half the job each, and no inter-unit path at all.

## 1. Decisions taken (and why)

1. **One DC document for every kind of outward challan:** `delivery_challans` gains
   `dc_kind` = `process` | `production`. It keeps one numbering series, one print and one
   register. A Rejection DC stays in `vendor_returns`, because the GRN already owns it.
2. **Process Order = the commercial order; Process DC = the goods leaving.** A Process
   Order carries vendor, process, rate, RE / IWO and expected date. One or more Process
   DCs are dispatched **against** it. Stores ▸ Process Issues is retired into this, so
   there is one way to send goods out instead of two.
   - `process_orders.vendor_id` is repointed to `master_vendors`. The table is empty, so it
     is free.
   - The vendor list = vendors registered for that process (`master_vendor_processes`).
3. **Material at the processor stays on the books.** On dispatch, stock TRANSFERS from
   the material store to the unit's processing store ("at vendor"), as 0447 already
   does. It is never booked as consumed.
4. **What comes back can be a different item.** Grey fabric goes out and dyed fabric
   comes back. A **Process Receipt** against the DC records:
   - the received item and qty;
   - the input qty it used up;
   - the **process loss** (for example 5% of weight in dyeing).

   On post, the processing store gives up the input used, the material store takes in
   the output item, and the loss is recorded as process loss (`adjust_out`, with a reason).
   The bill is the Process Order's rate × received qty, raised as a draft payable, as a
   GRN's is.
5. **A Production DC is two-step, dispatch and receive, with goods "in transit" between.**
   - The sending unit dispatches: stock moves to its new **Transit** store (`store_type`
     `transit`).
   - The receiving unit receives against the DC: qty received, any shortage with a
     reason, into its own store and bin. Stock moves Transit → receiver.
   - Until received, the goods show as in transit, not lost and not double-counted.
6. **Unit isolation, both ends.** A Production DC is readable by the sending unit
   (`location_id`) AND the receiving unit (`to_location_id`). Each side may write only
   its own step: dispatch by the sender, receipt by the receiver. Every stock movement
   goes through one SECURITY DEFINER function per step, all or nothing, the way
   `grn_post` works.
7. **GST on the challan.** A job-work DC carries the standard line "Goods sent for job
   work — not for sale" plus HSN and approximate value per line. An inter-unit DC says
   "Stock transfer between units of the same company — not a sale". The three units
   currently share one GSTIN. If a unit ever gets its own, that transfer becomes a
   taxable supply and needs an invoice instead (flagged, not built).

## 2. Schema (one migration)

- `delivery_challans`:
  - Identity: `dc_kind` (process | production), `to_location_id`, `process_order_id`,
    `process_type`.
  - Dates: `expected_return_date`.
  - Transport: `vehicle_no`, `transporter`, `eway_bill_no`.
  - Who dispatched / received: `dispatched_at` / `_by`, `received_at` / `_by`.
  - Status becomes: `draft` → `dispatched` → `partially_received` → `received` / `closed`
    / `cancelled`.
- `dc_line_items`:
  - What went: `from_store_id`, `bin_id`, `hsn_code`, `rate` (value for the challan).
  - Production DC receipt: `received_qty`, `shortage_qty`, `shortage_reason`.
- **New** `dc_receipts` + `dc_receipt_lines` (Process Receipt): `dc_line_id`,
  `output_item_id`, `received_qty`, `input_used_qty`, `loss_qty`, `loss_reason`,
  `store_id`, `bin_id`, `lot_no`.
- `stores.store_type` gains `transit`, seeded one per unit. Unit 2 and Unit 3 also get
  the standard five stores.
- `process_orders.vendor_id` repointed to `master_vendors`.
- Functions:
  - `dc_dispatch(dc_id)`: stock out, status dispatched.
  - `dc_receive_production(dc_id, lines jsonb)`: receiver's side.
  - `dc_receipt_post(receipt_id)`: process return, loss and draft bill.
  - Each one is all or nothing and revokes `public, anon`.
- RLS: an `lv_delivery_challans` predicate that also lets the `to_location_id` unit
  read. Child tables follow their document.

## 3. Screens

| Screen | Where | What |
|---|---|---|
| **Process DC** | Stores ▸ Job Work ▸ Process DC (replaces Purchase ▸ Delivery Challans and Stores ▸ Process Issues) | Shaped like the Raise PO / GRN lists: Pending (process orders with something not yet sent) · Dispatched · Draft, plus a Filters button (Process → Vendor → RE / IWO → Item Class). Header on one row: Unit · DC Date · Process · Vendor · Process Order · Expected Return · Vehicle No. Grid: Item · Order Qty · Sent so far · **Send Qty** (locked to the balance) · Store · Bin · Lot No · HSN · Value. |
| **Process Receipt** | Pending row "Due back" on the same screen | Picks the DC. Grid per DC line: Sent · **Output Item** (defaults to the order's output) · **Received** · Input used · **Loss** (auto = input used − received weight, editable) · Store · Bin · Lot No. **Close bal.** works as on the GRN. |
| **Production DC** | Stores ▸ Transfers ▸ Production DC (the in-unit Transfers screen stays beside it) | Send: Unit (current) · **To Unit** · DC Date · Vehicle · Transporter · E-way Bill, then the grid Item · From Store · Bin · Qty (locked to stock) · Lot No. The receiving unit gets an **Incoming** list. Its receive grid: Sent · **Received** · Shortage (auto) · Reason (required when short) · Store · Bin. |
| **Print** | One print sheet, two titles | Same kit as the PO and Rejection DC print. |

### Print format (both DCs)

- **Masthead:** company, unit address, GSTIN, title ("Delivery Challan — Job Work" /
  "Delivery Challan — Stock Transfer"), DC No, Date.
- **To:**
  - Job work: the vendor's name, address and GSTIN, plus the process.
  - Production: the receiving unit's name and address.
- **Reference block:** Process Order No, RE / IWO No, expected return date, vehicle No,
  transporter, e-way bill No.
- **Lines:** #, Item, HSN, Qty, UOM, Lot No, Approx. value.
- **Footer:**
  - Totals (qty, value).
  - Job work: "Goods sent for job work and to be returned — not for sale".
  - Production: "Stock transfer between units — not a sale".
  - Prepared by / Authorised signatory / Received by (signature and seal).

## 4. Phases

| Phase | What | Size |
|---|---|---|
| 1 | Migration (columns, `transit` store, U2 / U3 stores, vendor FK) + the three post functions, verified by a dry run | M |
| 2 | Production DC: send, Incoming, receive, print | M |
| 3 | Process DC against a Process Order: send, print. Purchase ▸ DC and Process Issues redirect here | L |
| 4 | Process Receipt: output item, loss, close balance, draft bill | M |
| 5 | Reports: stock at vendor (by process / vendor / age), in transit by unit, process loss % by vendor | S |

Phases 1 and 2 can ship first: inter-unit transfer has no rate and no vendor, so it is
the smaller half.

## 5. Open questions for the user

1. **Does a Process DC always need a Process Order first?** Recommended yes: the order
   carries the rate, and the rate is what the bill is checked against. The alternative is
   a standalone DC with the rate typed on it.
2. **Process loss:** is there an allowed % per process (e.g. dyeing 8%, knitting 2%)
   that should warn or block, like the GRN's excess lock?
3. **Unit 2 / Unit 3 stores:** should they get the same five stores as HO, plus Transit?
