# Knitting Hub — build plan (2026-11-11)

Spec: `doc/process/knitting.md` (Knitting Program, Yarn DC and Fabric Receipt in one
workspace at `/production/knitting-hub`). This plan maps that spec onto what is already
built, so the tables already holding job work are reused instead of being built again.

Status (2026-11-11): **Phase 1 BUILT** (0825 — Production ▸ Knitting, KO/26-27/n, specs +
yarn explosion, Issue). **Phase 2 BUILT** (0826 — Yarn DC: the Knitting Order's "Send yarn"
opens Purchase ▸ Delivery Challans ▸ Job Work DC with the order picked; Bags column fills kg
from the bag weight; lot picker lists lots on hand oldest-first and sets the bin; dispatch now
books each line in its own lot and refuses a line larger than its lot). **Phase 3 BUILT** (0830 —
`knitting_receipts` / `_fabrics` / `_yarns`, `knitting_receipt_post`: fabric in, yarn used =
fabric × blend % drawn oldest-DC-first lot by lot, yarn return to the shelf, draft bill at fabric
kg × rate; `knitting_order_close`: within Allowed Loss % closes now, past it the `knitting_close`
approval goes to the MD). Knitting receipts are NOT in 0787's `dc_receipts`, so Reports ▸ Process
Loss by Vendor does not count knitting yet — the Knitting Analysis report covers it. **Phase 4 BUILT**
(`/production/knitting-hub/<id>/report` — fabric programmed vs received, yarn ledger, movements,
audit conclusion; linked from the list's report icon and the order header; 0828 dropped the empty
0110 `knitting_programs`, the dashboard counts knitting process orders, the demo seed no longer
writes it). All four phases built 2026-11-11.
Decisions D1–D4 (§5) taken by the user on 2026-11-11, all four as recommended.

## 0. What already exists (every table below holds ZERO rows today)

| Spec asks for | Already built | Gap |
|---|---|---|
| Knitting Order (KO) to a knitter | `process_orders` with `process_type = 'knitting'`: vendor (master vendor), RE / IWO link, rate, expected date, `allowed_loss_pct` (0364, 0786) | No knitting specs (GSM, Dia, Gauge, Loop, Ply, rolls). No yarn explosion. One line = one item. |
| `knitting_programs` | 0110 table, Process Planning. No screen, only a dashboard count | Replaced by this plan (§2.5). |
| Yarn outward DC | Process DC: `delivery_challans` (`dc_kind = 'process'`) + `dc_line_items` with store, bin, lot. `process_dc_dispatch` moves stock to the unit's Processing store ("at vendor") in one transaction and refuses more than the order line's balance (0786) | No bag count on a DC line. No "+1 bag" allowance. |
| Fabric GRN + loss | Process Receipt: `dc_receipts` + `process_receipt_post` takes the output item into a store and bin, works out loss % against allowed %, and raises a draft bill flagged `exception` on excess (0787) | **It is one DC line in, one item out.** Knitting is **several yarns in, one fabric out**, so a 1-fabric receipt has to be split across 3 yarn lines. That function is the main new piece of work. |
| Yarn returned unknitted | Same receipt with Close balance, which writes the rest off as loss | A real return (yarn back on the shelf) is not there. |
| Analysis report | Reports ▸ Stock at Vendor · Process Loss by Vendor | Not per KO. No live bar. |
| Blend % per fabric | Fabric BOM already explodes each fabric into its yarns × `mixing_pct` (`mixingDetailRows`, `lib/orders/fabric-bom/reports.ts`, used by the Y&F Requirement report) | Read it. Never retype the blend. |
| Bag rounding | Raise PO: `bag_weight` + `bags`, "round up, max one extra bag" (0758) | Same rule on the DC. |
| Stock ledger | `stock_ledger` (store, bin, lot, `garment_order_id`, `iwo_id`) | The spec's `bin_stock_ledger` is this table. |

**The spec's SQL is not used as written.** It uses `SERIAL` ids and tables this app does
not have (`customer_master`, `vendor_master`, `item_master`, `stores_master`,
`store_bins_master`). Every table here is uuid-keyed and points at `master_vendors`,
`items`, `stores`, `bins` and `sales_orders`, with unit (location) scoping and RLS, as
every other document does.

