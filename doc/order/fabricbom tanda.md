TECHNICAL DEVELOPMENT SPECIFICATION
Pre-Production T&A; Work Plan, Fabric BOM Activities (Steps 6–11) & Color-Wise Process Loss Engine
Author: ERP Technical Architecture Team | Version: 1.0 | Target: Full Stack & Database Engineers | Date: September 2026

DEVELOPER DIRECTIVE: This document establishes the exact engineering blueprint for implementing three critical ERP updates:
1) Pre-Production Administrative T&A; Work Plan (6 mandatory milestones), 2) Fabric BOM Manufacturing Transaction
Activities (Steps 6–11), and 3) Color-Wise Process Loss Engine for shade-wise dyeing loss compounding. All database DDLs,
formula specifications, API contracts, and UI grid alignments contained herein are production-binding.

Module 1: Pre-Production Administrative T&A; Work Plan
1.1 Rationale & Problem Statement
Order execution tracking was historically restricted to factory floor activities (Cutting, Sewing, Packing) and buyer sample
sign-offs (PP Sample, Fit Sample). However, administrative bottlenecks—such as delayed CAD tech packs, incomplete Material
BOMs, or unapproved budgets—frequently caused untracked pre-production delays. To resolve this, the system embeds a
6-milestone Work Flow directly into the Order Time & Action (T&A;) tab to enforce administrative accountability prior to bulk
production.
1.2 Milestone Sequence & Sequential Target Date Math
Target dates calculate sequentially from order_received_date (Day 0) using forward calendar day addition:
Formula: Target Date = Order Received Date + Lead Days
S
N
Milestone Code Description / Activity Lead

Days Prerequisite Trigger Task Owner Role

1 ORDER_ENTRY Order Header, Style & Quantity Setup Day 1 Order Received Date

Created Merchandiser

2 CAD_COMPLETION Pattern Blocks, Tech Pack & Marker

Plan Day 2 ORDER_ENTRY Finalized CAD / Sampling Team
3 MATERIAL_BOM Sewing & Packing Trims Plan Day 3 ORDER_ENTRY Finalized Accessory
Merchandiser

4 FABRIC_BOM Fabric Structure, Yarn Split & Loss

Route Day 3 CAD_COMPLETION

Finalized Fabric Merchandiser

5 BUDGETING Cost Aggregation

(Yarn+Fabric+Trims+CMT) Day 4 MATERIAL & FABRIC BOM

Saved Costing Merchandiser

6
BUDGET_APPROVA
L

MD Margin Approval & Gating Lock Day 4 BUDGETING Finalized Managing Director

(MD)

RAAGAM EXPORTS ERP — TECHNICAL DEVELOPMENT SPECIFICATION MODULE: PRE-PROD T&A & FABRIC BOM

Confidential — For Internal Engineering & Development Use Only Page 2
1.3 PostgreSQL Database Schema: order_ta_work_plans
CREATE TYPE ta_work_plan_milestone_code AS ENUM (
'ORDER_ENTRY', 'CAD_COMPLETION', 'MATERIAL_BOM', 'FABRIC_BOM', 'BUDGETING', 'BUDGET_APPROVAL'
);
CREATE TABLE order_ta_work_plans (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
milestone_code ta_work_plan_milestone_code NOT NULL,
sn INTEGER NOT NULL CHECK (sn BETWEEN 1 AND 6),
target_days_from_received INTEGER NOT NULL DEFAULT 1 CHECK (target_days_from_received >= 0),
target_date DATE NOT NULL,
actual_completion_date DATE,
task_owner_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE')),
remarks TEXT,
created_at TIMESTAMPTZ DEFAULT NOW(),
updated_at TIMESTAMPTZ DEFAULT NOW(),
CONSTRAINT unique_order_milestone UNIQUE (order_id, milestone_code)
);

Module 2: Fabric BOM T&A; Manufacturing Activities (Steps 6–11)
2.1 Manufacturing Transaction Pipeline
To track fabric from commercial procurement through mill processing, the T&A; engine incorporates 6 sequential transaction
activities. These activities link directly to Purchase Orders (PO), Delivery Challans (DC), and Goods Receipt Notes (GRN) to
update factory inventory buckets in real time:
Step # T&A; Activity Name Doc

Type Inventory Stock Bucket Target Scheduling Rule & Validation
Step 6 YARN PURCHASE ORDERS PO Pending Yarn PO Triggered upon Fabric BOM completion.
Commercial yarn PO generation.
Step 7 YARN PURCHASE RECEIPTS GRN Yarn Store Stock Yarn cone inward receipt & weight verification

into store.

Step 8 KNITTING DELIVERY DC In-Transit (Knitting) Issue of raw uncolored yarn cones to
circular/flat knitting looms.

Step 9 KNITTING RECEIPTS GRN Greige Stock Receipt of uncolored greige rolls. Aggregated

into Consolidated Greige Lot.

Step 10 FABRIC PROCESS DELIVERY DC In-Transit (Dyeing) Dispatch of greige rolls to dye house / wet plant

(Colorway split occurs here).

Step 11 FABRIC PROCESS RECEIPTS GRN Finished Stock Receipt of dyed, stentering & compacted rolls
(e.g. 1000 kgs) into cutting stock.

RAAGAM EXPORTS ERP — TECHNICAL DEVELOPMENT SPECIFICATION MODULE: PRE-PROD T&A & FABRIC BOM

