# Stock Transfer — fields, logic and UI plan (2026-11-03)

Status: PLAN — nothing built. Source: the pasted brief on Screenshot 4027 (legacy RP
"Material Transfer Entry"), re-cut against the database as it stands after 0800.
Route stays **Purchase ▸ Purchase Store ▸ Stock Transfer** (`/purchase/transfers`;
`/stores/transfers` already redirects there).

---

## 0. What exists today, and why the brief cannot be built on it as-is

| Area | Today | Gap against the brief |
|---|---|---|
| `/purchase/transfers` | A Sheet: From Store, To Store, Item, Qty, Note. `transferStock()` writes **two separate inserts** (out, then in). | Half a transfer is possible. No lot, no bin, no rate, no document, no number, no RE. |
| `stock_ledger` | One row per movement, keyed **store · bin · item · lot** (0779 bin, 0790 lot), with `rate`, `value`, `txn_date`, `location_id`, `counterparty_store_id`. | **Stock has no owner.** Nothing says "these 259 kg belong to RE-13" or "this is General Stock". The brief's whole idea — GENSTK → RE — has nothing to move between. |
| FIFO layers (0793) | `report_stock_layers` opens a layer at every inflow, **including `transfer_in`**, dated the transfer day. | A transfer today **resets the age to 0 days and loses the GRN No**. The brief's "preserve lot, GRN, inward date and rate" is false on the current engine. |
| Stock types | `stores.store_type`: material (= Accepted), rejection (= Rejected / Replacement by the GRN line's `rejection_action`), surplus, processing, transit, storage. | Already modelled — "Stock Type" in the brief is **the store**, not a new field. |
| RE ↔ purchase | `po_line_items.garment_order_id / iwo_id + req_key` (0737, 0740); `po_requirement_lines()` gives each requirement line's balance; 0799 closures subtract from it. | A transfer into an RE should reduce that RE's "to order" balance exactly like a PO or a closure does. Nothing does yet. |
| Inter-unit moves | Production DC (0784) — In Transit store, receive at the other unit. | Done. Stock Transfer stays **inside one unit**. |

---

## 1. Decisions (recommended — each says why)

1. **Stock gets an owner, on the ledger.** `stock_ledger.owner_kind` (`re` | `iwo` | `swo`,
   null) + `owner_id`. **Null = General Stock** — that *is* GENSTK; no fake "GENSTK order".
   Stamped at `grn_post` from the PO line's `garment_order_id` / `iwo_id`, carried by every
   DC / issue / return that moves it. Existing GRN rows are backfilled through
   `grn_line_items → po_line_items`; anything that cannot be traced reads as General Stock.
   *Why on the ledger, not a reservation table:* the ledger is the one source every balance
   and report reads (0790, 0793, `raagam-report-data`); a side table would be a second truth.

2. **"Stock Type" is the store; the screen says so.** From = a store (Material → "Accepted",
   Rejection → "Rejected"/"Replacement" by `rejection_action`, Surplus, Storage). No separate
   Stock Type column is stored. Rejected → Accepted is the same document with a different
   To Store (a QC re-accept), so it needs no screen of its own.

3. **A transfer moves a LAYER, never re-receives it.** The `transfer_in` row carries
   `origin_ledger_id` → the receipt row it came from. 0793's engine is changed so a
   `transfer_in` with an origin **inherits** that origin's GRN, first-in date and rate
   instead of opening a fresh layer. Age bands (0–30 / 31–60 / 61–90 / 90+) and Stock
   Statement with Value stay right. *This is the one change everything else depends on.*

4. **Rate is never typed.** Read from the chosen layer (the GRN's approved PO rate, as
   0793 already resolves it). Value = Qty × Rate, read-only. Both legs post at that rate,
   so a transfer moves value without creating or destroying any.

5. **One document, one transaction.** New `stock_transfers` + `stock_transfer_lines`;
   `stock_transfer_post(id)` (SECURITY DEFINER, like `grn_post`) writes every out/in pair or
   none. Replaces the two-insert `transferStock()`.

6. **Same item, same UOM, always.** A transfer never changes the item — that is a Process
   Receipt (0787). So the brief's *To Description* and *To UOM* columns go: they could only
   ever repeat the From side, and a field that can only disagree by mistake is a trap.

7. **A transfer into an RE answers that RE's requirement.** The line names the target
   requirement line (`req_key`); `po_requirement_lines()` subtracts transferred qty like
   ordered and closed qty (rebuilt from 0799's body). This is what makes "transfer before
   you buy" real — Raise PO's balance drops the moment the stock moves.

8. **Order close → General Stock is MANUAL.** Same rule as 0799 ("manual only, a person's
   decision with a reason"): the screen offers *Release to General Stock* (From = a closed
   RE, To = General); nothing moves on its own at close.

9. **Numbering at post, not at save.** `STR/26-27/0001`, per financial year; a draft has no
   number (same rule as 0700 for RE drafts). The brief's "Entry No 54" is the post-time
   number.

10. **Inside the current unit only** (`current_location()`); both stores and every bin
    must be the unit's. Cross-unit = Production DC.

---

## 2. Header — fields

`FieldRow` + `<Field w=…>`, one row on desktop (≈ 72rem cap). Active-first rule does not
apply (a document, not a master).

| # | Field | Widget | Req | Rule |
|---|---|---|---|---|
| 1 | Transfer No | read-only | — | `(auto)` until posted, then `STR/yy-yy/nnnn` |
| 2 | Date | `type="date"` | ★ | defaults today (local, not UTC); not in the future |
| 3 | Transfer Type | `ToggleGroup` | ★ | **Order → Order · General → Order · Order → General · Store → Store** — decides which of 4–7 are shown |
| 4 | From Store | `Select` (stores of unit) | ★ | label shows its stock type: "Material Store · Accepted" |
| 5 | From Stock Of | picker: General Stock / RE / IWO / SWO | ★ unless Store→Store | "General Stock" is the first option; Customer filter narrows the RE list |
| 6 | To Store | `Select` | ★ | defaults to From Store (most transfers re-own stock in place) |
| 7 | To Order | picker: RE / IWO / SWO | ★ for →Order | open orders only; **not the same as From** |
| 8 | Customer | picker | — | filter only (narrows 5 and 7); never stored on lines |
| 9 | Remarks | `Textarea` | ★ when Order→Order or Order→General | the reason moves cost from one order's books to another's |

Brief fields dropped: *From Group Desc* (it is the picked order's own name — shown as
hint text under field 5), *To Stock Type* (it is field 6's store type).

---

## 3. Lines grid — `ChildGrid`, `tableFrom="5xl"`, tail row (no "+ Add")

One line = **one source layer** (store · bin · lot · GRN) to one target. Picked from a
layer picker that lists only what is on hand under the header's From Store + From Stock Of.

| Column | Width | Editable | Notes |
|---|---|---|---|
| S.No | hug | — | |
| Item | name | ★ picker | `unique` per layer (pick-once) — same item, other lot = new line |
| Class · Category | sm | read-only | from the item |
| Lot / GRN | md | ★ layer picker | shows `Lot DRTN/2223/0276 · GRN 0412 · 23 d · 312.5 kg` — choosing it fills Bin, Rate, Available |
| From Bin | sm | read-only | from the layer |
| Available | sm | read-only | layer balance **as of the header Date** |
| Against (target line) | md | picker, ★ for →Order | the To Order's requirement line for this item, with its open balance; blank = order stock with no line |
| To Bin | sm | `StoreBinCell` | defaults to From Bin when the store is the same; "Split bins…" as on GRN |
| Bags / Cones / Rolls | hug ×1 | number | one count column whose label follows Item Class (Yarn → Bags·Cones, Fabric → Rolls); printed, not stock |
| Transfer Qty | sm | ★ number | in the item's stock UOM; UOM shown as suffix |
| Rate ₹ | sm | read-only | from the layer |
| Value ₹ | sm | read-only | Qty × Rate |

Footer row: total Qty per UOM, total Value. Width check: columns + 72px ≤ 1155px —
`npm run check:grid-budget` must list this grid as `ok`.

---

## 4. Logic — what the post does

```
stock_transfer_post(id):
  refuse unless stores:edit, document in current unit, status = draft
  for each line (locked, in order):
    available := layer balance on header date (FOR UPDATE on the layer's store·item)
    refuse "Lot X has only N kg on <date>" if qty > available
    insert transfer_out  (from store, from bin, lot, owner = FROM, rate, value, ref = transfer)
    insert transfer_in   (to store, to bin,   lot, owner = TO,   rate, value, ref = transfer,
                          origin_ledger_id = the layer's receipt row)
  stamp transfer_no, status = posted, posted_by / posted_at
```

Validation the operator sees **before** Save (holds + Save gate, not a separate tab):

- Qty > Available → red under the cell, cursor held (it blocks Save).
- Qty > Against line's open balance → **amber, advisory** ("RE-15 needs only 180 kg; the
  rest will sit as RE-15 stock") — over-supplying an order is sometimes intended.
- From = To (same store, same owner, same bin) → refused: it moves nothing.
- Order → Order where the From order is still open → amber: "RE-13 still needs this item"
  (shows RE-13's own remaining requirement).

After post: read-only; **Cancel** = a reversing post (ledger is append-only), only while
nothing downstream has consumed the moved layer.

---

## 5. Screen

**Listing** (`DataTable`, full width, global pagination): Transfer No · Date · Type ·
From (store · owner) · To (store · owner) · Lines · Qty · Value · Created Date · Created
User · Status (Draft / Posted / Cancelled via `statusTone`). Row icons: pencil (draft),
FileText → print, bin (draft). Filters: date range, Type, From/To order, Item Class →
Category (cascading).

**Editor** (`MasterFullScreen`):

```
┌ Stock Transfer  STR/26-27/0054                              [Report] [Save & Post] ┐
│ Date [03/11/2026]  Type [Order→Order|General→Order|Order→General|Store→Store]         │
│ From Store [Material · Accepted ▾]  From Stock Of [General Stock ▾]                    │
│ To Store   [Material · Accepted ▾]  To Order      [RE-15 · ACME TEES ▾]  Customer [ ]  │
├ Lines ────────────────────────────────────────────────────────────────────────────────┤
│ # Item              Lot / GRN                From  Avail   Against      To   Bags Cones  Qty    Rate    Value │
│ 1 10'S COMBED CTN   DRTN/2223/0276·GRN412·23d A-03  312.50  RE-15 L2·180 A-03  10  120  259.00 313.94 81,310.46│
│ 2 (blank tail row)                                                                    │
├───────────────────────────────────────────────────── Total 259.00 kg   ₹81,310.46 ┤
│ Remarks [ ............................................................ ]               │
└ Cancel · Save (draft) · Save & Post ───────────────────────────────────────────────────┘
```

Keyboard: standard contract — Tab along fields, Enter on the tail row leaves the grid,
Ctrl+Del removes a line, Ctrl+S saves. `useUnsavedGuard(dirty || isPending)`.
Brief's *Modification History* tab = the app's audit log + Created columns (no new tab);
*Errors Found* = the inline holds above.

**Print** (`report-look-kit`): STR No, date, from → to, lines with lot / GRN / bags / qty /
rate / value, remarks, signatures (Stores · Received by).

---

## 6. Where else it shows (phase 3)

- **Raise PO**: on each requirement line, *"General Stock: 120 kg"* as a link that opens a
  new transfer pre-filled (General → this RE, this item). A hint, not a blocking modal —
  the brief's "prompt before PO" without trapping the Purchase Manager.
- **Stock Statement / with Value**: an **Owner** column (General / RE-xx) and filter.
- **Bin Stock & Aging**: age unaffected by transfers (decision 3).

---

## 7. Build phases

| Phase | Migration | What |
|---|---|---|
| 1 ✅ 2026-11-03 | **0802** (0801 was taken by Opening Stock) | `stock_ledger.garment_order_id` / `iwo_id` (both null = General) + `origin_ledger_id`; owner stamped by trigger `trg_stamp_stock_owner` through `stock_owner_for()`; 11 rows backfilled (all RE-owned); view `stock_owner_balances` |
| 2 ✅ 2026-11-03 | **0803** + **0804** | BUILT — see "Phase 2 as built" below. Original scope: `stock_transfers` + lines, RLS by unit, `stock_transfer_post` / `_cancel`, `STR` numbering; **0793 FIFO engine inherits origin on `transfer_in`** (moved here from phase 1 — no transfer row exists until this phase posts one, and 0801 re-created the Stock Statement today, so the engine change starts from that body); `po_requirement_lines` subtracts transferred qty; screen + print; retire `transferStock()` |
| 3 | — | Raise PO "General Stock" hint; Owner column on stock reports |

**Owner columns match the existing vocabulary.** The plan first said `owner_kind/owner_id`;
built as `garment_order_id` / `iwo_id`, the pair `po_line_items` and `opening_stocks` (0801)
already use, so one order reference has one spelling everywhere.

**Stamped by trigger, not by editing the 8 posting functions** (0790's lot pattern). Sources:
GRN → PO line; vendor return → its GRN; opening stock → header; DC → Process Order, else its
source GRN; DC receipt / process order → the Process Order's IWO, else its sales order's RE.
A caller that states an owner keeps it.

**Known floor:** department returns, general DC, material requisitions and the old
`transferStock()` name no order, so an OUTFLOW of order stock through them posts against
General Stock (General can read negative while the RE reads high). `stock_owner_balances`
shows it rather than hiding it. Each screen gains an owner field when it is next touched.

Verified 2026-11-03: per-owner balances sum to `stock_balances` for every store · item
(0 mismatches); anon has no access to the resolver, trigger fn or view; a rolled-back probe
confirmed a new GRN row is stamped, a reference-less row stays General, and a stated owner
is kept.

---

## 8. Decided (user 2026-11-03: "go with your recommendations on all three")

1. **Order → Order needs no approval.** Remarks are mandatory and the move is listed on
   both orders' budget screens.
2. **Release to General Stock** = Stores edit + the From order closed. Never automatic.
   An open order's stock moves only Order → Order.
3. **Bags / Cones / Rolls are printed only** — never a stock balance; the ledger stays in
   the stock UOM.

---

## Phase 2 as built (2026-11-03)

**DB.** 0803: `stock_transfers` (STR-0001, numbered on SAVE like every sibling Stores document —
DPR, DC, OPN — not at post as §1.9 first said) + `stock_transfer_lines` (one line = one source
LAYER; bags / cones printed only); guards per type, post-only status flag, RLS by unit with line
DELETE on edit (0678 shape); `stock_owner_is_closed` (RE = sales order shipped / closed /
cancelled or an Order Completion; IWO / SWO = completed / cancelled); `stock_transfer_layers`
(picker; rate only with the Stock Statement with Value grant); `stock_transfer_post` (balance
rows locked, qty ≤ layer on the transfer date AND today, both legs at the layer rate, both legs
carry `origin_ledger_id` = the receipt). FIFO engine files a transfer at its receipt's date and
drains a transfer_out from its own receipt + owner first; Stock Statement reads GRN / in-date /
PO / vendor off the receipt and the order off the layer's owner. `po_requirement_lines` patched
in place to subtract posted transfers per `req_key`. 0804: the post stamps its rate on each line.

**Verified.** Stock Statement for every unit identical before / after the engine rewrite (7
layers, 5,360 qty, ₹4,08,500, same row hash). Rolled-back probes as admin@raagam.test: 2,501 kg
of a 2,500 kg layer refused with a sentence; 1 kg RE→RE posted and the target layer still reads
GRN-0014, in-date 02/11, ₹2.50; source 2,500 → 2,499, item total unchanged; release from an open
order, Order→Order without remarks and a Processing store each refused; line rate stamped.

**Screen.** `/purchase/transfers` (list, new, `[id]`, `[id]/print`). Grid 8 columns, 1,128px
(Class·Category in the picker sub-line, Rate inside Value, Bags·Cones one cell). Tail row, no
"+ Add". The old Sheet (`transfer-form.tsx`) is gone.

**Not done.** `transferStock()` is still called by the Stores ▸ store page's tab
(`app/(app)/stores/[storeId]/store-tabs.tsx`) and still writes two separate inserts with no
owner. A posted transfer cannot be reversed yet (cancel is draft-only). The "RE-13 still needs
this item" warning on Order → Order was left out: the source order's requirement balance is
"still to buy", not "still needs stock", and showing it would mislead. Phase 3 unchanged.
