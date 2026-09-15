Technical Implementation Specification: Textile Manufacturing Management System (TMMS) Phase II Updates

1. Project Scope and Strategic Implementation Context

Phase II updates to the Textile Manufacturing Management System (TMMS) are designed to consolidate fragmented user interfaces and refine underlying calculation logic. This architectural shift reduces manual data entry errors and ensures manufacturing accuracy from the order stage through shipment. By aligning interface data with physical manufacturing constraints, the system ensures that procurement and production schedules are driven by verified technical parameters.

The objective of this document is to provide developers with a definitive technical roadmap for implementing functional changes in UI architecture, yarn mapping, knitting weight algorithms, and Time & Action (T&A) scheduling.

Interface clarity is the foundational requirement for accurate data capture, beginning with the UI/UX architecture.

2. UI/UX Consolidation and Interface Optimization

UI consolidation is mandatory to improve operative efficiency and eliminate "screen fatigue" caused by menu redundancy. The system must provide a unified entry point for all fabric-related data to ensure consistency across the production lifecycle.

Mandatory Interface Changes:

* Menu Navigation: The developer shall resolve the overlapping menu structure where 'Order Management' appears redundantly. The navigation tree must be streamlined to a single, logical path.
* Screen Merging: The separate 'Mixing Details' screen is decommissioned. Developers must integrate the 'Mixing Percentage' and '10/6 Value' columns, along with 'Combination' (Combo) buttons, directly into the primary Fabric/Yarn entry grid.
* Field Constraints: Implement a 'Read-Only' constraint on the 'Number of Colours' field once the Yarn Color rows have been generated. This prevents data corruption within the generated grid after mixing percentages have been assigned.

Interface Mapping Table:

Legacy Screen/Field	New Consolidated Location/Property
Mixing Details (Separate Screen)	Integrated into Fabric/Yarn Entry Screen
10/6 Value Column	Primary Fabric Grid
Mixing Percentage (%)	Primary Fabric Grid
Combination/Combo Buttons	Primary Fabric Grid
Number of Colours (Editable)	Read-Only (Post-Row Generation)
Duplicate Order Management Menu	Unified Navigation Tree

These UI improvements facilitate the input of complex data required for yarn mixing and multi-combo orders.

3. Functional Logic: Yarn Mixing and Combo Color Mapping

Accurate yarn color mapping is required for multi-style and multi-combo orders to ensure procurement accuracy. The system must map visual garment "Combos" to the specific technical yarn colors and percentages required for dyeing and knitting.

Functional Mandates:

* Style-Wise Differentiation: If the "Multi-Style" flag is set to 'Yes' in the Order Header, the Fabric Entry grid shall force a "Style Selection" for every yarn mixing row. This prevents global overrides and allows different mixing percentages for different styles within a single order.
* Data Normalization: "Combo Names" (e.g., "Red/Green") must be pull-down selections populated from the "Fabric/Record Color" table. Individual "Yarn Colors" must be sourced from the "Yarn Master."
* Combo Mapping Logic: The system shall map a selected Combo Name to specific yarn colors and weight percentages (e.g., Combo "Red/Green" maps to 60% Red yarn and 40% Green yarn).
* Stripe-to-Percentage Conversion: For striped fabrics, the system must convert physical measurements into weight percentages for machine-splitting.
  * Algorithm: Percentage per Color = (Individual Stripe Width / Total Width of All Stripes) * 100.
  * Example: If a fabric has stripes of 6cm, 1cm, and 0.5cm (Total Width = 7.5cm), the 6cm stripe yarn requirement is calculated as (6 / 7.5) * 100 = 80%.

This mapping logic ensures the system calculates material requirements based on physical composition, feeding directly into the manufacturing weight algorithms.

4. Technical Algorithms: Manufacturing Weight Calculations

Calculation logic must be differentiated by fabric type (Circular Knit, Flat Knit, or Woven) to prevent material waste and ensure precise procurement.

Manufacturing Weight Algorithms:

* Circular Knit Logic (Weight-Based):
  * The system shall default to KG calculations.
  * Formula: Total Yarn Requirement = (Order Quantity * Piece Weight in Grams) / 1000.
* Flat Knit Logic (Collars/Cuffs/Ribs - Number-Based):
  * The system shall default to piece-based calculations.
  * Inputs Required: Width, Length, and Weight per individual piece (Grams).
  * Formula 1 (Quantity): Total Quantity = (Order Quantity * Pieces per Garment).
  * Formula 2 (Weight): Total Weight = (Total Quantity * Piece Weight in Grams) / 1000.
* Woven Logic (Meter-Based):
  * The system shall calculate requirements based on linear length and GSM.
  * Formula 1 (Length): Total Meters = (Order Quantity * Meters per Garment).
  * Formula 2 (Weight): Total Weight = (Total Meters * Grams per Meter) / 1000.

The calculated "Total Weight" for all categories is the primary data trigger for the "Material Inward" task in the T&A schedule.

5. Dynamic Scheduling Engine: T&A Backward Date Logic

The T&A Scheduler shall utilize backward scheduling from the 'Shipment Date' to ensure On-Time Delivery (OTD). The engine must account for non-working days to maintain realistic production targets.

T&A Logic Parameters:

* The Baseline: All task dates are calculated backward from the 'Shipment Date'.
* The Sunday Rule: If any calculated Start or End date falls on a Sunday, the system shall automatically shift that date to the preceding Saturday.
* Sunday-Aware Lead Time: The lead time calculation must be inclusive of non-working days. If a Sunday falls within a task's lead time range, the system must add +1 day to the backward offset to ensure the actual number of required production days is maintained.
* Lead Time Formula: Start Date = (End Date - (Lead Time - 1)).
* Task Dependencies:
  * Inspection: Must conclude at least one day prior to Shipment (subject to the Sunday Rule).
  * Packing: Must conclude before the Inspection task begins.
  * Material Inward: Must be completed prior to the "Cutting" task start date.

Sample Schedule Table:

Task	Lead Time	Calculated Date	Adjusted Date (Sunday Rule)	Notes
Shipment	N/A	Oct 5 (Mon)	Oct 5	Baseline
Inspection	1 Day	Oct 4 (Sun)	Oct 3 (Sat)	Shifted from Sunday
Packing	2 Days	Oct 1 - Oct 2	Oct 1 - Oct 2	Ends before Inspection

This implementation directive provides the comprehensive framework required to update the TMMS into a technically rigorous manufacturing management tool.
