Technical Specification: Unified Knitting Order, Outward DC & Process Analysis Module
1. Overview & System Objectives
The Knitting Order & Outward Delivery Challan (DC) Module in Ragam ERP governs the transition of raw yarn inventory from internal warehouse stores (Yarn Store / Material Store) into processed grey fabric rolls via external job-work knitting vendors (e.g., Roja Fab, Myilvira Fabs).
Based on operational feedback in record-1794460545493.wav, this specification establishes a strict, developer-ready blueprint for updating the module. Key objectives include:

Preventing Duplicate Knitting Programs: Restricting already-planned RE numbers from being re-selected or re-submitted.
Post-Submission Immutability: Locking submitted Knitting Orders into a read-only (disabled view) state.
UI Column & Terminology Standardization: Updating field labels (Finishing GSM, Knitting GSM, Loop Length), reordering grid columns (Roll Wt placed immediately before Program Qty), and removing redundant fields (Rolls, Loop Ref).
Fixing 100% Blend Calculation Logic: Ensuring single-component yarns evaluate cleanly to 100% blend without returning NaN or zero required weight.
Manual DC Weight Override: Enabling dispatchers to manually adjust net dispatch weight (kg) on the Job Work DC screen.
Standardized Job Work DC Printout: Generating legally compliant tax delivery challans containing vendor details, RE numbers, fabric technical specs, and yarn dispatch balances.


2. Detailed Field Dictionary & UI Specification Updates
2.1 Header & Master Selection Fields

Order / RE Ref Number (order_no):

Selection dropdown listing active Requirement Orders (RE-13, SWO-05, IWO-02).
Rule: If a Knitting Program has already been placed for a given RE number, that RE number must appear greyed out as Disabled with a badge reading Program Placed. Re-selection is strictly blocked.


Vendor / Knitter Name (vendor_id): Dropdown filtered to active job-work knitting vendors from Vendor Master. Displays vendor name, workplace address, and GSTIN.
Order Status (status):

Draft: Editable mode during initial data entry.
Submitted / Placed: Form locks completely into Read-Only (Disabled) mode. All input fields, buttons, and row controls are disabled. Editing or re-adding lines is prohibited.



2.2 Fabric Technical Parameters Grid Updates
Field NameTypeSource / CalculationEditable?Validation & Logic RulesFabric ItemDropdownMaster Fabric CatalogYesSelects target fabric (e.g., Slub Jersey, 2x2 Derby Rib).Finishing DiaNumericRE Requirement PlanNoTargeted finished fabric diameter (e.g., 30", 34").Knitting DiaDropdownTechnical SetupYesRequired machine diameter on knitting floor.Finishing GSMNumericRE Requirement PlanNoRenamed from GSM. Targeted finished fabric weight ($g/m^2$).Knitting GSMNumericDefault = Finishing GSMYes (Editable)New Field. Defaults to Finishing GSM, but allows manual override for machine tension adjustments.Machine Gauge (GG)DropdownVendor Machine MasterYesMachine gauge density (e.g., 20 GG, 24 GG, 28 GG).Loop LengthText / NumTechnical SetupYesRenamed from Loop Ref. Target loop length in mm/cm.PlyDropdownTechnical SetupYesSingle Ply (1-Ply) or Double Ply (2-Ply).Roll Wt (kg)NumericTechnical SetupYesRepositioned. Must be placed immediately before Program Qty. Defines target weight per fabric roll (e.g., 20 kg).Program Qty (kg)NumericUser InputYesTarget total fabric output required in kilograms.Yarn Rate (₹/kg)CurrencyPO / Quotation MasterNoPre-approved yarn valuation rate.Total Value (₹)Currency$\text{Program Qty} \times \text{Rate}$NoAuto-calculated financial extension.

