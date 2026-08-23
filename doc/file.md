Functional Specification: Garment Order Management, CAD Integration, and Advanced Trim Lifecycle

1. Garment Order Sheet (GOS): Print Architecture and Data Isolation

Context and Strategic Importance

The Garment Order Sheet (GOS) is the primary physical and digital directive for the shop floor, acting as the bridge between Merchandising and Production. To maintain operational efficiency, the GOS architecture prioritizes high data-to-ink ratios by strictly isolating construction data from procurement clutter. This ensures that operators and supervisors receive only the specific garment architecture required for execution, minimizing error rates and maximizing throughput.

Header and Grid Specifications

The GOS print format is defined by a 1,000-entry-per-year internal sequence using a 000-padding format (e.g., STL/2026-27/001) for system readability. However, for floor-level communication involving 500+ employees, the system recognizes the RE Number (ஆரி நம்பர்) as the universal primary key.

Mandatory Header Data:

* S No (Serial Number): Internal system sequence.
* RE Number (ஆரி நம்பர்): The definitive production key for all floor tracking and reports.
* Approved Sample Number: A mandatory linkage field ensuring traceability from the Marketing/Sampling phase to Bulk production.
* Customer & Country: The purchasing entity and destination market.
* Order Number (Customer PO): Reference to the original purchase order.
* Order Date, Season, and Delivery Dates: Critical temporal constraints for the T&A (Time & Action) calendar.

