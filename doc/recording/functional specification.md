Functional Specification Document: ERP Material Master & Accessory Modules

1. Module Overview and General Configuration

A centralized Material Master is the strategic cornerstone of the textile ERP ecosystem. By consolidating all material-related data into a single, governed repository, the system ensures data integrity across procurement, inventory management, and production. Standardized "Item Classes" serve as the architectural foundation, ensuring that every component—from raw yarn to finished fabric and accessories—follows a uniform logic. This standardization is mandatory for accurate reporting, cost analysis, and maintaining a "single version of truth" across the supply chain.

UI Cleanup and Optimization

To eliminate redundant data entry and improve user efficiency, the following modifications to the existing UI are required:

* Removal of Legacy UI Elements: Remove the legacy "First Button" and redundant "New Entry" buttons from the Material Master interface.
* Category Master Rationalization: The "Short Spec" field MUST be removed for all new entries within the Category Master. Descriptive data will henceforth be driven by structured, mandatory attributes to ensure string consistency.

Core Item Classes

The system architecture is anchored by seven primary Item Classes. These classes categorize every stock-keeping unit (SKU) and dictate specific data validation rules:

1. Fabric: Primary production material.
2. Yarn: Raw material for knitting/weaving.
3. Sewing Accessories (Trims): Non-fabric garment components.
4. General Items: Electrical, machinery, and maintenance supplies.
5. Capitals: Specifically used for Top/Bottom component categorization.
6. Collar/Rib: Specialized flat-knit components.
7. Process Materials: Consumables used during production stages.

2. Fabric Master Specifications and Unit of Measure (UoM) Logic

Fabric classification is vital for accurate inventory valuation and production planning. The system must enforce specific UoM logic based on the knitting or weaving method to prevent downstream accounting errors.

Fabric Type Evaluation

Fabric Category	Primary UoM	Secondary UoM	"So What?" (Impact on Logic)
Circular Knit	KG	N/A	Body fabric; stock and consumption tracked exclusively by weight.
Flat Knit	Numbers (PCS)	KG	Used for Collars/Cuffs. Requires dual tracking (e.g., 10 pieces = 1 KG) for inventory vs. production needs.
Woven	Meters	KG	Standard for shirting; consumption planned in meters, but logistics and weight-based costing require KG.

Fabric Processing and Procurement Logic

* Fabric Type Selection: Selection of Solid (piece-dyed), Yarn-Dyed, or Melange (fiber-dyed) is mandatory, as this dictates whether the system generates a Yarn Dyeing PO or a Fabric Dyeing PO.
* Direct Purchase Constraint: A "Direct Purchase" flag must be available. When enabled, the system MUST bypass the yarn composition requirement, as the item is procured as a finished fabric from a vendor rather than produced through internal knitting/dyeing processes.

3. Yarn Composition and Automated Consumption Logic

The "Yarn Mixing" logic is a critical system intelligence feature, enabling the ERP to automate Bill of Materials (BOM) calculations based on percentage blends.

Distinction Between Fiber Blends and Construction

Architecturally, the system must distinguish between a physical yarn blend and a fabric construction:

* Single Yarn (Blended): A single physical yarn made of multiple fibers (e.g., a 60/40 Poly-Cotton yarn). This is defined at the Yarn Master level.
* Multi-Yarn Construction: Two or more distinct physical yarns knitted together (e.g., Cotton + Elastane for Ribbing). This is defined at the Fabric Master level.

Logic Example: Automated Consumption Split If a Fabric Master is configured with a 60/40 blend of Combed Cotton and Polyester Slub, the system MUST perform an automated split during production planning.

* Input: 1,000 kg Fabric Requirement.
* System Enforcement: Automated trigger of procurement plans for 600 kg of Combed Cotton and 400 kg of Polyester Slub.

4. Yarn Master Module and Concatenated String Generation

To resolve the "Data Pollution" identified in legacy systems (e.g., inconsistent naming such as "30s" vs "30 s"), the Yarn Master will utilize automated name generation.

Yarn Category Hierarchy

1. Natural: Plant-based fibers (e.g., Cotton, Linen).
2. Man-made: Synthetic fibers (e.g., Polyester, Rayon).
3. Mixed: Pre-blended fibers at the yarn level (e.g., Poly-Cotton).

Concatenated String Generation

The "Yarn Name" field must be read-only for users. The system MUST automatically generate the name using the following logic to prevent manual entry errors and duplicate records: [Count] + [Purity/Quality] + [Category] Example: "30s Combed Cotton Natural"

5. Sewing Accessories and Trims (Dynamic Attribute Logic)

Accessory master data requires a context-sensitive UI. The system must prompt for different descriptive attributes based on the selected Item Category.

Dynamic UI Requirements

* If "Label" is selected: System MUST prompt for Category (Main Label, Care Label), Type (Printed, Laminated), Material (Canvas, Satin), and Finishing (Roll form, Center fold).
* If "Polybag" is selected: System MUST prompt for Material and Thickness attributes specific to packaging.

UoM Conversion Logic (Sewing Thread)

The system must manage a dual-UoM relationship for thread planning:

* Purchase/Billing UoM: Cones.
* Planning/Consumption UoM: Meters.
* Conversion Rule: 1 Cone = 5000 Meters. (If a plan requires 10,000m, the system MUST calculate a requirement of 2 Cones).

6. Process Master and Operational Validation

The Process Master defines the workflow from Inward to Outward stages and governs vendor financial settlements.

Validation Rule: Billing Logic

The system must enforce billing settlement based on a Settlement_Rule flag:

* Input-Based Billing (Inward): For Knitting/Dyeing. Payment is calculated on Inward_Qty (e.g., vendor is paid for the 500kg of yarn sent, regardless of process loss).
* Output-Based Billing (Outward): For Printing/Washing. Payment is calculated on Outward_Qty (e.g., if 500 pieces are sent but only 450 are successfully printed, the system MUST settle for 450 pieces).

Operational Logic Gates

* Short Description: Mandatory for use on Delivery Challans (DCs) and Invoices where full process names exceed character limits.
* Bypass Plan (Non-Plan Flag): A toggle must exist to allow "Non-plan based" processes (e.g., emergency Washing) to be executed without a pre-defined production plan.

7. Data Integrity, GST Logic, and System Controls

Levy and GST Logic (State-Code Comparison)

Taxation must be automated during the Purchase Order (PO) process via a state-code comparison between the Company and the Vendor:

* Condition: If Company_State_Code == Vendor_State_Code.
* Enforcement: Apply Intra-state logic (Split total GST into CGST and SGST per the GST Master).
* Condition: If Company_State_Code != Vendor_State_Code.
* Enforcement: Apply Inter-state logic (Full IGST).

Referential Integrity Constraints

To preserve historical data integrity, the system must enforce strict lifecycle management for all Master records:

* Deletion Constraint: A Master record can only be deleted if active_foreign_key_links == 0. If a record is referenced in any historical PO, Production Order, or Invoice, the "Delete" action MUST be disabled.
* Blocked Status: To retire a record that cannot be deleted, the user must apply a "Blocked" status. A blocked record remains in the database for historical reporting but MUST be excluded from all active search results and new transaction entries.

Conclusion: This document establishes the technical requirements for the Material Master ecosystem. Implementation must adhere to the specified automated naming conventions, UoM conversion rules, and referential integrity constraints to ensure a robust, high-integrity ERP environment.
