# Software Requirement Specification (SRS): Sample Module (Sample Entry & Product Info)

## 1. Executive Architectural Overview

This Software Requirement Specification (SRS) details the functional, technical, and UI/UX design specifications for the next-generation **Sample Module** within the apparel manufacturing enterprise resource planning (ERP) system. Based on business discussions and legacy screen evaluations, this module unifies previously fragmented pre-production workflows into a single streamlined screen.

Historically, the legacy ERP separated sampling operations into two distinct MDI window interfaces: `Create Opportunities` (under Sales & Marketing) and `Define Styles` (under Sales & Marketing). This architecture introduced data redundancy, forced unnecessary navigation steps, and created synchronization overhead for merchandising teams.

The updated architecture merges `Create Opportunities` and `Define Styles` into a single, cohesive **Sample Module (Sample Entry)**. The interface adopts a modern, card-based, multi-tab responsive design matching the updated ERP design language (as demonstrated in the updated Order Entry interface), discarding the legacy 3D tabular UI layout. While field definitions, business logic, and validation rules are preserved or refined from the legacy system and recording discussions, the visual layout and user experience are fully modernized.

```
+-----------------------------------------------------------------------------------+
|                            UNIFIED SAMPLE MODULE                                  |
+--------------------------------------------------+--------------------------------+
| TAB 1: SAMPLE INFO                               | TAB 2: PRODUCT INFO            |
| (Merged from Legacy 'Create Opportunities')     | (Merged from Legacy 'Define    |
| - Header Information                             |  Styles')                      |
| - Styles Grid                                    | - General & Technical Specs    |
| - Unit Concept (PCS / Set)                       | - Accessories Reqd Checkbox    |
| - Coordinate Components                          | - Billable Toggle (No / Yes)   |
|                                                  |   ├── If No: Standard Free     |
|                                                  |   └── If Yes: Enable Price &   |
|                                                  |       Quantities Tab           |
+--------------------------------------------------+--------------------------------+
| SUB-TAB 1: COMBOS / COORDINATE GRID              | SUB-TAB 2: QUANTITIES TAB      |
| - Combo Details & Size Matrix                    | - Copied from Order Entry      |
|                                                  | - Enabled when Billable = Yes  |
+--------------------------------------------------+--------------------------------+
```

---

## 2. Module Integration & Screen Flow Architecture

The primary objective of the merged Sample Module is to allow merchandisers to capture initial customer sampling requests, define style attributes, configure fabric/technical parameters, and handle commercial/quantity breakdowns within one seamless user journey.

### Key Integration Directives
1. **Unified Data Entity**: A single primary transaction key (`Sample No` / `Enquiry No`) binds the Sample Info header, Style details, Product specifications, and Quantity matrix.
2. **Tab-Based Navigation**: 
   - **Tab 1: Sample Info**: Focuses on commercial intake, customer origin, inquiry classification, style listing, and basic quantity allocation.
   - **Tab 2: Product Info**: Focuses on garment construction details, fabric structure, merchandising assignments, delivery channels, billable statuses, and full quantity assortment breakdowns.
3. **Data Inheritance**: All style names, article numbers, customer details, seasons, and base quantities defined in Tab 1 automatically populate and lock into Tab 2 to eliminate duplicate data entry.

---

## 3. Tab 1 Specification: Sample Info (Formerly Create Opportunities)

Tab 1 acts as the primary entry point for capturing buyer inquiries and sample creation requests.

### 3.1 Header Fields Specification

The header captures high-level transaction parameters and customer sourcing context.

