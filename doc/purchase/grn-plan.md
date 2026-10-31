# GRN — build plan (from `doc/purchase/grn.md`, 2026-10-31)

Status: PLAN, nothing built. Spec: `doc/purchase/grn.md`. Written against the code
as it stands on branch `purchase` (migrations up to 0776).

## 0. What already exists — extend it, do not build beside it

| Area | Today | Gap against the spec |
|---|---|---|
| GRN | `/purchase/grn` list, `new` form (`grn-new-form.tsx`, 680 lines), detail, Post, QC (GAN) page. `grns` / `grn_line_items` (0008, 0620). Accepted = Received − Rejected, tolerance + Store-Manager authorise, `postGrn` writes stock + draft payable. | Vendor → PO pick only; no filter cascade; one `challan_no` (no invoice no / date / DC no); no bin; no store choice. |
| **Requirement POs** | Raise PO writes `purchase_orders.master_vendor_id` only. | **BLOCKER — a PO raised on Raise PO cannot be received today.** The GRN side reads the legacy `vendor_id` (FK `vendors`), so the PO shows with no vendor and Save stays disabled. |
| Rejection | `rejected_qty` per line; posted rejections already reopen the requirement (`po_line_rejected_qty`, 0740). Rejected stock goes to the unit's `rejection` store. | No debit note, no rejection DC, and the rejected qty is ALSO still open on the old PO → can be bought twice (see §3 decision). |
| Returns / replacement | Stores ▸ Vendor Returns (0202): return + replacement qty, stock issue/receipt. | Not linked to a GRN, PO or requirement. |
| Debit note | `finance_notes` (0107), Finance ▸ Notes. | Free-text reference; no GRN / PO link; nothing creates one automatically. |
| Bins | `bins` (0308): `bin_code`, `location_id`, flat, "common across units". | No store, rack, shelf; no stock per bin; no labels. |
| Stores | `stores` (0010): type purchase/processing/material/rejection/surplus, per unit. | No Stores master screen at all; no Yarn / Fabric / Trims / General store split. |
| Labels | `qrcode` package + Resolve's QR sticker sheet (`sticker-sheet.tsx`). | Reuse the pattern for bin labels. |
| Live board | Realtime pattern in `hr/attendance/live-client.tsx`. | Nothing for stores. |
| Approvals | One engine + one inbox `/approvals` (0500–0505), PO approval + signatures (0764). | Spec §5 is mostly DONE. Only new workflow keys are needed. |

## 1. Decisions taken (and why)

1. **One GRN screen, rebuilt in place** at `/purchase/grn` — the Raise PO shape:
   Pending · Updated · Draft list, a **Filters** button, the editor opened from a row.
   The old `new` form is replaced, not kept beside it.
2. **The vendor is the master vendor.** `grns.master_vendor_id` (FK `master_vendors`),
   the same move 0737 made for POs. Legacy `vendor_id` stays nullable for old GRNs.
3. **"General" Group Type = PO lines with no requirement** (a PO raised on Purchase
   Orders, not from a requirement sheet). So General works on the GRN even though
   Raise PO has no General list yet.
4. **A rejected quantity goes ONE of two ways, chosen on the line** (fixes the
   double-buy):
   - **Replace** (default) — the vendor sends it again on the SAME PO. The PO line stays
     open for that qty; the requirement does NOT reopen. The replacement arrives as a
     **Replacement GRN** (no new payable).
   - **Return & re-buy** — the PO line is short-closed by that qty and the requirement
     reopens so a fresh PO can be raised (what 0740 does today for every rejection).
   Both create the Rejection DC + Debit Note.
5. **Bins become per unit + store** (spec §3), reversing 0487's "bins common across
   units". Code composed, never typed: `HO-TRIM-R01-S02`.
6. **Stock posting moves into ONE database function** (`grn_post`) run in one
   transaction. Today `postGrn` marks the GRN posted first and then swallows stock /
   payable errors — a posted GRN with no stock is possible.
7. **Approvals reuse the existing engine.** No new `approvals` table, no
   `UnifiedApprovals.tsx` — the spec's sketch describes what `/approvals` already does.

## 2. Phases