Architectural Logic: Piece vs. Set The GOS behavior is governed by the product unit type. If "Piece" is selected, the Coordinate count is fixed at 1. If "Set" is selected (e.g., matching children's Top and Bottom), the system must support up to 6 coordinates. This logic dictates the visibility of sub-tabs and component mapping throughout the order lifecycle.

Grid Requirements:

* Size-wise and Colour-wise Breakdown: Matrix tables mapping quantities per size across all colorways.
* Component Lists: Identification of all physical panels (Front, Back, Sleeve, etc.) mapped to specific fabric structures (e.g., Single Jersey, Interlock).

The Trim Clutter Prevention Policy

To maintain shop floor clarity, the GOS print format enforces a strict exclusion of trim and accessory details. All buttons, sewing threads, and labels are isolated in a dedicated Accessories Requirement Sheet. This separation ensures the GOS remains a clean construction blueprint, preventing the production line from being distracted by non-textile procurement data.

Connective Tissue

Finalizing the GOS data structure establishes the garment’s physical coordinates, which then triggers the downstream CAD task for precise panel layout.

2. The Digital CAD Loop and Marker Handoff Workflow

Context and Strategic Importance

Transitioning from traditional physical pattern handoffs to an automated, paperless CAD task is a strategic imperative for reducing manual data entry errors. By digitizing the CAD loop, the system creates a high-fidelity data bridge where technical marker dimensions directly inform the procurement engine, removing physical friction between the CAD room and Merchandising.

Marker Layout Planning

The CAD department must map template patterns against standard fabric roll widths—defined in the system as Dia / Width (வித்). This functional requirement ensures that marker layouts are optimized for specific fabric widths, minimizing wastage before the first cut is made.

Component Weight Formulation

Upon finalizing the marker, the CAD team inputs the exact weight in grams for every coordinate component panel:

* Front Body: 120g
* Sleeve: 45g
* Neck Rib: 12g
* Additional Panels: Back Body, Pocket, etc.

Automated Workspace Sync

Once the CAD markers (PDF) and component weights are submitted, the system automatically pushes these values to Step 4 (Fabric BOM) in the order workspace. This automation accelerates the procurement cycle by allowing Merchandisers to instantly calculate raw material needs without waiting for physical coordination with the CAD room.

Connective Tissue

Data Output from Section 2 serves as the primary Input Variable for the Fabric BOM Calculation Engine.

3. Step 4: Fabric BOM Calculation Engine

Context and Strategic Importance

Precision in the Fabric Bill of Materials (BOM) is necessary to prevent yarn over-ordering while ensuring the cutting room has sufficient stock to fulfill the order. This engine balances cost-control with production reality.

Consumption Logic and Formula

The system calculates the Fabric Consumption in KGs using the following architectural formula:

The Calculation: Total Fabric Requirement (KG) = (CAD Component Weight × Size-wise Quantity) + Cutting-Room Rejection Multiplier

Specific Differentiator: Unlike trim and accessories—which are ordered to exact SKU counts—the Fabric BOM must include a dedicated garment rejection percentage. This multiplier accounts for defects in knitting, roll-dyeing, and cutting-room floor waste, ensuring the final knitting and dyeing weights cover the total net garment quantity.

Data Output

The engine generates three critical technical outputs:

1. Yarn Requirement (KGs): Total raw material for procurement.
2. Knitting Weight: Assigned volume for the knitting unit.
3. Dyeing Volume: Weight categorized by colorway for the dye house.

Connective Tissue

These technical requirements are communicated to the relevant internal departments through the integrated order-centric collaboration module.

4. Order-Centric "RE-Community" Collaboration Module

Context and Strategic Importance

To eliminate information silos created by fragmented external chats, the "RE-Community" module centralizes all order-bound communication into an auditable, isolated digital workspace.

Automated Space Spawning

The system's trigger logic ensures that saving a new order automatically spawns a dedicated collaboration channel. This channel is uniquely bound to the RE Number (ஆரி நம்பர்), serving as the permanent digital file for the job.

Role-Based Auto-Assignment

Relevant stakeholders are auto-joined based on their system permissions:

* Merchandisers: For procurement and delivery oversight.
* CAD Technicians: For marker and gram-weight updates.
* Cutting Room Heads: To receive alerts on fabric readiness and marker PDFs.

The Collaboration Stream

The stream supports direct file sharing (CAD markers) and system-bot alerts. For instance, the moment CAD weights are submitted, an automated notification is pushed to the stream, alerting the Merchandiser that the Fabric BOM is ready for approval.

Connective Tissue

While the community handles general coordination, the system employs specialized sub-grids to manage the complexity of multi-color trim configurations.

5. Combination Configuration for Multi-Colour Trims

Context and Strategic Importance

Procuring trims for multi-color orders requires a specialized rollup engine to ensure SKU accuracy. A mismatch in thread or zip color can halt an entire production line; therefore, the system must map trims at the component level.

Trigger Rules and Component Mapping

When a trim item (e.g., Sewing Thread) is flagged as a "Combination," the system initiates a sub-grid configuration. The system uses Color vs. Combo logic: a "Combo" is the garment-level identity (e.g., "Red-Navy Combo"), whereas the system maps specific dyed colors to individual components (e.g., Front: Red, Sleeves: Navy).

Rollup and Consolidation Engine

The system sums component requirements across different combinations and groups them by Trim Colour SKU.

* Strategic Impact: If multiple combos use "Navy" thread for different panels, the system rolls these up into a single consolidated purchasing SKU. This allows for bulk procurement of specific trim colors even when they are spread across different garment parts or combinations.

Connective Tissue

Consolidated trim requirements move into the inventory pipeline, where they are managed through a "Grey-to-Processed" lifecycle.

6. Multi-Process Pipeline and Grey-to-Processed Lifecycle

Context and Strategic Importance

To comply with Minimum Order Quantities (MOQ), trims are often purchased in bulk as "Grey" (raw/undyed) stock. The system must support the financial advantage of bulk buying while tracking the technical reality of color-wise processing.

The Multi-Process Sequence

The pipeline allows for chaining multiple stages for a single trim item (e.g., Dyeing -> Printing -> Engraving). This is critical for items involving Contrast Panel Splits, where one bulk "Grey" purchase is sliced into multiple color-wise batches based on the Combo-to-Component mapping.

Inventory Lifecycle Stages

The lifecycle is tracked via four distinct states:

1. Purchase Requirement (Grey/Raw): Grouping dyed colorways to facilitate bulk undyed procurement.
2. Process Requirement (Colour-wise): Slicing requirements by color and processing stage.
3. Delivery Challans (சலான் / DCs): Logic for issuing DCs to track stock movement to external dyeing or printing contractors.
4. Lifecycle Transitions: Status flow: Raw Grey Purchased -> Out at Process (DC Tracking) -> Finished Stock Received -> Issued to Production.

Summary

This end-to-end specification ensures total visibility from the initial Garment Order Sheet to the final issued trim. By integrating CAD weights, enforcing "RE-Number" centricity, and automating the "Grey-to-Processed" transition, the system provides an auditable and highly efficient lifecycle for Record 1787376887158.