Confidential — For Internal Engineering & Development Use Only Page 3
2.2 Operational Scheduling & Back-Scheduling Rules
• Finished Fabric In-House Gate (Step 11): Step 11 Target Date <= Cutting Start Date - 1 Day.
• Greige Consolidation Rule (Steps 8 & 9): All colorways sharing a common yarn specification are merged into a single greige
knitting lot.
• Automated Milestone Completion: When cumulative GRN receipts equal or exceed planned BOM requirement weight (e.g.
1000 kgs), Step 11 automatically flags COMPLETED.
2.3 Database Schema: order_fabric_process_transactions
CREATE TABLE order_fabric_process_transactions (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
fabric_bom_item_id UUID NOT NULL REFERENCES order_fabric_bom_items(id),
transaction_step INTEGER NOT NULL CHECK (transaction_step BETWEEN 6 AND 11),
step_name VARCHAR(100) NOT NULL CHECK (step_name IN (
'YARN_PURCHASE_ORDERS', 'YARN_PURCHASE_RECEIPTS', 'KNITTING_DELIVERY',
'KNITTING_RECEIPTS', 'FABRIC_PROCESS_DELIVERY', 'FABRIC_PROCESS_RECEIPTS'
)),
document_ref_no VARCHAR(50) NOT NULL, -- PO No / DC No / GRN No
transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
item_class VARCHAR(20) NOT NULL CHECK (item_class IN ('YARN', 'GREIGE_FABRIC', 'DYED_FABRIC', 'FINISHED_FABRIC')
),
colorway_name VARCHAR(100),
quantity_kg NUMERIC(12, 3) NOT NULL CHECK (quantity_kg >= 0),
vendor_id UUID REFERENCES vendors(id),
created_at TIMESTAMPTZ DEFAULT NOW()
);

Module 3: Color-Wise Process Loss & Requirement Report Engine
3.1 Business Rationale & UI Controls
Applying a flat process loss across all colorways causes severe costing errors. Dark or heavy dye shades (e.g. BLACK,
CRANBERRY) undergo longer dye cycles resulting in higher loss (e.g. 5.00%), while light shades (e.g. WHITE) incur lower loss
(e.g. 3.00%).
• UI Control: On the Process Tab, toggling Assort Color-Wise Loss = ON renders a [Set Color Loss] button.
• Modal Configuration: Opens a pop-up grid listing all active order colorways with editable custom loss percentages.
3.2 Mathematical Formulas & Compounding Engine
For each color shade s, the gross ordered weight is calculated using the confirmed module formula:
Order Screen / Yarn Process: Gross Weight_s = Net Weight_s * (1 + Color Loss %_s / 100)
Requirement Report / IWO Lines: Gross Weight_s = Net Weight_s / (1 - Color Loss %_s / 100)
Type / Yarn Description Colorway /

Shade Plan Wt (kg) Custom Loss
%

To Ordered Wt (kg) Procurement Stage
20'S COMBED COTTON GREEN 510.500 5.00% 537.368 DYED (Yarn Dyeing)
20'S COMBED COTTON RED 340.299 4.00% 354.478 DYED (Yarn Dyeing)
20'S COMBED COTTON WHITE 170.201 3.00% 175.465 DYED (Yarn Dyeing)
TOTAL CONSOLIDATED
LOT ALL SHADES 1,021.000 Weighted 4.54% 1,067.311 GREY (Yarn
Purchase)

RAAGAM EXPORTS ERP — TECHNICAL DEVELOPMENT SPECIFICATION MODULE: PRE-PROD T&A & FABRIC BOM

Confidential — For Internal Engineering & Development Use Only Page 4
3.3 Database Schema: fabric_process_color_loss_overrides
ALTER TABLE fabric_process_stages
ADD COLUMN is_color_wise_loss BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE fabric_process_color_loss_overrides (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
process_stage_id UUID NOT NULL REFERENCES fabric_process_stages(id) ON DELETE CASCADE,
required_color VARCHAR(100) NOT NULL,
loss_pct NUMERIC(5, 2) NOT NULL CHECK (loss_pct >= 0 AND loss_pct < 100),
created_at TIMESTAMPTZ DEFAULT NOW(),
updated_at TIMESTAMPTZ DEFAULT NOW(),
CONSTRAINT unique_stage_color UNIQUE (process_stage_id, required_color)
);

Module 4: Fabric BOM Entry Register Calculation Engine
4.1 Column Arithmetic & Verification Math
1. SQ Quantity Math: SQ Qty = Order Qty + Excess Qty + Rejection Allowance + Approval Allowance
2. Net Required Weight (kg): Net Req Wt = (SQ Qty * Piece Wt in kg) / (1 - Wastage % / 100)
Worked Example: 95 Pcs * 0.025 kg (Pocket) = 2.375 kg Net Req Wt.
3. Multi-Stage Compounded Loss %: Compounded Loss = (1 + Loss_knit) * (1 + Loss_dye) * (1 + Loss_compact) - 1
Worked Example: 2% Knitting + 5% Dyeing + 2% Compacting = 9.60% Total Compounded Loss.
4. Total Gross Weight (kg): Total Gross Wt = Net Req Wt * (1 + Compounded Loss %) = 2.375 kg * 1.0960 = 2.609 KGS.
VERIFICATION CHECKLIST FOR QA & DEVELOPERS:
✓ Pre-Production T&A;: Ensure all 6 milestones auto-initialize with target dates upon order creation.
✓ Fabric T&A; Steps 6–11: Verify Step 11 GRN auto-completes when actual received weight matches BOM gross weight.
✓ Color Loss Engine: Confirm Yarn & Fabric Requirement reports render per-shade itemized breakdowns with custom loss
percentages.
✓ Formula Injection: Ensure shared formula resolvers maintain qty * (1 + loss) on Order screen and qty / (1 - loss) on IWO
screen.