| Field Name | Control Type | Legacy Status | Logic & Validation Rules |
| :--- | :--- | :--- | :--- |
| **Enquiry No** | Text (Read-Only) | Retained | Auto-generated system sequence (e.g., `OPP/2627/0186`). |
| **Date / Received Dt** | Date Picker | Retained | Defaults to system date (`DD-MM-YYYY`). |
| **Against** | Dropdown | Retained | Options: `Customer Request`, `Sales Meeting`, `New Development`. Defines inquiry origin. |
| **Action** | Dropdown | Retained | Options: `Quote`, `Development`, `Quote and Development`. Drives downstream costing workflows. |
| **Customer** | Search Lookup | Retained | Mandatory. Selects customer entity (e.g., `AARSAN AMERICAS`). |
| **Country** | Text (Auto) | Retained | Auto-populates based on selected Customer master (e.g., `IND`). |
| **Cust Dept** | **Removed** | **Deprecated** | **Field removed** per user directive; department context is handled at customer level. |
| **Season & Year** | Dropdown + Year | Retained | Select Season (`Autumn`, `Spring`, `Summer`, `Winter`, `All`) and Year (e.g., `2026`). |
| **Cust Ref** | Text Input | Retained | Optional customer reference or tech pack reference number. |
| **Agent** | Search Lookup | Retained | Buying office or agent entity dropdown. |
| **Received Mode** | Dropdown | Retained | Channel of request receipt (e.g., `By Mail`, `By Courier`, `Hand Delivery`). |
| **Delivery To** | Dropdown | Retained | Destination entity classification (e.g., `Agent`, `Customer Direct`, `Buying House`). |
| **Delivery Mode** | Dropdown | Retained | Dispatch method (e.g., `By Courier`, `Air Freight`, `Sea Freight`). |

### 3.2 Styles Grid Specification

The Styles Grid allows merchandisers to enter multiple garment items associated with a single inquiry.

| Grid Field Name | Data Type / Control | Legacy Status | Modification & Business Logic |
| :--- | :--- | :--- | :--- |
| **S No** | Integer | Retained | Auto-incrementing line item number (`1, 2, 3...`). |
| **Style / Style Name** | Search Lookup / Text | Retained | Garment style identifier (e.g., `TESTINFG`). |
| **Article No** | Text Input | Retained | Buyer article code (e.g., `4545`). |
| **Style Description** | Text Area | Retained | Textual description of garment silhouette or styling details. |
| **Fabric Description** | **Removed** | **Deprecated** | **Removed from Grid**. Fabric construction is configured in Product Info. |
| **Composition** | **Removed** | **Deprecated** | **Removed from Grid**. Fiber content moved to fabric master details. |
| **Unit** | Dropdown | **Modified** | **Unit concept imported from Order Entry**. Options: `PCS` (Single Piece) or `SET` (Multi-component garment). |
| **Coordinates** | Button / Sub-table | **Modified** | Enabled when `Unit = SET`. Opens Coordinate Component table to define components (e.g., Top, Bottom). |
| **Sample Qty** | Integer Input | Retained | Mandatory. Quantity of sample garments required (e.g., `5`, `10`, `65`). |
| **Expected Order Qty**| **Removed** | **Deprecated** | **Removed from Grid**. Bulk order projections are handled during quotation stage. |
| **Delivery Dt** | Date Picker | Retained | Target dispatch date for the sample line item. |
| **Ship Type / Ship Mode**| **Removed** | **Deprecated** | **Removed from Grid**. Shipping terms are relocated to Product Info under Billable logic. |

### 3.3 Unit Concept & Coordinate Component Logic
- **Single Garment (`Unit = PCS`)**: The row operates as a single item. Coordinate sub-tables remain inactive.
- **Set Garment (`Unit = SET`)**: The system activates the `Coordinates` control. The user defines the garment breakdown (e.g., `2 Coordinates` -> `Top` and `Bottom`, or `3 Coordinates` -> `Jacket`, `Shirt`, `Trouser`). Quantity calculations apply across the specified components.

---

## 4. Tab 2 Specification: Product Info (Formerly Define Styles)

Tab 2 captures technical manufacturing parameters, merchandising ownership, delivery specifications, commercial billing options, and detailed quantity breakdowns.

