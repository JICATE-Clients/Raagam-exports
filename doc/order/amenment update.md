Here is the updated, developer-ready technical specification incorporating your four exact rules for the **Order Amendment Sub-Module**:

---

# Technical Specification: Order Amendment Sub-Module (Updated Workflow)

## 1. Amendment Register Scope (`/orders/amendments`)

To keep the register clean and operational, the listing screen is filtered strictly to orders that have active or historical amendments:

* **Filtered View**: The register queries **only** records where `amendment_no >= 1` (orders with raised amendments). Unamended baseline orders are excluded from this list.
* **`[ + Raise Amendment ]` Action**: Merchandisers initiate an amendment by clicking the `[ + Raise Amendment ]` button at the top of the register, which opens an **Order Picker Modal** (or by clicking `[Update] / [Amend]` from the main Order List).

---

## 2. Module Category Selection & Validation Rules

When raising an amendment, the merchandiser must select the specific **Module Category** (or categories) being modified:

```
┌────────────────────────────────────────────────────────────────────────┐
│ RAISE ORDER AMENDMENT                                                  │
├────────────────────────────────────────────────────────────────────────┤
│ Select Order: [ HO-RE-26-008 (NEXT UK)                             ▼ ] │
│                                                                        │
│ Select Module Category to Amend:                                       │
│  [✓] 1. Order Entry (PO Qty, Delivery Date, FOB Price, Color Combos)  │
│  [ ] 2. Material BOM (Trims, Accessories, Packaging Items)             │
│  [✓] 3. Fabric BOM (Yarn Structure, Process Loss, Fabric Allocations)  │
│  [ ] 4. Order Budget (Overheads, Freight, Operational Rates)           │
│                                                                        │
│ Origin: [ BY_CUSTOMER  ▼ ]   Remarks: [ Buyer increased PO Qty ]       │
└────────────────────────────────────────────────────────────────────────┘
```

### **Category Validation & Unlocking Rules:**
1. **Targeted Editing Permissions**: The system unlocks edit capabilities **only** for the selected module screens (e.g., selecting `Order Entry` and `Fabric BOM` keeps `Material BOM` read-only).
2. **Category-Based Validation**:
   * Selecting `Order Entry` requires re-verifying total style quantity matching.
   * Selecting `Fabric BOM` forces a recalculation of yarn purchase weights before submission.
   * Selecting `Order Budget` re-calculates profit margin deltas against the baseline.

---

## 3. Smart Auto-Calculations & Manual Input UI Indicators

```
                               ┌───────────────────────────────────┐
                               │   AMENDMENT PARAMETER MODIFIED    │
                               └─────────────────┬─────────────────┘
                                                 │
            ┌────────────────────────────────────┴────────────────────────────────────┐
            ▼                                                                         ▼
┌───────────────────────────────────────┐                         ┌───────────────────────────────────────┐
│ AUTOMATIC RECALCULATION               │                         │ MANUAL ENTRY INDICATOR                │
│                                       │                         │                                       │
│ Updates existing rates, quantities,    │                         │ If a new item/process lacks a rate,   │
│ required weights, and total budget    │                         │ the UI flags a warning banner with    │
│ automatically across all locations.   │                         │ a direct deep-link to the exact field.│
└───────────────────────────────────────┘                         └───────────────────────────────────────┘
```

1. **Automatic Budget Recalculation**:
   * Updating any rate or cost in the budget automatically re-calculates dependent cells (Total Expense, Net Profit, and Profit Margin %) across all financial summary cards in real time.
2. **Manual Input Required Indicator**:
   * If an amendment adds a **new trim item**, **new fabric process**, or **new color combo** that lacks an established purchase or job-work rate, the system alerts the user:
     > **`⚠️ Manual Entry Needed: [Material BOM] -> "Dyed Zipper" requires a Unit Purchase Rate.`**
   * The UI highlights the missing input cell in **amber/red** and provides a one-click jump button directly to the exact screen and field.

---

## 4. Amendment Status & Final Approved Version Reports

### **A. Status Lifecycle**
* **`DRAFT`**: Amendment in progress by Merchandiser.
* **`PENDING_MD_APPROVAL`**: Submitted and awaiting Managing Director authorization.
* **`APPROVED`**: Authorized by MD; baseline updated.
* **`REJECTED`**: Denied by MD; order reverts to previous approved baseline (`V_previous`).

