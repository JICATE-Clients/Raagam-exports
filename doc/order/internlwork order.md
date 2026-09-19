GARMENT MANUFACTURING ERP | TECHNICAL SRS MODULE: INTERNAL WORK ORDER (IWO)
CONFIDENTIAL - FOR INTERNAL DEVELOPER HANDOFF ONLY Page 1
INTERNAL WORK ORDER (IWO) MODULE
End-to-End Functional, Technical & UI Architecture Specification for Developers
1. Executive Overview & Module Purpose
The Internal Work Order (IWO) module manages internal demand generation, material planning, and advance stock
procurement prior to receiving a formal customer purchase order. Unlike standard customer order budgeting (which
calculates material demand bottom-up from garment style specs), the IWO module enables direct bulk manual entry
of required weights and quantities across three material categories: Yarn, Fabric, and Accessories.
Feature /
Architecture
Standard Customer Order Budgeting Internal Work Order (IWO) Module
Demand Trigger External Buyer Sales Quote / Order Entry Internal Planning / Trial / Stock Procurement
Garment Panel Logic Calculated per component (Front/Back/Sleeve
GSM)
Completely Bypassed (0 Garment Pcs / 0 Grams)
Consumption
Calculation
Garment Pcs × Grams/Pc ÷ 1000 Direct User Input (Bulk KGS / Bulk Qty)
System Tracking ID Auto-generated RE Number (e.g.,
U2/RE/2627/2093)
Auto-generated IWO Number (e.g.,
U2/IWO/2627/0005)
Advised Items
Protocol
N/A (BOM is frozen from style spec) Supported ([x] Is Advised Item blocks PO creation)
2. Header UI Logic & Field Streamlining
To modernize the legacy ERP screens (Screenshot (2936).png), redundant fields such as Type (Order/Non-Order),
Item Class, and Customer have been eliminated. The simplified header contains 7 core fields:
Field Name UI Control Type System Logic & Validation Rules
IWO Number Read-Only Text Box Auto-generated sequential primary key (Format: U2/IWO/YYYY/####).
Date Date Picker Defaults to current system date (e.g., 18-09-2026). Editable.
Category (For) Primary Dropdown CRITICAL FILTER: Exactly 3 options: [Yarn, Fabric, Accessories].
Dynamically controls the lower grid structure.
Reference No Lookup Dropdown Optional link to Reference Entry (RE Number).
Style Ref Text Input Optional internal style code or trial reference.
Delivery Date Date Picker Target completion / delivery date for internal production.
Remarks Text Area Free-text field for internal notes, trial objectives, or buyer instructions.
GARMENT MANUFACTURING ERP | TECHNICAL SRS
MODULE: INTERNAL WORK ORDER (IWO)
3. Category Specifications: Yarn (For = Yarn)
Referencing Screenshot (2937).png, selecting For = Yarn bypasses all fabric allocation and garment panel tabs.
Yarn quality specs are pulled directly from the Yarn Master, and the merchandiser enters the bulk weight manually.
S
No
Yarn Quality / Specs
Stage
UOM Planned Weight (KGS) Yarn Process Details
1
16'S BCI COTTON GREY
GREY
KGS
1000.000 (Manual Input)
2
70 DENIER ELASTANE
GREY
KGS
Yarn Dyeing (Navy Blue @ Rs.
85/KG)
250.000 (Manual Input)
4. Category Specifications: Fabric (For = Fabric)
None
Referencing Screenshot (2938).png & Screenshot (2940).png, selecting For = Fabric bypasses garment component
calculations (Garment Pcs = 0, Grams/Pc = 0). The merchandiser inputs the Required Weight (Req Wt) directly in
KGS. The system automatically calculates gross yarn weight using process loss %.
Fabric
Construction
Structure
GSM Stage Finish Dia Color /
Shade
Req Wt
(KGS)
165.000 KG (at
10% loss)
Gross Yarn Reqd
SOLID SINGLE
JERSEY
2X2 LYCRA RIB
Circular
Circular
180
240
DYED
DYED
30" OPEN
36" TUB
NAVY BLUE
NAVY BLUE
1000.000
1100.000 KG (at
10% loss)
150.000
5. Category Specifications: Accessories (For = Accessories)
Referencing Screenshot (2941).png, selecting For = Accessories reuses the Material BOM UI component.
Piece-level consumption is overridden, allowing direct manual bulk entry of items (Cartons, Thread, Labels,
Polybags).
Item Description
Brand / Specs
Color / Shade
CARTON BOX
7-PLY 60x40x40
KRAFT
UOM Planned Qty Is Advised Item?
NOS 100.00
[x] True (LOCKED for
PO)
[ ] False (Ready for PO)
MAIN SEWING THREAD 120s SPUN POLY
RED 4012
CONE 50.00
BRAND MAIN LABEL
WOVEN TAFFETA
PENDING
SHADE
NOS 5000.00
6. Business Controls: Advised Items & P&L Variance
[ ] False (Ready for PO)
CONFIDENTIAL - FOR INTERNAL DEVELOPER HANDOFF ONLY
Page 2
GARMENT MANUFACTURING ERP | TECHNICAL SRS MODULE: INTERNAL WORK ORDER (IWO)
CONFIDENTIAL - FOR INTERNAL DEVELOPER HANDOFF ONLY Page 3
CRITICAL SYSTEM CHECKPOINTS
ADVISED ITEMS CHECKPOINT: When Is Advised Item = TRUE (used when buyer artwork or shades are
unconfirmed), the item is logged under the RE Number but the system STRICTLY BLOCKS Purchase Order (PO)
creation. Once details are confirmed, the merchandiser toggles the flag to Available to unlock PO creation.
ORDER COMPLETION & P&L RECONCILIATION: Upon job closing, the system reconciles budgeted material vs.
actual issued material (from Packing List Advice and GRN), calculating exact scrap weight, process loss variances,
and final job profitability.
7. Database Schemas for Developer Implementation-- 1. Header Table
CREATE TABLE internal_work_order_header (
    iwo_id INT PRIMARY KEY AUTO_INCREMENT,
    iwo_no VARCHAR(100) UNIQUE NOT NULL,
    iwo_date DATE NOT NULL,
    category ENUM('YARN', 'FABRIC', 'ACCESSORIES') NOT NULL,
    re_no VARCHAR(100),
    style_ref VARCHAR(100),
    delivery_date DATE,
    remarks TEXT
);-- 2. Accessories Items Table
CREATE TABLE iwo_accessory_items (
    iwo_acc_id INT PRIMARY KEY AUTO_INCREMENT,
    iwo_no VARCHAR(100) NOT NULL,
    material_master_id INT NOT NULL,
    brand_specifications VARCHAR(255),
    item_color VARCHAR(100),
    uom VARCHAR(20) NOT NULL,
    planned_qty DECIMAL(10,3) NOT NULL,
    is_advised_item BOOLEAN DEFAULT FALSE,
    is_available_for_po BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (iwo_no) REFERENCES internal_work_order_header(iwo_no)
);