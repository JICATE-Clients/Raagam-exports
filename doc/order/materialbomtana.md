GARMENT ERP TECHNICAL SPECIFICATION
Material BOM (Accessories & Trims) Time & Action (T&A) Engine

Version 1.0 | Steps 12–17
Target: Full-Stack Engineering

CONFIDENTIAL — FOR DEVELOPER IMPLEMENTATION ONLY Page 1
1. Executive Summary & System Rationale
In garment manufacturing execution, Material BOM (Trims & Accessories) procurement is split into two distinct operational
classes: Sewing Trims (threads, buttons, zippers, care labels) and Packing Trims (poly bags, cartons, hangtags, price stickers).
Historical ERP implementations treated all trims as a single bulk delivery event, forcing factories to receive packing cartons weeks
before garment assembly even began. This resulted in working capital tie-ups, warehouse space congestion, and carton humidity
damage.
This specification establishes the 6 Material Store T&A; Activities (Steps 12 through 17). It enforces staggered in-house
scheduling (Sewing Trims arrive prior to Cutting/Sewing Start; Packing Trims arrive prior to Packing Start), models optional job-work
secondary processes (e.g. zipper tipping, button painting), and defines automated GRN completion threshold gates for full backend
implementation.
Core Strategic Rule: Staggered In-House Dates
• Sewing Material Receipts (Step 13): Target Date = Sewing / Cutting Start Date - 1 Day
• Packing Material Receipts (Step 17): Target Date = Packing Start Date - 1 Day
Impact: Defers packaging carton deliveries by 10 to 15 days, optimizing vendor credit cycles and warehouse capacity.

2. Material BOM T&A; Lifecycle Breakdown (Steps 12 – 17)

Step # T&A; Activity Name Doc Inventory Bucket Target Date Logic & Rules
12 SEWING MATERIAL PURCHASE
ORDERS

PO Pending PO Issued to trim vendors based on item lead time so trims

arrive prior to sewing.

13 SEWING MATERIAL PURCHASE
RECEIPTS

GRN Sewing Trims Stock In-house receipt into store. Target = Sewing / Cutting

Start - 1 Day.

14 SEWING MATERIAL PROCESS
DELIVERY

DC In-Transit (Vendor) Conditional (Painting/Tipping). Activated ONLY if item

has is_process = true.

15 SEWING MATERIAL PROCESS
RECEIPTS

GRN Sewing Trims Stock Receipt of job-work processed trims back into store

before issuing to sewing lines.

16 PACKING MATERIAL PURCHASE
ORDERS

PO Pending PO Issued to carton/polybag vendors aligned with garment

finishing schedules.

17 PACKING MATERIAL PURCHASE
RECEIPTS

GRN Packing Store Stock In-house receipt into store. Target = Packing Start - 1

Day.

3. Detailed Functional Rules & Domain Logic
Rule 3.1 — Item Class Bifurcation & In-House Target Scheduling
The Material BOM line item schema contains a mandatory trim_class enum (SEWING vs PACKING). When T&A; schedules are
generated or updated, the system evaluates:

GARMENT ERP TECHNICAL SPECIFICATION
Material BOM (Accessories & Trims) Time & Action (T&A) Engine

Version 1.0 | Steps 12–17
Target: Full-Stack Engineering

CONFIDENTIAL — FOR DEVELOPER IMPLEMENTATION ONLY Page 2
• For trim_class = 'SEWING': target_in_house_date = cutting_start_date - 1.
• For trim_class = 'PACKING': target_in_house_date = packing_start_date - 1.
Rule 3.2 — Conditional Process Steps (Steps 14 & 15 Bypass)
Certain accessories require external job-work (e.g., button painting, dyed-to-match zipper tipping, tape printing). If a trim item in the
BOM has is_process = false, Steps 14 and 15 are marked as BYPASSED and hidden from the active store work queue. If is_process
= true, Steps 14 (Delivery DC) and 15 (Process GRN) are inserted sequentially between Step 13 (Receipt GRN) and the floor issue
stage.
Rule 3.3 — Automated Completion Thresholds via GRN Reconciliation
A T&A; receipt activity (Step 13 or Step 17) automatically transitions from PENDING / IN_PROGRESS to COMPLETED when:
SUM(grn_received_qty) >= required_bom_qty * (1 - tolerance_pct).
The system auto-stamps actual_completion_date = CURRENT_DATE and closes the task card.

