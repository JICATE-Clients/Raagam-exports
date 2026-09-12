Here is the exact calculation pipeline derived directly from the client discussions and internal production reports:1. Net Required Fabric Weight (Cutting Required Wt)To find the net weight of fabric needed for the garment components before applying process loss:$$\mathbf{\text{Net Required Fabric Wt (Kg)}} = \frac{\mathbf{\text{Cut Qty (or SQ Qty)}} \times \mathbf{\text{Piece Wt (Consumption Wt in grams)}}}{1000}$$1more_horizCut Qty / SQ Qty: The total number of pieces to be cut (including excess and rejection allowances)56.Piece Wt / Consumption Wt (g): The weight in grams of the specific garment component (e.g., Front Body + Back + Sleeves = 200g, Neck Rib = 25g)2more_horiz.2. Multi-Stage Compounded Process Loss (Backward Markup)Because fabric loses weight during manufacturing processes (such as knitting, dyeing, stentering, brushing, and compacting), the system calculates required input weights backward from the final cutting weight using markup formulas rather than simple subtraction7more_horiz:$$\mathbf{\text{Stage Input Wt}} = \frac{\mathbf{\text{Stage Output Wt}}}{1 - \mathbf{\text{Stage Loss \%}}}$$7more_horizCompacting Stage: $\text{Input Wt} = \frac{\text{Net Cutting Wt}}{1 - \text{Compacting Loss \%}}$710Dyeing Stage: $\text{Input Wt} = \frac{\text{Compacting Input Wt}}{1 - \text{Dyeing Loss \%}}$710Knitting Stage: $\text{Input Wt} = \frac{\text{Dyeing Input Wt}}{1 - \text{Knitting Loss \%}}$710This ensures that after every manufacturing stage incurs its respective waste percentage, the exact required weight of finished fabric reaches the cutting floor without shortages1011.3. Raw Yarn Purchase Requirement & Fiber Blend SplitOnce the gross knitting stage weight is derived, the required yarn weight is split by fiber composition or stripe percentage1213:$$\mathbf{\text{Yarn Requirement (Kg)}} = \mathbf{\text{Gross Knitting Input Wt (Kg)}} \times \mathbf{\text{Yarn Blend \%}}$$1213Solid / Single Blend: A 100% BCI Cotton fabric takes 100% of the gross knitting weight45.Fiber Blends: A 95% BCI Cotton / 5% Elastane Lycra Rib splits the gross knitting weight into 95% Cotton Yarn and 5% Elastane Yarn5more_horiz.Yarn Aggregation: If the same yarn count (e.g., 30'S BCI COTTON) is shared across multiple garment components or fabric items, the system sums their individual calculated weights into a single Total Yarn Purchase Requirement line item5more_horiz.⛵ Would you like me to map these specific calculation fields directly into your database schema or spreadsheet export logic?keep_pin
              Save to notecopy_allthumb_upthumb_downso now i need to implemen t the logic in fabric bom and need to create report based on the calucation now please share me the end end to calelry deatils summary for itfor devlopement Thoughts expand_moreEND-TO-END TECHNICAL DEVELOPMENT SPECIFICATION: FABRIC BOM LOGIC & CALCULATION REPORT1. CORE MATHEMATICAL LOGIC & FORMULA PIPELINEThe calculation engine derives total raw yarn purchase requirements and multi-stage fabric process weights by executing a 3-stage backward calculation pipeline1more_horiz.  [Garment SQ / Cut Qty] × [Piece Wt (Consumption Wt)]
                         │
                         ▼
             1. Net Cutting Required Weight (Kg)
                         │
                         ▼ (Backward Multi-Stage Markup Loss Compacting ──► Stentering ──► Brushing ──► Dyeing ──► Knitting)
             2. Gross Knitting Stage Weight (Kg)
                         │
                         ▼ (Yarn Fiber Blend / Stripe % Split & Aggregation)
             3. Total Yarn Purchase Requirement (Kg)
Stage 1: Net Cutting Required Weight (Cutting Req Wt)To calculate the net finished fabric weight needed at the cutting floor for each size/component5more_horiz:$$\mathbf{\text{Net Cutting Required Wt (Kg)}} = \frac{\mathbf{\text{Cut Qty (SQ Qty)}} \times \mathbf{\text{Consumption Wt (g)}}}{1000}$$Cut Qty / SQ Qty: Total piece count to be cut59: $$\text{SQ Qty} = \text{Order Qty} + \text{Excess Qty} + \text{Rejection Allowance Qty} + \text{Approval Allowance Qty}$$Consumption Wt (g) / Piece Wt: Weight in grams of the specific garment part (e.g., Front Body + Back + Sleeves = $100\text{g}$, Neck Rib = $25\text{g}$)5more_horiz.Stage 2: Backward Multi-Stage Markup Process Loss CompoundingManufacturing processes (Knitting, Dyeing, Brushing, Compacting, Stentering) incur physical material waste1more_horiz. Because wastage occurs on the input material entering each machine, the system uses a backward markup formula to determine the required input weight entering every stage2more_horiz:$$\mathbf{\text{Stage Input Wt (Kg)}} = \frac{\mathbf{\text{Stage Output Wt (Kg)}}}{1 - \left(\frac{\mathbf{\text{Stage Loss \%}}}{100}\right)}$$Sequential Chain Walk (Worked Example)1more_horiz:Cutting Floor Output Required: $1,415.40\text{ Kg}$21.Compacting Stage (Loss: 1.00%): $$\text{Compacting Input Wt} = \frac{1,415.40}{1 - 0.01} = 1,429.70\text{ Kg} \quad$$3Stentering Stage (Loss: 2.00%): $$\text{Stentering Input Wt} = \frac{1,429.70}{1 - 0.02} = 1,458.88\text{ Kg} \quad$$320Dyeing Stage (Loss: 5.00%): $$\text{Dyeing Input Wt} = \frac{1,458.88}{1 - 0.05} = 1,535.66\text{ Kg} \quad$$13Knitting Stage (Loss: 1.00%): $$\text{Knitting Input Wt (Gross Yarn Required)} = \frac{1,535.66}{1 - 0.01} = 1,551.17\text{ Kg} \quad$$13Stage 3: Raw Yarn Requirement & Blend SplitOnce the Gross Knitting Input Weight is computed, the system splits the weight according to the fabric's yarn blend or yarn-dyed stripe percentage1more_horiz:$$\mathbf{\text{Yarn Count Requirement (Kg)}} = \mathbf{\text{Gross Knitting Input Wt (Kg)}} \times \left(\frac{\mathbf{\text{Yarn Blend \%}}}{100}\right)$$Single Fiber (100% BCI Cotton): Receives $100\%$ of the gross knitting weight1more_horiz.Fiber Blend (95% Cotton / 5% Elastane Lycra Rib)1more_horiz:30's BCI Cotton Yarn: $\text{Gross Weight} \times 0.95$1more_horiz.30 Diner Elastane Yarn: $\text{Gross Weight} \times 0.05$1more_horiz.Yarn Aggregation: If multiple garment components share the same yarn count (e.g., 30'S BCI COTTON used in both Jersey body and Rib neck), the backend aggregates their individual weights into a single purchase line item1more_horiz.2. DATABASE SCHEMA DESIGNTo implement this logic, developers must set up the following relational database tables:-- 1. Main Fabric BOM Register Header
CREATE TABLE fabric_bom_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sq_no VARCHAR(50) NOT NULL,
    sq_description TEXT,
    customer_name VARCHAR(100) NOT NULL,
    delivery_from_date DATE NOT NULL,
    delivery_to_date DATE NOT NULL,
    sc_no VARCHAR(50),
    order_no VARCHAR(50) NOT NULL,
    style_ref_no VARCHAR(50) NOT NULL,
    style_no VARCHAR(50) NOT NULL,
    order_qty INT NOT NULL,
    unit VARCHAR(10) DEFAULT 'PCS',
    excess_pct DECIMAL(5,2) DEFAULT 0.00,
    excess_qty INT DEFAULT 0,
    approval_allowance_qty INT DEFAULT 0,
    rejection_allowance_pct DECIMAL(5,2) DEFAULT 0.00,
    rejection_allowance_qty INT DEFAULT 0,
    sq_qty INT NOT NULL, -- Calculated: order_qty + excess + approval + rejection
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Fabric Item & Component Line Items
CREATE TABLE fabric_bom_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    header_id UUID REFERENCES fabric_bom_headers(id) ON DELETE CASCADE,
    assort_color VARCHAR(50) NOT NULL,
    item_color_print VARCHAR(50) NOT NULL,
    component_name VARCHAR(100) NOT NULL, -- e.g., FRONT BODY, NECK
    fabric_description TEXT NOT NULL, -- e.g., SOLID SINGLE JERSEY 100% BCI COTTON
    gsm INT NOT NULL,
    process_type VARCHAR(50) NOT NULL, -- e.g., Solid - OpenWidth, Solid - Tube
    size_code VARCHAR(10) NOT NULL, -- S, M, L, XL, XXL
    size_order_qty INT NOT NULL,
    size_excess_qty INT DEFAULT 0,
    size_appr_qty INT DEFAULT 0,
    size_rej_qty INT DEFAULT 0,
    size_sq_qty INT NOT NULL,
    finish_dia INT NOT NULL, -- Target Diameter / Width
    consumption_wt_gram DECIMAL(10,3) NOT NULL, -- Piece Wt (g)
    cutting_req_wt_kg DECIMAL(10,3) NOT NULL, -- (size_sq_qty * consumption_wt_gram) / 1000
    compounded_loss_pct DECIMAL(5,2) DEFAULT 0.00,
    total_gross_wt_kg DECIMAL(10,3) NOT NULL -- Input weight after loss compounding
);

-- 3. Process Sequence & Stage Loss Master
CREATE TABLE fabric_process_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID REFERENCES fabric_bom_items(id) ON DELETE CASCADE,
    stage_seq INT NOT NULL, -- 1, 2, 3...
    stage_state VARCHAR(20) NOT NULL, -- GREY, DYED, RFD
    process_name VARCHAR(50) NOT NULL, -- KNITTING, DYEING, COMPACTING, STENTERING, BRUSHING
    loss_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    planned_input_wt_kg DECIMAL(10,3),
    ordered_output_wt_kg DECIMAL(10,3)
);