Column Layout Sequence: [# | Fabric Item | Finishing Dia | Knitting Dia | Finishing GSM | Knitting GSM (Editable) | Gauge | Loop Length | Ply | Roll Wt (kg) | Program Qty (kg) | Yarn Rate | Total Value]


Removed Columns: Loop Ref (replaced by Loop Length) and Rolls / Expected Rolls are permanently removed from the data entry table.


3. Core Business & Mathematical Logic
3.1 100% Single Yarn Blend Calculation Fix
In legacy code, selecting a single-component yarn (e.g., 100% Cotton) caused the blend ratio variable to evaluate as null or None, forcing required yarn weight to 0 kg.
Corrected Formulation:
$$\text{Blend \%} = \begin{cases} 100.00\% & \text{if yarn blend count} = 1 \text{ or blend is unassigned} \\ \text{User Entered \%} & \text{if multi-component blend} \end{cases}$$
$$\text{Net Required Yarn (kg)} = \text{Target Fabric Program Qty (kg)} \times \left( \frac{\text{Blend \%}}{100} \right)$$
$$\text{Gross Required Yarn (kg)} = \text{Net Required Yarn (kg)} \times \left( 1 + \frac{\text{Knitting Loss \%}}{100} \right)$$
$$\text{Calculated Bags} = \left\lceil \frac{\text{Gross Required Yarn (kg)}}{\text{Standard Bag Weight (kg)}} \right\rceil$$
3.2 Delivery Challan (DC) Manual Override
While the system calculates the theoretical gross yarn weight and required bag counts, dispatchers on the shop floor must handle real-world physical packaging variations (e.g., a bag weighing 58.4 kg instead of 60.0 kg).

Rule: The Send Qty (kg) field on the Outward Yarn DC tab MUST permit manual numeric entry and override.
Validation Check:
$$\text{Manual Send Qty (kg)} \le \text{Available Bin Stock (kg)}$$
If Send Qty > Bin Stock, display an error: "Send Qty (X kg) exceeds available stock in Bin Y (Z kg)".


4. PostgreSQL Database Schema Updates (Migration_0813)
-- Migration 0813: Update Knitting Order Schema & Add Field Constraints
BEGIN;

-- 1. Alter knitting_programs table to enforce single active program per order
ALTER TABLE knitting_programs
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE;

-- Enforce unique active program per order_no to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_knitting_order
ON knitting_programs (order_no)
WHERE status IN ('Submitted', 'Placed', 'Completed');

-- 2. Update knitting_program_items table for renamed and new fields
ALTER TABLE knitting_program_items
RENAME COLUMN gsm TO finishing_gsm;

ALTER TABLE knitting_program_items
ADD COLUMN IF NOT EXISTS knitting_gsm NUMERIC(6,2),
ADD COLUMN IF NOT EXISTS loop_length VARCHAR(50),
ADD COLUMN IF NOT EXISTS roll_wt_kg NUMERIC(8,2);

-- Populate knitting_gsm default from finishing_gsm
UPDATE knitting_program_items
SET knitting_gsm = finishing_gsm
WHERE knitting_gsm IS NULL;

-- Remove legacy columns if they exist
ALTER TABLE knitting_program_items
DROP COLUMN IF EXISTS loop_ref,
DROP COLUMN IF EXISTS expected_rolls;

COMMIT;


5. Job Work Delivery Challan (DC) Standardized Print Format
When a user clicks Print Delivery Challan, the system renders a clean, printable A4 document (Delivery Challan — Job Work):
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 RAGAM EXPORTS PRIVATE LTD                              │
│                      123 Cotton Mill Road, Tiruppur - 641602                           │
│                      GSTIN: 33AAAAA0000A1Z5 | Phone: +91 421 2200000                   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                               DELIVERY CHALLAN - JOB WORK                              │
│                         (Goods sent for job work, not for sale)                        │
├────────────────────────────────┬───────────────────────────────────────────────────────┤
│ DC No:       DC-2026-0891      │ Vendor:      ROJA FABRICATIONS                         │
│ DC Date:     11-11-2026        │ Address:     45 Knitting Shed, Veerapandi, Tiruppur  │
│ Order Ref:   HO/RE/26-27/0017  │ Vendor GST:  33BBBBA1111B1Z2                          │
│ Vehicle No:  TN-39-AX-4012     │ Place of Del:Roja Fab Shed 2, Tiruppur                │
├────────────────────────────────┴───────────────────────────────────────────────────────┤
│ FABRIC TECHNICAL SPECIFICATIONS                                                       │
│ Fabric: SLUB JERSEY | Finishing Dia: 30" | Knitting Dia: 30"                             │
│ Finishing GSM: 180 | Knitting GSM: 185 | Gauge: 24 GG | Loop Length: 2.80 mm | Ply: 1  │
├────┬────────────────────────────┬──────────────┬─────────────┬─────────────┬───────────┤
│#   │ Yarn Description           │ Program Qty  │ Prev Sent   │ Send Qty    │ Source Bin│
├────┼────────────────────────────┼──────────────┼─────────────┼─────────────┼───────────┤
│ 1  │ 30'S BCI COTTON YARN       │ 195.00 kg    │ 0.00 kg     │ 195.00 kg   │ R01S01    │
│ 2  │ 70 DENIER ELASTANE         │  10.30 kg    │ 0.00 kg     │   0.00 kg*  │ Vendor Stk│
├────┴────────────────────────────┴──────────────┴─────────────┴─────────────┴───────────┤
│ *Note: 70 Diner Elastane allocated from Vendor-Held Stock at Roja Fab.                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ DECLARATION: We declare that this Delivery Challan shows the actual quantity and      │
│ description of goods dispatched for job work processing.                              │
├──────────────────────────┬──────────────────────────┬──────────────────────────────────┤
│ Prepared By: S. Kumar    │ Store In-Charge:         │ Authorized Signatory:            │
└──────────────────────────┴──────────────────────────┴──────────────────────────────────┘


6. Summary Checklist for Engineering Implementation

[x] RE Selector Guard: Grey out orders that already possess a submitted knitting_program.
[x] Post-Submit Lock: Set form container to pointer-events: none / disabled when status === 'Submitted'.
[x] Column Renaming: Change table headers to Finishing GSM, Knitting GSM, and Loop Length.
[x] Column Reordering: Move Roll Wt (kg) directly before Program Qty (kg).
[x] Field Deletion: Remove Rolls and Loop Ref from both UI table and API payloads.
[x] 100% Blend Calculation: Fix fallback logic when yarn blend count is 1.
[x] DC Manual Override: Allow editing Send Qty directly in the DC dispatch grid.
[x] Print Template: Build A4 printable layout for Job Work Delivery Challan.