## 1. The one decision underneath everything

**A Knitting Order IS a Process Order of type knitting, plus two child tables.**
Not a fourth job-work path beside it. The reason is everything that comes free with it:
"Pending orders / At Vendor / Returned" on Process DC, the stock moving to "at vendor",
the loss limit, the draft bill, and the Stock at Vendor and Process Loss reports. All of
that already works for a Process Order and would have to be rebuilt for a separate table.
The Knitting Hub is a new screen over these documents, not a new set of documents.

## 2. Schema (migration A, then B in Phase 3)

### 2.1 Knitting specs: `process_order_knit_fabrics` (Tab 1 grid, one row per fabric)
- `process_order_id`; `fabric_item_id` (the grey fabric that comes back);
  `fabric_bom_ref` (the Fabric BOM requirement row it came from, for "already
  programmed" balance).
- Read from the Fabric BOM, shown read-only: category, description, GSM, tube / open
  width, knit dia, finished dia. This is the 0762 rule: GSM and Dia come from planning.
- Typed on the KO: `loop_length`, `loop_length_ref`, `gauge` (Gauge master), `ply`,
  `programmed_qty_kg`, `roll_weight_kg`. `expected_rolls` = ceil(qty ÷ roll weight) is
  derived, never typed. This follows the 10-30 rule that Gauge and Loop are typed on the
  order sent to the vendor.

### 2.2 Yarn explosion: `process_order_knit_yarns` (sub-grid, one row per fabric × yarn)
- `knit_fabric_id`, `yarn_item_id`, `blend_pct` (copied from the Fabric BOM's
  `mixing_pct`), `allowance_pct` (default from the order's allowed loss %),
  `required_kg` = programmed × blend% × (1 + allowance%), and `bag_weight_kg`.
- `required_bags` = ceil(required ÷ bag weight) is derived.
- Blends of one fabric must total 100%. Save is refused otherwise.
- **This row is the Process Order LINE.** Each yarn row creates the matching
  `process_order_lines` row (item = yarn, `sent_qty` target = required_kg,
  `output_item_id` = the fabric). Process DC's balance check then works unchanged.

### 2.3 DC bags: `dc_line_items` + `bags`, `bag_weight_kg`
- Kg issued is typed from the scale. Bags are counted.
- Cap per yarn row = required_kg + one bag (D2).

### 2.4 Knitting receipt (Phase 3): `knitting_receipt_post(dc_ids, header, fabrics, returns)`
- One receipt per **fabric**, against every DC of the KO:
  - fabric rolls, net and gross kg, received dia, the knitter's DC no, vehicle, and the
    store and bin it goes to;
  - yarn **returned** per yarn: bags and kg, back to the shelf the keeper picks.
- **Input used** per yarn = fabric received × that yarn's blend %. Stock then moves:
  - the input used leaves the Processing store as an ISSUE (consumed);
  - the fabric enters the chosen store and bin as a RECEIPT;
  - returned yarn TRANSFERS from Processing back to the store.
- **Close** writes off what is still at the knitter as process loss, with a mandatory
  reason (same as 0787's Close balance).
- Rows go into the existing `dc_receipts` / `dc_receipt_lines`, so Process Loss by
  Vendor and the draft bill see knitting like any other process.

### 2.5 `knitting_programs` (0110)
It has no rows, no screen and no writer. Phase 4 drops it and the dashboard count moves
to Knitting Orders. It is left alone until then.

## 3. Formulas (the spec's, checked against the example)

- Yarn required per yarn = fabric kg × blend% × (1 + allowance%).
  Example: 743 × 55% = 408.650 kg before allowance.
- Bags = ceil(kg ÷ bag weight). The DC may issue up to that many bags.
- Balance at knitter = Σ yarn issued − (Σ fabric received + Σ yarn returned).
  Example: 740.180 − (737.100 + 0) = 3.080 kg.
- Loss % = balance ÷ issued × 100. Example: 3.080 ÷ 740.180 = 0.42%.
- Fulfilment = fabric received ÷ programmed. Example: 737.1 ÷ 743 = 99.2%.

Every figure on the analysis bar is a sum of posted DC lines and receipts, never a typed
total. That is what makes it "live".

## 4. Phases

1. **KO + specs + explosion.** Migration A (§2.1–2.3).
   - `/production/knitting-hub` list and editor with the header (RE / IWO / SWO picker,
     customer read-only, knitter = vendors registered for Knitting, delivery date).
   - Tab 1: pick fabrics off the order's current Fabric BOM, with an "already programmed"
     balance shown. The yarn sub-grid fills itself from the BOM blends. Changing Programmed
     Qty re-derives kg and bags on the spot (acceptance 1).
   - Save writes the Process Order and its lines. Issue = status issued.
2. **Tab 2: Yarn DC.** A Process DC against the KO.
   - Store, then bin, lists only bins holding that yarn (lot shown, FIFO first). A bin
     with nothing on it is not offered.
   - Bags + kg per yarn, capped at the bin's stock and at the KO's +1 bag.
   - Dispatch calls the existing `process_dc_dispatch`, which moves the stock (acceptance 2).
   - Print the DC with the job-work line.
3. **Tab 3: Fabric receipt + yarn return.** Migration B (§2.4) and the receipt form.
   - The loss is shown red past the allowed % (acceptance 3).
   - Close writes off the balance and closes the order (acceptance 4).
4. **Analysis.**
   - The live bar under all three tabs.
   - A per-KO **Knitting Analysis** report (the 4104 / 4105 printout) in the Reports
     catalog.
   - Drop `knitting_programs`.
   - Sidebar: **Production ▸ Knitting** as its own sub-module.

Each phase ships on its own and is usable before the next starts. Phases 1–2 can go
live without Phase 3, because a KO and its DCs make sense before any fabric is back.

## 5. Decisions (user 2026-11-11, all as recommended)

- **D1 · Over-tolerance loss.** The pasted brief says loss past the allowed % needs
  management approval before the program closes. The 2026-10-31 decision for every Process
  Receipt is the opposite: warn, never block, and flag the draft bill `exception`.
  **Decided:** keep warn + flag on receipt, and route only the **Close** of an
  over-tolerance KO to the MD through the approval engine.
- **D2 · Beyond the +1 bag.** The spec allows up to ceil(bags) without approval and does
  not say what happens past that. **Decided:** refuse, the same as Raise PO (0758).
  Issuing more means raising the KO's programmed qty.
- **D3 · Knitting charge basis.** 0787 bills on input used. Knitters usually bill per kg
  of fabric delivered. **Decided:** bill on fabric kg received × KO rate.
- **D4 · Numbers.** The spec shows `KO/2627/0141`, `KNTDL/2627/0235`, `KRC/2627/0311`.
  **Decided:** use `KO/26-27/0001` for the order, the shape REV numbers already use,
  and keep the DC and receipt on their existing Process DC and Process Receipt series so
  there is one challan register.

## 6. Not in scope

- Knitting in-house on our own machines (no knitter DC). This is for outside knitters
  only, as in the spec.
- Dyeing after knitting. The grey fabric this receipt brings in goes out again on an
  ordinary Process DC.

## 7. Client round 2 (recording 2026-11-11, built 2026-11-12)

What the client asked, and what was built for each:

| Ask | Built |
|---|---|
| Finishing Dia vs Knitting Dia | **Fixed.** The Fabric BOM's dia is the FINISHED dia; Tab 1 now shows it read-only as Fin Dia and asks for **Knit Dia** (required: star, cursor hold, Save and the server action). The DC print and the report show both. KO/26-27/0001 and 0002 were saved before the fix, so their "knit dia" is the BOM's finished dia — check them by eye. |
| Separate Fabric Receipt and Yarn Return | **0831.** Tab 3 Fabric Receipt (PRC-n) and Tab 4 Yarn Return (KYR-n, own sequence); `knitting_receipts.kind`; `knitting_receipt_post` refuses a document carrying both. |
| Blend explosion | Already built (Phase 1). |
| Several RE numbers on one DC | **0832.** A knitting DC may carry lines of several Knitting Orders of the same knitter and unit ("+ Add Knitting Order" on the DC; each line names its KO and RE; the print lists them). Each KO stays one RE, so each RE keeps its own loss. Every reader of "an order's DCs" now goes through the LINES, never `delivery_challans.process_order_id` (dispatch, balance, write-off, close, DC status, the order's DC list, the report, Cancel, the DC's balance-to-send). The stock owner is each line's own order. Other processes keep one order per DC (0787's receipt reads one). |
| Partial DCs against a big program | Already built (Phase 2). |
| Bin stock on the DC | Already built (0826 / 0829). |
| Reconciliation | Already built (Phase 3/4); now also counts yarn moved at the knitter. |
| Yarn already at the knitter | **0833 / 0834.** Read as OUR yarn left at the knitter on another open KO (the knitter's own yarn would be a purchase — not built). Tab 2 lists it; "Move here" calls `knitting_transfer_at_knitter`: the kg comes off the source order's DC lines (kind `transferred`, not loss), a PAPER DC (`delivery_challans.knit_transfer_from`) carries it onto this order within its +1-bag cap, the stock stays in Processing with its owner changed. 0834: the source's loss % leaves moved yarn out of "sent". |

Not yet: registers of Fabric Receipts / Yarn Returns as their own sidebar rows (they live on
the order's tabs); browser test of a shared DC and a move.

## 8. Knitting is its own module: Process (user 2026-11-12)

"Knitting need to move as new module as process … like purchase, production, process also
module." The sidebar has a **Process** row beside Purchase and Production (`/process`,
`components/shell/nav.ts` + `"/process"` in `lib/nav/module-groups.ts`), with **Knitting** as its
sub-module: Knitting Orders `/process/knitting-hub`, Fabric Receipts `/process/knitting-receipts`,
Yarn Returns `/process/knitting-returns`. The old `/production/knitting-*` addresses redirect
(declared in `check-module-groups` REDIRECTED and `check-screen-catalog` UNREGISTERED). The module
row uses the `stores` permission the screens always asked, so access did not change. Code stays in
`lib/production/knitting-*`. Paths in §1–§7 above are the pre-move ones.

## 9. One screen, no tabs (client recording-1794374987319, user 2026-11-12)

- The Knitting Order has **no tabs**. Each yarn row under a fabric carries **From Store · Bin**,
  **In Stock** (the bin's, else the store's) and **Send Qty** (refused past what is left to send
  or what the bin holds). **Issue & Send Yarn** saves (if changed), issues, and dispatches ONE Job
  Work DC for the rows with a Send Qty (`dispatchKnittingYarn` → `saveProcessDc` →
  `process_dc_dispatch`); rows at 0 stay open. An issued order keeps the columns and a **Send Yarn
  (Job Work DC)** button for the next lot. Three calls in a row, not one transaction: a failed
  step stops the rest and what went through stays done.
- **Fabric Receipts / Yarn Returns are entry screens of their own** (Process ▸ Knitting):
  "+ New" → pick the Knitting Order (`?order=`) → the same receipt panel (yarn by blend %, draft
  bill, analysis, Close). The order links to both once yarn is out.
- The yarn-at-knitter panel and the order's DC list sit under the program. Multi-order DCs are
  still raised from Purchase ▸ Delivery Challans ▸ Job Work DC.

## 10. One Knitting Order, several REs (0836, client 2026-11-12)

- The RE moved down to the fabric line: `process_order_knit_fabrics.sales_order_id`
  (backfilled). `process_orders.sales_order_id` stays and holds the FIRST RE, so lists and
  filters keep working; screens show every RE (`order_number` is the REs joined).
- Stock owner per line: `knit_line_owner` / `knit_fabric_owner`. Dispatch, receipt (fabric and
  yarn used), yarn return, write-off at close and the move at the knitter each post under the
  line's own RE. The four functions were re-created from their live bodies with that one
  statement swapped (each swap must match exactly once).
- "Program Placed" is per fabric line's RE; the same BOM slice may sit on one KO for two REs.
- Screen: RE No is a multi-select; the fabric picker lists every picked RE's fabrics (tagged
  "RE …"), each block shows its RE, removing an RE removes its fabrics. The Job Work DC print
  names the RE on every yarn line.
- Sample work orders (SWO) are not offered — they have no Fabric BOM to read.