-- 4. Yarn Requirement Summary Table
CREATE TABLE yarn_purchase_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    header_id UUID REFERENCES fabric_bom_headers(id) ON DELETE CASCADE,
    stage_state VARCHAR(20) DEFAULT 'GREY',
    yarn_description VARCHAR(100) NOT NULL, -- e.g., 30'S BCI COTTON
    yarn_color VARCHAR(50) DEFAULT 'GREY',
    plan_wt_kg DECIMAL(10,3) NOT NULL,
    loss_pct DECIMAL(5,2) DEFAULT 0.00,
    to_ordered_wt_kg DECIMAL(10,3) NOT NULL
);
3. BACKEND COMPUTATION SERVICE (TYPESCRIPT)interface ProcessStage {
  stageSeq: number;
  processName: string;
  lossPct: number;
}

interface YarnBlend {
  yarnDescription: string;
  blendPct: number;
}

interface FabricItemInput {
  sqQty: number;
  consumptionWtGram: number;
  stages: ProcessStage[]; // Executed from finished stage backward to Knitting
  yarnBlends: YarnBlend[];
}

export function calculateFabricAndYarnRequirements(input: FabricItemInput) {
  // Step 1: Calculate Net Cutting Required Weight (Kg)
  const cuttingReqWtKg = (input.sqQty * input.consumptionWtGram) / 1000.0;

  // Step 2: Backward Stage Loss Compounding
  let currentStageOutputWt = cuttingReqWtKg;
  const stageWeights: { processName: string; inputWt: number; outputWt: number; lossPct: number }[] = [];

  // Sort stages backward (e.g., Compacting -> Stentering -> Dyeing -> Knitting)
  const sortedStages = [...input.stages].sort((a, b) => b.stageSeq - a.stageSeq);

  for (const stage of sortedStages) {
    const inputWt = currentStageOutputWt / (1 - stage.lossPct / 100.0);
    stageWeights.push({
      processName: stage.processName,
      inputWt: Number(inputWt.toFixed(3)),
      outputWt: Number(currentStageOutputWt.toFixed(3)),
      lossPct: stage.lossPct,
    });
    currentStageOutputWt = inputWt; // Input becomes output for preceding upstream stage
  }

  const grossKnittingReqWtKg = currentStageOutputWt;

  // Step 3: Yarn Purchase Requirement & Fiber Blend Breakdown
  const yarnRequirements = input.yarnBlends.map((blend) => {
    const yarnWtKg = grossKnittingReqWtKg * (blend.blendPct / 100.0);
    return {
      yarnDescription: blend.yarnDescription,
      planWtKg: Number(yarnWtKg.toFixed(3)),
      toOrderedWtKg: Number(yarnWtKg.toFixed(3)), // Applied yarn loss if any
    };
  });

  return {
    cuttingReqWtKg: Number(cuttingReqWtKg.toFixed(3)),
    grossKnittingReqWtKg: Number(grossKnittingReqWtKg.toFixed(3)),
    stageBreakdown: stageWeights.reverse(), // Restored to chronological order
    yarnRequirements,
  };
}
4. REPORT STRUCTURES & FIELD LAYOUTSReport 1: Fabric BOM Entry Register (Detailed & Summary)59========================================================================================================
                                      FABRIC BOM ENTRY REGISTER