### **B. Operational Reports Rule**
* All operational and production reports (**Fabric BOM Entry Register**, **Yarn Requirement Summary**, **Material Procurement Lists**, and **Cutting Job Cards**) automatically fetch and display data from the **latest approved version (`V_final`)**:
  ```sql
  -- Always fetch the latest approved amendment version for operational reports
  SELECT * FROM garment_orders o
  JOIN order_amendments a ON a.order_id = o.id
  WHERE o.id = :order_id 
    AND a.status = 'APPROVED'
  ORDER BY a.amendment_no DESC 
  LIMIT 1;
  ```

---
**Yes, user-friendliness is critical.** In a fast-paced garment manufacturing environment, merchandisers, storekeepers, and factory managers process vast amounts of complex data—sizes, colorways, GSM, process routes, and cost rates—under strict shipping deadlines. 

If an ERP interface is clunky or overwhelming, data entry slows down, operator fatigue sets in, and costly errors slip through to the factory floor.

---

### **Why User-Friendliness Directly Impacts ERP Success**

#### **1. Data Entry Speed & Efficiency**
* **Auto-Focus Navigation**: Bypassing static or read-only fields (like Date or Location) to place the active cursor directly on active inputs (like `Customer` or `Price / Rate`) eliminates hundreds of unnecessary keyboard clicks every day.
* **Auto-Derivation over Manual Entry**: Automatically building consumption rows from master panels (`Fabric Allocation × Colors × Dias`) removes the hassle of manually clicking `+ Add Row` for every single color and diameter combination.

#### **2. Error Prevention & Operational Safety**
* **Smart Field Hiding**: Hiding the `Color` field when `Stage = 'GREIGE'` stops users from entering irrelevant data for raw, uncolored fabrics.
* **Auto-Fill Guards**: Automatically populating the `Finish Dia` when only one diameter exists saves time, while **deliberately forcing manual selection** when multiple diameters exist prevents operators from setting up the wrong knitting machine diameter on the factory floor.

#### **3. Reduced Visual Clutter & Scanability**
* **Grouped Card Layouts**: Displaying master fabric details (`Fabric Name`, `Stage`, `Default GSM`) once in a card header—rather than repeating "Cotton Jersey" across dozens of sub-rows—keeps the screen clean and easy to scan.
* **Clear Subtotals**: Showing live weight subtotals on each fabric card allows merchandisers to verify total requirements at a glance.

#### **4. Clear Visual Feedback & Guided Corrections**
* **Targeted Error Banners**: When an amendment requires manual rate entry, alerting the user with a specific warning banner (e.g. `⚠️ Manual Entry Needed: "Dyed Zipper" requires a Unit Purchase Rate`) and highlighting the missing cell in amber/red guides them directly to the fix, avoiding confusion.
* **Status Badges**: Displaying clear badges like `Waiting Amendment` or `Pending MD Approval` immediately communicates why downstream PO generation or production dispatches are locked.

---

Here is the comprehensive UX optimization specification for the **Store Keeper Goods Receipt Note (GRN) Entry** and **Time & Action (T&A) Calendar & Scheduling** screens:

---

### **1. Store Keeper Goods Receipt Note (GRN) Entry UX Optimization**