4. Database Schema Specification (PostgreSQL DDL)
-- Enum Types for Material T&A;
CREATE TYPE trim_class_enum AS ENUM ('SEWING', 'PACKING');
CREATE TYPE material_ta_step_enum AS ENUM (
'SEWING_PO', 'SEWING_GRN', 'SEWING_PROCESS_DC', 'SEWING_PROCESS_GRN',
'PACKING_PO', 'PACKING_GRN'
);
CREATE TYPE material_ta_status_enum AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'BYPASSED');
-- Material BOM T&A; Master Schedule Table
CREATE TABLE order_material_ta_schedules (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
material_bom_item_id UUID NOT NULL REFERENCES order_material_bom_items(id) ON DELETE CASCADE,
step_code material_ta_step_enum NOT NULL,
step_number INTEGER NOT NULL CHECK (step_number BETWEEN 12 AND 17),
trim_class trim_class_enum NOT NULL,
target_date DATE NOT NULL,
actual_completion_date DATE,
required_qty NUMERIC(12, 3) NOT NULL CHECK (required_qty >= 0),
received_qty NUMERIC(12, 3) NOT NULL DEFAULT 0.000,
status material_ta_status_enum NOT NULL DEFAULT 'PENDING',
assigned_store_user_id UUID REFERENCES staff_users(id),
created_at TIMESTAMPTZ DEFAULT NOW(),
updated_at TIMESTAMPTZ DEFAULT NOW(),
CONSTRAINT unique_item_step UNIQUE (material_bom_item_id, step_code)
);
-- Store Transaction Receipts & Delivery Ledger
CREATE TABLE order_material_store_ledger (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
ta_schedule_id UUID NOT NULL REFERENCES order_material_ta_schedules(id) ON DELETE CASCADE,
document_type VARCHAR(10) NOT NULL CHECK (document_type IN ('PO', 'GRN', 'DC')),
document_no VARCHAR(50) NOT NULL,
transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
vendor_id UUID REFERENCES vendors(id),
created_by UUID REFERENCES staff_users(id),
created_at TIMESTAMPTZ DEFAULT NOW()
);
5. Backend TypeScript Service Implementation

GARMENT ERP TECHNICAL SPECIFICATION
Material BOM (Accessories & Trims) Time & Action (T&A) Engine

Version 1.0 | Steps 12–17
Target: Full-Stack Engineering

CONFIDENTIAL — FOR DEVELOPER IMPLEMENTATION ONLY Page 3
// Service method for auto-scheduling Material T&A; dates
export async function generateMaterialTaSchedule(orderId: string, item: MaterialBomItem) {
const taMilestones = await db.orderTaMilestones.findUnique({ where: { orderId } });
const isSewing = item.trimClass === 'SEWING';
// Rule 3.1: Staggered Date Math
const baseAnchorDate = isSewing ? taMilestones.cuttingStartDate : taMilestones.packingStartDate;
const targetInHouseDate = subDays(new Date(baseAnchorDate), 1);
const targetPoDate = subDays(targetInHouseDate, item.leadTimeDays || 7);
const steps = [
{
stepNumber: isSewing ? 12 : 16,
stepCode: isSewing ? 'SEWING_PO' : 'PACKING_PO',
targetDate: targetPoDate,
requiredQty: item.requiredQty,
status: 'PENDING'
},
{
stepNumber: isSewing ? 13 : 17,
stepCode: isSewing ? 'SEWING_GRN' : 'PACKING_GRN',
targetDate: targetInHouseDate,
requiredQty: item.requiredQty,
status: 'PENDING'
}
];
// Rule 3.2: Insert Conditional Process Steps 14 & 15 if process required
if (isSewing && item.isProcess) {
steps.push(
{ stepNumber: 14, stepCode: 'SEWING_PROCESS_DC', targetDate: targetInHouseDate, requiredQty: item.requiredQty,
status: 'PENDING' },
{ stepNumber: 15, stepCode: 'SEWING_PROCESS_GRN', targetDate: targetInHouseDate, requiredQty: item.requiredQty,
status: 'PENDING' }
);
}
await db.orderMaterialTaSchedules.createMany({ data: steps.map(s => ({ ...s, orderId, materialBomItemId: item.id })
) });
}
6. Developer Verification & QA Test Suite
Test ID Scenario Description Action & Input Data Expected System Outcome
QA-MAT-01 Staggered Date
Auto-Population

Create Material BOM with Poly Bag
(Packing) and Thread (Sewing).

Thread target = Cutting Start - 1 Day; Poly Bag target
= Packing Start - 1 Day.

QA-MAT-02 Conditional Process Bypass Add Care Label with is_process = false. Steps 14 & 15 are marked BYPASSED and excluded

from active store queues.

QA-MAT-03 Automated GRN Milestone

Closure

Post GRN receipt equal to required BOM
count for Buttons.

Step 13 status changes to COMPLETED;
auto-stamps actual_completion_date.