========================================================================================================
SQ No.: HO/SQ/2627/0001     SQ Description: HO/RE//2627/0001/1    Customer: TAFFLES   Delivery: 12-10-2026
SC No.: HO/RE//2627/0001     Order No.: 3232   Style Ref No.: 00096/2627/C   Style: TEST   Qty: 10,000 PCS
Excess %: 2.00% (200 PCS)    Rejection Allow: 0.10% (10 PCS)       Approval Allow: 200 PCS   SQ Qty: 10,210
------------------------------------------------========================================================
Assort Color | Component  | Fabric Description         | Size | Order Qty | SQ Qty | Dia | Piece Wt(g) | Req Wt(Kg) | Loss % | Total Wt(Kg)
--------------------------------------------------------------------------------------------------------
WHITE        | FRONT,BACK | SOLID SINGLE JERSEY        | S    | 2,500     | 2,552  | 60" | 100.000     | 255.200    | 19.35% | 304.581
WHITE        | SLEEVES    | 100% BCI COTTON 180 GSM    | M    | 1,500     | 1,532  | 60" | 100.000     | 153.200    | 19.35% | 182.844
WHITE        |            |                            | L    | 1,500     | 1,532  | 60" | 100.000     | 153.200    | 19.35% | 182.844
WHITE        |            |                            | XL   | 3,000     | 3,062  | 60" | 100.000     | 306.200    | 19.35% | 365.450
WHITE        |            |                            | XXL  | 1,500     | 1,532  | 60" | 100.000     | 153.200    | 19.35% | 182.844
--------------------------------------------------------------------------------------------------------
SUBTOTAL     |            |                            |      | 10,000    | 10,210 |     | Avg:100.00g | 1,021.00Kg |        | 1,218.56Kg
--------------------------------------------------------------------------------------------------------
WHITE        | NECK RIB   | SOLID 1X1 LYCRA RIB        | S    | 2,500     | 2,552  | 28" | 25.000      | 63.800     | 0.00%  | 63.800
WHITE        |            | 95% COTTON / 5% ELASTANE   | M-XXL| 7,500     | 7,658  | 28" | 25.000      | 191.450    | 0.00%  | 191.450
--------------------------------------------------------------------------------------------------------
GRAND TOTAL  |            |                            |      | 10,000    | 10,210 |     | Avg:125.00g | 1,276.25Kg |        | 1,473.81Kg
========================================================================================================

