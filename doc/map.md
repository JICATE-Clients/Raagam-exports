# RAAGAM ERP — Application Module Map (12 Modules)

**App:** Raagam ERP (Next.js) · **Reference system:** EDP2 by RP Software (© 2010)
**Purpose:** Authoritative module → sub-module checklist the app is built to follow.
Reorganizes the legacy EDP2 deep-capture (11 modules / 31 sub-modules / 433 forms) onto the
**12 modules actually built in the app**, and surfaces the sub-modules still to build.

> **Session note:** All **12** modules are detailed below (1–6 in session 1, 7–12 in session 2),
> each tagged at app-screen granularity. Source of truth for app screens: `components/shell/nav.ts`
> + routes under `app/(app)/` + `*-tabs.tsx` tab components.

---

## STATUS LEGEND

| Tag | Meaning |
|-----|---------|
| ✅ | Built — screen/route exists in the app |
| ◐ | Partial — some behaviour exists, legacy scope not fully covered |
| 🔲 | Missing — in the legacy spec, not yet built |

---

## MODULE MAP (12 modules)

| # | App Module | Route | Permission key | Legacy EDP2 source |
|---|-----------|-------|----------------|--------------------|
| 1 | Sales | `/sales` | `sales` | Sales ▸ Marketing |
| 2 | Orders | `/orders` | `orders` | Sales ▸ Garment Orders + TA |
| 3 | Planning | `/planning` | `planning` | Planning ▸ Materials-Garment Orders + Product Development |
| 4 | Purchase | `/purchase` | `materials_purchase` | Materials ▸ Purchase + Lab |
| 5 | Stores | `/stores` | `stores` | Materials ▸ Purchase Store + Processing Store |
| 6 | Production | `/production` | `production` | Garmenting ▸ Production |
| 7 | Process Planning | `/process` | `process_planning` | Planning ▸ Process Planning + Garmenting ▸ Production Planning |
| 8 | HR & Payroll | `/hr` | `hr_payroll` | HR + HRD |
| 9 | Logistics | `/logistics` | `logistics` | Logistics |
| 10 | Finance | `/finance` | `finance` | Finance |
| 11 | Integration | `/integration` | `integration` | *(new — Tally export, not in legacy)* |
| 12 | Administration | `/admin` | `system_admin` | Administration ▸ Asset, Courier, Rejection Store, Surplus Store (+ roles/users) |

**Not counted as one of the 12:** `/` Dashboard (home screen) · `/masters` Master Data (shared setup ← legacy Configure).
**Dropped from scope:** Embroidery (legacy module 5).

---

# MODULES 1–6 (detailed)

### 1. SALES — `/sales`  ✅
**Permission:** `sales` · **Legacy source:** Sales ▸ Marketing

**Sub-modules (app screens):**
- **Opportunities / Sales Pipeline** (list; stages: enquiry → costing → quoted → won/lost) — `/sales` ✅
- **Opportunity detail** — `/sales/[opportunityId]`
  - **Styles** — style cards (style code, fabric type/subtype) — tab ✅
  - **Cost Sheets** — versioned; draft → submit → approve/reject → clone; computed vs target FOB — tab ✅
  - **Quotes** — from approved cost sheet; draft → sent → accepted (wins)/rejected — tab ✅
  - **Samples** — proto/fit/sms/pp/top; requested → in-progress → sent → approved/rejected — tab ✅ *(app addition)*
- **Sales Registers** (cross-opportunity read-only views of Cost Sheets / Quotes / Samples; each row links to its opportunity) — `/sales/registers` ✅

**Still to build (legacy spec):**
- **Product Development request** → creates a PD request in Planning via a *Request Product Development* button on the opportunity ✅ *(Sales→Planning handoff; writes `pd_requests` via admin client)*

---

### 2. ORDERS — `/orders`  ✅
**Permission:** `orders` · **Legacy source:** Sales ▸ Garment Orders + Sales ▸ TA

