Unified Knitting Program, Delivery Challan & Live Analysis Module Specification
1. Executive System Overview & Architecture
1.1 Problem Statement & Legacy Architecture Deficiencies
In the legacy software, managing knitting operations required navigating through five to six separate, disconnected desktop screens and popups:

Prepare Knitting Specifications (Screenshot 4099 & Screenshot 4100): A multi-tiered nested popup structure where operators entered GSM, Tube, Knit Dia, Finished Dia, Loop Length, Gauge, and Ply instructions.
Prepare Knitting Program (Screenshot 4101): A preliminary screen to set up Program Order weights against buyer quotations.
Knitting Order (KO) (Screenshot 4102 & Screenshot 4103): A standalone transaction window to generate KO numbers and assign external knitter vendors (such as RAAGAM FAB or MYILVIRA FABS).
Outward Yarn Delivery Challan (DC): A separate store issue screen to dispatch raw yarn bags to the knitter.
Fabric Receipt GRN: A separate store inward screen to receive knitted fabric rolls.
Knitting Analysis Report (Screenshot 4104 & Screenshot 4105): A static, post-facto printout used to manually audit ordered vs. received fabric and calculate unreturned yarn balances.

This fragmented workflow created severe operational friction: store managers frequently issued yarn without linking to active KO specifications, knitter deliveries were logged without real-time yarn balance checks, and process loss audit reports could only be run long after order completion.
1.2 Unified Single-Screen Vision (/production/knitting-hub)
The new Unified Knitting Program, DC & Analysis Hub consolidates the entire lifecycle—from technical specification and KO generation to yarn outward dispatch, fabric inward receipt, and live reconciliation audit—into a single, interactive 3-step workspace with an embedded real-time analysis dashboard.
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🧵 UNIFIED KNITTING PROGRAM, DC & ANALYSIS WORKSPACE                  (/production/knitting-hub)        │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Group No (RE): [ U2/RE/2627/2076  ▼ ]   Customer: [ AARSAN AMERICAS  ▼ ]   Knitter: [ MYILVIRA FABS  ▼ ] │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [ 📝 1. Program & Knitting Specs ]   [ 🚚 2. Outward Yarn DC ]   [ 📦 3. Fabric GRN & Yarn Return ]   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                         │
│  [ ACTIVE TAB CONTENT OPERATIONAL PANEL ]                                                               │
│                                                                                                         │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 📊 PERSISTENT LIVE KNITTING ANALYSIS & RECONCILIATION DASHBOARD                                         │
│ ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Fabric Program vs. Received:  743.000 KG Ordered  │  737.100 KG Received (1 Roll)  │ 99.2% Yield     │ │
│ │ Yarn Issued vs. Consumption:  740.180 KG Issued   │  737.100 KG Fabric + 0 KG Ret │ 3.080 KG Bal    │ │
│ │ ⚠️ YARN TO BE RETURNED / PROCESS LOSS: 3.080 KGS (0.42%) — ALLOWABLE TOLERANCE WITHIN RANGE (1.5%)  │ │
│ └─────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘


2. Comprehensive Field Reference & UI Layout Specification
Every field in the unified screen is directly mapped to the legacy master screens to ensure zero loss of operational data while vastly simplifying data entry.
2.1 Global Context Filter Header
Located at the top of the workspace, these sticky controls establish the operational context across all three workflow tabs:
Field NameTypeData Source / OptionsLegacy Field ReferenceValidation & RulesGroup No (SQ / RE)Dropdownorders_master (e.g., U2/SQ/2627/0083, U2/RE/2627/2076)SQ No / Group NoRequired. Filters all available fabric BOM lines and active KOs.Group DescriptionRead-onlyorders_master.descriptionSQ Description / DescriptionAuto-populated upon selecting Group No.Customer NameRead-onlycustomer_master (e.g., AARSAN AMERICAS)CustomerAuto-populated from the selected Group/RE.Fabrication Unit (Knitter)Dropdownvendor_master (e.g., MYILVIRA FABS, RAAGAM FAB)Knitter / Fabrication UnitMandatory for dispatching DC and filtering Knitter-specific stock.Delivery DateDate PickerCalendar (YYYY-MM-DD)Delivery DtTarget date for knitted fabric delivery.