PROCESS SEQUENCE & STAGE LOSS LEDGER:
--------------------------------------------------------------------------------------------------------
Class  | Item / Fabric Description                       | Stage | Process Name        | Loss %
--------------------------------------------------------------------------------------------------------
Fabric | SOLID SINGLE JERSEY (100% BCI COTTON)           | GREY  | KNITTING            | 5.00%
Fabric | SOLID SINGLE JERSEY (100% BCI COTTON)           | DYED  | DYEING              | 10.00%
Fabric | SOLID SINGLE JERSEY (100% BCI COTTON)           | DYED  | COMPACTING [OPEN]   | 2.00%
Yarn   | 30'S BCI COTTON                                 | GREY  | YARN PURCHASE       | 0.00%
========================================================================================================
Report 2: Yarn & Fabric Requirement Calculation Report120========================================================================================================
                                   YARN AND FABRIC REQUIREMENT REPORT
========================================================================================================
SQ No.: U2/SQ/2627/0008     Customer: AARSAN AMERICAS     Delivery Window: 25-06-2026 To 25-06-2026
Order No.: 9626013          Style Ref No.: 00002/2627/C   Order Qty: 9,612 PCS     SQ Qty: 10,118 PCS
========================================================================================================

YARN PURCHASE REQUIREMENT:
--------------------------------------------------------------------------------------------------------
Stage | Type | Yarn Description                      | Color | Planned Wt (Kg) | Loss % | To Ordered Wt (Kg)
--------------------------------------------------------------------------------------------------------
GREY  | YARN | 16'S BCI COTTON                       | GREY  | 1,885.053       | 0.00%  | 1,885.053
GREY  | YARN | 24'S BCI COTTON                       | GREY  | 1,505.825       | 0.00%  | 1,505.825
GREY  | YARN | 32'S BCI COTTON                       | GREY  | 2,772.136       | 0.00%  | 2,772.136
GREY  | YARN | 70 DINER ELASTANE                     | GREY  | 46.572          | 0.00%  | 46.572
GREY  | YARN | 80 DINER POLYESTER                    | GREY  | 942.527         | 0.00%  | 942.527
--------------------------------------------------------------------------------------------------------
TOTAL YARN PURCHASE REQUIREMENT:                               1,152.113 Kg              1,152.113 Kg
========================================================================================================