**Sub-modules (app screens):**
- **All Orders** (list; create from accepted quote; statuses: confirmed → in_production → shipped → closed / cancelled) — `/orders` ✅
- **Order detail** — `/orders/[orderId]`
  - **Line items** — colour / size / qty — tab ✅
  - **T&A Tracker** — generate plan (template or auto 8-stage); milestones (planned/actual, status) — tab ✅
  - **Amendments** — raise (type + profit impact) → approve/reject — tab ✅
  - **Revisions** — version history (created when an amendment is approved) — tab ✅

**Still to build (legacy spec):**
- Customer **Color Cards** ✅ *(built + migrated — `/orders/color-cards`)*
- Define **Garment Processes** for accepted orders ✅ *(built + migrated — `/orders/[id]/processes`)* · Garment Process Amendment ✅ *(built + migrated — Amendments card on `/orders/[id]/processes`)*
- **Internal Work Order** ✅ *(built + migrated — `/orders/internal-work-orders`)*
- **Prepare Advised Items** ✅ *(built + migrated — `/orders/advised-items`)*
- **Packing List Advice** ✅ *(built + migrated — `/orders/packing-advice`)*
- Garment order **cancellation / completion** — ◐ partial (status flag only, no dedicated flow)
- **TA masters:** TA Activity ✅ · TA Department Assign ✅ *(built + migrated — `/orders/ta-masters`, activity catalogue with owning department & default plan offset)* · TA User Rights · TA Style · TA Followups 🔲 *(niche config — deferred; User Rights largely covered by RBAC)*
- *(Material BOM for accepted orders → handled in Planning module)*

---

### 3. PLANNING — `/planning`  ✅
**Permission:** `planning` · **Legacy source:** Planning ▸ Materials-Garment Orders + Planning ▸ Product Development

**Sub-modules (app screens):**
- **Planning hub** (BOM + Budget counts) — `/planning` ✅
- **Bill of Materials** — `/planning/boms` (per-order Fabric/Material BOM status) ✅
  - **Fabric BOM** — header + components (colour/size/GSM/consumption/loss → net) + process sequence — `/planning/orders/[orderId]` tab ✅
  - **Material BOM** — items grouped by category (sewing/packing accessories), qty basis nos/MOQ, requires-processing — tab ✅
