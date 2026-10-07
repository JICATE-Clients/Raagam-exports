# UI/UX Design Specification & Frontend Engineering Guide: Sample Costing Module

## 1. Executive UI/UX Design Principles

This specification defines the modern user interface (UI) and user experience (UX) architecture for the **Sample Costing Module**. It translates complex textile financial formulas, multi-fabric process derivations, and multi-currency quotation logic into an intuitive, high-density, professional SaaS interface.

### Core UX Objectives
* **Eliminate Tab Fatigue**: Replace 6+ disconnected paginated tabs with a continuous single-page scrolling canvas featuring sticky sidebar section anchors.
* **Excel-Speed Ergonomics**: Provide full keyboard navigation (Tab, Shift+Tab, Enter, Arrow keys) and inline editing capabilities matching spreadsheet speed.
* **Persistent Financial Visibility**: Position a sticky 35% right-hand commercial rail that dynamically recalculates Gross Cost, Net Margin, and FOB Quoted Price in real time as the user inputs data.
* **Form Factor Flexibility**: Collapse dense multi-field process steps (Yarn, Knitting, Dyeing) into smart expandable accordions or single "Direct Rate" overrides.

---

## 2. Spatial Grid, Color Tokens & Typography Architecture

To achieve a professional, polished finish, the interface enforces strict design tokens, high contrast, and specialized financial typography.

### 2.1 Design System Tokens

| Design Token Category | CSS / Tailwind Token | Visual / Functional Purpose |
| :--- | :--- | :--- |
| **Primary Brand Accent** | `indigo-600` (`#4F46E5`) | Action buttons, active focus rings, active navigation tabs. |
| **Secondary Brand Accent** | `slate-900` (`#0F172A`) | Primary headings, dark summary card headers. |
| **Canvas Background** | `slate-50` (`#F8FAFC`) | Main application viewport background. |
| **Card Surface** | `white` (`#FFFFFF`) | Elevated card containers (`shadow-sm`, `border border-slate-200`). |
| **Border & Divider** | `slate-200` (`#E2E8F0`) | Subtle field and grid cell dividers. |
| **Success Status / Profit** | `emerald-600` (`#059669`) | Positive profit margins, target margin achievements. |
| **Warning / Caution** | `amber-500` (`#F59E0B`) | Tight margins (below 15%), missing fabric rates. |
| **Danger Status / Loss** | `rose-600` (`#E11D48`) | Negative margins, invalid inputs, unlinked dependencies. |

### 2.2 Financial Typography & Number Formatting
* **Primary Font Family**: `Inter`, `Plus Jakarta Sans`, or system `-apple-system, BlinkMacSystemFont`.
* **Tabular Numbers Requirement**: All numeric fields, currency displays, weights, and calculations MUST use `font-variant-numeric: tabular-nums` (Tailwind: `tabular-nums`). This enforces fixed character widths so digits align perfectly vertically across rows and data tables.
* **Precision Standards**:
  * **Fabric Rates & Processing Charges**: 2 decimal places (`₹582.40/kg`).
  * **Garment Weights**: Integer or 1 decimal place (`168g`).
  * **Process Loss & Margins**: 2 decimal places (`12.00%`).
  * **Foreign Quotations**: 2 or 4 decimal places (`$4.2300`).

---

## 3. Screen Layout Architecture (65/35 Canvas Split)

The screen is structured as a two-column desktop interface with a persistent top context header and sticky navigation.

```
+---------------------------------------------------------------------------------------------------+
| TOP CONTEXT RIBBON: Sample No | Style Name | Buyer | Season | Status Badge | Quick Actions        |
+--------------------------------------------------+------------------------------------------------+
| LEFT SECTION NAVIGATION (15% Sticky Anchor)       | RIGHT COMMERCIAL SUMMARY RAIL (35% Sticky)     |
| [•] 1. Fabric Rates                              | +--------------------------------------------+ |
| [ ] 2. Consumption & Component Weights           | | LIVE COST BREAKDOWN SUMMARY                | |
| [ ] 3. CMT & Garment Processing                  | | - Fabric Cost / Pc:      ₹112.50           | |
| [ ] 4. Trims & Accessories                       | | - CMT & Washing / Pc:    ₹45.00            | |
| [ ] 5. Overheads & Commercial Margin             | | - Trims & Accessories:   ₹18.20            | |
|                                                  | | - Net Base Cost / Pc:    ₹175.70           | |
| MAIN WORKSPACE CANVAS (50% Scrollable Area)      | | - Wastage (5%):          ₹8.79             | |
| +----------------------------------------------+ | - Overhead (3%):         ₹5.27             | |
| | SECTION 1: FABRIC RATE DERIVATIONS          | | - Gross Cost / Pc:       ₹189.76           | |
| | [Card 1: Body Fabric - 100% Cotton]          | |--------------------------------------------| |
| | [Card 2: 2x2 Rib Collar]                     | | COMMERCIAL QUOTATION PANEL                 | |
| |                                              | | - Profit Margin (%):    [ 25.00 % ]        | |
| | SECTION 2: CONSUMPTION & GARMENT WEIGHTS     | | - Currency:             [ USD ($) v ]      | |
| | [Garment Weight Breakdown Matrix]            | | - Exchange Rate (INR):  [ 84.00 ]           | |
| |                                              | |--------------------------------------------| |
| | SECTION 3: CMT & PROCESS CHARGES             | | FINAL QUOTED FOB PRICE:   $3.08 / PCS      | |
| | [Sewing, Printing, Embroidery, Washing]      | | MULTI-PIECE SET PRICE:    $6.15 / SET      | |
| +----------------------------------------------+ +--------------------------------------------+ |
+---------------------------------------------------------------------------------------------------+
```

