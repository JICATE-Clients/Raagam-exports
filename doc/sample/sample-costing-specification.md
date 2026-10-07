# Software Requirement Specification (SRS): Modern Sample Costing Module

## 1. Executive Architectural Overview & Design Vision

This Software Requirement Specification (SRS) details the functional, technical, mathematical, and UI/UX specifications for the next-generation **Sample Costing Module** within the enterprise resource planning (ERP) system. Based on evaluations of legacy ERP screens (`Product Cost Sheet`), commercial Excel models (`costing-for LF -.pdf`), and project leadership discussions (`record-1791344746792.wav` and `record-1791346314633.wav`), this module addresses usability bottlenecks that previously slowed down merchandising teams.

### 1.1 Legacy Pain Points
In the legacy ERP interface, preparing a sample cost sheet required navigating through 8+ nested tab levels:
* **Primary Tabs**: `Fabrics`, `Consumption`, `Other Expenses`, `Cost`
* **Secondary Sub-tabs**: `Fabric`, `CMT`, `Garment Process`, `Trims`
* **Sub-grid Modals**: Direct consumption popups, currency rate lookup windows, process loss calculation modals.

This deep tab hierarchy created visual disorientation, required excessive mouse clicks, and slowed costing preparation to 10–15 minutes per style. Consequently, merchandisers frequently bypassed the ERP system in favor of offline Excel spreadsheets.

### 1.2 Modernization Strategy
The updated Sample Costing Module replaces nested tabs with a single-screen **Responsive 3-Section Canvas**:
1. **Header & Context Bar**: A fixed top banner displaying sample identifiers, customer info, season, garment thumbnail, and version history.
2. **Left/Main Canvas (Material & Direct Cost Engine)**: A clean, stacked accordion layout organizing Fabric Rate Derivations, Piece Consumption, CMT, Garment Processing, and Trims into clear, editable cards.
3. **Right Sticky Rail (Commercial Summary & Quotation Matrix)**: A live-updating financial summary card that calculates net costs, margins, shipping add-ons, currency conversions, and set price aggregations in real time as values are entered.

```
+---------------------------------------------------------------------------------------------------+
| HEADER: Costing No: CST/26-27/0001 | Sample No: SMP/26-27/0001 | Style: SAFARI SET | Season: Q1   |
+-------------------------------------------------------------------+-------------------------------+
| MAIN COSTING CANVAS (Left Panel)                                  | LIVE SUMMARY RAIL (Right)     |
| +---------------------------------------------------------------+ | +---------------------------+ |
| | 1. FABRIC RATE DERIVATION (Yarn + Knitting + Dyeing + Loss %) | | | FINANCIAL BREAKDOWN (INR)   | |
| +---------------------------------------------------------------+ | | Fabric Cost:        173.33  | |
| | 2. PIECE CONSUMPTION & FABRIC COST (Gram Weight x Rate/KG)    | | | CMT Cost:            30.00  | |
| +---------------------------------------------------------------+ | | Print / Embroidery:  38.00  | |
| | 3. CMT & GARMENT PROCESSING (Cut/Sew, Printing, Embroidery)   | | | Trims & Accessories: 20.00  | |
| +---------------------------------------------------------------+ | | Testing & Port Charges: 8.00| |
| | 4. TRIMS, ACCESSORIES & OTHER EXPENSES (Labels, Polybags, FOB) | | |---------------------------| |
| +---------------------------------------------------------------+ | | Net Piece Cost:     269.33  | |
|                                                                   | | Margin (25%):        67.33  | |
|                                                                   | | Wastage (5%):        13.47  | |
|                                                                   | | Gross Price (INR):  350.13  | |
|                                                                   | |---------------------------| |
|                                                                   | | QUOTATION BUILDER         | |
|                                                                   | | Currency: [ USD v ] @ 84.0| |
|                                                                   | | Calc Price:        $4.17  | |
|                                                                   | | Quoted Price:     [$4.25] | |
|                                                                   | | Set Price (2-Pcs): $7.02  | |
|                                                                   | +---------------------------+ |
+-------------------------------------------------------------------+-------------------------------+
```

---

## 2. Header & Context Parameters

The header locks in transaction context and inherits core metadata from the Sample Entry module (`SMP/...`).

| Field Name | Control Type | Logic & Validation Rules |
| :--- | :--- | :--- |
| **Costing No** | Text (Read-Only) | Auto-generated transaction sequence (e.g., `CST/2627/0001`). |
| **Costing Date** | Date Picker | Defaults to system date (`DD-MM-YYYY`). |
| **Sample No / Inquiry** | Search Lookup | Links directly to Sample Entry (`SMP/...`). Auto-fetches style attributes upon selection. |
| **Customer** | Text (Auto-Fetched) | Customer entity inherited from Sample Entry (e.g., `LI & FUNG` / `AARSAN AMERICAS`). |
| **Season & Year** | Dropdown / Auto | Inherited from Sample Entry (e.g., `Q1 2026`). |
| **Style Name & Description**| Text (Auto-Fetched) | Garment style name (e.g., `PZAW25522 - SAFARI SET`) and silhouette description. |
| **Garment Visual** | Image Thumbnail | Displays garment thumbnail uploaded during Sample Entry or allows new upload. |
| **Version / Revision** | Dropdown | Options: `Original (Rev 0)`, `Rev 1`, `Rev 2`, `Rev 3`. Tracks negotiation history. |