### Phase 1 — Unblock + header fields — DONE 2026-10-31 (0777)
Built: GRN names the master vendor; vendor list = vendors with an open PO; Invoice No /
Invoice Date / DC No on the form and detail; line `item_id` copied from the PO line;
the draft bill carries `master_vendor_id`. Columns `store_id` / `bin_id` added, unused
until Phase 2. Open: Finance ▸ Payables still shows the legacy vendor only.
- Migration: `grns.master_vendor_id`, `invoice_no`, `invoice_date`, `dc_no`
  (keep `challan_no` readable for old rows); `grn_line_items.item_id`, `store_id`, `bin_id`.
- `getOpenPoLines` reads `master_vendor_id`, and only lines with an open balance.
- Result: a Raise-PO PO can be received with the CURRENT form while Phase 2 is built.

### Phase 2 — The Receiving screen — DONE 2026-10-31 (0778)
Built: `/purchase/grn` is the Raise-PO-shaped list (`grn-screen.tsx`); `grn_open_po_lines()`
returns every open PO line with Group Type / order / buyer / class in one read; the entry
(`grn-new-form.tsx`) opens on a PO from the pencil, carries Store + Bin per line (grid
1128px), and posting books accepted stock into the line's store. Not yet: multi-PO GRN,
bin tied to store (Phase 5), stock per bin (Phase 3). `/purchase/grn/new` still works.

#### Spec as planned
- **List** (Pending = PO lines still to receive grouped by PO; Updated = posted GRNs;
  Draft = draft GRNs). Report icon → GRN report.
- **Filters** (one button, cascade, each narrowed by the ones before):
  `Group Type → Buyer → Vendor → Item Class → RE / Order No`.
  Vendor lists only vendors with an open PO; Item Class only the classes in that
  vendor's open POs; RE No only orders with something pending under them.
- **Editor**: header — Unit (current), Vendor, Invoice No *, Invoice Date *, DC No,
  GRN Date. Grid per PO line — Item, PO qty, Already received, **Received**,
  **Rejected**, Accepted (auto), Reason (when rejected), Replace / Return (when
  rejected), Roll/Batch, **Store** (default from item class), **Bin** (that store's bins).
- Over-tolerance still needs the Store Manager (kept from 0620).
- Keyboard / required / auto-reload / default-row rules as AGENTS.md.

### Phase 3 — Post in one transaction — DONE 2026-10-31 (0779)
Built: `grn_post(grn_id)` (SECURITY DEFINER, checks edit permission + working unit) does
tolerance → PO received qty → PO status → stock (line store + BIN; rejected → Rejection
store) → draft bill, all or nothing; `postGrn` is one RPC call. A unit with no Material /
Rejection store now refuses the post instead of silently skipping stock.
`stock_ledger.bin_id` + view `stock_bin_balances`. Detail page shows Store / Bin.
Dry-run verified (posted, booked 2900 + 100, PO partially received, bill raised, rolled back).
Moved to Phase 4: GAN QC result feeding the line's Rejected qty.

#### As planned
- `grn_post(grn_id)`: tolerance re-check → received qty on PO lines → PO status →
  stock ledger rows **with `bin_id`** → draft payable (not for Replacement GRNs) →
  rejection documents (Phase 4). All or nothing; the screen shows the error.
- `stock_ledger.bin_id` + a bin balance view (`stock_bin_balances`).
- GAN QC result feeds the line: a failed QC fills Rejected (operator confirms).

### Phase 4 — Rejection, Debit Note, Rejection DC, Replacement — DONE 2026-10-31 (0780)
Built: per rejected line **Vendor replaces / Return & re-buy** (`rejection_action`).
On post (`grn_post`): one draft **Debit Note** (`finance_notes`, rejected × rate + GST,
linked to GRN / PO / master vendor) and one draft **Rejection DC** (`vendor_returns` +
lines, linked to the GRN). Return short-closes the PO line (`po_line_items.closed_qty`)
and reopens the requirement (`po_line_rejected_qty` now = closed qty); Replace keeps it
owed on the PO. The GRN's bill is now the RECEIVED value (the vendor's invoice); the
debit note takes off the rejection. **Replacement GRN** (`grns.kind`, `vendor_return_id`):
listed under Pending per DC owed, receives only the owed lines, raises no bill, reduces
the debit note (to 0 → cancelled), marks the DC replaced. The owed qty is no longer
offered on the PO's own Pending row. Vendor Returns: a GRN-raised DC is not edited,
deleted or "Record replacement"d there. Finance ▸ Notes names the master vendor.
Dry-run verified both paths (rolled back).
Follow-ups, built the same day: **Rejection DC print** with the Debit Note copy
(`/stores/vendor-returns/<id>/print`, linked from the GRN and the DC); **GAN QC → line**
(`completeGanCheck` sets the draft line's QC status; the GRN page flags a Failed line with
nothing rejected and takes the rejection in place — `setGrnLineRejection`); `createGrn`
refuses a regular GRN taking qty owed as a replacement (any entry route).