---

## 4. Section-by-Section UX Component Specifications

### 4.1 Top Context Ribbon (Header Bar)
* **Visual Styling**: Compact dark or clean slate surface (`bg-slate-900 text-white` or `bg-white border-b border-slate-200`).
* **Content Elements**:
  * **Sample Transaction Badge**: `SMP/26-27/0001` (Mono font, bold).
  * **Style Title & Image Thumbnail**: Style identifier with hover-preview thumbnail image.
  * **Buyer & Season Badge**: `Li & Fung | Q2 2026`.
  * **Currency Indicator**: Target quotation currency pill (`USD $`).
  * **Action Buttons**: `Save Draft`, `Recalculate`, `Export Cost Sheet (PDF)`, `Submit Quotation` (Primary Indigo Button).

### 4.2 Section 1: Fabric Rate Derivation Module
* **UX Design Pattern**: Smart Accordion Cards per fabric type (Body, Rib, Trim).
* **Direct Rate Override Toggle**:
  * **Switch Component**: A prominent toggle switch labeled `Direct Rate Mode`.
  * **Behavior**: When toggled **ON**, the detailed yarn mix, knitting, dyeing, and process loss sub-table collapses into a single high-visibility input field (`Flat Fabric Price / KG`).
  * **When OFF**: Expands the detailed calculation breakdown:
    * **Yarn Mix Breakdown Table**: Material %, Yarn Rate/kg, Weighted Cost.
    * **Processing Rate Inputs**: Knitting Rate, Dyeing Rate, Finishing Rate.
    * **Process Loss % Badge**: Interactive percentage input with real-time recalculation of total Fabric Price / KG.

### 4.3 Section 2: Consumption & Component Weight Matrix
* **UX Design Pattern**: Data Table with inline editable numeric inputs.
* **Column Structure**:
  * `Component Name` (e.g. Sweatshirt Body, Hood Lining, Pants Body).
  * `Fabric Structure` (Inherited read-only pill).
  * `Weight (Grams)` (Editable numeric input with `tabular-nums`).
  * `Wastage Allowance %` (Default 3%).
  * `Calculated Piece Fabric Cost (₹)` (Auto-calculated, read-only highlighted badge).

### 4.4 Section 3: CMT, Printing, Embroidery & Trims Matrix
* **UX Design Pattern**: Tabular Grid with group headers.
* **Component Fields**:
  * **CMT (Cut, Make & Trim)**: Base sewing labor cost per garment piece.
  * **Garment Processing**: Inline cost inputs for Printing/Puff, Embroidery, Washing, and Testing.
  * **Trims Breakdown Drawer**: Slide-over drawer or expandable inline table for Trims (Buttons, Labels, Polybags, Zippers).

### 4.5 Section 4: Sticky Commercial Summary & Quotation Rail (Right Column)
* **UX Design Pattern**: Persistent sticky card (`position: sticky; top: 1rem;`).
* **Visual Hierarchy**:
  * **Top Sub-Total Breakdown**: Fabric + CMT + Trims + Processing.
  * **Margin Controls**:
    * Interactive `Overhead %` slider/input.
    * Interactive `Profit Margin %` slider/input.
    * Real-Time **Margin Health Indicator**: Green badge (`>= 20%`), Amber badge (`12% - 19%`), Red alert (`< 12%`).
  * **Currency Converter Box**:
    * Currency selector dropdown (`USD`, `EUR`, `GBP`, `INR`).
    * Foreign Exchange Rate field with an inline "Fetch Live Rate" icon button.
  * **Hero Price Display**: Large typography (`text-3xl font-bold text-indigo-600`) displaying the final **FOB Quoted Piece Price** and **Set Price**.

---

## 5. Micro-Interactions, Accessibility & Keyboard Navigation

### 5.1 Keyboard Shortcuts & Spreadsheet Navigation
To enable fast data entry without touching the mouse:
* **Tab / Shift+Tab**: Move focus linearly through editable grid cells.
* **Enter Key**: Moves focus to the cell directly below in data tables.
* **Esc Key**: Cancels active cell edit and restores previous value.
* **Ctrl + S / Cmd + S**: Instantly triggers background save.

### 5.2 Micro-Animations & Visual State Cues
* **Live Calculation Pulse**: When a user changes a weight or process rate, calculated cost badges exhibit a subtle 200ms background highlight transition (`bg-indigo-50` to `bg-transparent`) to indicate updated calculations.
* **Focus States**: High-contrast 2px indigo outline (`focus:ring-2 focus:ring-indigo-500 focus:outline-none`) on all active input fields.
* **Validation Errors**: Clear inline red text and subtle shake animation on invalid numeric entries (e.g. Negative weights or missing exchange rates).

---

## 6. Developer Implementation Checklist (Frontend Stack)

When implementing this screen in React / Vue / Angular with Tailwind CSS:

- [ ] Configure `tabular-nums` on all data table cells and summary cards.
- [ ] Implement `position: sticky` on the right summary column with overflow scrolling on the main workspace.
- [ ] Use debounced inputs (200ms) for heavy recalculation formulas to prevent UI lag during fast typing.
- [ ] Ensure all input fields feature `type="number"`, `inputmode="decimal"`, and auto-select text on focus.
- [ ] Add tooltips over calculated fields explaining the exact underlying math formula.
- [ ] Test layout responsiveness across standard desktop displays (1366x768, 1920x1080, and 2560x1440).