2.2 Tab 1: Program & Knitting Specification Setup (Knitting Order & Specs)
This tab merges legacy Knitting Specifications (Screenshots 4099 and 4100) and Knitting Order Creation (Screenshots 4101, 4102, and 4103) into a single flattened grid, eliminating secondary popup windows.
Primary Fabric Specification & KO Line Grid
SNoFabric Category & DescriptionGSMTubeKnit DiaFin DiaLoop Lg Ref/ValGaugePlyProgram Qty (KG / Wt)Billing UOMExpected Rolls1SOLID LOOP KNIT (32's Cotton 55%, 50D Filament 10%, 16's Cotton 35%) / Open Width265OpenWidth34 DIA34 DIA29.500 (29.5 Ref)24Single743.000 KGSKGS20 Rolls2SOLID 2X2 LYCRA DURBY RIB (24's BCI Cotton 97%, 70D Elastane 3%) / Tubular360Tube20 DIA21 DIA28.000 (28.0 Ref)18Single441.173 KGSKGS12 Rolls
Field Dictionary for Tab 1:

KO No & KO Date: System-generated unique identifier (e.g., KO/2627/0141) stamped upon saving the program.
Category: Fabric classification (SOLID LOOP KNIT, SLUB JERSEY, 2X2 LYCRA DURBY RIB, 3T FLEECE BRUSHED).
Fabric Description & Content Breakdown: Full specification string including yarn composition percentages (e.g., 32'S COTTON 55%, 50 DINER FILAMENT 10%, 16'S COTTON (COTTON 80%, POLYESTER 20%) 35% / Open Width).
GSM: Fabric weight per square meter (e.g., 180, 265, 360).
Tube Type: Form factor dropdown (OpenWidth, Tubular).
Knit Dia / Size: Physical machine cylinder diameter (e.g., 20 DIA, 34 DIA).
Finished Dia / Size: Desired finished fabric width required at the cutting table.
Loop Length & Reference: Loop length measurement value and reference baseline (e.g., 29.500 mm / 29.5 Ref).
Gauge & Ply: Machine gauge setting (e.g., 24 Gauge) and yarn ply construction (Single, 2-Ply).
Programmed Qty / Weight: Total fabric weight ordered for knitting in KGS (e.g., 743.000 KGS).
Expected Rolls: Estimated roll count calculated based on target roll weight (e.g., 20 Rolls @ 35 kg/roll).

Automated BOM Yarn Explosion Sub-Grid
Selecting any fabric row dynamically expands the Yarn Requirement Explosion Panel, showing the exact breakdown of yarn blends required to fulfill the programmed fabric weight:
$$W_{\text{yarn}, i} = W_{\text{fabric}} \times \left( \frac{P_i}{100} \right) \times (1 + \text{Allowance}_i)$$
Example for 743.000 KG of SOLID LOOP KNIT:

32's Cotton (55% Share): $743.000 \times 0.55 = 408.650 \text{ KG}$
16's Cotton Blend (35% Share): $743.000 \times 0.35 = 260.050 \text{ KG}$
50 Denier Filament (10% Share): $743.000 \times 0.10 = 74.300 \text{ KG}$


2.3 Tab 2: Outward Yarn Delivery Challan (Yarn Dispatch DC)
Tab 2 handles issuing raw yarn bags from company stores (Raagam HO / Yarn Store) to the assigned knitter premises (MYILVIRA FABS).
Yarn Issue Entry & Store Stock Picker
SNoYarn DescriptionSpinning Mill / Vendor SourceRequired WtBag Stock AvailableBags IssuedNet Wt Issued116'S COTTON (COTTON 80%, POLYESTER 20%)KUMARAGIRI SPINNERS (P) LTD260.050 kg10 Bags (600.0 kg)4 Bags244.000 kg232'S COTTONSIVARAJ SPINNING MILLS (P) LTD408.650 kg12 Bags (720.0 kg)7 Bags409.800 kg350 DENIER FILAMENTJKR SYNTHETICS74.300 kg5 Bags (250.0 kg)2 Bags86.380 kgTOTALDISPATCHED FOR KO/2627/0141DC No: KNTDL/2627/0235743.000 kg27 Bags Available13 Bags740.180 KGS
Field Dictionary for Tab 2:

Doc No / Doc Date: Unique Outward Yarn DC Number (e.g., KNTDL/2627/0235 dated 05-09-2026).
Yarn Specification & Mill Name: Full yarn classification including spinning mill source (e.g., 16'S COTTON - KUMARAGIRI SPINNERS (P) LTD, 32'S COTTON - SIVARAJ SPINNING MILLS (P) LTD).
Issue Store & Bin Location: Source store (Yarn Store) and physical rack bin (HO-YARN-R01-S01).
Bag Count & Bag Weight: Physical bag count and total weight in kg (e.g., 4 Bags = 244.000 KGS).
Bag Rounding Logic (+1 Bag Rule): Because spinning mills supply full sealed yarn bags (e.g., 60 kg or 48 kg bags), store managers cannot break sealed bags. The UI allows rounding up by +1 bag over the exact theoretical requirement without requiring a separate over-budget manager approval.


2.4 Tab 3: Fabric Inward GRN & Yarn Return (Fabric Receipt & Return)
Tab 3 records knitted fabric rolls received back from the knitter and logs any un-knitted yarn or waste yarn returned to company stores.
Fabric Inward & Yarn Return Grid
Inward ParameterValue / Field EntryLegacy ReferenceGRN No & GRN DateKRC/2627/0311 dated 11-09-2026GRN No / GRN DtSupp DC No & Supp DateSupp DC 1073 dated 11-09-2026Supp Dc No / Supp DtFabric DescriptionSOLID LOOP KNIT (32's Cotton 55%, 50D Filament 10%, 16's Cotton 35%)ItemReceived Dia34 DIADiaRoll Count1 RollRollNet Weight Received737.100 KGSWtDestination Store & BinStore: Fabric Store (HO), Bin: HO-FAB-R02-S01Store & Bin MasterReturned Yarn Bags & Wt0 Bags / 0.000 KGSReturned Bag / Wt

2.5 Persistent Live Knitting Analysis & Reconciliation Section
Replicating the core auditing function of Screenshots 4104 and 4105, this persistent summary bar sits at the bottom of the screen across all tabs, rendering live calculations:
Analysis MetricProgrammed / IssuedReceived / ReturnedVariance / Reconciliation BalanceStatusFabric Execution743.000 KGS (KO Ordered)737.100 KGS (GRN Received, 1 Roll)-5.900 KGS Shortfall99.2% FulfilledYarn Ledger740.180 KGS (DC Issued)737.100 KGS (Fabric Wt) + 0.000 KGS (Yarn Ret)3.080 KGS UNRETURNED0.42% Process LossAudit ConclusionTotal Issued: 740.180 KGTotal Accounted: 737.100 KGYARN TO BE RETURNED: 3.080 KGS (0.42%)🟢 Within 1.50% Tolerance

3. Mathematical Formulas & Business Logic Rules
3.1 BOM Yarn Explosion Formula
When a fabric item is programmed for a given weight $W_{\text{fabric}}$, the required weight for each yarn component $i$ with blend percentage $P_i$ is calculated as:
$$W_{\text{yarn}, i} = W_{\text{fabric}} \times \left( \frac{P_i}{100} \right) \times (1 + \text{Allowance}_i)$$
3.2 Bag Weight Rounding Rule (+1 Bag Rule)
Given required yarn weight $W_{\text{yarn}, i}$ and standard bag weight $S_{\text{bag}}$ (e.g., 60 kg):
$$\text{Exact Bags} = \frac{W_{\text{yarn}, i}}{S_{\text{bag}}}$$
$$\text{Permissible Dispatched Bags} = \lceil \text{Exact Bags} \rceil = \lfloor \text{Exact Bags} \rfloor + 1$$
Rule: The store module allows dispatching up to $\lceil \text{Exact Bags} \rceil$ without triggering an over-budget authorization popup.
3.3 Live Yarn Reconciliation & Unreturned Balance Formula
Derived directly from Screenshots 4104 and 4105:
$$W_{\text{balance}} = \sum W_{\text{yarn\_issued}} - \left( \sum W_{\text{fabric\_received}} + \sum W_{\text{yarn\_returned}} \right)$$
$$\text{Unreturned Loss \%} = \left( \frac{W_{\text{balance}}}{\sum W_{\text{yarn\_issued}}} \right) \times 100$$
Example from Screenshot 4104:

Total Yarn Issued = $740.180 \text{ KGS}$
Total Fabric Received = $737.100 \text{ KGS}$
Total Yarn Returned = $0.000 \text{ KGS}$
Unreturned Balance ($W_{\text{balance}}$) = $740.180 - 737.100 = 3.080 \text{ KGS}$
Process Balance Percentage = $\left( \frac{3.080}{740.180} \right) \times 100 = \mathbf{0.42\%}$


4. Database Schema & Data Model
Developers must implement the following relational database structure:
-- 1. Knitting Program Master
CREATE TABLE knitting_programs (
  program_id SERIAL PRIMARY KEY,
  ko_number VARCHAR(50) UNIQUE NOT NULL, -- e.g. KO/2627/0141
  program_date DATE NOT NULL DEFAULT CURRENT_DATE,
  group_no VARCHAR(100) NOT NULL, -- e.g. U2/SQ/2627/0083
  group_description TEXT, -- e.g. U2/RE//2627/2076
  customer_id INT NOT NULL REFERENCES customer_master(customer_id),
  knitter_vendor_id INT NOT NULL REFERENCES vendor_master(vendor_id),
  delivery_date DATE,
  status VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, CLOSED
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Knitting Program Specifications & Items
CREATE TABLE knitting_program_items (
  item_id SERIAL PRIMARY KEY,
  program_id INT NOT NULL REFERENCES knitting_programs(program_id) ON DELETE CASCADE,
  fabric_category VARCHAR(100) NOT NULL, -- e.g. SOLID LOOP KNIT
  fabric_description TEXT NOT NULL, -- Full composition string
  gsm INT NOT NULL, -- e.g. 265
  tube_type VARCHAR(20) DEFAULT 'OpenWidth', -- OpenWidth, Tube
  knit_dia VARCHAR(20) NOT NULL, -- e.g. 34 DIA
  finished_dia VARCHAR(20), -- e.g. 34 DIA
  loop_length_ref NUMERIC(8,3), -- e.g. 29.500
  loop_length NUMERIC(8,3),
  machine_gauge INT, -- e.g. 24
  ply_count VARCHAR(20) DEFAULT 'Single',
  programmed_qty_kg NUMERIC(12,3) NOT NULL, -- e.g. 743.000
  expected_rolls INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Outward Yarn Delivery Challans (DC)
CREATE TABLE yarn_dispatch_dcs (
  dc_id SERIAL PRIMARY KEY,
  dc_number VARCHAR(50) UNIQUE NOT NULL, -- e.g. KNTDL/2627/0235
  dc_date DATE NOT NULL DEFAULT CURRENT_DATE,
  program_id INT NOT NULL REFERENCES knitting_programs(program_id),
  knitter_vendor_id INT NOT NULL REFERENCES vendor_master(vendor_id),
  source_store_id INT NOT NULL REFERENCES stores_master(store_id),
  total_bags INT NOT NULL DEFAULT 0,
  total_issued_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0.000,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Yarn DC Line Items
CREATE TABLE yarn_dispatch_dc_items (
  dc_item_id SERIAL PRIMARY KEY,
  dc_id INT NOT NULL REFERENCES yarn_dispatch_dcs(dc_id) ON DELETE CASCADE,
  yarn_item_id INT NOT NULL REFERENCES item_master(item_id),
  spinning_mill_name VARCHAR(150), -- e.g. KUMARAGIRI SPINNERS (P) LTD
  lot_number VARCHAR(50),
  bags_issued INT NOT NULL DEFAULT 0,
  net_weight_issued_kg NUMERIC(12,3) NOT NULL DEFAULT 0.000
);

-- 5. Fabric Inward Receipt GRNs
CREATE TABLE fabric_receipt_grns (
  grn_id SERIAL PRIMARY KEY,
  grn_number VARCHAR(50) UNIQUE NOT NULL, -- e.g. KRC/2627/0311
  grn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  program_id INT NOT NULL REFERENCES knitting_programs(program_id),
  supp_dc_number VARCHAR(50) NOT NULL, -- e.g. 1073
  supp_dc_date DATE NOT NULL,
  fabric_item_id INT NOT NULL REFERENCES knitting_program_items(item_id),
  received_dia VARCHAR(20) NOT NULL, -- e.g. 34 DIA
  roll_count INT NOT NULL DEFAULT 1,
  net_weight_received_kg NUMERIC(12,3) NOT NULL DEFAULT 0.000,
  target_store_id INT NOT NULL REFERENCES stores_master(store_id),
  target_bin_id INT NOT NULL REFERENCES store_bins_master(bin_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Yarn Return & Waste Entries
CREATE TABLE yarn_return_entries (
  return_id SERIAL PRIMARY KEY,
  grn_id INT REFERENCES fabric_receipt_grns(grn_id),
  program_id INT NOT NULL REFERENCES knitting_programs(program_id),
  yarn_item_id INT NOT NULL REFERENCES item_master(item_id),
  bags_returned INT DEFAULT 0,
  net_weight_returned_kg NUMERIC(12,3) DEFAULT 0.000,
  return_date DATE DEFAULT CURRENT_DATE
);


5. API Endpoints & Developer Integration Workflow
5.1 REST API Endpoint Specifications
1. POST /api/knitting/programs/save-program

Purpose: Saves the KO header and fabric specification lines.
Payload:

{
  "group_no": "U2/SQ/2627/0083",
  "group_description": "U2/RE//2627/2076",
  "customer_id": 104,
  "knitter_vendor_id": 42,
  "delivery_date": "2026-11-25",
  "items": [
    {
      "fabric_category": "SOLID LOOP KNIT",
      "fabric_description": "32'S COTTON 55%, 50 DINER FILAMENT 10%, 16'S COTTON 35%",
      "gsm": 265,
      "tube_type": "OpenWidth",
      "knit_dia": "34 DIA",
      "finished_dia": "34 DIA",
      "loop_length_ref": 29.5,
      "machine_gauge": 24,
      "ply_count": "Single",
      "programmed_qty_kg": 743.0,
      "expected_rolls": 20
    }
  ]
}

2. POST /api/knitting/dc/dispatch-yarn

Purpose: Posts an Outward Yarn DC and deducts yarn bag stock from bin_stock_ledger.
Payload:

{
  "program_id": 812,
  "source_store_id": 3,
  "dc_date": "2026-11-12",
  "yarn_items": [
    {
      "yarn_item_id": 501,
      "spinning_mill_name": "KUMARAGIRI SPINNERS (P) LTD",
      "lot_number": "LOT-16S-09",
      "bags_issued": 4,
      "net_weight_issued_kg": 244.0
    },
    {
      "yarn_item_id": 502,
      "spinning_mill_name": "SIVARAJ SPINNING MILLS (P) LTD",
      "lot_number": "LOT-32S-14",
      "bags_issued": 7,
      "net_weight_issued_kg": 409.8
    }
  ]
}

3. POST /api/knitting/grn/receive-fabric

Purpose: Posts Fabric Inward GRN, updates fabric stock, and logs yarn return entries.

4. GET /api/knitting/analysis/reconciliation?program_id={id}

Purpose: Fetches real-time reconciliation totals for the Live Knitting Analysis section.
Response:

{
  "program_id": 812,
  "ko_number": "KO/2627/0141",
  "ordered_fabric_kg": 743.0,
  "received_fabric_kg": 737.1,
  "total_yarn_issued_kg": 740.18,
  "total_yarn_returned_kg": 0.0,
  "unreturned_balance_kg": 3.08,
  "unreturned_balance_percent": 0.42,
  "status": "WITHIN_TOLERANCE"
}


6. Implementation Summary & Checklist for Developers

[x] Consolidate Screens: Merge legacy screens 4099, 4100, 4101, 4102, 4103, 4104, and 4105 into /production/knitting-hub.
[x] BOM Explosion: Auto-calculate yarn blend weights based on fabric composition %.
[x] Bag Rounding: Enforce $+1 \text{ bag}$ rounding rule without blocking store dispatches.
[x] Reconciliation Calculation: Implement live formula $W_{\text{balance}} = \text{Issued} - (\text{Fabric Recd} + \text{Returned})$.
[x] Database Migration: Deploy SQL schema for programs, DCs, GRNs, and reconciliation analytics.