#### As planned
- On post, per rejected line:
  - **Debit Note** — `finance_notes` gains `grn_id`, `purchase_order_id`,
    `master_vendor_id`; amount = rejected × PO rate (+ GST); status draft → issued.
  - **Rejection DC** — `vendor_returns` gains `grn_id` / `grn_line_id` and becomes the
    Rejection DC (printable, with the debit note copy). Stock leaves the rejection store.
  - **Replace** → PO line stays open by that qty; **Return & re-buy** → short-close +
    requirement reopens (change `po_line_rejected_qty` to count only "return" lines).
- **Replacement GRN** — `grns.kind = 'replacement'`, linked to the Rejection DC; receives
  against the same PO line, writes stock, creates **no payable**, closes the DC.

### Phase 5 — Bin Master + labels
- Stores master screen (none exists): code, name, unit, type + **material store class**
  (Yarn / Fabric / Trims / General) so a GRN line defaults to the right store.
- Bin Master: Unit → Store → Rack → Shelf; code composed and unique; existing flat bins
  are kept and shown as "not placed" until edited.
- Labels: print sheet from Bin Master (pick bins) and from a posted GRN (one label per
  line): Unit, Store, Bin code, Item, Lot/RE No, QR. QR opens the bin's contents.

### Phase 6 — Digital Live Board
- `/stores/live-board`, full screen, Realtime on `stock_ledger` (attendance board pattern).
- Unit tabs (HO / U2 / U3) → stores → bin grid, occupied vs empty.
- Hover/click a bin: items, RE No, qty, age in days.
- Feed: latest GRNs in, latest issues out.

### Phase 7 — Approvals (only what is new)
- New workflow keys on the existing engine: `grn_shortage` (over/under receipt beyond
  tolerance — replaces today's inline Store-Manager tick) and `grn_rejection_override`
  (accepting stock QC failed). Each with `_apply_decision`, flow seed, signature column,
  inbox card. Budget and PO approvals already exist.

### Phase 8 — GRN report
- Received history, pending balance per PO line, invoice match (PO qty × rate vs
  invoice), stock age. Registered in the reports catalog.

## 3. Order and size

| Phase | Depends on | Size |
|---|---|---|
| 1 Unblock | — | S (1 migration, 2 files) |
| 2 Screen | 1 | L |
| 3 Post txn | 1 | M |
| 4 Rejection | 3 | L |
| 5 Bins + labels | 1 | M |
| 6 Live board | 3, 5 | M |
| 7 Approvals | 2 | M |
| 8 Report | 3 | S |

Phases 2, 3 and 5 can run in parallel after Phase 1.

## User rules, 2026-10-31 (built same day — 0781, 0782)
- **Entry header, one row:** Store Location (working unit) · GRN Date · Vendor · Document Type
  (Invoice / DC — Replacement removed 10-31, a Replacement GRN opens from its Pending row) · PO No or Replacement DC · its No · its Date (today). No Notes.
- **Grid:** no Shortage / Reason columns; **Lot No** (was Roll / Batch). QC opens on **Passed**.
- **QC Failed → popup:** failed qty + reason + **Rejection** (debit note, Rejection DC, requirement
  reopens) or **Replacement** (Replacement DC, NO debit note, vendor resends on a Replacement GRN).
  0781: two DCs per GRN when both happen (`vendor_returns.dc_kind`); only Rejection is debited.
- **Excess locked:** Today Recd ≤ pending balance (ordered − closed − received − owed as
  replacement). No tolerance band, no Store-Manager override (reverses 0620's UI rule).
- **Close balance:** short of the balance, "Close bal." closes the rest on post
  (`po_line_items.balance_closed_qty`, 0782) — the requirement does NOT reopen.
- **Bin split:** "+ Split bin" → `grn_line_bins`; must add up to the accepted qty (grn_post checks).
- **Replacement as a document type:** picking the Replacement DC locks the vendor.
- Not built: Process DC / Production DC (job-work and inter-unit DCs) — asked as a next step.