- **Budgets** — `/planning/budgets`; pull lines from BOMs; draft → submit → approve/reject — ✅
- **Shortages** (material/garment gap: required vs available; raise → submit → approve/reject → resolve) — `/planning/shortages` ✅ *(migration 0020)*
- **Shipment Plans** (group orders into a planned ship window; draft → confirmed → cancelled) — `/planning/shipment-plans` (+`[planId]`) ✅ *(migration 0021)*
- **Budget Amendments** (revise an approved budget's total; raise → submit → approve → applies to budget) — `/planning/budget-amendments` ✅ *(migration 0022)*
- **BOM Amendments** (formal record + approval of a fabric/material BOM change) — `/planning/bom-amendments` ✅ *(migration 0023)*
- **SQ Notes & Allocation** (sample-quote note + allocation lines; draft → allocated → cancelled) — `/planning/sq-notes` (+`[sqId]`) ✅ *(migration 0025)*
- **BOM for Internal Work Orders** (material BOM for an Orders internal work order) — `/planning/iwo-boms` (+`[iwoId]`) ✅ *(migration 0026)*
- **Purchase Process Allocation** (allocate an order's process to a vendor + qty/rate; draft → confirmed) — `/planning/process-allocations` ✅ *(migration 0027)*
- **Material Excess Order & Receipt** (order excess material, record receipt; open → received → closed) — `/planning/material-excess` ✅ *(migration 0028)*
- **Issue PPM** (production-material issue with line receipts; draft → issued → received; editable line rate = rate amendment) — `/planning/ppm` (+`[ppmId]`) ✅ *(migration 0029)*
- **Stock Completion** (close out planned stock for an order; draft → completed) — `/planning/stock-completion` ✅ *(migration 0030)*
- **Product Development pipeline** (8-stage tracker: acknowledged → grouped → processes → sample → processing → samples-to-dept → dispatched → packing-list; + product lines) — `/planning/product-dev` (+`[pdId]`) ✅ *(migration 0031)*

**Still to build (legacy spec):** — **none; Planning module complete.** Minor legacy nuances are folded into the screens above (SQ allocation amendment = edit lines while draft; PPM rate amendment = editable line rate while draft; PD's 8 legacy steps modelled as pipeline stages).

---

### 4. PURCHASE — `/purchase`  ✅
**Permission:** `materials_purchase` · **Legacy source:** Materials ▸ Purchase + Materials ▸ Lab

**Sub-modules (app screens):**
- **Materials & Purchase hub** (PO / vendor / DC stats) — `/purchase` ✅
- **Purchase Orders** — `/purchase/orders`; create from budget; submit → approve/reject; open-balance tracking — ✅
- **RFQ** — `/purchase/rfq`; lines + vendor quotes; add quote → award — ✅
- **Goods Receipt Notes (GRN)** — `/purchase/grn`; partial receipt, QC accept/reject, posts to Stores ledger — ✅
- **Delivery Challans (DC)** — `/purchase/dc`; issue material to processors, record returns — ✅
- **Vendors** (master: yarn/knitting/dyeing/trims/packing) — `/purchase/vendors` ✅
- **Acknowledge Indents** (department indents + lines; open → acknowledged → converted) — `/purchase/indents` (+`[indentId]`) ✅ *(migration 0035)*
- **Price-over-Budget Confirmation** (budget vs quoted rate + variance%; raise → submit → approve/reject) — `/purchase/over-budget` ✅ *(migration 0036)*
- **PO Rate Amendment** (revise a PO line rate; approve applies to the line + recomputes PO total) — `/purchase/rate-amendments` ✅ *(migration 0037)*
- **Cancel Purchase Order** (cancel with logged reason; sets PO status) — `/purchase/po-cancellations` ✅ *(migration 0038)*
- **Lab / QC** (test standards [general/customer/order] + tests: in-house / outside-lab, draft → issued → passed/failed) — `/purchase/lab` ✅ *(migration 0039)*

**Still to build (legacy spec):**
- RFQ variants: **Item-SQ wise / Itemwise** (+ confirm itemwise quotes) — ◐ partial (the existing RFQ screen already does lines + per-vendor quotes + award; item/SQ-wise is a grouping view, not yet a distinct per-line award)

---

### 5. STORES — `/stores`  ✅
**Permission:** `stores` · **Legacy source:** Materials ▸ Purchase Store + Materials ▸ Processing Store (unified multi-store)

**Sub-modules (app screens):**
- **Stores list** (store types: purchase · processing · material · rejection · surplus) — `/stores` ✅
- **Store detail** — `/stores/[storeId]`
  - **Live Balances** — on-hand qty per item — tab ✅
  - **Ledger** — signed movement history (type, item, qty, reference, note) — tab ✅
  - **Movements** — receipt / issue / return / adjust-in / adjust-out / **transfer to another store** — tab ✅
  - **Access** — grant/revoke store-keeper access — tab ✅
- **Opening Stock** (set a store's initial balances; draft → posted = adjust-in to ledger) — `/stores/opening-stock` (+`[openingId]`) ✅ *(migration 0200)*
- **Material Requisition Slip** (department requests; draft → submit → approve → issue = ledger issue) — `/stores/requisitions` (+`[mrsId]`) ✅ *(migration 0201)*
- **Return to Vendor** (+ Replacement) (post return = ledger issue; replacement = ledger receipt) — `/stores/vendor-returns` (+`[returnId]`) ✅ *(migration 0202)*
- **CSP Receipt** (customer-supplied/consignment material; draft → posted = ledger receipt) — `/stores/csp-receipts` (+`[cspId]`) ✅ *(migration 0203)*

**Still to build (legacy spec):**
- Quality audit of received materials — ◐ (done at GRN, not in Stores)
- **Indent to Purchase** — ◐ (built on the Purchase side as `/purchase/indents`; MRS covers the store-issue side)
- Inter-department material delivery & receipt (distinct docs) — ◐ (covered by transfer)
- Delivery against Purchase Order — ◐ (via GRN)
- **Processing Store specifics:** Yarn issue vs Knitting Programs · Receive Knitted Fabric · Issue materials for (re)processing · Receipt of material from processing · Multiple processing split — ◐ (covered by store transfers + Purchase DC + Process Planning job orders)

---

### 6. PRODUCTION — `/production`  ✅
**Permission:** `production` · **Legacy source:** Garmenting ▸ Production (+ Production Planning masters)

**Sub-modules (app screens):**
- **Line Dashboard** — today's per-line output (good/reject/pending) + KPI stats — tab ✅
- **Order Progress** — per-order cutting/sewing/packing %, gap flag — tab ✅
- **Record Output** — record entry (stage, line [sewing], colour/size, good/reject) → confirm → **log rework** — tab ✅

**Stages built:** Cutting · Sewing · Packing

**Sub-modules (app screens) — added:**
- **Planning Masters** (Work Types + Sewing Operations) — `/production/masters` (tabs) ✅ *(migration 0204)*
- **Job Orders** (+ component details; draft → open → completed) — `/production/job-orders` (+`[jobId]`) ✅ *(migration 0205)*
- **Contractor Piece Rates** (per-operation rate; draft → submit → approve/reject) — `/production/piece-rates` ✅ *(migration 0206)*
- **Packing List** (carton-wise; draft → finalized) — `/production/packing-lists` (+`[packingId]`) ✅ *(migration 0207)*
- **Inspection** (final QC; draft → completed with pass/fail/rework) — `/production/inspections` ✅ *(migration 0208)*
- **Despatch** (finished-goods despatch → Logistics; draft → despatched) — `/production/despatch` ✅ *(migration 0209)*

**Still to build (legacy spec):**
- Deliveries to **Sewing** / **Line** / **Finishing** · **Checking** (QC) · **Ironing / Finishing** stage · Department receipts for Finishing — ◐ partial (the existing Record-Output stage tracking [cutting/sewing/packing] + Inspection cover the QC/flow tail; discrete checking/ironing/finishing stages + inter-stage delivery docs not separately modelled)
- **Sewing Lines** master UI — ◐ (lines exist + seeded; managed via Line Dashboard, no dedicated CRUD screen)
- **Garment Process Plan** (per-order) — ◐ (covered by Orders ▸ Garment Processes + Production Job Orders)

---

# MODULES 7–12 (detailed)

### 7. PROCESS PLANNING — `/process`  ✅
**Permission:** `process_planning` · **Legacy source:** Planning ▸ Process Planning + Garmenting ▸ Production Planning

**Sub-modules (app screens):**
- **Process job orders** (outsourced knitting / dyeing / finishing) — `/process` ✅
  - **Open / Received / All** tabs (status: draft → issued → in_process → received → closed) — tabs ✅
  - **New job order** — processor (vendor), sales order, fabric BOM, item, sent qty + UOM, DC, planned-loss %, expected return — form ✅
- **Process job detail** — `/process/[jobId]`
  - Job header (type, processor, sent qty, planned loss %, expected return, total received) ✅
  - **Issue** (DC-out to processor) · **Record receipt** (partial returns + loss-vs-BOM check) · **Close** — actions ✅

**Still to build (legacy spec):**
- **Knitting Specifications / Knitting Program** ✅ *(built — `/process/knitting`; draft → running → completed / cancelled)*
- Process **RFQ → receive quotes → confirm price & qty** ✅ *(built — `/process/rfq`; vendor quotes, award/confirm)*
- **Price more than budget rate** confirmation ✅ *(built — over-budget approval gate on confirm, `process_planning:approve`)*
- **Cancel Process Order** — ◐ partial (close only, no cancel/rate flow)
- **Rate Amendment** for process / knitting orders ✅ *(built — `/process/rate-amendments`; approve applies new rate to the confirmed RFQ)*
- **Production Planning masters** (Garmenting): Sewing Lines · Sewing Operations · Work Types · Job Orders · Component Details · Garment Process Plan · Jobwork Orders · Contractor Piece Rates (+ approve) · production rate > budget approved 🔲
- Garment **quote requests / receipts / price confirmations** · **Material Excess Order & Receipt** · Jobwork/Job Order completions & cancellations · **Daily Production Wage Splits** 🔲

---

### 8. HR & PAYROLL — `/hr`  ✅
**Permission:** `hr_payroll` · **Legacy source:** HR (Worker + Staff Payroll) + HRD (Worker + Staff Payroll)

**Sub-modules (app screens):**
- **HR & Payroll hub** (worker / staff / contractor counts) — `/hr` ✅
- **Workers** (3 types: shift & piece-rate) — `/hr/workers` ✅
- **Contractors** (piece-rate) — `/hr/contractors` ✅
- **Staff** (monthly-salary) — `/hr/staff` ✅
- **Attendance** (daily hours, OT & extra; biometric/manual) — `/hr/attendance` ✅
- **Piece Records** (worker piece counts; editable until locked) — `/hr/piece-records` ✅
- **Payroll Runs** (weekly workers + monthly staff; dual-account A/C1+A/C2) — `/hr/payroll`; run detail `/hr/payroll/[runId]` (approve → lock → pay) ✅
- **Payslips** (weekly worker payslip; A/C1 + A/C2) — `/hr/payslip` ✅
- **Payroll Settings** (OT caps, ESI/PF rates) — `/hr/settings` ✅
- **Advances** (employee advance + repayment; open → repaying → closed) — `/hr/advances` ✅ *(migration 0210)*
- **Allowances & Deductions** (recurring/one-off pay adjustments; active → ended) — `/hr/adjustments` ✅ *(migration 0211)*
- **Bonus & Increments** (comp events; draft → approve/reject) — `/hr/comp-events` ✅ *(migration 0212)*
- **Leave & Encashment** (leave application + EL encashment flag; pending → approve/reject) — `/hr/leave` ✅ *(migration 0213)*
- **Lifecycle** (transfers · resignations · settlements; draft → completed) — `/hr/lifecycle` ✅ *(migration 0214)*
- **Statutory Docs** (ESI Form 3/5/10 + strength correction; draft → filed) — `/hr/statutory` ✅ *(migration 0215)*

*All pay-event / lifecycle screens use a polymorphic employee reference across worker/staff/contractor.*

**Still to build (legacy spec):**
- **Roosters** (shift schedules) · **Daily Team Assigns** · **Statutory Attendances** — ◐ (Attendance screen covers daily hours/OT/extra; shift-roster scheduling + team-assign not separately modelled)
- **Employee Opening Details** 🔲 (opening leave/wage balances — niche migration-time data)

---

### 9. LOGISTICS — `/logistics`  ✅
**Permission:** `logistics` · **Legacy source:** Logistics ▸ Pre-Shipment + Shipment + Export Incentives

**Sub-modules (app screens):**
- **Shipment register** (list; create new shipment from buyer + currency + orders; status: planning → docs_ready → shipped → delivered → closed) — `/logistics` ✅
- **Shipment detail** — `/logistics/[shipmentId]`
  - **Details** — header (consignee, port/country, vessel/voyage, incoterm, ETD/ETA, invoice) + linked orders — tab ✅
  - **Line items** — description/HSN/qty/price/cartons/weights; pull from orders — tab ✅
  - **Documents** — generate/re-generate export docs + checklist — tab ✅
  - **Status & workflow** — advance shipment lifecycle — tab ✅
- **Printable export document** — `/logistics/[shipmentId]/documents/[docType]` (commercial invoice · packing list · bill of lading · GST invoice · DGFT) ✅

**Still to build (legacy spec):**
- **Pre-Shipment:** ✅ **complete** — **Proforma Invoices** (`/logistics/proforma`) · **LC Details** (`/logistics/lc`) · **EPCG Declarations** (`/logistics/epcg`) · **Export Categories** (`/logistics/export-categories`) · **Order Category Assignment** (`/logistics/order-categories`)
- **Shipment docs:** ✅ **complete** — commercial invoice · packing list · BL · GST invoice · DGFT · **Certificate of Origin · GSP · Single Country Declaration · EP Copy Receipt · BOE · TT Advice** *(all generatable + printable via the shipment Documents tab; migration 0121 widened the doc-type set)*
- **Export Incentives File** ✅ *(built — `/logistics/incentives`; RoDTEP/Drawback/RoSCTL claims)*

---

### 10. FINANCE — `/finance`  ✅
**Permission:** `finance` · **Legacy source:** Finance ▸ Masters + Payables + Receivables + General Ledger

**Sub-modules (app screens):**
- **Finance hub** (payables-outstanding / receivables stats) — `/finance` ✅
- **Shipment P&L** (real-time profit per shipment: revenue − cost) — `/finance/pnl`; detail `/finance/pnl/[shipmentId]` ✅
- **Payables** (vendor bills, 3-way match & aging) — `/finance/payables`; new bill + detail `/finance/payables/[payableId]` ✅
- **Receivables** (buyer invoices GBP/EUR + forex, aging) — `/finance/receivables`; new + detail `/finance/receivables/[receivableId]` (record receipt) ✅
- **General Ledger** (journal entries, admin-only reversal) — `/finance/ledger`; new journal + detail `/finance/ledger/[entryId]` ✅
- **Chart of Accounts** (GL account master) — `/finance/accounts` ✅

**Still to build (legacy spec):**
- **Masters:** **Cost Centre Groups / Centres** ✅ *(`/finance/cost-centres`)* · **Cost Heads / Categories / Cost Items** ✅ *(`/finance/cost-heads`)* · **Bank Limits & Interests** ✅ *(`/finance/bank-limits`)* · Default Account Heads · Schedules 🔲 *(minor config, deferrable)*
- **Debit / Credit Notes** (vendor + buyer) ✅ *(built — `/finance/notes`)*
- **Cheque Register** ✅ *(built — `/finance/cheques`; issued → deposited → cleared / cancelled / bounced)*
- **Payables:** Contractor Bill Matchings · Price Confirmations · OS Adjustments · Blocked Bills · Bills-not-required GRNs 🔲
- **Forward Contracts** ✅ *(built — `/finance/forward-contracts`; forex cover, utilisation %)*
- **Other Income & Expenses** ✅ *(built — `/finance/other-entries`)*
- **Party Openings** (vendor + buyer opening balances) ✅ *(built — `/finance/party-openings`)*
- **Actual Exchange Rate Details** ✅ *(built — `/finance/exchange-rates`; booked vs actual → gain/loss)*
- **Provisional Invoices** ✅ *(built — `/finance/provisional-invoices`)*
- **Bank Journals** ✅ *(built — `/finance/bank-journals`)*
- **Domestic Garment Invoices** ✅ *(built — `/finance/domestic-invoices`; taxable + GST → total)*
- **General Ledger:** General Openings · **Stock Details** · Provisional Journals · **Budgets** 🔲

---

### 11. INTEGRATION — `/integration`  ✅ *(new — no legacy EDP2 equivalent)*
**Permission:** `integration` · **Legacy source:** *(net-new — reads from other modules)*

**Sub-modules (app screens):**
- **Integration dashboard** (pending-approvals / crisis / recent-export stats) — `/integration` ✅
  - **Approvals** — unified cross-module MD/management approval digest — tab ✅
  - **Daily Summary** — crisis digest (overdue milestones, late POs, pending amendments, negative stock) — tab ✅
  - **Tally Export** — recent export history — tab ✅
- **Tally Export generator** — `/integration/tally` (sales invoices / customer orders / POs / supplier payments → Tally Prime XML); export detail + download `/integration/tally/[exportId]` ✅

**Still to build (not legacy — hardening / scope):**
- **Tally round-trip validation** against a live Tally Prime instance ◐
- Additional voucher / master export types beyond the current four 🔲

---

### 12. ADMINISTRATION — `/admin`  ✅
**Permission:** `system_admin` · **Legacy source:** Administration ▸ Asset · Courier · Rejection Store · Surplus Store (+ app roles/users)

**Sub-modules (app screens):**
- **System Administration hub** — `/admin` ✅
- **Users** (accounts; assign roles + work locations) — `/admin/users` ✅
- **Roles & Permissions** (roles + module-level permission matrix) — `/admin/roles` ✅
- **Assets** (fixed-asset register [code = asset no.] + assignment delivery/return history; active → assigned → retired/disposed) — `/admin/assets` (+`[assetId]`) ✅ *(migration 0216)*
- **Courier** (couriers master + despatches folding in invoice + POD fields; draft → despatched → delivered) — `/admin/couriers` (tabs) ✅ *(migration 0217)*

*Existing Users & Roles screens are unchanged — Assets/Courier were added alongside them (add-only).*

**Still to build (legacy spec):**
- **Asset** sub-masters (Groups / Activities / Categories · User Activities) — ◐ (folded into free-text category/group on the asset record)
- **Rejection Store** (Dept Receipts · Deliveries · Opening Stocks · Stock Adjustments) — ◐ partial *(reachable as a `rejection` store type in Stores)*
- **Surplus Store** (parallel to Rejection Store) — ◐ partial *(reachable as a `surplus` store type in Stores)*

---

## MASTER DATA — `/masters`  ✅ *(shared config ← legacy Configure; not one of the 12, but tracked here)*
**Permission:** `masters` · **Legacy source:** Configure (Materials · Associates · HR · Currencies · GST · System)

**Sub-modules (app screens):**
- **Buyers** (customer master) — Buyers tab ✅
- **Items** (material master — code/name/category/uom) — Items tab ✅ *(◐ vs legacy: no composition/count/purity/supplier/std-cost on the item)*
- **Units of Measure** (= legacy Stock Units) — UOMs tab ✅
- **Materials Config** (generic `config_lookups`, kind-selector) — Materials Config tab ✅ *(migration 0218)* — covers Material Categories · Compositions · Yarn Counts · Yarn Purities · Processes · Components · Gauges · Knitting Dias · Commodities
- **Transporters** (Associates) — Transporters tab ✅ *(migration 0218)*
- **GST Rates** — GST Rates tab ✅ *(migration 0218)*
- **Currencies** (management CRUD; previously seed-only) — Currencies tab ✅ *(migration 0218)*

**Covered in other modules (Associates):** Vendors → Purchase (`/purchase/vendors`) ✅ · Contractors → HR (`/hr/contractors`) ✅

**Still to build (legacy Configure):**
- **HR ▸ Designations / employee classifications** — ◐ (free-text `designation` on staff; no master)
- **System ▸ Locations** master UI — ◐ (`locations` table seeded; no CRUD screen)
- Materials ▸ **Attributes / Material Attributes / Levies / Out-Document Terms** 🔲 (niche)
- Richer **Materials Master** fields (composition/count/purity/supplier/std-cost linked to config masters) 🔲

---

## EXCLUDED / OUT OF SCOPE

- **Dashboard** — `/` (home screen, not a module).
- **Embroidery** — legacy module 5 (Machine, Job Order, Thread/Foam/Sequence consumption). **Dropped — not needed.**

---

## LEGACY EDP2 REFERENCE (source system)

Original capture: **RAAGAM EXPORTS — Head Office**, EDP2 by RP Software (© 2010).
433 deep-captured form screenshots across 31 sub-modules in `C:\Users\admin\1st\erp_screens\`
(each sub-module dir: `00_tasklist_deep.png` + `task_01..XX.png`). Full field-level detail lives in
`doc/deep capture.md`. Legacy bottom-nav tabs (Modules / Formats / Reports / MIS) and the Time/Action
side panel are EDP2-specific and are not carried into the app map above.