### 4.1 Header & Inherited General Data

The top section of Tab 2 displays core identifiers, inherited automatically from Tab 1 to guarantee consistency:
- **Sample No**: Generated transaction code (e.g., `PRD/2627/0222`).
- **Enquiry No**: Referenced from Tab 1 (e.g., `OPP/2627/0186`).
- **Customer**: Inherited from Tab 1.
- **Style Name & Description**: Inherited from selected grid line in Tab 1.
- **Order Dt**: Transaction timestamp.
- **Quantity & Unit**: Total sample order quantity and unit type (e.g., `65 PCS`).
- **Season & Year**: Inherited from Tab 1 (e.g., `Autumn 2026`).
- **Article No**: Inherited from Tab 1.

### 4.2 Merchandising, Technical & Delivery Fields

| Field Name | Control Type | Logic & Business Rules |
| :--- | :--- | :--- |
| **Merchandiser Name** | Search Lookup | **Mandatory Field**. Selects assigned merchandiser. Can be searched or auto-fetched per `Sample No`. |
| **Fabric Structure** | Text / Lookup | Primary fabric construction descriptor (e.g., `100% BCI COTTON`, `Single Jersey`). |
| **Fabric Code** | Search Lookup | Internal fabric master code (e.g., `32323`). |
| **GSM** | Numeric Input | Fabric weight in grams per square meter (e.g., `180`, `220`). |
| **Tech Pack** | Dropdown | Status selector: `Not Required`, `Received`, `To be Received`. |
| **Customer Reference** | Text Input | Additional customer reference notes or buyer PO/sample numbers. |
| **Receipt Mode & Date** | Dropdown + Date | Mode (`By Mail`, `By Courier`) and date sample request documentation was physically received. |
| **Delivery To & Agent** | Dropdown / Lookup | Consignment delivery entity and buying agent details. |
| **Delivery Mode** | Dropdown | Dispatch mechanism (`By Courier`, `Air Freight`, `Sea`). |
| **Delivery Through** | Search Lookup / Text | Specific logistics partner or courier express account details. |
| **Accessories Reqd** | **Checkbox** | **Mandatory Checkbox**. When checked (`True`), signals that accessories planning (labels, trims, buttons, polybags) is required for sample production. |

### 4.3 Billable Conditional Workflow

Samples in garment manufacturing are predominantly free of cost (proto/fit samples). However, paid samples (e.g., salesman samples, bulk development samples) require commercial billing. The **Billable** dropdown drives dynamic interface visibility:

```
                      +-------------------+
                      |   BILLABLE TOGGLE  |
                      +---------+---------+
                                |
               +----------------+----------------+
               |                                 |
       [ Billable = NO ]                 [ Billable = YES ]
               |                                 |
  - Standard Sampling Mode          - Commercial Billing Mode
  - Ship Type / Mode Hidden         - Enable Ship Type & Ship Mode
  - Price Fields Disabled           - Enable Currency & Price Input
  - Quantities Tab Hidden           - ENABLE QUANTITIES TAB
```

1. **When `Billable = No` (Default)**:
   - Garment sample is treated as non-commercial (Free of Cost).
   - Commercial shipping and pricing fields (`Ship Type`, `Ship Mode`, `Currency`, `Price`) are hidden or read-only.
   - The **Quantities Tab** remains disabled.

2. **When `Billable = Yes`**:
   - Garment sample is treated as a paid/commercial transaction.
   - **Ship Type**: Enabled dropdown (e.g., `FOB`, `CIF`, `CFR`).
   - **Ship Mode**: Enabled dropdown (e.g., `Air`, `Sea`, `Courier`).
   - **Currency**: Enabled lookup (e.g., `USD`, `EUR`, `INR`).
   - **Price**: Enabled numeric input (Unit price per sample, e.g., `2.5000`).
   - **Quantities Tab**: **Enabled and activated** for detailed color/size/country distribution.

