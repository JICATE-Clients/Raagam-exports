
Technical Development Specification: Fabric BOM Entry Register (Detailed & Summary)

1. Executive Summary and Strategic Objectives

The Fabric Bill of Materials (BOM) Entry Register serves as the critical bridge between merchandising commitments and manufacturing execution within the Raagam Exports / Tiruppur garment manufacturing cluster. This specification provides a robust technical framework for translating customer style references into precise, actionable material requirements.

This system utilizes a dual-mode reporting architecture to facilitate stakeholder-specific workflows:

* Detailed Register: Empowers Production Managers and Cutting Room Supervisors with component-level consumption, size-wise assortments (S–XXL), and specific technical parameters like Item Form (Open Width vs. Tubular).
* Summary Register: Provides Procurement Officers and Yarn Merchants with aggregated demand data, facilitating bulk yarn purchasing and inventory management.

The primary objective is the establishment of a "Single Source of Truth" that accounts for multi-stage process losses (Knitting, Dyeing, Stentering) and complex wastage. By implementing a backward multi-stage compounding logic, the system ensures that yarn procurement is exactly sufficient to meet finished garment output, eliminating the risks of stock shortages or expensive deadstock accumulation.

2. SQ and Order Quantity Calculation Framework

Precise quantity forecasting begins with the Standard Quantity (SQ). In the Tiruppur export framework, the SQ represents the final garment count for which fabric must be knit and processed, incorporating buffers for sampling and production variance.

2.1 The SQ Formula

The system must calculate the SQ based on the following logic:

\text{SQ Quantity} = \text{Order Qty} + \text{Excess Qty} + \text{Approval Allowance} + \text{Rejection Allowance}

* Approval Allowance: A critical manual entry field reserved for QC seal samples, size sets, and testing. Even if zeroed for specific styles, the architecture must support integer inputs to prevent sampling from depleting the main order stock.
* Rejection Allowance: A percentage-based buffer (typically 2.00% to 5.00%) to account for defects during stitching and finishing.

2.2 Analytical Example (SQ No: HO/SQ/2627/0001)

Based on Source Image [SOURCE_IMAGE_1], the system calculates the garment requirements as follows:

Parameter	Value	Percentage
Order Quantity	10,000 PCS	-
Excess Quantity	10 PCS	0.10%
Rejection Allowance	200 PCS	2.00%
Approval Allowance	10 PCS	Strategic Buffer
Final SQ Total	10,220 PCS	-

3. Component Consumption and Technical Material Logic

The system translates garment counts into fabric weight using size-wise consumption data. This ensures marker efficiency and prevents "Net Weight" underestimation.

3.1 Net Cutting Weight (Kg)

The base requirement before process loss is calculated as:

\text{Required Weight (Kg)} = \frac{\text{SQ Qty} \times \text{Piece Consumption Weight (grams)}}{1,000}

3.2 Technical Parameters and Item Forms

The register must distinguish between "Item Forms" to drive downstream process routing (e.g., Open Width vs. Tubular).

