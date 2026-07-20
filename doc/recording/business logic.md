Garment Manufacturing Business Logic and Workflow Manual

1. Material Master Architecture and Item Classification

The Material Master architecture serves as the mandatory single source of truth for all enterprise operations, ranging from procurement and production to financial inventory integrity. A structured master data environment is strategically essential to eliminate data redundancy and prevent the creation of duplicate records, which otherwise lead to inventory valuation errors and fragmented stock reporting.

The system configuration must be constrained by the following primary Item Classes. Following a recent data audit, the "Tava Button" class has been identified as redundant and must be purged from the active configuration.

Core Item Class Configuration

Item Class	Status	System Action
Fabric	Active	Primary production raw material.
Yarn	Active	Constituent raw material for knitting/weaving.
Sewing Thread	Active	Core assembly accessory with alternate UoM logic.
Labels	Active	Finishing accessory using attribute-based naming.
Polybags	Active	Essential packaging material.
General Items	Active	Consumables (Machinery spares, Electricals).
Tava Button	Deprecated	Permanent removal from system configuration.

Documentation Integrity: Short Spec and Naming Logic

Standardized naming conventions are enforced via "Short Name" and "Short Spec" fields. These fields are not merely descriptive; they are technical safeguards against data truncation on Delivery Challans (DCs) and other external documentation.

* Logic: The system enforces a 200-character limit for specifications to ensure compatibility with Crystal Reports and programming hard-codes.
* Rational: This prevents truncated descriptions that can lead to vendor miscommunication or logistics errors during material dispatch.

Item classification dictates the downstream logic for unit conversion and process routing, establishing the governing rules for fabrics and yarns.

2. Fabric Logic: Types, Units, and Measurement Rules

Fabric management requires a nuanced mathematical approach to inventory, as the physical properties of fabric construction (knit vs. weave) dictate how materials are consumed and billed.

Fabric Type and Measurement Matrix

Fabric Type	Organizational Prevalence	Mandatory UoM	Business Rationale
Circular Knit	90%	KG (Kilograms)	Produced on circular machines; inventory and consumption are exclusively weight-based.
Flat Knit	8–9%	Pcs & KG	Used for collars/cuffs. Requires tracking by both unit count (Pcs) and physical weight for costing.
Woven	Rare Case	Meters & KG	Predominantly length-based for cutting, but weight-based for bulk procurement and shipping.

System Priority and Calculation Logic

Given the 90% dominance of Circular Knit materials, the ERP must prioritize weight-based (KG) calculations across all production modules. Inventory buffers and knitting plans shall defaults to KG units to align with shop-floor machinery output. This fabric architecture directly informs the Raw Material Requirements Planning (MRP) for constituent yarns.

3. Yarn Composition and Blend Logic

Yarn master data accuracy is critical for cost estimation and MRP precision. Errors in yarn definition result in procurement failures and stock-outs.

Yarn Categories and Purity Enforcement

The system classifies all yarn into three categories: Natural, Man-made, and Mixed.

* Data Integrity Protocol: To prevent "data pollution" (e.g., "30s Cotton" vs. "30 S Cotton"), the fields for Count and Purity must be restricted to non-editable dropdown menus. Users are prohibited from manual text entry to preserve the integrity of stock and audit reports.

Blend Calculation and Procurement Integration

For Mixed Yarns (e.g., Poly-Cotton), the system utilizes an automated blend split logic to determine raw fiber requirements.

* Example: A requirement for 1 KG of Poly-Cotton (60% Polyester / 40% Cotton).
* MRP Action: The system must automatically split the consumption to identify that 600g of Polyester and 400g of Cotton fiber must be procured.
* Strategic Value: This ensures the Procurement Module knows exactly what volume of base fiber to purchase for blended production.

Consumption Distinction: Single vs. Multiple Yarn

The system must distinguish between Single Yarn (one yarn type per fabric) and Multiple Yarn (e.g., a Rib fabric combining base yarn with Elastane). This distinction triggers the ERP to either draw from a single stock item or split consumption across multiple yarn masters during the knitting process.

4. Trims and Accessory Management

Trims and accessories carry the highest variance in garment manufacturing. Attribute-based naming is mandatory to differentiate between items that share similar generic descriptions.

Attribute-Driven Configuration

Master records for accessories must be defined by specific parameters to prevent ID duplication:

* Labels: Required attributes include Type (Main Label, Size Label), Material (Laminated, Satin, Canvas), and Finishing (Printed, Roll-form, Center-fold).
* Sewing Thread: Required attributes include Material (Cotton, Polyester) and Length per cone (e.g., 5000m).

Alternate UoM Logic for Threads

Thread management requires a precise conversion engine to bridge production needs and procurement:

1. Consumption: Calculated in Meters (e.g., 200m per garment).
2. Procurement: Managed in Cones (e.g., 5000m per cone).
3. System Action: The system shall automatically convert the total production meterage into the required number of cones for the Purchase Order.

5. Processing Workflows and Billing Logic

Value-added processes such as Dyeing, Printing, and Knitting must be managed with specific focus on process loss—the inevitable shrinkage or wastage during manufacturing.

Billing Logic Comparison Matrix

Process	Billing Logic	Input Material	Output Material	Business Rationale
Dyeing	Outward-based	Greige Fabric	Dyed Fabric	Shrinkage Management: Billing is based on input weight (e.g., 500kg) to ensure the vendor is paid for the full material handled, regardless of shrinkage (e.g., 450kg received).
Printing	Inward-based	Fabric Component	Printed Component	Quality Control: Vendor is only paid for successfully printed pieces (e.g., 450 pcs) even if the input was higher (500 pcs).
Knitting	Inward-based	Yarn	Fabric	Paid based on the weight of fabric successfully knit.

Plan-Independent Process Flag

The system includes a "Plan-independent" flag for operational flexibility. When active (e.g., for specialized corrective washing), the system permits process execution and billing without a pre-defined production budget or order entry.

6. Taxation (Levy) and GST Configuration

The ERP utilizes a dynamic tax engine to manage Indian GST compliance. The application of tax is automated based on the geographical relationship between the company and the vendor.

Taxation Triggers and GST Split

The system must use the Vendor’s Registered Location from the Vendor Master to trigger the correct tax calculation:

* Intrastate (Within the same state): Triggers the CGST and SGST split.
* Interstate (Different states): Triggers the full IGST application.

GST Brackets

* 5% GST: Split into 2.5% CGST and 2.5% SGST.
* 18% GST: Split into 9% CGST and 9% SGST.
* 24% GST: Split into 12% CGST and 12% SGST.

This automated "if-then" logic ensures that all Purchase Orders (POs) reflect accurate tax liabilities without manual user intervention.

7. Master Record Lifecycle: Deletion vs. Blocking

Data integrity is the paramount priority for a relational manufacturing database. Orphan records—records that are deleted while still referenced by historical data—will cause catastrophic system failures.

Record Management Protocol

The following protocols are mandatory for all system administrators:

* Deletion Rule: A master record shall only be deleted if it has zero transactional history (no POs, stock movements, or orders).
* Blocking Rule: If a record has historical data but is no longer required for active use, it must be blocked.

Impact of Blocking

Blocking a record updates the User Interface (UI) to suppress the item from appearing in new transactions. This prevents accidental selection of obsolete materials in current production. Crucially, the record remains in the database to preserve the integrity of historical reports, audits, and year-over-year financial comparisons.

These rules collectively establish a robust, error-resistant environment for the garment manufacturing lifecycle.
