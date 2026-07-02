# RAAGAM ERP — DEEP CAPTURE & BUILD REFERENCE

**App:** Raagam ERP (Next.js) · **Reference system:** EDP2 by RP Software (© 2010)
**Licensed to:** RAAGAM EXPORTS - Head Office · **Industry:** Garment Exports
**Purpose:** Field-level build reference mapping the legacy EDP2 deep capture onto the **12 modules built in the app**, tagging what's built vs. still to build.
**Legacy capture:** 433 form screenshots across 31 sub-modules (source detail retained below).

> **Session note:** App module hierarchy for **all 12 modules** is detailed in the next section
> (1–6 session 1, 7–12 session 2). The full **legacy EDP2 hierarchy, form field specs, business
> entities, and flows are preserved further down** as the field-level build reference.

---

## EXECUTIVE SUMMARY

The app reorganizes the legacy EDP2 ERP (11 modules / 31 sub-modules / 433 deep-captured forms) into
**12 built modules**. This report is the checklist the app follows: each module lists its real app screens
(✅ built / ◐ partial) and the legacy sub-modules/forms still to build (🔲). Key business characteristics
carried over: multi-currency (USD/INR), order lifecycle (opportunity → quote → order → production → shipment),
BOM-driven material planning, and export-compliance logistics.

### App Module Map (12 modules)

| # | App Module | Route | Legacy EDP2 source |
|---|-----------|-------|--------------------|
| 1 | Sales | `/sales` | Sales ▸ Marketing |
| 2 | Orders | `/orders` | Sales ▸ Garment Orders + TA |
| 3 | Planning | `/planning` | Planning ▸ Materials-Garment Orders + Product Development |
| 4 | Purchase | `/purchase` | Materials ▸ Purchase + Lab |
| 5 | Stores | `/stores` | Materials ▸ Purchase Store + Processing Store |
| 6 | Production | `/production` | Garmenting ▸ Production |
| 7 | Process Planning | `/process` | Planning ▸ Process Planning + Garmenting ▸ Production Planning |
| 8 | HR & Payroll | `/hr` | HR + HRD |
| 9 | Logistics | `/logistics` | Logistics |
| 10 | Finance | `/finance` | Finance |
| 11 | Integration | `/integration` | *(new — Tally export)* |
| 12 | Administration | `/admin` | Administration ▸ Asset/Courier/Rejection/Surplus (+ roles/users) |

**Excluded from the 12:** Master Data `/masters` (legacy Configure) · Dashboard `/` (home). **Dropped:** Embroidery.

---

## APP MODULE HIERARCHY — MODULES 1–12

**Legend:** ✅ built · ◐ partial · 🔲 missing (legacy spec, not yet built)

### 1. SALES — `/sales`  ✅
**Legacy source:** Sales ▸ Marketing (`01_sales_marketing/`, 6 forms)

**Sub-modules (app screens):**
- **Opportunities / Pipeline** (enquiry → costing → quoted → won/lost) — `/sales` ✅
- **Opportunity detail** `/sales/[opportunityId]`:
  - **Styles** (style code, fabric type/subtype) — tab ✅
  - **Cost Sheets** (versioned; draft → submit → approve/reject → clone; computed vs target FOB) — tab ✅
  - **Quotes** (from approved cost sheet; draft → sent → accepted/rejected) — tab ✅
  - **Samples** (proto/fit/sms/pp/top; requested → in-progress → sent → approved/rejected) — tab ✅ *(app addition)*
- **Sales Registers** (cross-opportunity Cost Sheets / Quotes / Samples views) — `/sales/registers` ✅

**Still to build (legacy):** — none; **Product Development request** → Planning ✅ *(Request PD button on the opportunity → creates a `pd_request`)*

### 2. ORDERS — `/orders`  ✅
**Legacy source:** Sales ▸ Garment Orders (`01_sales_garment_orders/`, 14) + Sales ▸ TA (`01_sales_ta/`, 7)

**Sub-modules (app screens):**
- **All Orders** (create from accepted quote; confirmed → in_production → shipped → closed/cancelled) — `/orders` ✅
- **Order detail** `/orders/[orderId]`:
  - **Line items** (colour/size/qty) — tab ✅
  - **T&A Tracker** (plan via template or auto 8-stage; milestones planned/actual/status) — tab ✅
  - **Amendments** (raise type + profit impact → approve/reject) — tab ✅
  - **Revisions** (version history on amendment approval) — tab ✅

**Still to build (legacy):** Customer Color Cards 🔲 · Define Garment Processes (+ amendment) 🔲 · Internal Work Order 🔲 · Prepare Advised Items 🔲 · Packing List Advice 🔲 · Order cancellation/completion ◐ (status only) · TA masters: Activity/Department Assign/User Rights/TA Style/Followups 🔲
*Field spec for Garment Order Amendment & TA Completion: see "Form Specifications" below.*

### 3. PLANNING — `/planning`  ✅
**Legacy source:** Planning ▸ Materials-Garment Orders (`02_planning_materials/`, 30) + Product Development (`02_planning_product_dev/`, 19)

**Sub-modules (app screens):**
- **Planning hub** — `/planning` ✅
- **Bill of Materials** — `/planning/boms` ✅
  - **Fabric BOM** (components: colour/size/GSM/consumption/loss → net; process sequence) — `/planning/orders/[orderId]` tab ✅
  - **Material BOM** (items by category; qty basis nos/MOQ; requires-processing) — tab ✅