---

## 3. Main Canvas: Material & Manufacturing Cost Engine

### 3.1 Fabric Rate Derivation Card

Calculates the total cost per kilogram ($\text{Price / KG}$) for each fabric quality required by the style.

| Column Field Name | Data Type / Control | Formula / Business Logic |
| :--- | :--- | :--- |
| **Fabric Quality** | Search Lookup | Selects fabric master or construction descriptor (e.g., `280gsm Super Sueded Brush Back 100% Cotton`). |
| **Yarn Rate / KG** | Numeric Input | Base raw yarn cost in INR (e.g., $\text{₹295.00}$). |
| **Knitting Rate / KG** | Numeric Input | Knitting / weaving processing charge (e.g., $\text{₹55.00}$). |
| **Dyeing Rate / KG** | Numeric Input | Fabric dyeing / bleaching charge (e.g., $\text{₹100.00}$). |
| **Special Processing** | Multi-Select / Grid | Itemizes processing: Stentering ($\text{₹16}$), Brushing ($\text{₹12}$), Sueding ($\text{₹16}$), Dip Stentering ($\text{₹16}$), Compacting ($\text{₹10}$). |
| **Subtotal Rate** | Calculated | Sum of Yarn + Knitting + Dyeing + Special Processing (e.g., $\text{₹520.00}$). |
| **Process Loss %** | Numeric Input | Manufacturing shrinkage/wastage allowance percentage (e.g., $12\%$). |
| **Fabric Price / KG** | Calculated | $\text{Fabric Price / KG} = \text{Subtotal Rate} \times \left(1 + \frac{\text{Process Loss \%}}{100}\right)$ (e.g., $520 \times 1.12 = \mathbf{\text{₹582.40}}$). |
| **Direct Rate Override** | Toggle + Numeric | Allows direct manual override if buying finished fabric from an external mill. |

### 3.2 Component Consumption & Piece Fabric Cost Card

Maps fabric qualities to garment components (Body, Rib, Pocketing) and size groups to calculate exact fabric cost per piece.

| Component Field | Data Type | Formula / Business Logic |
| :--- | :--- | :--- |
| **Garment Component** | Dropdown | Selects component category: `Body Fabric`, `2x2 Derby Rib`, `Pocketing`, `Interlining`. |
| **Size Group / Category** | Dropdown | Selects size range (e.g., `3/6M - 12/18M`, `1.5/2yrs - 5-6yrs`, `6-7yrs`). |
| **Garment Weight (Grams)**| Numeric Input | Weight of fabric consumed for this component in grams (e.g., Body = $162\text{g}$ / $258\text{g}$ / $270\text{g}$, Rib = $40\text{g}$). |
| **Dimensional Calc Mode** | Optional Accordion | Calculates gram weight dynamically: $\text{Weight (g)} = \frac{\text{Length (cm)} \times \text{Width (cm)} \times \text{GSM}}{10,000}$. |
| **Component Fabric Cost** | Calculated | $\text{Component Cost} = \left(\frac{\text{Fabric Price / KG}}{1000}\right) \times \text{Garment Weight (g)}$ (e.g., $\frac{582.40}{1000} \times 162 = \mathbf{\text{₹94.35}}$). |

### 3.3 CMT & Garment Processing Card

Captures direct labor, assembly, and embellishment charges.

| Cost Item | Control Type | Description & Calculation Rules |
| :--- | :--- | :--- |
| **CMT (Cut, Make, Trim)** | Numeric / Sub-grid | Cutting, sewing, and trimming labor rate per garment piece (e.g., $\text{₹30.00}$ for Top, $\text{₹25.00}$ for Pants). |
| **Print (Pigment & Puff)** | Numeric Input | Screen printing, chest print, or AOP charges per piece (e.g., $\text{₹38.00}$). |
| **Embroidery (EMB)** | Numeric Input | Stitch count-based embroidery charges per piece (e.g., $\text{₹0.00}$ / $\text{₹15.00}$). |
| **Garment Wash** | Numeric Input | Special garment washing, enzyme wash, or tie-dye processing per piece (e.g., $\text{₹0.00}$). |

### 3.4 Trims, Accessories & Other Expenses Card

| Item Category | Control Type | Description & Calculation Rules |
| :--- | :--- | :--- |
| **Accessories & Trims** | Sub-grid Table | Itemized trims: Buttons, Zipper, Labels, Main Label, Care Label, Hangtag, Polybag, Elastic (e.g., $\text{₹20.00}$). |
| **Testing & FOB Charges** | Numeric Input | Fabric/garment lab testing allowance plus port/FOB handling expenses (e.g., $\text{₹8.00}$). |
| **Bank Charges** | Numeric Input | Trade finance, LC processing, or banking fee allowance per piece. |