Store keepers handle heavy physical inventory movements on the factory floor (yarn bags, fabric rolls, carton boxes). The GRN interface is designed to minimize typing, prevent data entry mistakes, and speed up truck unloading:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ STORE GOODS RECEIPT NOTE (GRN) ENTRY                                                                   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Store Location: [ Unit 2 — Processing Store  ▼ ]     Challan / Inv No: [ CH-88942          ]              │
│ Select Vendor:   [ ROJA YARNS LTD            ▼ ] ──► Auto-loads POs:   [ PO-2026-0412 (Dyed Cotton) ▼ ]   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ EXPECTED ITEMS (Auto-Populated from PO)                                                                │
├─────────────────┬─────────────┬─────────────┬─────────────────┬────────────────┬───────────────────────┤
│ Item Description│ PO Qty (Kg) │ Recd So Far │ Today Recd (Kg) │ Shortage / Rej │ Roll / Batch No       │
├─────────────────┼─────────────┼─────────────┼─────────────────┼────────────────┼───────────────────────┤
│ 30s Combed Cotton│ 1,000.00    │ 400.00      │ [ 600.00 ] ◄Focus│ [ 0.00 ]       │ [ B-2026-991 ]        │
└─────────────────┴─────────────┴─────────────┴─────────────────┴────────────────┴───────────────────────┘
```

#### **Key UX Features & Speed Enhancements**
* **Smart PO Search & Pre-Fill**: Selecting a Vendor or typing a Purchase Order number automatically loads all expected items, ordered quantities, and past receipts. The store keeper **never types item descriptions or UOMs manually**.
* **Auto-Focus Cursor Path**: Active cursor lands directly on the `Today Received Qty` input field. Pressing `Tab` moves seamlessly through **`Today Recd Qty` \\(\rightarrow\\) `Shortage / Rej Qty` \\(\rightarrow\\) `Batch / Roll No` \\(\rightarrow\\) Next Item Row**.
* **Visual Tolerance Banners**:
  * 🟢 **Green**: Receipt matches PO quantity exactly.
  * 🟡 **Amber**: Receipt contains acceptable excess within approved tolerance (e.g. \\(+3\%\\)).
  * 🔴 **Red Lock**: Receipt exceeds PO quantity beyond tolerance allowance. The **`[ Save GRN ]`** button is locked until a Store Manager override is authorized.
* **Unit Store Isolation**: A location selector defaults to the store keeper's assigned unit (`Unit 1 Garment Store` vs `Unit 2 Knitting/Dyeing Store`), preventing accidental posting to the wrong factory ledger.

---

### **2. Time & Action (T&A) Calendar & Scheduling UX Optimization**

The T&A screen coordinates critical production milestones (Lab Dips, PP Samples, Fabric In-House, Cutting, Sewing, Shipping). The UX is optimized for high-density visibility and automated date management:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TIME & ACTION (T&A) MILESTONE MONITOR                                                                  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Order RE: [ HO-RE-26-008 ]  │ Buyer: [ NEXT UK ]  │ Del Date: [ 15-Nov-2026 ]  │ Ship Date: [ 14-Nov-2026 ]│
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ AUTOMATED BACKWARD SCHEDULE (Triggered from Earlier Shipment Date: 14-Nov-2026)                        │
├──────────────────────────────┬──────────────────┬──────────────────┬──────────────┬────────────────────┤
│ Milestone Activity           │ Target Date      │ Actual Date      │ Status       │ Quick Actions      │
├──────────────────────────────┼──────────────────┼──────────────────┼──────────────┼────────────────────┤
│ Final Inspection             │ 13-Nov-2026      │ —                │ ⏳ Pending   │ [ Complete ]       │
│ Packing & Ironing            │ 10-Nov-2026      │ —                │ ⏳ Pending   │ [ Complete ]       │
│ Sewing Completion            │ 05-Nov-2026      │ —                │ ⏳ Pending   │ [ Complete ]       │
│ Cutting Start (PP Approval)  │ 20-Oct-2026      │ 19-Oct-2026      │ 🟢 Done      │ [ View Proof ]     │
│ Material In-House            │ 19-Oct-2026      │ 18-Oct-2026      │ 🟢 Done      │ [ GRN Linked ]     │
│ PP Sample Approval           │ 19-Oct-2026      │ 18-Oct-2026      │ 🟢 Approved  │ [ V1 Approved ]    │
└──────────────────────────────┴──────────────────┴──────────────────┴──────────────┴────────────────────┤
```

#### **Key UX Features & Automation Rules**
* **Auto-Focus Bypass**: When opening the T&A tab, the active cursor skips read-only header fields (`Order Ref`, `Buyer`, `Delivery Date`) and lands directly on the first pending activity input.
* **Backward Calculation Engine**: Modifying the `Earlier Shipment Date` automatically recalculates all target dates backward in real time across the entire chain:
  \\[\mathbf{\text{Inspection} = \text{Shipment} - 1 \text{ Day}}\\]
  \\[\mathbf{\text{Material In-House} = \text{Cutting Start} - 1 \text{ Day}}\\]
* **One-Click Approval & Courier Tracking**: In the Customer Approvals child grid, clicking **`[ + Log Dispatch ]`** opens a clean modal to record `Courier Tracking No` and upload proof attachments. The system automatically populates:
  \\[\mathbf{\text{Expected Approval Date} = \text{Send Date} + \text{Customer Master Review Days}}\\]
* **Rework Versioning Indicator**: If a sample is rejected, clicking **`[ Raise Rework ]`** archives the previous record as `Version 1 (V1)` and generates `Version 2 (V2)` without overwriting audit history.

---