- **Budgets** — `/planning/budgets`; pull from BOMs; draft → submit → approve/reject ✅
- **Shortages** (material/garment; required vs available; raise → submit → approve/reject → resolve) — `/planning/shortages` ✅ *(0020)*
- **Shipment Plans** (group orders into a planned ship window; draft → confirmed → cancelled) — `/planning/shipment-plans` (+`[planId]`) ✅ *(0021)*
- **Budget Amendments** (revise an approved budget's total; raise → submit → approve → applies to budget) — `/planning/budget-amendments` ✅ *(0022)*
- **BOM Amendments** (formal record + approval of a fabric/material BOM change) — `/planning/bom-amendments` ✅ *(0023)*
- **SQ Notes & Allocation** (sample-quote note + allocation lines; draft → allocated → cancelled) — `/planning/sq-notes` (+`[sqId]`) ✅ *(0025)*
- **BOM for Internal Work Orders** (material BOM for an Orders internal work order) — `/planning/iwo-boms` (+`[iwoId]`) ✅ *(0026)*
- **Purchase Process Allocation** (allocate an order's process to a vendor + qty/rate; draft → confirmed) — `/planning/process-allocations` ✅ *(0027)*
- **Material Excess Order & Receipt** (order excess, record receipt; open → received → closed) — `/planning/material-excess` ✅ *(0028)*
- **Issue PPM** (production-material issue + line receipts; draft → issued → received; editable line rate) — `/planning/ppm` (+`[ppmId]`) ✅ *(0029)*
- **Stock Completion** (close out planned stock; draft → completed) — `/planning/stock-completion` ✅ *(0030)*
- **Product Development pipeline** (8-stage tracker + product lines) — `/planning/product-dev` (+`[pdId]`) ✅ *(0031)*

**Still to build (legacy):** — **none; Planning module complete.** Legacy nuances folded in: SQ allocation-amendment = edit lines while draft; PPM rate-amendment = editable line rate while draft; PD's 8 legacy steps = pipeline stages.

### 4. PURCHASE — `/purchase`  ✅
**Legacy source:** Materials ▸ Purchase (`03_materials_purchase/`, 26) + Materials ▸ Lab (`03_materials_lab/`, 9)

**Sub-modules (app screens):**
- **Materials & Purchase hub** — `/purchase` ✅
- **Purchase Orders** — `/purchase/orders`; create from budget; submit → approve/reject; open-balance ✅
- **RFQ** — `/purchase/rfq`; lines + vendor quotes → award ✅
- **Goods Receipt Notes (GRN)** — `/purchase/grn`; partial receipt, QC accept/reject, posts to Stores ✅
- **Delivery Challans (DC)** — `/purchase/dc`; issue to processors, returns ✅
- **Vendors** master (yarn/knitting/dyeing/trims/packing) — `/purchase/vendors` ✅
- **Acknowledge Indents** (department indents + lines; open → acknowledged → converted) — `/purchase/indents` (+`[indentId]`) ✅ *(0035)*
- **Price-over-Budget Confirmation** (budget vs quoted rate + variance%; raise → submit → approve/reject) — `/purchase/over-budget` ✅ *(0036)*
- **PO Rate Amendment** (revise a PO line rate; approve applies + recomputes PO total) — `/purchase/rate-amendments` ✅ *(0037)*
- **Cancel Purchase Order** (cancel with logged reason; sets PO status) — `/purchase/po-cancellations` ✅ *(0038)*
- **Lab / QC** (test standards general/customer/order + tests in-house/outside; draft → issued → passed/failed) — `/purchase/lab` ✅ *(0039)*

**Still to build (legacy):** RFQ Item-SQ wise / Itemwise (+ confirm) — ◐ (existing RFQ covers lines + per-vendor quotes + award; item/SQ-wise = grouping view, not yet per-line award).

### 5. STORES — `/stores`  ✅
**Legacy source:** Materials ▸ Purchase Store (`03_materials_purchase_store/`, 20) + Processing Store (`03_materials_processing_store/`, 17)

**Sub-modules (app screens):**
- **Stores list** (types: purchase/processing/material/rejection/surplus) — `/stores` ✅
- **Store detail** `/stores/[storeId]`:
  - **Live Balances** (on-hand per item) — tab ✅
  - **Ledger** (signed movement history) — tab ✅
  - **Movements** (receipt/issue/return/adjust-in/out/**transfer**) — tab ✅
  - **Access** (grant/revoke store-keeper) — tab ✅
- **Opening Stock** (initial balances; draft → posted = adjust-in) — `/stores/opening-stock` (+`[openingId]`) ✅ *(0200)*
- **Material Requisition Slip** (dept requests; draft → submit → approve → issue) — `/stores/requisitions` (+`[mrsId]`) ✅ *(0201)*
- **Return to Vendor** (+ replacement; issue then receipt) — `/stores/vendor-returns` (+`[returnId]`) ✅ *(0202)*
- **CSP Receipt** (customer-supplied material; draft → posted = receipt) — `/stores/csp-receipts` (+`[cspId]`) ✅ *(0203)*

**Still to build (legacy):** Quality audit ◐ (at GRN) · Indent to Purchase ◐ (built as `/purchase/indents`) · Inter-department delivery & receipt ◐ (via transfer) · Delivery against PO ◐ (via GRN) · **Processing** (Yarn issue vs Knitting Program · Receive Knitted Fabric · Issue/Receipt for (re)processing · Multiple processing split) ◐ (covered by transfers + Purchase DC + Process Planning job orders)

### 6. PRODUCTION — `/production`  ✅
**Legacy source:** Garmenting ▸ Production (`04_garmenting_production/`, 12) + Production Planning masters

**Sub-modules (app screens):**
- **Line Dashboard** (per-line output + KPIs) — tab ✅
- **Order Progress** (cutting/sewing/packing %, gap flag) — tab ✅
- **Record Output** (stage, line [sewing], colour/size, good/reject → confirm → log rework) — tab ✅

**Stages built:** Cutting · Sewing · Packing

**Sub-modules (app screens) — added:**
- **Planning Masters** (Work Types + Sewing Operations) — `/production/masters` ✅ *(0204)*
- **Job Orders** (+ components; draft → open → completed) — `/production/job-orders` (+`[jobId]`) ✅ *(0205)*
- **Contractor Piece Rates** (draft → submit → approve/reject) — `/production/piece-rates` ✅ *(0206)*
- **Packing List** (carton-wise; draft → finalized) — `/production/packing-lists` (+`[packingId]`) ✅ *(0207)*
- **Inspection** (final QC; pass/fail/rework) — `/production/inspections` ✅ *(0208)*
- **Despatch** (→ Logistics; draft → despatched) — `/production/despatch` ✅ *(0209)*

**Still to build (legacy):** Deliveries to Sewing/Line/Finishing · Checking (QC) · Ironing/Finishing · Dept receipts for Finishing — ◐ (Record-Output stage tracking + Inspection cover the tail; discrete stages/delivery docs not separately modelled) · Sewing Lines master UI ◐ (seeded, via Line Dashboard) · Garment Process Plan ◐ (via Orders ▸ Garment Processes + Job Orders)
*Field specs for Sewing Lines / Work Types / Job Orders / Material Excess: see "Form Specifications" below.*

### 7. PROCESS PLANNING — `/process`  ✅
**Legacy source:** Planning ▸ Process Planning (`02_planning_process/`, 15) + Garmenting ▸ Production Planning (`04_garmenting_production_planning/`, 26)

**Sub-modules (app screens):**
- **Process job orders** (outsourced knitting / dyeing / finishing; Open / Received / All) — `/process` ✅
  - **New job order** (processor · sales order · fabric BOM · item · sent qty + UOM · DC · planned-loss % · expected return) ✅
- **Process job detail** `/process/[jobId]`: header (type/processor/sent/loss%/received) + **Issue** (DC-out) · **Record receipt** (partial returns + loss-vs-BOM) · **Close** ✅ *(status: draft → issued → in_process → received → closed)*

**Still to build (legacy):** Knitting Specifications / **Knitting Program** (+ cancel) 🔲 · Process **RFQ → quotes → confirm price & qty** (orderwise/processwise) 🔲 · **Price > budget rate** confirmation 🔲 · Cancel Process Order ◐ (close only) · **Rate Amendment** (process/knitting) 🔲 · **Production Planning masters** (Sewing Lines · Sewing Operations · Work Types · Job Orders · Component Details · Garment Process Plan · Jobwork Orders · Contractor Piece Rates + approve) 🔲 · Garment quote requests/receipts/price confirmations · **Material Excess Order & Receipt** · Job/Jobwork completions & cancellations · **Daily Production Wage Splits** 🔲
*Field specs for Sewing Lines / Work Types / Job Orders / Material Excess: see "Form Specifications" below.*

### 8. HR & PAYROLL — `/hr`  ✅
**Legacy source:** HR ▸ Worker Payroll (22) + Staff Payroll (19) + HRD ▸ Worker Payroll (16) + Staff Payroll (13)

**Sub-modules (app screens):**
- **HR & Payroll hub** (worker/staff/contractor counts) — `/hr` ✅
- **Workers** (3 types; shift & piece-rate) — `/hr/workers` ✅ · **Contractors** (piece-rate) — `/hr/contractors` ✅ · **Staff** (monthly-salary) — `/hr/staff` ✅
- **Attendance** (daily hours, OT & extra; biometric/manual) — `/hr/attendance` ✅
- **Piece Records** (worker piece counts; editable until locked) — `/hr/piece-records` ✅
- **Payroll Runs** (weekly workers + monthly staff; dual-account A/C1+A/C2; approve → lock → pay) — `/hr/payroll` (+ `/hr/payroll/[runId]`) ✅
- **Payslips** (weekly worker; A/C1 + A/C2) — `/hr/payslip` ✅ · **Payroll Settings** (OT caps, ESI/PF rates) — `/hr/settings` ✅
- **Advances** (+ repayment; open → repaying → closed) — `/hr/advances` ✅ *(0210)*
- **Allowances & Deductions** (active → ended) — `/hr/adjustments` ✅ *(0211)*
- **Bonus & Increments** (draft → approve/reject) — `/hr/comp-events` ✅ *(0212)*
- **Leave & Encashment** (pending → approve/reject) — `/hr/leave` ✅ *(0213)*
- **Lifecycle** (transfer/resignation/settlement; draft → completed) — `/hr/lifecycle` ✅ *(0214)*
- **Statutory Docs** (ESI Form 3/5/10 + strength; draft → filed) — `/hr/statutory` ✅ *(0215)*
*(polymorphic employee ref across worker/staff/contractor)*

**Still to build (legacy):** Roosters (shift schedules) · Daily Team Assigns · Statutory Attendances ◐ (Attendance covers daily hours/OT/extra) · Employee Opening Details 🔲 (niche migration-time balances)

### 9. LOGISTICS — `/logistics`  ✅
**Legacy source:** Logistics ▸ Pre-Shipment (7) + Shipment (11) + Export Incentives (1)

**Sub-modules (app screens):**
- **Shipment register** (create from buyer + currency + orders; status: planning → docs_ready → shipped → delivered → closed) — `/logistics` ✅
- **Shipment detail** `/logistics/[shipmentId]`:
  - **Details** (consignee, port/country, vessel/voyage, incoterm, ETD/ETA, invoice + linked orders) — tab ✅
  - **Line items** (description/HSN/qty/price/cartons/weights; pull from orders) — tab ✅
  - **Documents** (generate/re-generate + checklist) — tab ✅
  - **Status & workflow** (advance lifecycle) — tab ✅
- **Printable export document** `/logistics/[shipmentId]/documents/[docType]` (commercial invoice · packing list · bill of lading · GST invoice · DGFT) ✅

**Still to build (legacy):** **Pre-Shipment** (Categories / Category Description · **EPCG Declarations** · Order Category Assignment · **Proforma Invoices** + docs · **LC Details**) 🔲 · **Shipment** (**Certificate of Origin** · **GSP** · **Single Country Declaration** · **EP Copy Receipts** · **BOE Details** · **TT Advices**) 🔲 *(commercial invoice / packing list / BL / GST invoice ✅ generated)* · **Export Incentives File** 🔲

### 10. FINANCE — `/finance`  ✅
**Legacy source:** Finance ▸ Masters (10) + Payables (26) + Receivables (23) + General Ledger (7)

**Sub-modules (app screens):**
- **Finance hub** (payables-outstanding / receivables stats) — `/finance` ✅
- **Shipment P&L** (real-time profit per shipment) — `/finance/pnl` (+ `/finance/pnl/[shipmentId]`) ✅
- **Payables** (vendor bills, 3-way match & aging) — `/finance/payables` (+ new bill, `[payableId]`) ✅
- **Receivables** (buyer invoices GBP/EUR + forex, aging) — `/finance/receivables` (+ new, `[receivableId]` record receipt) ✅
- **General Ledger** (journals, admin-only reversal) — `/finance/ledger` (+ new journal, `[entryId]`) ✅
- **Chart of Accounts** (GL account master) — `/finance/accounts` ✅

**Still to build (legacy):** **Masters** (Cost Centre Groups/Centres/Heads/Categories · **Cost Items** · Default Account Heads · **Bank Limits & Interests** · Schedules) 🔲 · **Payables** (**Debit / Credit Notes** · **Cheque management** [opening/deposited/cleared/cancelled] · Contractor Bill Matchings · Price Confirmations · OS Adjustments · Blocked Bills · Bills-not-required GRNs) 🔲 · **Receivables** (**Provisional Invoices** · Bank Journals · **Forward Contracts** + cancellation · **Export Incentives** + receipts/openings · **Domestic Garment Invoices** · **Actual Exchange Rate Details** · Other Income/Expenses · Party Openings) 🔲 · **General Ledger** (General Openings · **Stock Details** · Provisional Journals · **Budgets**) 🔲

### 11. INTEGRATION — `/integration`  ✅ *(net-new — no legacy EDP2 equivalent)*
**Legacy source:** *(none — reads from other modules)*

**Sub-modules (app screens):**
- **Integration dashboard** (pending-approvals / crisis / recent-export stats) — `/integration` ✅
  - **Approvals** (unified cross-module MD/management approval digest) — tab ✅
  - **Daily Summary** (crisis digest: overdue milestones, late POs, pending amendments, negative stock) — tab ✅
  - **Tally Export** (recent export history) — tab ✅
- **Tally Export generator** `/integration/tally` (sales invoices / customer orders / POs / supplier payments → Tally Prime XML); detail + download `/integration/tally/[exportId]` ✅

**Still to build (not legacy — hardening/scope):** **Tally round-trip validation** vs live Tally Prime ◐ · additional voucher / master export types beyond the current four 🔲

### 12. ADMINISTRATION — `/admin`  ✅
**Legacy source:** Administration ▸ Asset (8) · Courier (4) · Rejection Store (4) · Surplus Store (7) + app roles/users

**Sub-modules (app screens):**
- **System Administration hub** — `/admin` ✅
- **Users** (accounts; assign roles + work locations) — `/admin/users` ✅
- **Roles & Permissions** (roles + module-level permission matrix) — `/admin/roles` ✅
- **Assets** (fixed-asset register + assignment delivery/return; active → assigned → retired/disposed) — `/admin/assets` (+`[assetId]`) ✅ *(0216)*
- **Courier** (couriers master + despatches with invoice + POD; draft → despatched → delivered) — `/admin/couriers` tabs ✅ *(0217)*
*(add-only — existing Users/Roles unchanged)*

**Still to build (legacy):** Asset sub-masters (Groups/Activities/Categories · User Activities) ◐ (folded into asset category/group) · **Rejection Store** ◐ *(reachable as `rejection` store type)* · **Surplus Store** ◐ *(reachable as `surplus` store type)*

### MASTER DATA — `/masters`  ✅ *(shared config ← legacy Configure; not one of the 12)*
**Legacy source:** Configure (Materials 15 · Associates · HR · Currencies · GST · System)

**Sub-modules (app screens):**
- **Buyers** ✅ · **Items** ✅ *(◐ — no composition/count/purity/supplier fields)* · **Units of Measure** (= Stock Units) ✅
- **Materials Config** (generic `config_lookups`) — Material Categories · Compositions · Yarn Counts · Yarn Purities · Processes · Components · Gauges · Knitting Dias · Commodities ✅ *(0218)*
- **Transporters** ✅ *(0218)* · **GST Rates** ✅ *(0218)* · **Currencies** (CRUD; was seed-only) ✅ *(0218)*
- Associates covered elsewhere: **Vendors** → `/purchase/vendors` ✅ · **Contractors** → `/hr/contractors` ✅

**Still to build (legacy):** HR Designations/classifications ◐ (free-text on staff) · Locations master UI ◐ (seeded) · Attributes/Material-Attributes/Levies/Out-Document-Terms 🔲 (niche) · richer Materials-Master fields linked to config masters 🔲

---

## LEGACY EDP2 HIERARCHY & FIELD REFERENCE
*(Original deep-capture detail — retained as the field-level build reference and session-2 source. Module numbers below are the legacy EDP2 grouping, not the app's 12.)*

---

## TABLE OF CONTENTS

1. [System Overview](#system-overview)
2. [Module Hierarchy & Task Lists](#module-hierarchy--task-lists)
3. [Form Specifications & Field Captures](#form-specifications--field-captures)
4. [Key Business Entities & Patterns](#key-business-entities--patterns)
5. [Configuration Entities](#configuration-entities)

---

## SYSTEM OVERVIEW

### Organization Information
- **Company Name:** RAAGAM EXPORTS
- **Location:** Head Office (HO)
- **Business Type:** Garment Export Company
- **System:** EDP2 Enterprise Resource Planning
- **Primary Functions:** Sales, Planning, Materials Management, Production, Logistics, Finance, Human Resources

### Key System Characteristics
- Multi-location support (Head Office, U2 locations, department-wise sections)
- Multi-currency enabled (USD, INR)
- Production team-based organization (Teams A1-C6, II A1-C1)
- Stage-based production tracking (CP→PACK, SW stages)
- User role-based access (admin, SUDHAN, brindha, swathi, kalaiselvi, mahalakshmi, SWATHI, BRINDHA, MAHALAKSHMI)
- Export documentation compliance integrated

---

## MODULE HIERARCHY & TASK LISTS

### MODULE 1: SALES

#### 1.1 MARKETING
**Deep Captures:** 6 forms (`01_sales_marketing/task_01.png` to `task_06.png`)

**Sub-Module Tasks:**
1. Create opportunities
2. Define Styles
3. Prepare product cost sheet
4. Quote preparation
5. Confirm quotes
6. Product development request

**Business Logic:** Marketing module handles the initial phase of customer engagement, from opportunity creation through style definition, costing, and quoting, culminating in product development requests for confirmed styles.

---

#### 1.2 GARMENT ORDERS
**Deep Captures:** 14 forms (`01_sales_garment_orders/task_01.png` to `task_14.png`)

**Sub-Module Tasks:**
1. Define customer color cards
2. Style
3. Create sale orders
4. Prepare material BOM for accepted orders
5. Define Garment Processes for accepted orders
6. Internal work order
7. Prepare Advised Items
8. Garment Order Amendment
9. Material BOM Amendment
10. Garment Process Amendment
11. Approve amendment
12. Packing List Advice
13. Garment order cancellation
14. Garment order completion

**Garment Order Amendment Form - Field Specifications:**
| Field Name | Data Type | Notes |
|-----------|-----------|-------|
| SC No | Text | Sales Confirmation Number |
| SC Dt | Date | Sales Confirmation Date |
| Amended Dt | Date | Amendment Date |
| Amendment SINo | Text | Amendment Serial Number |
| Amendment Type | Dropdown | Type classification of amendment |
| Customer ID | Text | Linked customer reference |
| PO No | Text | Purchase Order Number |
| Curr | Dropdown | Currency (USD, INR) |
| Style No | Text | Style/Product Number |
| Ship Type | Dropdown | FOB, SEA, etc. |
| Ship Mode | Dropdown | Shipment mode classification |
| Pay Mode | Dropdown | TT (Telegraphic Transfer), etc. |
| Delivery Dt | Date | Expected delivery date |
| Unit | Dropdown | Measurement unit |
| PO Qty | Numeric | Quantity on PO |

**Business Logic:** Garment Orders represent confirmed customer orders with detailed specifications. Amendments track changes to pricing, dates, quantities, and delivery terms post-confirmation.

---

#### 1.3 TA (TECHNICAL ASSESSMENT)
**Deep Captures:** 7 forms (`01_sales_ta/task_01.png` to `task_07.png`)

**Sub-Module Tasks:**
1. TA Activity
2. TA Department Assign
3. TA User rights
4. TA Style
5. TA Plan
6. TA Followups
7. TA completion

**TA Completion Form - Field Specifications:**
| Field Name | Data Type | Notes |
|-----------|-----------|-------|
| Completion Yr | Numeric | Year of completion |
| Completion No | Text | Completion reference number |
| Completion Dt | Date | Completion date |
| CompletionID | Text | Unique completion identifier |
| Customer ID | Text | Customer reference |
| SC No | Text | Sales Confirmation Number |
| Order No | Text | Order Number |
| Order Qty | Numeric | Quantity in order |
| Delivery Dt | Date | Delivery date |
| CancelID | Text | Cancellation ID (if applicable) |

**Business Logic:** TA (Technical Assessment/Department) manages quality and technical verification of orders before production commences. Completions track when technical requirements are satisfied.

---

### MODULE 2: PLANNING

#### 2.1 MATERIALS - GARMENT ORDERS
**Deep Captures:** 30 forms (`02_planning_materials/`)

**Sub-Module Tasks:**
1. Create Shipment plan
2. SQ Note
3. Prepare fabric BOM
4. Prepare Material BOM
5. BOM for internal orders
6. Prepare material BOM for internal work order
7. Prepare budgets
8. Approve budgets
9. Purchase Process Allocation
10. Material Excess Order and Receipt
11. Issue PPM for garment production
12. Rate Amendment for Garmenting PPMs
13. SQ Allocation Amendment
14. Fabric BOM Amendment
15. Material BOM Amendment
16. Budget Amendment
17. Budget amendments to approve
18. Shortage
19. Shortages to approve
20. Garmenting PPM Cancellation
21. Rate detail for amended items
22. SQ Cancellation
23. Garment Shortage
24. Garment shortages to approve
25. Stock completion
26. Garmenting PPM receipt completion
27-30. Additional related tasks

**Business Logic:** Materials planning translates garment orders into material requirements, generating BOMs (Bill of Materials) at multiple levels and coordinating material allocation across production batches.

---

#### 2.2 PRODUCT DEVELOPMENT
**Deep Captures:** 19 forms (`02_planning_product_dev/task_01.png` to `task_19.png`)

**Sub-Module Tasks:**
1. Acknowledge PD requests
2. Group products for development
3. SQ Note
4. Prepare fabric BOM
5. Prepare material BOM
6. Define garment processes
7. Define items for purchase process
8. Material Excess Order and Receipt
9. Production of Sample
10. Products processing delivery
11. Products processing receipt
12. Samples to department and return
13. Dispatch
14. Shortage
15. Shortages to approve
16. Packing List
17. Stock completion
18. Fabric BOM Amendment
19. Material BOM Amendment

**Business Logic:** Product Development manages the full sample development lifecycle from PD request acknowledgement through BOM preparation, sample production, dispatch, and amendments.

---

#### 2.3 PROCESS PLANNING
**Deep Captures:** 15 forms (`02_planning_process/`)

**Sub-Module Tasks:**
1. Prepare knitting specifications
2. Request for quote
3. Receive quotes from vendors
4. Receive quotes from vendors - Direct (Orderwise)
5. Confirm price & quantity for processes
6. Price more than the Budget Rate confirmation
7. Receive quotes from vendors (Processwise)
8. Confirm process wise Quotes
9. Price more than the budget rate (ProcessWise)
10. Prepare Knitting Program
11. Cancel Knitting Order
12. Cancel Process Order
13. Rate Amendment for process order
14. Rate Amendments for Knitting order
15. Additional related task

**Business Logic:** Process Planning coordinates sub-contracted and in-house processing (knitting, dyeing, finishing) with budget control through quote management and rate amendments.

---

### MODULE 3: MATERIALS

#### 3.1 PURCHASE
**Deep Captures:** 26 forms (`03_materials_purchase/`)

**Sub-Module Tasks:**
1. Acknowledge Indents from departments
2. Request for quote
3. Request for quote (Item-SQ wise)
4. Receive quotes from vendors
5. Receive quotes from vendors - Direct (Orderwise)
6. Confirm price for purchase
7. Price more than the Budget Rate confirmation
8. Request for quote (Itemwise)
9. Receive quotes from vendors (Itemwise)
10. Confirm Itemwise Quotes
11. Price more than the budget rate (Itemwise)
12. Prepare purchase orders
13. Purchase order Approvals
14. Cancel Purchase Order
15. Rate Amendment
16-26. Additional related tasks

**Business Logic:** Purchase module manages the complete procurement lifecycle from indent generation through purchase order creation, approval, and rate management with budget controls.

---

#### 3.2 PURCHASE STORE
**Tasks:** 20

1. Purchase Receipts
2. GANs (Goods Acceptance Notes - Quality)
3. Replacement Deliveries
4. Replacement Receipts
5. Rejection Deliveries
6. Opening Stocks
7. Stock Adjustments
8. Material Transfers
9. Department Deliveries
10. Department Receipts
11. Deliveries
12. Indent to Purchase
13. Material Requisition Slips
14. Requisitions Approved
15. General Item Deliveries
16. CSP Receipts
17. Deliveries Against Purchase Order
18. Delivery Returns
19. And 2+ related tasks

**Business Logic:** Purchase Store manages inventory of purchased materials including receiving, quality inspection, storage, tracking, and distribution to departments and processing units.

---

#### 3.3 PROCESSING STORE
**Tasks:** 17

1. Department Receipts
2. GANs (Quality)
3. Deliveries to Knitting
4. Knitting Receipts
5. Processing Deliveries
6. Processing Receipts
7. Rejection Deliveries
8. Opening Stocks
9. Stock Adjustments
10. Material Transfers
11. Deliveries
12. Department Returns
13. Delivery Returns
14. Department Deliveries
15. Multiple Processing Splits
16. And 2+ related tasks

**Business Logic:** Processing Store manages materials in the processing pipeline (dyeing, finishing, knitting) from vendor to garmenting with quality controls and rejection tracking.

---

#### 3.4 LAB
**Tasks:** 9

1. Test Standards
2. Tests
3. Test Standards for Customers
4. Test Standards for Orders
5. Requisitions
6. In-House Test Reports
7. Issues to Outside Labs
8. Receipts from Outside Labs
9. And 1+ related task

**Business Logic:** Lab module manages quality testing standards and execution (both internal and outsourced) ensuring material and finished product compliance with customer specifications.

---

### MODULE 4: GARMENTING

#### 4.1 PRODUCTION PLANNING
**Deep Captures:** 26 forms (`04_garmenting_production_planning/`)

**Sewing Lines Form - Field Specifications:**
| Field Name | Data Type | Notes |
|-----------|-----------|-------|
| Team ShortName | Text | Abbreviated team identifier |
| Team Name | Text | Full team name |
| Location | Dropdown | HO, U2, etc. |
| Section | Text | PRODUCTION section |
| Created Dt | Date | Line creation date |
| Created User | Text | User who created |
| Blocked | Boolean | Operational status flag |

**Example Teams Captured:** A1, A2, A3, B1, B2, B3, C1, C2, C3, C4, C5, C6, II A1, II C1

**Work Types Form - Field Specifications:**
| Field Name | Data Type | Notes |
|-----------|-----------|-------|
| Stage | Dropdown | Production stage classification |
| Short Name | Text | Abbreviated work type |
| Name | Text | Full work type description |
| Find/Tag All/None/Toggle | Buttons | Multi-select controls |
| Criteria Filter | Input | Filtering mechanism |

**Job Orders Form - Field Specifications:**
| Field Name | Data Type | Notes |
|-----------|-----------|-------|
| WO No | Text | Work Order Number |
| WO Dt | Date | Work Order Date |
| Job Work No | Text | Job Work identifier |
| Customer | Text | Customer name/ID |
| Group No | Text | Group reference number |
| Description | Text | Job description |
| Stage From | Dropdown | Starting production stage |
| Stage To | Dropdown | Ending production stage |
| Style No | Text | Style/Product number |
| Created User | Text | Creator user ID |
| Created Dt | Date | Creation date |

**Example Job Orders:** JO/2526/xxxx series with ABC customer, CP→PACK (Cut Panels to Packing) flow

**Material Excess Order & Receipts Form - Field Specifications:**
| Field Name | Data Type | Notes |
|-----------|-----------|-------|
| Entry No | Text | Entry reference number |
| Entered Dt | Date | Entry date |
| SQ No | Text | Sample Quote number |
| SQ Description | Text | Quote description |
| Customer ID | Text | Customer identifier |
| Created User | Text | Creating user |
| Created Dt | Date | Creation timestamp |
| Modified User | Text | Last modifier |
| Modified Dt | Date | Last modification timestamp |

**Sub-Module Tasks:** 24 tasks including:
1. Sewing Lines
2. Sewing Operations
3. Work Types
4. Job Orders
5. Component Details
6. Job Wise Sewing Operations
7. Garment Process Plans
8. Jobwork Orders
9. Contractor Piece Rate Details
10. Contractor Piece Rates Approved
11. Production Rates More Than Budget Rate Approved
12. Quote Requests (Garments)
13. Quote Receipts (Garments)
14. Price Confirmations (Garments)
15. Confirmed Process Wise Quotes
16. Confirmed Price More Than Budget (ProcessWise)
17. Prices More Than Budget Rate Confirmed
18. Material Excess Order and Receipts
19. Jobwork Cancellations
20. Job Order Completions
21. Job Order Stock Completions
22. Process Order Cancellations
23. Daily Production Wage Splits
24. Rate Amendments for Process Orders

**Business Logic:** Production Planning manages the resource allocation, scheduling, and cost control for garmenting operations including teams, operations sequence, contractor coordination, and budget variances.

---

#### 4.2 MATERIAL & GARMENT STORE
**Tasks:** 25+

1. Department Receipts (Materials)
2. Job Order Receipts (Materials)
3. Job Order Receipts (Garments)
4. GANs (Quality)
5. Department Deliveries - Materials
6. Processing Deliveries
7. Processing Receipts
8. Job Work Deliveries
9. Job Work Receipts
10. Job Work Delivery Returns
11. Department Returns
12. Department Returns (Materials)
13. Contract Process Deliveries
14. Receipt of Contract Works
15. Garmenting PPM Receipts
16. Rejection Deliveries
17. Sample Pieces Deliveries
18. Delivery Returns
19. Department Deliveries (Garments)
20. Department Receipts (Garments)
21. Job Order Deliveries
22. Job Order Returns
23. Surplus Deliveries
24. Stock Adjustments
25. Material Transfers

**Business Logic:** Material & Garment Store manages movement of both raw materials (fabrics, accessories) and garment pieces through production stages, including quality verification, departmental transfers, and rejection tracking.

---

#### 4.3 PRODUCTION
**Tasks:** 12

1. Cutting (Cut Panels - CP stage)
2. Deliveries to Sewing
3. Deliveries to Line
4. Sewing (SW stage)
5. Checking
6. Deliveries to Finishing
7. Department Receipts - Finishing
8. Ironing
9. Packing (PACK stage)
10. Packing Lists
11. Inspections
12. Despatches

**Business Logic:** Production module tracks the sequential processing stages from fabric cutting through final packing and despatch, with quality checkpoints at each stage.

---

### MODULE 5: EMBROIDERY

#### 5.1 EMBROIDERY
**Tasks:** 17

1. Machine Groups
2. Machines
3. Job Orders
4. Thread Consumption
5. Foam Consumption
6. Sequence Consumption
7. Job Order Receipts
8. Daily Productions
9. Job Order Deliveries
10. Job Order Returns
11. Job Order Completions
12. Processing Deliveries
13. Processing Receipts
14. Price Confirmations
15. Delivery Returns
16. General Deliveries
17. General Receipts

**Business Logic:** Embroidery module manages specialized embroidery operations as sub-process within garmenting, tracking machine assignments, material consumption (thread, foam, sequences), and output completion.

---

#### 5.2 MATERIAL STORE
**Tasks:** 10

1. Indent to Purchase
2. Purchase Orders Approved
3. Purchase Receipts
4. Opening Stocks
5. Stock Adjustments
6. Rejection Deliveries
7. Material Requisition Slips
8. General Item Deliveries
9. Material Transfers
10. And related tasks

**Business Logic:** Embroidery-specific material store manages specialized materials (embroidery thread, foam, sequences) procurement and inventory.

---

#### 5.3 COSTING
**Tasks:** 1

1. Costing

**Business Logic:** Tracks embroidery costs per order for cost accounting and profitability analysis.

---

### MODULE 6: HR (HUMAN RESOURCES - WORKER & STAFF)

#### 6.1 WORKER PAYROLL
**Tasks:** 22+

1. Workers (Master)
2. Roosters (Shift Schedules)
3. Recorded Attendances
4. Attendance Corrections
5. Manual Attendances
6. Statutory Attendances
7. Advances
8. Advance Returns
9. Monthly Allowances
10. Monthly Deductions
11. Payslips
12. Production Piece Rate Details
13. Bonus
14. Settlements
15. Increments
16. Worker Transfers
17. Employee Opening Details
18. Leave Details
19. Resignation Details
20. Pieces Rate Wages
21. EL EnCash (Encashment)
22. Daily Team Assigns

**Business Logic:** Worker Payroll manages production workforce (hourly/daily) compensation including attendance, piece rates, statutory requirements, and leave management.

---

#### 6.2 STAFF PAYROLL
**Tasks:** 19

1. Staffs (Master)
2. Roosters
3. Recorded Attendances
4. Attendance Corrections
5. Manual Attendances
6. Statutory Attendances
7. Advances
8. Advance Returns
9. Monthly Allowances
10. Monthly Deductions
11. Payslips
12. Bonus
13. Increments
14. Settlements
15. Employee Opening Details
16. Leave Details
17. Staff Transfers
18. Resignation Details
19. EL EnCash

**Business Logic:** Staff Payroll manages administrative and supervisory staff compensation with similar structures to Worker Payroll but tailored for salaried employees.

---

### MODULE 7: HRD (HUMAN RESOURCE DEVELOPMENT)

#### 7.1 WORKER PAYROLL
**Tasks:** 16

1. Workers (Master)
2. Recorded Attendances
3. Manual Attendances
4. Attendance Corrections
5. Attendances
6. Payslips
7. Bonus
8. Settlements
9. Increments
10. Form 3 Return of Declaration Form (ESI)
11. Form 5 (Joining Service)
12. Form 10 (Leaving Service)
13. Strength Corrections
14. Pieces Rate Wages
15. And 2+ related tasks

**Business Logic:** HRD Worker Payroll focuses on statutory compliance documentation (ESI forms) and strength management for the production workforce.

---

#### 7.2 STAFF PAYROLL
**Tasks:** 13

1. Staffs (Master)
2. Recorded Attendances
3. Attendance Corrections
4. Manual Attendances
5. Attendances
6. Advances
7. Payslips
8. Settlements
9. Increments
10. Form 3 Return of Declaration Form (ESI)
11. Form 5 (Joining Service)
12. Form 10 (Leaving Service)
13. Strength Corrections

**Business Logic:** HRD Staff Payroll manages statutory compliance and strength documentation for administrative staff.

---

### MODULE 8: LOGISTICS

#### 8.1 PRE-SHIPMENT
**Tasks:** 7

1. Category Description
2. Categories
3. EPCG Declarations (Export Promotion Capital Goods)
4. Order Category Assignment
5. Proforma Invoices
6. Proforma Invoice Documents
7. LC Details (Letter of Credit)

**Business Logic:** Pre-shipment manages export documentation preparation including commodity classifications, EPCG compliance, and LC coordination.

---

#### 8.2 SHIPMENT
**Tasks:** 11

1. Invoices
2. Shipment Details
3. Invoice Documents
4. Customs Packing Lists
5. GSPs (Goods Service Packages / Export documentation)
6. Certificates of Origins
7. Single Country Declarations
8. BL Details (Bill of Lading)
9. EP Copy Receipts (Export Promotion)
10. BOE Details (Bill of Entry)
11. TT Advices (Telegraphic Transfer)

**Business Logic:** Shipment manages actual export execution with complete documentation, customs compliance, and financial settlement tracking.

---

#### 8.3 EXPORT INCENTIVES
**Tasks:** 1

1. Export Incentive File

**Business Logic:** Tracks government export incentive claims and documentation.

---

### MODULE 9: ADMINISTRATION

#### 9.1 ASSET
**Tasks:** 8

1. Groups
2. Activities
3. Categories
4. User Activities
5. Openings
6. Asset No Assigns
7. Asset Deliveries
8. Asset Returns

**Business Logic:** Asset module manages fixed assets (machinery, equipment) lifecycle from acquisition through assignment, delivery, and return.

---

#### 9.2 REJECTION STORE
**Tasks:** 4

1. Department Receipts
2. Deliveries
3. Opening Stocks
4. Stock Adjustments

**Business Logic:** Rejection Store manages inventory of rejected/defective materials and garments for return, rework, or disposal.

---

#### 9.3 SURPLUS STORE
**Parallel Structure:** Similar tasks to Rejection Store (not separately detailed)

**Business Logic:** Manages surplus materials and garments for clearance or alternative use.

---

#### 9.4 COURIER
**Tasks:** 4

1. Couriers (Master)
2. Courier Invoices
3. Courier Despatches
4. Courier PODs (Proof of Delivery)

**Business Logic:** Manages domestic courier operations for sample movement, documentation, and tracking.

---

### MODULE 10: FINANCE

#### 10.1 MASTERS
**Tasks:** 10

1. Account Groups
2. Account Heads
3. Cost Centre Groups
4. Cost Centres
5. Cost Heads
6. Cost Categories
7. Default Account Heads
8. Cost Items
9. Bank Limits and Interests
10. Schedules

**Business Logic:** Finance Masters define the chart of accounts, cost structure, and banking parameters.

---

#### 10.2 PAYABLES
**Tasks:** 25+

1. Bill Entries
2. GRN Matchings (Purchase)
3. GRN Matchings (Processing)
4. GRN Matchings (Garments)
5. Contractor Bill Matchings
6. Bill Acceptances
7. Price Confirmations (Processing)
8. Party Openings
9. Debit Notes
10. OS Adjustments (Outstanding)
11. Credit Notes
12. Bank Payments
13. Cash Payments
14. Purchase Order Completions
15. Process Order Completions
16. Cheque Details
17. Cheque Cancellation Details
18. Cheque Opening Details
19. Cheque Cleared Details
20. Cheque Deposited Details
21. Shortages Debited
22. Bills Not Required GRNs
23. Blocked Bills
24. Matched Vouchers
25. Vouchers Matching

**Business Logic:** Payables manages vendor invoicing, three-way matching (PO-GRN-Invoice), payment processing, and cash management.

---

#### 10.3 RECEIVABLES
**Tasks:** 22+

1. Export Invoices
2. Provisional Invoices
3. Bank Journals
4. BL Details Opening
5. BOE Detail Openings
6. Debit Notes
7. Credit Notes
8. Cash Receipts
9. Bank Receipts
10. Party Openings
11. Other Income Expenses
12. Export Incentives
13. Export Incentive Receipts
14. Export Incentive Openings
15. General Invoices
16. Domestic Invoice Against DCs
17. Bank Journals (Opening)
18. Forward Contracts
19. Forward Contract Cancellations
20. Domestic Garment Invoices
21. Actual Exchange Rate Details
22. Domestic Garment Invoice Vouchers

**Business Logic:** Receivables manages customer invoicing (export and domestic), cash collection, forex management, and incentive tracking.

---

#### 10.4 GENERAL LEDGER
**Tasks:** 5

1. Journals
2. General Openings
3. Stock Details
4. Provisional Journals
5. Budgets

**Business Logic:** General Ledger manages overall accounting entries, balances, and budget tracking.

---

### MODULE 11: CONFIGURE (SYSTEM CONFIGURATION)

#### 11.1 MATERIALS CONFIGURATION
**Tasks:** 15

1. Attributes
2. Levies
3. Categories
4. Material Attributes
5. Stock Units
6. Counts
7. Yarn Purities
8. Compositions
9. Materials (Master)
10. Processes
11. Components
12. Gauges
13. Knitting Dias
14. Out Document Terms
15. Commodities

**Business Logic:** Materials Configuration defines the master data for material and component specifications, units, and classifications used throughout the system.

#### 11.2 ASSOCIATES CONFIGURATION
**Sub-modules:** Visible but not separately detailed

**Business Logic:** Manages customer, vendor, contractor, and transporter master records.

#### 11.3 HR CONFIGURATION
**Sub-modules:** Visible but not separately detailed

**Business Logic:** Defines employee classifications, designations, and organizational structures.

#### 11.4 CURRENCIES CONFIGURATION
**Sub-modules:** Visible but not separately detailed

**Business Logic:** Manages multi-currency setup for international transactions.

#### 11.5 GST CONFIGURATION
**Sub-modules:** Visible but not separately detailed

**Business Logic:** Defines GST tax rates and applicability rules (India-specific compliance).

---

## FORM SPECIFICATIONS & FIELD CAPTURES

### Critical Business Forms Captured

#### FORM 1: GARMENT ORDER AMENDMENT
**Module:** Sales > Garment Orders
**Purpose:** Record and track changes to confirmed customer orders

| Field | Type | Mandatory | Notes |
|-------|------|-----------|-------|
| SC No | Text | Yes | Sales Confirmation reference |
| SC Dt | Date | Yes | Original confirmation date |
| Amended Dt | Date | Yes | Amendment effective date |
| Amendment SINo | Text | Yes | Sequential amendment number |
| Amendment Type | Dropdown | Yes | Type of change (price, qty, date, etc.) |
| Customer ID | Text | Yes | Buyer reference |
| PO No | Text | Yes | Customer's purchase order |
| Curr | Dropdown | Yes | Transaction currency (USD/INR) |
| Style No | Text | Yes | Product/style identifier |
| Ship Type | Dropdown | Yes | FOB, CIF, SEA, AIR, etc. |
| Ship Mode | Dropdown | Yes | Shipment classification |
| Pay Mode | Dropdown | Yes | TT, LC, Cash, etc. |
| Delivery Dt | Date | Yes | Amended delivery date |
| Unit | Dropdown | Yes | Pcs, Dz, Dozen, etc. |
| PO Qty | Numeric | Yes | Amended quantity |

---

#### FORM 2: TA COMPLETION
**Module:** Sales > TA (Technical Assessment)
**Purpose:** Record completion of technical requirements for orders

| Field | Type | Mandatory | Notes |
|-------|------|-----------|-------|
| Completion Yr | Numeric | Yes | Year of completion |
| Completion No | Text | Yes | Sequential completion ID |
| Completion Dt | Date | Yes | Date of TA completion |
| CompletionID | Text | Yes | Unique identifier |
| Customer ID | Text | Yes | Buyer reference |
| SC No | Text | Yes | Sales Confirmation number |
| Order No | Text | Yes | Internal order number |
| Order Qty | Numeric | Yes | Total order quantity |
| Delivery Dt | Date | Yes | Expected delivery |
| CancelID | Text | No | Cancellation reference (if cancelled) |

---

#### FORM 3: SEWING LINES
**Module:** Garmenting > Production Planning
**Purpose:** Define and manage production teams/lines

| Field | Type | Mandatory | Notes |
|-----------|-----------|-----------|-------|
| Team ShortName | Text | Yes | Abbreviated identifier (A1, B2, C6, etc.) |
| Team Name | Text | Yes | Full team designation |
| Location | Dropdown | Yes | HO, U2, U3, etc. |
| Section | Text | Yes | PRODUCTION (standard value) |
| Created Dt | Date | System | Auto-populated |
| Created User | Text | System | Auto-populated with current user |
| Blocked | Boolean | Yes | Status flag (true = inactive) |

**Example Data:**
- Team A1 - PRODUCTION section at HO
- Team C6 - PRODUCTION section at HO
- Team II A1 - PRODUCTION section at HO

---

#### FORM 4: WORK TYPES
**Module:** Garmenting > Production Planning
**Purpose:** Define production operation types and stages

| Field | Type | Mandatory | Notes |
|-------|------|-----------|-------|
| Stage | Dropdown | Yes | CP, SW, PACK, etc. |
| Short Name | Text | Yes | Abbreviated operation name |
| Name | Text | Yes | Full operation description |
| Criteria Filter | Input | No | Custom filtering |

**Controls:** Find, Tag All, Tag None, Toggle selection

---

#### FORM 5: JOB ORDERS
**Module:** Garmenting > Production Planning
**Purpose:** Create and track job work assignments

| Field | Type | Mandatory | Notes |
|-------|------|-----------|-------|
| WO No | Text | Yes | Work Order number |
| WO Dt | Date | Yes | Work Order date |
| Job Work No | Text | Yes | Sequential job identifier |
| Customer | Text | Yes | Customer name (internal reference) |
| Group No | Text | Yes | Batch/lot grouping |
| Description | Text | Yes | Job description |
| Stage From | Dropdown | Yes | Starting stage (CP) |
| Stage To | Dropdown | Yes | Ending stage (PACK) |
| Style No | Text | Yes | Product style code |
| Created User | Text | System | Current user |
| Created Dt | Date | System | Timestamp |

---

#### FORM 6: MATERIAL EXCESS ORDER & RECEIPTS
**Module:** Garmenting > Production Planning
**Purpose:** Track excess material orders and receipts for contingency

| Field | Type | Mandatory | Notes |
|-------|------|-----------|-------|
| Entry No | Text | Yes | Reference number |
| Entered Dt | Date | Yes | Entry date |
| SQ No | Text | Yes | Sample Quote number |
| SQ Description | Text | Yes | Quote description |
| Customer ID | Text | Yes | Customer reference |
| Created User | Text | System | User who created |
| Created Dt | Date | System | Creation timestamp |
| Modified User | Text | System | Last modifier |
| Modified Dt | Date | System | Last modification |

---

## KEY BUSINESS ENTITIES & PATTERNS

### 1. CUSTOMER ENTITIES

**Identified Customers (from order data):**
- NEXT LI & (major export customer)
- FROCO
- ABC
- AARSAN AME
- SRI ANURAGAVI GARMEN
- Multiple others tracked in system

**Customer Interactions:** All tracked through Sales Confirmation numbers, Purchase Orders, and order amendments

---

### 2. ORDER NUMBERING CONVENTIONS

**Sales Confirmations:** HO/RE/2526/xxxx
- HO = Head Office location
- RE = Region/Export type
- 2526 = Year designation
- xxxx = Sequential number

**Job Orders:** JO/2526/xxxx
- JO = Job Order prefix
- 2526 = Year
- xxxx = Sequential

**Sample Quotes:** SQ/2425/xxxx
- SQ = Sample Quote
- 2425 = Year
- xxxx = Sequential

**Purchase Orders:** PO/YYYY/xxxx
- Standard procurement reference

---

### 3. PRODUCTION TEAM STRUCTURE

**Team Hierarchy:** Teams organized by letter (A-C) and number (1-6), with section II variants

**Standard Configuration:**
- A Teams: A1, A2, A3 (basic sewing lines)
- B Teams: B1, B2, B3 (intermediate sewing lines)
- C Teams: C1, C2, C3, C4, C5, C6 (advanced/finishing lines)
- II Teams: II A1, II C1 (parallel production lines)

**Locations:** All tracked at Head Office (HO) and U2 locations

**Section:** All classified under PRODUCTION section

---

### 4. PRODUCTION STAGES

**Sequential Processing Stages:**
1. **CP** - Cut Panels (fabric cutting from POs)
2. **SW** - Sewing (assembly operations)
3. **PACK** - Packing (final packing for shipment)

**Quality Checkpoints:** Between each stage with GAN (Goods Acceptance Note) tracking

---

### 5. TRANSACTION CURRENCIES

**Primary Currencies:**
- **USD** - International export transactions (FOB, CIF)
- **INR** - Domestic transactions and wages

**Exchange Rate Management:** Tracked through "Actual Exchange Rate Details" in Receivables

---

### 6. SHIPMENT PARAMETERS

**Shipment Types:** FOB (Free on Board), SEA (Ocean freight), AIR (Air freight)

**Payment Modes:**
- TT (Telegraphic Transfer) - primary
- LC (Letter of Credit) - for high-value orders
- Cash - limited use

---

### 7. USER ROLES & DEPARTMENTS

**Identified Users:**
- admin (system administrator)
- SUDHAN (production/warehouse)
- brindha (accounts/finance)
- swathi (HR/payroll)
- kalaiselvi (material planning)
- mahalakshmi (logistics)
- SWATHI, BRINDHA, MAHALAKSHMI (uppercase variants - possibly different sessions)

**Access Pattern:** Role-based, tracked through "Created User" and audit fields in all transactions

---

### 8. FINANCIAL CONTROLS

**Budget Variance Management:**
- "Prices More Than Budget Rate Confirmed" tasks in multiple modules
- Rate amendments tracked separately for variance approval
- Cost centre-wise tracking in Finance module

**Three-Way Matching:** PO → GRN (Goods Received Note) → Invoice
- Implemented in Payables module
- Separate matching for Purchase, Processing, and Garmenting GRNs

---

### 9. EXPORT COMPLIANCE ENTITIES

**Export Documentation:**
- EPCG (Export Promotion Capital Goods) - tracked
- BOE (Bill of Entry) - customs documentation
- GSP (Goods Service Package) - export documentation
- BL (Bill of Lading) - shipping documentation
- Certificate of Origin - trade compliance
- Single Country Declaration - origin certification

**LC Management:** Letter of Credit details tracked from negotiation through realization

---

### 10. PAYROLL CHARACTERISTICS

**Worker Segment:**
- Production piece-rate based (Pieces Rate Wages)
- Daily attendance tracking (Recorded Attendances)
- Manual attendance corrections allowed
- Leave and encashment management
- Team assignment (Daily Team Assigns)

**Staff Segment:**
- Salaried (Monthly Allowances/Deductions)
- Similar attendance and leave structure
- Separate statutory forms

**Statutory Compliance:**
- ESI (Employee State Insurance) Form 3, 5, 10
- Strength corrections and opening balances

---

### 11. QUALITY ASSURANCE FRAMEWORK

**Test Management:**
- Test Standards defined for materials and orders
- In-house and outsourced testing tracked
- Lab requisitions and report management
- Customer-specific testing requirements

**GAN (Goods Acceptance Notes):**
- Issued at multiple check points:
  - Purchase material receipt
  - Processing material receipt
  - Garmenting material receipt
  - Production stage completion

---

### 12. MATERIAL MANAGEMENT COMPLEXITY

**Multiple Store Types:**
- Purchase Store (raw materials)
- Processing Store (in-process materials)
- Garmenting Store (garment pieces)
- Rejection Store (defective items)
- Surplus Store (excess inventory)

**Inventory Movements:**
- Opening stocks → Allocations → Receipts → Issues → Closing
- Detailed tracking of material consumption by order
- Rejection and damage tracking
- Material transfer between stores

---

### 13. COST CONTROL MECHANISMS

**Cost Centres:** Department-wise cost tracking
- Materials department
- Garmenting department
- Processing department
- Embroidery department
- Each with own cost head hierarchies

**Cost Items:** Granular cost classification for:
- Material costs
- Processing costs
- Direct labor
- Overhead allocation
- Production-related expenses

---

### 14. AUDIT TRAIL PATTERN

**Standard Audit Fields (observed in all major forms):**
- Created User
- Created Dt (timestamp)
- Modified User
- Modified Dt (timestamp)

**Enables:** Complete traceability of transactions and changes

---

## CONFIGURATION ENTITIES

### Materials Configuration

#### 1. **Attributes**
Master attributes for material classification and filtering

#### 2. **Levies**
Import/export duty and levy classifications

#### 3. **Categories**
Primary material categories (fabric types, accessories, etc.)

#### 4. **Material Attributes**
Detailed specifications (color, finish, weight, etc.)

#### 5. **Stock Units**
Units of measurement:
- Pcs (Pieces)
- Dz (Dozens)
- Kg (Kilograms)
- Mtrs (Meters)
- etc.

#### 6. **Counts**
Yarn count specifications for knitted fabrics (16s, 20s, 30s, etc.)

#### 7. **Yarn Purities**
Classification of yarn purity (100% cotton, 65/35 blend, etc.)

#### 8. **Compositions**
Fiber composition specifications (cotton %, polyester %, etc.)

#### 9. **Materials (Master)**
Complete material master with specifications:
- Material Code
- Material Name
- Category
- Composition
- Count
- Purity
- Supplier references
- Standard cost

#### 10. **Processes**
Sub-contract processes:
- Knitting
- Dyeing
- Finishing
- Embroidery
- etc.

#### 11. **Components**
Sub-components used in garment manufacturing:
- Buttons
- Zippers
- Labels
- Trimmings
- Thread
- etc.

#### 12. **Gauges**
Knitting machine gauges (12G, 14G, 16G, etc.)

#### 13. **Knitting Dias**
Knitting diameter specifications

#### 14. **Out Document Terms**
Terms for goods issued outside facility (sub-contract terms)

#### 15. **Commodities**
Customs/export commodity classifications

---

## CRITICAL BUSINESS FLOWS

### Flow 1: Customer Order to Shipment

```
Marketing (Sample Queries & Confirmations)
    ↓
Sales (Garment Orders & Amendments)
    ↓
Technical Assessment (TA Completions)
    ↓
Planning (Material & Process Planning)
    ↓
Purchase (Material Procurement)
    ↓
Garmenting (Production)
    ├─ Cutting (CP Stage)
    ├─ Sewing (SW Stage)
    └─ Packing (PACK Stage)
    ↓
Logistics (Pre-shipment & Shipment)
    ↓
Finance (Invoicing & Payment)
```

### Flow 2: Material to Production

```
Materials > Purchase Module
    ↓
Materials > Purchase Store (Receipt)
    ↓
Quality (GAN - Goods Acceptance)
    ↓
Garmenting > Production (Cutting)
    ↓
Processing Store (if sub-contract)
    ↓
Garmenting > Production (Sewing)
    ↓
Final Packing (PACK Stage)
```

### Flow 3: Cost Control

```
Order Creation (Sales)
    ↓
Quote Requests (Process/Garmenting Planning)
    ↓
Quote Receipts & Price Confirmations
    ↓
Budget Rate Comparison
    ├─ If Within Budget → Proceed
    └─ If Over Budget → Approval Required
    ↓
Rate Amendments (if needed)
    ↓
Purchase Orders / Process Orders
```

### Flow 4: Financial Settlement

```
Goods Receipt (GRN)
    ↓
Vendor Invoice
    ↓
3-Way Matching (PO-GRN-Invoice)
    ↓
Bill Acceptance
    ↓
Cheque/Payment Processing
    ↓
Bank Reconciliation
```

---

## OPERATIONAL STATISTICS

### Module Distribution (Deep Captured Forms)
- **Sales:** 3 sub-modules, 27 forms (Marketing 6, Garment Orders 14, TA 7)
- **Planning:** 3 sub-modules, 64 forms (Materials 30, Product Dev 19, Process 15)
- **Materials:** 4 sub-modules, 72 forms (Purchase 26, Purchase Store 20, Processing Store 17, Lab 9)
- **Garmenting:** 3 sub-modules, 63 forms (Production Planning 26, Material Store 25, Production 12)
- **Embroidery:** 3 sub-modules, 28 forms (Embroidery 17, Material Store 10, Costing 1)
- **HR:** 2 sub-modules, 41 forms (Worker Payroll 22, Staff Payroll 19)
- **HRD:** 2 sub-modules, 29 forms (Worker Payroll 16, Staff Payroll 13)
- **Logistics:** 3 sub-modules, 19 forms (PreShipment 7, Shipment 11, Export Incentives 1)
- **Administration:** 4 sub-modules, 23 forms (Asset 8, Rejection Store 4, Surplus Store 7, Courier 4)
- **Finance:** 4 sub-modules, 67 forms (Masters 11, Payables 26, Receivables 23, General Ledger 7)
- **Configure:** Not deep-captured (system configuration, not operational forms)

**Total Deep-Captured Forms:** 433

---

## SYSTEM CHARACTERISTICS SUMMARY

| Characteristic | Details |
|---|---|
| **ERP System** | EDP2 by RP Software (© 2010) |
| **Industry** | Garment Export |
| **Organization** | RAAGAM EXPORTS (Head Office) |
| **Locations** | Head Office (HO), U2, U3 locations |
| **Major Modules** | 11 (Sales, Planning, Materials, Garmenting, Embroidery, HR, HRD, Logistics, Administration, Finance, Configure) |
| **Sub-Modules** | 31 (deep captured) + Configure |
| **Operational Forms** | 433 (all deep captured) |
| **Currencies** | USD, INR |
| **Primary Customers** | NEXT LI &, FROCO, ABC, AARSAN AME, SRI ANURAGAVI GARMEN (among others) |
| **Production Teams** | A1-C6, II A1-C1 (in PRODUCTION section) |
| **Payroll Categories** | Workers (piece-rate), Staff (salaried) |
| **Quality Framework** | GAN-based, Lab testing (in-house & outsourced) |
| **Export Compliance** | EPCG, BOE, GSP, BL, Certificate of Origin tracking |
| **Financial Controls** | 3-way matching, budget variance management, cost centre tracking |
| **User Roles** | admin, supervisory staff, functional experts across departments |

---

## CONCLUSION

The EDP2 ERP system at RAAGAM EXPORTS represents a comprehensive, integrated solution for garment export operations. With 11 major modules covering the complete value chain from customer engagement through post-shipment accounting, the system provides:

1. **End-to-end process management** across sales, production, and logistics
2. **Robust cost controls** with budget variance tracking and approval workflows
3. **Complete export compliance** documentation and tracking
4. **Integrated financial management** with 3-way matching and multi-currency support
5. **Detailed payroll** with statutory compliance for production and administrative staff
6. **Quality assurance** at multiple checkpoints with GAN-based tracking
7. **Comprehensive audit trails** for regulatory and internal control purposes

The system architecture reflects best practices in ERP design for discrete manufacturing (garment production) with strong supply chain integration and export-focused compliance capabilities.

---

**Report Status:** Complete - All modules deep captured
**Last Updated:** 2026-03-30
**Data Sources:** 433 deep-captured form screenshots across 31 sub-modules in 10 operational modules
**Document Version:** 3.0
**Capture Scripts:** deep_embroidery_hr.ps1, deep_garmenting.ps1, deep_mat_procstore.ps1, deep_mat_pstore_v3.ps1, deep_logistics_admin.ps1, deep_finance.ps1, deep_sales_planpd.ps1