---

## 4. Live Commercial Summary & Multi-Currency Quotation Builder

Positioned as a sticky sidebar or right-hand panel, this live summary recalculates instantly whenever any component in the main canvas is altered.

### 4.1 Cost Accumulation & Margin Logic

1. **Net Manufacturing Cost (INR)**:
   $$\text{Net Cost} = \text{Fabric Cost} + \text{Rib Cost} + \text{CMT} + \text{Printing} + \text{Embroidery} + \text{Washing} + \text{Accessories} + \text{Testing}$$
   *(Example: $94 + 23 + 30 + 38 + 0 + 0 + 20 + 8 = \mathbf{\text{₹214.00}}$)*

2. **Overheads & Profit Margin (%)**:
   * User inputs target margin percentage (e.g., $25\%$).
   * Margin Value = $\text{Net Cost} \times 25\% = \mathbf{\text{₹53.50}}$.

3. **Garment Rejection / Wastage (%)**:
   * User inputs production wastage percentage (e.g., $5\%$).
   * Wastage Value = $\text{Net Cost} \times 5\% = \mathbf{\text{₹10.70}}$.

4. **Commercial Discount (%)**:
   * User inputs buyer discount allowance (e.g., $2\%$).
   * Discount Value = $\text{Net Cost} \times 2\% = \mathbf{\text{₹4.28}}$.

5. **Gross Garment Price (INR)**:
   $$\text{Gross Price (INR)} = \text{Net Cost} + \text{Margin Value} + \text{Wastage Value} - \text{Discount Value}$$
   *(Example: $214 + 53.50 + 10.70 - 4.28 = \mathbf{\text{₹273.92}}$)*

### 4.2 Multi-Currency Quotation Engine

Translates local INR production costs into foreign commercial buyer quotes based on shipping terms.

| Commercial Field | Control Type | Business Logic & Mathematical Formulas |
| :--- | :--- | :--- |
| **Ship Mode & Freight** | Dropdown + Inputs | Selects `Sea Freight` or `Air Freight`. Adds freight allowance per piece (e.g., Air = $\text{₹25.00}$, Sea = $\text{₹2.00}$). |
| **Insurance Allowance** | Numeric Input | Cargo insurance allowance per piece (e.g., $\text{₹5.00}$). |
| **Target Currency** | Dropdown | Selects buyer billing currency: `USD ($)`, `EUR (€)`, `GBP (£)`. |
| **Exchange Rate** | Numeric Input | Conversion exchange rate (e.g., $1\text{ USD} = \text{₹83.00}$). |
| **Calculated Target Price** | Read-Only | $\text{Calc Price (USD)} = \frac{\text{Gross Price (INR)} + \text{Freight} + \text{Insurance}}{\text{Exchange Rate}}$ (e.g., $\frac{271}{83} = \mathbf{\$3.27}$). |
| **Final Quoted Price** | Editable Input | Merchandiser or MD rounds up or adjusts commercial offer price (e.g., $\mathbf{\$3.30}$). |
| **Profit Delta Indicator** | Visual Badge | Displays real-time margin variance between Calculated Target and Quoted Price (e.g., `+$0.03 / +0.9% Margin`). |

### 4.3 Multi-Piece Set Price Aggregator

When garment `Unit = SET` (e.g., Sweatshirt Top + Sweatpants Bottom):
1. The canvas maintains component costing for **Top** (e.g., $\$4.12$) and **Pants** (e.g., $\$2.70$).
2. The summary panel automatically displays the **Quoted Set Price**:
   $$\text{Quoted Set Price (USD)} = \text{Quoted Price}_{\text{Top}} + \text{Quoted Price}_{\text{Pants}} = \$4.12 + \$2.70 = \mathbf{\$6.82}$$

---

## 5. Downstream Workflows & Action Directives

Upon saving or approving the Cost Sheet:
1. **Quotation Generation**: Generates official PDF quotation sheet for buyer transmission.
2. **Margin Lock & Approval**: If Quoted Price falls below target margin (e.g. $< 20\%$), system flags for **MD Approval**.
3. **Conversion to Bulk Budget**: Upon buyer PO confirmation, costing numbers lock and automatically seed the **Bulk Order Budget & Bill of Materials (BOM)**.

---

## 6. UI/UX Guidelines for Development Team

1. **Accordion Layout**: Use collapsible card panels for Sections 3.1 to 3.4 to keep the main canvas clean while allowing instant access.
2. **Sticky Financial Panel**: The Live Summary Rail must use CSS `position: sticky; top: 1rem;` so it remains fully visible as merchandisers scroll down long cost breakdown forms.
3. **Reactive Calculation Engine**: Implement client-side reactive state (e.g., React hooks / Vue reactivity) so any change in yarn rate, process loss, or garment weight instantly updates the final USD set price without page reloads.
4. **Keyboard Accessibility**: Ensure spreadsheet-like grid navigation (Tab, Enter, Arrow keys) across tabular inputs so merchandisers can enter rates rapidly.
