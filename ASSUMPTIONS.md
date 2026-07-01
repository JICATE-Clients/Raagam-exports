# ASSUMPTIONS

Decisions and assumptions made during the build that are **not** explicitly
settled by `doc/prd.md`. Per the PRD Builder Notes, every gap is logged here so
the client can review and correct intent after seeing the software.

## Platform / architecture
- **`cacheComponents` (PPR) is disabled.** The ERP is overwhelmingly per-user,
  per-role dynamic data behind auth. Revisit for public/report surfaces later.
- **Supabase generated types deferred.** Clients are currently untyped against a
  `Database` generic; types will be generated once migrations are applied via the
  Supabase MCP (`project_ref=xcidbfgujrxginrgvbjw`).
- **Two GST entities (HO + Unit 2)** are modelled as rows in a `locations` table
  with location-scoped data and centralized reporting (PRD: "centralized finance
  with location reporting").

## Scope of this build pass (Phase 0–2)
- Only **Foundation + Sales & Marketing + Order Management** are implemented. The
  other 10 modules are roadmapped (see the plan file).
- **Master data** limited to buyers, items/UOM, currencies. Vendor/material
  masters deferred to the Materials & Purchase phase.
- **Amendment cross-module cascade** (BOM/Budget/Purchase/Production/T&A) is
  stubbed — only T&A + order versioning + audit log fire now; downstream cascade
  wires up as those modules arrive.
- **Profit-impact** of an amendment uses the latest **cost-sheet FOB** as the
  baseline until the Planning/Budget module exists.
- **Notifications** (SMS/email, daily crisis summary, MD approval digest) are
  deferred to the System Integration phase. In-app indicators only for now.

## Planning / BOM (Phase 3)
- **One Fabric BOM + one Material BOM per order** (unique constraint). Multi-style
  / component splitting is handled via component rows inside the Fabric BOM, not
  multiple BOM headers.
- **BOMs need no approval** (per PRD); only **budgets** are approved. Budget
  approval uses `planning:approve`; downstream-to-Purchase is a `// TODO` stub
  until the Materials & Purchase module exists.
- **Process loss** is applied as a simple gross-up: `net = gross × (1 + loss%)`
  per component. The process-sequence list carries per-process loss for
  reference; cumulative multi-stage loss compounding can be added later.
- **"Pull from BOMs"** into a budget treats BOM consumption/qty as **per-garment**
  and multiplies by `order_qty`. Fabric lines get `unit_cost = 0` (fabric BOMs
  don't store yarn/fabric cost yet — entered manually); material lines use the
  BOM item's `unit_cost`. All pulled lines remain editable.
- **Amendment → BOM auto-recalculate + alert** (PRD) is **not yet wired**. The
  hook point is `approveAmendment` in `lib/orders/actions.ts` (existing TODO
  cascade); it lands when BOM↔amendment linkage is built out.

## Materials & Purchase (Phase 4)
- **Vendors** live under Materials & Purchase (not Master Data), per the PRD's
  grouping of "vendor management" with purchasing.
- **GRN ↔ PO is many-to-many at the line level** (`grn_line_items.po_line_item_id`):
  one GRN can receive lines from multiple POs, and a PO line can be received
  across multiple GRNs. On **post**, `accepted_qty` accumulates into
  `po_line_items.received_qty` and each affected PO's status is auto-derived via
  `derivePoReceiptStatus` (stays open/partially_received until fully received).
- **GRN post is not a single DB transaction** (sequential updates); acceptable at
  scale, revisit with an RPC if atomicity becomes critical.
- **GRN → Store stock-in** and **GRN → Finance 3-way match** are stubbed (`// TODO`)
  until those modules exist. Likewise **Budget → PO** prefill is supported but the
  reverse downstream is partial.
- **PO from budget** prefills lines from `budget_lines` but they remain editable
  (PRD: "PO differs from budget based on vendor quotation").
- **RFQ is lightweight**: header-level vendor quotes (total + lead time), not
  per-line quotes; awarding a quote sets `rfq.status='awarded'`.
- **DC return** is tracked by incrementing `returned_qty` on the DC line (capped
  at `sent_qty`); no separate return-GRN document. Status auto: issued →
  partially_returned → closed.

## Store Management (Phase 5)
- **Negative stock is blocked at the database** by a trigger on `stock_ledger`
  that maintains `stock_balances` and raises if a movement would drive a balance
  below zero (PRD: "block the issue if stock insufficient" / "stock goes
  negative"). The service also pre-checks for a friendlier message.
- **5 stores seeded at Head Office** (one per type: purchase/processing/material/
  rejection/surplus). Multi-store-per-type / per-location is deferred.
- **Store-level access:** super-admins and users with `stores:approve`
  (Manager/MD/Admin) see all stores; the new **Store Keeper** role is limited to
  its `store_access` assignments (admin grants access). Enforced by RLS via
  `can_access_store()`.
- **`stock_ledger` is append-only** (no update/delete); corrections are
  `adjust_in`/`adjust_out` rows. `stock_balances` is a trigger-maintained cache.
- **GRN → stock-in:** posting a GRN inserts `receipt` movements — accepted qty →
  Material store, rejected qty → Rejection store — using the privileged client
  (system action; the posting user may lack per-store access). Only PO lines
  mapped to an item master generate movements; best-effort (GRN stays posted if
  stock-in hiccups). Issue-to-Production wiring lands with the Production module.
- **transferStock** writes two ledger rows (not a single transaction); a rare
  partial failure is surfaced to the user rather than silently rolled back.

## Production Tracking (Phase 6)
- **Two-step entry:** a supervisor records output (status `recorded`); a manager
  confirms it (`production:approve` → `confirmed`). Only **confirmed** entries
  count toward progress. New **Supervisor** role records but can't confirm.
- **Stage sequence** Cutting → Sewing → Packing is presented (cumulative confirmed
  qty per stage vs order qty, with a gap warning when a downstream stage trails)
  but not hard-blocked at the DB.
- **Reject & rework:** entries carry `good_qty` + `reject_qty`; "Log rework"
  creates an `is_rework=true` entry for re-processed pieces.
- **Production → T&A:** confirming a stage best-effort completes the matching
  Order T&A milestone (`STAGE_MILESTONE`: cutting→Cutting, sewing→Sewing,
  packing→Finishing & Packing) via the privileged client (production managers
  lack `orders:edit`). A sync hiccup never fails the confirmation.
- **Stubbed:** piece-rate **Payroll** feed (sewing entries are the source — wires
  up with HR & Payroll) and **material-issue-from-store on cutting** (use a manual
  store issue for now).
- Representative sewing lines seeded (A1/A2/B1/C1/C6 at HO; IIA1/IIB1/IIC1 at
  Unit 2); admin adds the rest.

## Process Planning (Phase 7)
- Knitting/dyeing/stentering/compacting are **fully outsourced**; the planner
  **manually creates** job orders for a processor (vendor). **Draft-save-with-
  warning** when processor / sent_qty are missing; `issueJob` requires both.
- **Returns** are captured as receipts (partial returns → multiple receipts) with
  a **quality check** (passed/failed/partial) and **loss vs BOM**:
  `loss_qty = sent − cumulative received`; variance vs `planned_loss_pct` is
  highlighted. Job status flips to `received` once cumulative ≥ sent.
- **Receipt → stock-in:** good qty returns to the **Processing store** via the
  privileged client (planners lack per-store access); best-effort, needs the job
  mapped to an item master.
- **DC linkage** is optional (reuses Materials & Purchase `delivery_challans`).
  Auto-writing actual loss back onto `fabric_bom_processes` is deferred (loss is
  recorded on the job for now).

## HR & Payroll (Phase 8)
- **3 worker types** (shift / contractor_piece / company_piece) + monthly **staff**.
  Wage math lives in `lib/hr/calc.ts` (pure functions, single source of truth;
  the payroll action calls them, never reimplements).
- **Dual-account wages:** Actual wage (A/C 1) = shift_wage×days + OT **paid double**
  (`ot_multiplier`, default 2), with **ESI + PF deducted**; Extra wage (A/C 2) has
  **no deductions**.
- **Extra wage by type:** shift = extra_hours×hourly − OT already paid; company_piece
  = pieces×rate − actual **gross**; contractor_piece = 0 at worker level.
  ASSUMPTION: "actual wages paid" in the piece formulas = actual **gross** (wage
  earned before statutory deductions) so A/C1+A/C2 reconstructs piece value.
- **Contractor netting:** Σ(pieces×rate) − Σ(actual gross) of tagged workers,
  floored at 0, paid to the contractor (not the workers).
- **ESI/PF** rates configurable (default employee 0.75% / 12%), deducted on the
  actual wage (and staff salary) only. Employer contributions and exact statutory
  slabs/wage-ceilings are NOT modelled.
- **OT** is capped daily at entry (`max_ot_hours_per_day`); the monthly cap is a
  stored setting, not auto-enforced across runs.
- **Attendance & piece counts** are entered manually/imported (no live biometric
  integration). Production output is line-level, so worker-level piece counts are
  captured in HR (`worker_piece_records`), HR-editable until the run is **locked**.
- **Payroll run is per location** (HO/Unit 2 separate HR teams) via a location
  filter, not RLS-scoped per location.
- **GL posting + ESI/PF statutory challans → stubbed** until Finance / System
  Integration modules exist.

## Logistics & Export Documentation (Phase 9)
- **One shipment record is the source of truth**; all export documents are
  generated/re-generated from it — each `shipment_documents` row stores a JSONB
  **snapshot** of the shipment + lines at generation, so correcting the consignee
  and re-generating flows the fix into every document (PRD requirement).
- **Documents are structured records + print-friendly HTML views** (browser
  Print), not real PDF files or Tally XML. Actual PDF/Tally-XML export is deferred
  to the System Integration module.
- **Checklist** = `REQUIRED_DOC_TYPES` (commercial invoice, packing list, bill of
  lading, GST invoice); **DGFT** is a placeholder doc record (no real e-filing).
- **Shipment completion → Finance receivable** is stubbed (`// TODO`) until the
  Finance module exists.

## Finance (Phase 10)
- **General Ledger** is double-entry; journals must balance (`isJournalBalanced`)
  before posting. **Reversal is admin-only** (`finance:delete` — admin grants it
  to authorise others, per PRD): it posts a swapped-sign reversing entry and marks
  the original `reversed`.
- **Payables 3-way match**: bill ↔ PO total ↔ GRN value via `threeWayMatchStatus`
  (1% tolerance). Payables **aging** buckets (current/1-30/31-60/61-90/90+).
- **Receivables forex**: invoices in GBP/EUR; an exchange rate is captured per
  invoice and again per receipt (rates vary), giving INR equivalents.
- **Shipment P&L** = revenue (the shipment's receivable `amount_inr` if invoiced,
  else `shipments.total_value` as an INR FOB baseline) − `shipment_costs`. A
  "Pull materials cost" rollup sums approved POs linked through
  shipment_orders → budget_orders → purchase_orders.
- **Cross-module auto-postings** (best-effort, privileged client, since the
  acting user lacks finance perms):
  - **GRN post → draft payables** (one per PO, valued at accepted qty × PO unit
    price, with computed 3-way match status).
  - **Shipment shipped → draft AR receivable** (rate defaults 1:1; AR team sets
    the real forex rate).
  - **Payroll lock → posted GL journal** (Dr Wages/Staff Salary; Cr Bank A/C1
    net, ESI payable, PF payable, Bank A/C2 extra).
- **Tally XML export** and **ESI/PF statutory challan files** are deferred to the
  System Integration module.

## System Integration (Phase 11)
- **Tally export** produces a credible Tally "Import Data" ENVELOPE (Sales /
  Sales Order / Purchase Order / Payment vouchers). Ledger names ("Export Sales",
  "Material Purchases", bank ledgers, party = buyer/vendor name) may need tuning
  to the client's actual Tally Prime company setup — the structure is a solid
  starting template, not a validated round-trip into their specific Tally.
- **Exports are manual** (admin/accounts; `integration:create`/`export`).
  Included records are logged in `tally_export_items`; re-exporting creates a new
  batch so records can be re-sent/replaced (PRD).
- **Approvals digest + daily crisis summary are computed read-only** across
  modules; RLS scopes results to the viewer's module permissions (intended for
  MD/management/admin with broad view).
- **Notifications (SMS/email delivery) are NOT implemented** — in-app digests
  only. The PRD wanted SMS for critical + email for reports; no provider is wired.

## Bug Reporter (JKKN Bug Boundary) integration
- `@boobalan_jkkn/bug-reporter-sdk` @1.3.2 mounted **app-wide** via
  `components/bug-reporter-wrapper.tsx` in the root `app/layout.tsx`, with the
  signed-in Supabase user passed as report context; `react-hot-toast` `<Toaster/>`
  added for the SDK's notifications (coexists with our own `components/ui/toast`).
- Installed with **`--legacy-peer-deps`**: the SDK's peer range wants
  `lucide-react` 0.4x–0.5x but the app uses `lucide-react@1.x` everywhere; the icon
  API is stable so 1.x works. Revisit if the SDK errors on a renamed icon.
- The wrapper **only mounts the provider when real credentials are set** (key
  starts with `app_`, not the `REPLACE_ME` placeholder) — the app runs untouched
  until the client registers the app on the Bug Reporter platform and fills
  `.env.local`. `.env.example` documents the two vars and is now git-tracked
  (`!.env.example` exception added to `.gitignore`).
- Mobile floating-button offset in `app/globals.css` is **best-effort** (the SDK
  ships no stable class); the selector must be verified against the live widget
  once credentials are active and tightened if needed.

## Auth / RBAC
- One **super-admin** (MD or IT) seeded at setup; all other access is
  admin-configurable per module (PRD repeated ~13×).
- Login supports **email/password and phone OTP**; users choose (PRD). Phone OTP
  requires an SMS provider configured in Supabase Auth.
- **Approve authorization** is enforced in the Server Action via `can(module,
  'approve')`; table RLS gates writes at the `edit` level (RLS can't distinguish
  which column changed). Approval-bearing mutations therefore live only in
  server actions, never client-side.

## Implementation choices (Phase 0–2 build)
- **Mutations use Server Actions** (`'use server'`) rather than React Query
  mutations — simpler and idiomatic for Next.js 16. React Query is still wired in
  providers for any future client-side fetching. Reads are Server Components.
- **Fonts**: switched from `next/font/google` (Geist) to a system font stack via
  the same CSS variables, so builds are deterministic and don't require network
  access. Swap back to Geist if self-hosted font files are added.
- **Stitch**: design system generated in Stitch project `19757366200390600`
  (asset `4e2a84b7743e47189d98efac3c8aec53`) from `doc/DESIGN.md`; the coded
  Tailwind tokens in `app/globals.css` mirror it and are the implementation
  source of truth. Per-screen Stitch generation can be done on demand later.
- **Amendment approval is not wrapped in a single DB transaction** — the version
  bump + revision snapshot run as sequential statements (revision failure is
  logged, not rolled back). Acceptable at current scale; revisit with an RPC if
  stricter atomicity is needed.
- **UOM dropdown** in the cost-sheet line editor is deferred (the `uoms` prop is
  passed but not yet wired into the item rows).
