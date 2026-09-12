Technical Specification: Special Administrative & Logistics Modules for Garment ERP

1. Internal Work Order (IWO) & Advance Procurement Module

1.1. Purpose and Scope

The Internal Work Order (IWO) acts as a "Dummy Order" mechanism, enabling the procurement of raw materials (Yarn, Fabric, Accessories) before a formal buyer Sales Confirmation (SC) is finalized. This module ensures long-lead items are secured while maintaining strict inventory traceability for eventual transfer to actual production orders.

1.2. IWO Generation and Header Details

IWO numbers are system-generated to maintain a unique audit trail.

Numbering Logic: IWO/[Unit]/[YY-YY]/[Serial] (e.g., IWO/U2/26-27/0001).

Field Name	Description	Source Mapping
Customer	Intended buyer for the material hedge	Customer
Style Ref No	Prospective style reference	Style Ref No
Delivery Window	Target shipment range (From/To)	Delivery Window
Season	Optional seasonal category	Season

1.3. Material Requirement Planning (MRP) for IWO

Requirements must be calculated using the Divisive Loss Formula to prevent material shortages.

* Logic: The system must calculate the input requirement by dividing the planned output by the yield (1 - Loss %).
* Calculation Formula: To\_Ordered\_Wt = Planned\_Wt / (1 - (Stage\_Loss \% / 100))
* Precision: All weight calculations must maintain a Decimal(18,4) precision.
* Workflow Stages: Requirements must account for losses across Knitting, Dyeing, Brushing, Stentering, and Compacting.

1.4. Stock Transfer Logic

* Hard Locking: Materials purchased under an IWO are reserved. They cannot be issued to actual orders without a "De-link" or "Transfer" transaction.
* Technical Validation: Stock transfer to a Buyer Order is only permitted if the Item Class, GSM, Dia, and Composition match the target Order's BOM exactly.

2. To Be Advised (TBA) Management Queue

2.1. BOM Flagging and Visibility

The Fabric BOM Entry screen includes a TBA (Bit) flag. When TBA=YES, the item is excluded from standard procurement views and highlighted in the Merchandiser TBA Dashboard. This dashboard serves as the central queue for resolving pending technical specifications.

2.2. System Blocks and PO Constraints

The system must enforce a database-level "Hard Stop":

* PO Blocking: Any BOM line item with TBA_Status = 1 must prevent the generation of a Purchase Order.
* Validation: The PO Submission service must check the TBA_Status bit; if true, it must return a validation error: "Procurement blocked: Item specifications pending (TBA)."

2.3. Specification Updates & Approval

The TBA flag can only be toggled to NO when:

1. Technical specs (GSM, Width, Color) are updated.
2. The record is authorized via the "Checked-By" or "Approved-By" workflow in the Fabric BOM Entry Register.

3. Packing List Advice & Commercial Invoicing

3.1. Packing List Data Architecture

The system must capture granular shipping data to automate downstream logistics.

* Attributes: Carton Numbering, Dimensions (L x W x H), CBM (calculated), Gross Weight, and Net Weight.
* Carton Breakdown: A mandatory "Size/Color Breakdown" grid.
* Integrity Check: Sum(Packed_Pieces) must equal the Order_Quantity from the Sales Confirmation (SC).

3.2. Commercial Invoice Automation

* Logic: Invoice Value = Actual Packed Quantity * Unit Price.
* Price Fetching: Prices must be retrieved from the Style Master or Order Entry. The system must support tiered pricing (e.g., "Solid Price" for small runs vs. bulk tiers).

3.3. Logistics UI & Coordinate Logic

* Pack Ratios: Users define "Solid Pack" vs. "Assorted Pack" ratios.
* Coordinate Input Rules:
  * If "Piece" is selected: Coordinate_Count defaults to 1 and is Read-Only.
  * If "Set" is selected: Coordinate_Count is editable. Inputting a value (e.g., 2 or 3) must dynamically generate the corresponding rows for component definition.

4. Order Lifecycle & Closure Controls

4.1. Order Deactivation

Changing an order status to "Cancelled" or "Inactive" must trigger an immediate global stop on all WIP. The system shall block any further issuance for Knitting, Dyeing, or Cutting.

4.2. Force-Closure Logic

To maintain clean reporting, the system allows "Force Closure" for minor balances.

* Threshold: Remaining Qty < 1% of total or absolute value (e.g., < 10kg yarn or < 5 pieces).
* Audit: All force-closures must be logged in Order_Closure_Log with the Closure_Type and Remaining_Qty.

5. Database Schema & Data Relationships

5.1. Core Entities

Table	Field Name	Data Type	Precision/Constraint
IWO_Header	IWO_No	Varchar(50)	Unique Index
Fabric_BOM	Net_Req_Wt	Decimal(18,4)	4 decimal places
Fabric_BOM	TBA_Status	Bit	Default 0
Packing_Advice	Gross_Wt	Decimal(18,4)	Per Carton
Order_Closure	Force_Close	Bit	Triggered by Threshold

5.2. Rejection & Allowance Logic

The SQ (Standard Quantity) is calculated as: Order Quantity + Excess % + Rejection Allowance + Approval Allowance.

Rejection Allowance Tiers (Flat vs. Percentage):

* 1 - 10 Pieces: 4 Pieces Flat.
* 11 - 50 Pieces: 3 Pieces Flat.
* 100 - 500 Pieces: 3% of Order Qty.
* 500+ Pieces: 2% of Order Qty.

6. User Interface (UI) and Validation Rules

6.1. Mandatory Field Constraints

The "Order Entry" screen requires: PO Number, Merchandiser (filtered by Designation in Staff Master), Delivery Date (restricted to future dates), and Description.

6.2. UI Efficiency & Focus Logic

To optimize data entry speed, the UI must implement Auto-Focus Skipping:

* Upon selecting Location, the cursor must automatically skip Date and Unit (which should auto-populate based on Location) and land directly on Customer.
* Duplicate Prevention: The system must block duplicate "Component" or "Family" entries within the same Style BOM.

7. Developer Integration Guidelines

7.1. Process Sequence & Cumulative Loss

MRP logic must apply the Divisive Loss Formula cumulatively across the following sequence: Knitting → Dyeing → Brushing → Stentering → Compacting.

Example Calculation for Dyeing Stage: If Planned_Wt after Brushing is 1460.029kg and Dyeing Loss is 5%: To\_Ordered\_Wt = 1460.029 / (1 - 0.05) = 1536.873\text{ kg.}

7.2. Printing Workflow Differentiation

Developers must distinguish between two printing types:

* Fabric Print: Applied at the fabric stage (online). Loss % is applied to the entire fabric requirement.
* Component Print: Applied to cut pieces (e.g., a logo on a pocket). This is a garment-stage process and does not impact the base fabric knitting/dyeing loss.

7.3. Yarn-Dyed Workflow Trigger

If the Yarn-Dyed flag is set at the BOM level:

1. The system must skip the standard "Fabric Dyeing" stage logic.
2. An automated sub-process record must be instantiated in the Yarn_Dyeing_Requirement table.
3. The "To Ordered Wt" for Yarn must be calculated including the Yarn-Dyeing Loss % prior to the Knitting stage.