PROCESS STAGE LEDGER BREAKDOWN:

1. KNITTING STAGE
--------------------------------------------------------------------------------------------------------
Fabric Details                                       | Dia/Size | Planned Wt (Kg) | Loss % | To Ordered Wt (Kg)
--------------------------------------------------------------------------------------------------------
SOLID 2X2 LYCRA DURBY RIB (97% Ctn / 3% Elastane)    | 26"      | 1,536.873       | 1.00%  | 1,552.397
SOLID 3T FLEECE BRUSHED (49% Ctn/34% Ctn/17% Poly)   | 70"      | 5,488.831       | 1.00%  | 5,544.274
SOLID SINGLE JERSEY (100% BCI COTTON)                | ANY      | 54.888          | 1.00%  | 55.442
--------------------------------------------------------------------------------------------------------
STAGE TOTAL:                                                    7,080.592 Kg              7,152.113 Kg

2. DYEING STAGE [WITH BIOWASH]
--------------------------------------------------------------------------------------------------------
RFD SOLID 2X2 LYCRA DURBY RIB                        | 26"      | 1,460.029       | 5.00%  | 1,536.873
RFD SOLID 3T FLEECE BRUSHED                          | 70"      | 5,214.389       | 5.00%  | 5,488.831
RFD SOLID SINGLE JERSEY                              | ANY      | 52.144          | 5.00%  | 54.888
--------------------------------------------------------------------------------------------------------
STAGE TOTAL:                                                    6,726.562 Kg              7,080.592 Kg

3. COMPACTING & FINISHING STAGE
--------------------------------------------------------------------------------------------------------
RFD SOLID 3T FLEECE BRUSHED [OPEN WIDTH]            | 70"      | 4,957.820       | 1.00%  | 5,007.899
RFD SOLID 2X2 LYCRA DURBY RIB [TUBULAR]             | 26"      | 1,416.520       | 1.00%  | 1,430.828
RFD SOLID SINGLE JERSEY [TUBULAR]                    | ANY      | 50.590          | 1.00%  | 51.101
--------------------------------------------------------------------------------------------------------
FINISHED FABRIC CUTTING READY TOTAL:                           6,424.930 Kg              6,489.828 Kg
====================================================================================