---

## 5. Combos & Coordinate Component Table Specification

Located as a sub-section within Tab 2, the **Combos** tab captures colorway breakdowns and size-level garment piece counts.

### 5.1 Coordinate Component Selector
- **No. of Coordinates**: Defines number of garment components (e.g., `1` for single garment, `2` for top + bottom set).
- **Coordinates List**: Grid listing component names (e.g., `1: PIECES`, `2: TOP`, `3: BOTTOM`).

### 5.2 Combo Details Grid

Captures color variations and piece quantities across garment sizes.

| Column Name | Data Type | Description & Validation |
| :--- | :--- | :--- |
| **S No** | Integer | Line number (`1, 2...`). |
| **Combo / Color** | Search Lookup / Text | Color name (e.g., `WHITE`, `RED`, `NAVY`). |
| **Sample Order Qty** | Integer (Auto) | Sum of size-level quantities entered for this combo (e.g., `15`, `50`). |
| **Extra Qty** | Integer Input | Additional allowance/buffer garments produced for internal testing or backup. |
| **Total Qty** | Integer (Calculated)| Calculated total: `Sample Order Qty + Extra Qty`. |
| **Size Matrix (S, M, L, XL)** | Integer Inputs | Size-wise piece breakdown sub-grid for each combo. |

---

## 6. Quantities Tab Specification (Replicated from Order Entry)

The **Quantities Tab** is copied directly from the bulk Order Entry module. It is conditionally displayed in the Sample Module when `Billable = Yes`.

### 6.1 Main Breakdown Grid Structure

| Column Name | Control Type | Description & Business Rules |
| :--- | :--- | :--- |
| **S No** | Integer | Line sequence number. |
| **Country** | Search Lookup | Destination country for sample shipment (e.g., `USA`, `UK`, `DE`). |
| **Ref No** | Text Input | Buyer reference number for specific destination shipment. |
| **Consignee** | Search Lookup | Delivery consignee entity (e.g., `AARSAN AMERICAS - NY OFFICE`). |
| **Assortment Type** | Dropdown | Options: `Solid Color - Solid Size`, `Solid Color - Assorted Size`, `Ratio Pack`. |
| **PO Qty** | Integer Input | Order quantity for this specific consignee/country shipment line. |
| **Delivery Dt** | Date Picker | Scheduled dispatch date. |
| **Earlier Shipment Dt**| Date Picker | Earliest acceptable shipment date. |
| **Assortment Button** | Action Trigger | Opens the **Assortment & Pack Ratio Breakdown Modal**. |
| **Discharge Port** | Search Lookup | Port of entry / discharge port. |
| **Final Destination** | Search Lookup | Final delivery destination facility. |

### 6.2 Assortment & Pack Ratio Breakdown Modal

Triggered by the `Assortment` button in the main grid, this modal allows fine-grained packaging configuration:

```
+-----------------------------------------------------------------------------------+
| ASSORTMENT & PACK BREAKDOWN MODAL                                                 |
+-----------------------------------------------------------------------------------+
| Country: [ USA ]      Pack: [ 32323 ]       Assortment Type: [ SC-SS ]             |
| Qty: [ 50 ]           Delivery Dt: [ 06-10-2026 ]  Style Ref No: [ PRD/2627/0222 ]   |
| Style: [ TESTINFG ]   No of Cartons: [ 2 ]                                        |
+-----------------------------------------------------------------------------------+
| STYLE REF NO    | STYLE      | COMBO | S  | M  | L  | XL | PCS PER PACK | TOTAL PCS |
|-----------------|------------|-------|----|----|----|----|--------------|-----------|
| PRD/2627/0222   | TESTINFG   | WHITE | 5  | 10 | 5  | 0  | 20           | 20        |
| PRD/2627/0222   | TESTINFG   | RED   | 10 | 10 | 10 | 0  | 30           | 30        |
+-----------------------------------------------------------------------------------+
| Master CTN Name: [ MASTER-01 ]              Total Qty: [ 50 ]                     |
+-----------------------------------------------------------------------------------+
```