Component	Fabric / Description	GSM	Item Form	Dia/Size	Width
FRONT, BACK, SLEEVE	Solid Single Jersey (30'S BCI Cotton)	180	Open Width	60	-
NECK	1x1 Lycra Rib (30'S BCI / 30 Diner Elastane)	220	Tubular	28	-

* BCI Cotton: Better Cotton Initiative standard sourcing.
* Diner: Technical measurement for Elastane/Lycra thickness (e.g., 30 Diner).

4. Yarn Dyed (YD) Logic and Mixing Framework

For Yarn Dyed (YD) fabrics such as stripes, the BOM must transition from a simple weight calculation to a "Mixing Logic" based on color ratios.

4.1 Mixing UOM and Percentage

When a fabric is flagged as Yarn Dyed, the system enables the Mixing Ledger:

* Mixing UOM: Configurable as "Percentage" or "CM" (Stripe length).
* Mixing %: Tracks the percentage of each yarn color within the fabric blend (e.g., 60% Navy / 40% White).
* Yarn Purchase Integration: The gross yarn requirement is split by these percentages to generate specific purchase orders for Navy Yarn and White Yarn.

4.2 Multi-Color Count

The system supports up to 12 colors per YD item, tracking the "Number of Colors" to ensure that the cumulative Mixing Percentage always equals 100%.

5. Multi-Stage Backward Markup and Loss Compounding

To determine the Yarn Purchase Requirement, the system applies a "Backward Multi-Stage" markup. This is essential because process losses at the end of the chain (Stentering) affect the input requirements at the beginning (Knitting).

5.1 The Backward Markup Formula

\text{Input Weight} = \frac{\text{Output Weight}}{1 - (\frac{\text{Loss \%}}{100})}

5.2 Compounding Logic Chain

For Solid Single Jersey, the compounding effect of a 19.35% total loss is applied as follows:

1. Stage 3 (Compacting/Stentering): 1,021.000 Kg (Finished) / 0.98 (2% Loss) = 1,041.837 Kg
2. Stage 2 (Dyeing): 1,041.837 Kg / 0.90 (10% Loss) = 1,157.597 Kg
3. Stage 1 (Knitting): 1,157.597 Kg / 0.95 (5% Loss) = 1,218.523 Kg (Final Yarn Requirement)

6. Process Sequence & Stage Loss Ledger

Every item must be mapped to a rigorous Process Stage Ledger. This defines the technical state (Grey, Dyed, RFD) and the sequence of operations.

Item Class	Item / Process Type	Stage	State	Loss %
Fabric	Solid Single Jersey (Open Width)	1. Knitting	Grey	5.00
		2. Dyeing	Dyed	10.00
		3. Compacting [Open Width]	RFD	2.00
Fabric	Solid 1x1 Lycra Rib (Tubular)	1. Knitting	Grey	-
		2. Dyeing	Dyed	-
		3. Compacting [Tubular]	RFD	-

7. Database Schema Design (PostgreSQL)

The schema utilizes relational constraints to handle coordinate pieces (Sets vs. Pieces) and the mixing logic for yarn-dyed requirements.

-- Fabric BOM Header
CREATE TABLE fabric_bom_headers (
    sq_id SERIAL PRIMARY KEY,
    sq_no VARCHAR(50) UNIQUE NOT NULL,
    style_ref_no VARCHAR(100) NOT NULL,
    order_qty INT NOT NULL,
    excess_qty INT DEFAULT 0,
    rej_allow_qty INT DEFAULT 0,
    appr_allow_qty INT DEFAULT 0, -- Manual entry field
    uom VARCHAR(10) DEFAULT 'PCS',
    coordinate_count INT DEFAULT 1 -- Logic for Sets (Top/Bottom)
);

-- Fabric Item and Mixing Logic
CREATE TABLE fabric_bom_items (
    item_id SERIAL PRIMARY KEY,
    sq_id INT REFERENCES fabric_bom_headers(sq_id),
    item_class VARCHAR(20), -- 'Fabric' or 'Yarn'
    component_name VARCHAR(100),
    item_form VARCHAR(20), -- 'Open Width' or 'Tubular'
    mixing_uom VARCHAR(10), -- 'Percentage' or 'CM'
    mixing_percent NUMERIC(5,2),
    dia_size VARCHAR(10),
    width_inches INT,
    consumption_grams NUMERIC(10,3),
    item_state VARCHAR(20) -- 'Grey', 'Dyed', 'RFD'
);

-- Backward Markup Stages
CREATE TABLE fabric_process_stages (
    stage_id SERIAL PRIMARY KEY,
    item_id INT REFERENCES fabric_bom_items(item_id),
    process_seq INT NOT NULL,
    process_name VARCHAR(50),
    loss_percent NUMERIC(5,2) DEFAULT 0.00
);


8. Backend API & Calculation Service (TypeScript)

The service must dynamically calculate gross weights based on the item_form.

interface ProcessStage {
    sequence: number;
    lossPercent: number;
}

/**
 * Calculates Gross Weight using Backward Multi-Stage Logic.
 * Applied iteratively from final process to initial knitting.
 */
function calculateGrossWeight(netWeight: number, stages: ProcessStage[]): number {
    if (stages.length === 0) return netWeight;
    
    // Reverse sort stages (e.g., Compacting -> Dyeing -> Knitting)
    const reversedStages = [...stages].sort((a, b) => b.sequence - a.sequence);
    
    let grossWt = netWeight;
    for (const stage of reversedStages) {
        const lossFactor = 1 - (stage.lossPercent / 100);
        if (lossFactor <= 0) throw new Error("Invalid Loss Percentage");
        grossWt = grossWt / lossFactor;
    }
    return Number(grossWt.toFixed(3));
}


9. Wireframe & Table Layout Specification

9.1 Detailed Register Layout (Reference: [SOURCE_IMAGE_1])

Component	Fabric	Size	SQ Qty	Dia/Size	Width	Cons. (g)	Req. Wt (Kg)	Loss %	Total Wt
FRONT BODY	SINGLE JERSEY	S	2552	60	-	100.000	255.200	19.35	304.581
FRONT BODY	SINGLE JERSEY	M	1532	60	-	100.000	153.200	19.35	182.844
TOTAL			10220			Avg: 100.0	1022.000		1218.523

9.2 Summary Register Layout

Component	Fabric / Yarn	GSM	Process Type	Item Form	Avg Consum.	Total Required (Kg)
BODY	SINGLE JERSEY	180	Solid - Open	Open Width	100.000	1218.523
NECK	1x1 LYCRA RIB	220	Solid - Tube	Tubular	25.000	255.250


This specification serves as the definitive blueprint for the Fabric BOM Entry Register development, ensuring mathematical accuracy and manufacturing fidelity.