---

## 7. Downstream Business Logic & Operational Workflow

To ensure seamless integration across pre-production departments, the Sample Module connects directly into sample planning, fabric procurement, and quotation workflows discussed in executive sessions.

```
+-------------------+      +--------------------+      +--------------------+
| 1. SAMPLE ENTRY   | ---> | 2. PD REQUEST &    | ---> | 3. GROUP PRODUCTS  |
| (Sample & Product |      |    ACKNOWLEDGMENT  |      |    FOR SAMPLING    |
|  Info Saved)      |      | (Merchandiser ->   |      | (Combine multiple  |
|                   |      |  Sample Dept)      |      |  styles for dye)   |
+-------------------+      +--------------------+      +--------------------+
                                                                  |
                                                                  v
+-------------------+      +--------------------+      +--------------------+
| 6. QUOTATION &    | <--- | 5. SAMPLE COST SHEET| <--- | 4. FABRIC & TRIM   |
|    CONFIRMATION   |      |    PREPARATION     |      |    INTERNAL PLAN   |
| (Send quote to    |      | (Cost per sample   |      | (Issue yarn/fabric |
|  buyer)           |      |  piece calculated) |      |  work orders)      |
+-------------------+      +--------------------+      +--------------------+
```

### 7.1 Sample Product Development (PD) Request & Acknowledgment
1. **Request Generation**: Upon saving Sample Entry, the merchandiser submits a Product Development Request to the Sampling Department.
2. **Acknowledgment Status**: The Sample Department reviews technical feasibility and updates status (`Acknowledged` / `Not Acknowledged`), notifying merchandising.

### 7.2 Sample Grouping for Dyeing & Knitting Cost Efficiency
Sampling requires small quantities (e.g., 4 kg of yarn for 5 garments). Producing isolated dye batches for tiny quantities is economically unviable.
- **Grouping Engine**: The system enables sample managers to group multiple sample styles (`Group Products for Development`) sharing identical fabric structures, yarn counts, or colors across seasonal inquiries (e.g., grouping 20-30 sample styles).
- **Consolidated Fabric Planning**: A single consolidated yarn purchase and fabric knitting/dyeing internal work order is raised for the group, dramatically lowering sample development costs.

### 7.3 Sample Cost Sheet & Quotation Workflow
1. **Cost Sheet Calculation**: Calculates fabric consumption, trim costs, embroidery/printing processing charges, and sample room labor to determine true piece cost.
2. **Quotation Generation**: Generates official buyer quotation sheets (`Quote Preparation`) including currency conversion rates, target margins, and shipment terms.
3. **Buyer Approval Tracking**: Manages revision cycles (`Revised Sample 1`, `Revised Sample 2`) until buyer sign-off converts the sample inquiry into a bulk production order.

---

## 8. UI/UX Design Guidelines & Modernization Directives

Developers and UI designers must follow modern web application design standards when building this module:

1. **Card Layout & Visual Hierarchy**: Replace old MDI gray frames with elevated white card containers, clear section headers, soft border dividers, and subtle shadows.
2. **Tab Architecture**: Use modern sticky horizontal tab headers with active indicator bars and icon accents (`Sample Info`, `Product Info`).
3. **Responsive Grid Controls**: Form controls should adopt flexbox/grid layout (2 or 4 columns depending on screen width) with floating input labels, inline validation badges, and searchable select controls.
4. **Data Tables**: Grids must feature fixed headers, zebra striping, row hover states, inline edit controls, and sticky action columns.
5. **Action Bar**: Use a sticky bottom/top action bar containing primary actions (`Save`, `Save as Draft`, `Submit Request`, `Cancel`) with distinct visual weight.

---
