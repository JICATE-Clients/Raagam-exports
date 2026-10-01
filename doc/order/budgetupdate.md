Here is the complete **Developer Implementation Specification Document** addressing your 7 requirements and bug fixes across User Management, Order Entry, Material BOM, and the Order Budgeting & MD Approval module.

A downloadable PDF copy (**`garment-erp-developer-updates-spec.pdf`**) has also been generated and published to your **Studio panel**.

---

# 🛠️ Garment ERP: Developer Technical Specification — Updates & Budget Module Fixes

---

### **1. Multi-Location Access Selection for Roles & User Accounts**
* **Rationale**: Staff members and managerial roles (e.g. Factory Managers, Merchandisers, QC Officers) frequently operate across multiple factory units, dye houses, and head office locations. The system must allow assigning multiple location access permissions per user or role.
* **Functional Changes**:
  1. **Multi-Select Dropdown UI**: In Admin User Management & Role/Email Permission setup, replace the single-select location selector with a multi-select checkbox/tag component.
  2. **Database Schema Update**: Extend `app_users` or `user_email_permission_overrides` to store `allowed_locations UUID[]` or populate a multi-location join table `app_user_locations`.
  3. **Backend Filtering Logic**: Update backend data fetch queries to evaluate against array elements:
     ```sql
     WHERE location_id = ANY(user_allowed_locations)
     ```

---

### **2. Order Entry (Order Info Tab): Unrestricted PO Number Case Sensitivity**
* **Rationale**: Customer Purchase Order (PO) numbers contain varying alphanumeric formats, slashes, and mixed-case letter combinations. The input field must accept all character cases without auto-converting or throwing validation errors.
* **Functional Changes**:
  1. **Remove Uppercase Transformation**: Remove `.toUpperCase()`, `text-transform: uppercase` CSS, and restrictive uppercase regex validation patterns from the PO Number input component in `components/orders/order-info-tab.tsx`.
  2. **Preserve Raw Input**: Store and display the exact string typed by the merchandiser (e.g., `po-2026/88a-ROJA`).

---

### **3. Size Field Selection Dropdown UI Alignment Fix**
* **Rationale**: The size selection dropdown in Order Entry was experiencing layout overflow, clipping, and irregular sorting, hindering quick size assortment entry.
* **Functional Changes**:
  1. **Dropdown Container Styling**: Apply a fixed max-height (`max-h-60`), `overflow-y-auto`, and high z-index (`z-50`) to the dropdown container in `components/orders/size-selector.tsx`.
  2. **Logical Sequence Sorting**: Enforce standard garment size sequence sorting (`XS, S, M, L, XL, XXL, 3XL`) derived from Size Master sequence numbers rather than raw alphabetical sorting.

---

### **4. Order Info Attachment Row Focus Jump Fix**
* **Rationale**: Uploading or updating a style sketch/tech pack file in Order Info was triggering a full component re-render that caused active cursor focus to jump unexpectedly to the next form row.
* **Functional Changes**:
  1. **Isolate Component State**: Isolate the file upload state handler to prevent global form re-renders on file upload completion.
  2. **Explicit Focus Retention**: Call `e.preventDefault()` and maintain active input field references so focus stays on the active row/field.

---

### **5. Release Pre-Save File Upload Restriction (Allow Attachments During Entry)**
* **Rationale**: Merchandisers previously had to save the order header first before attaching tech packs or style sketches. Releasing this condition allows attaching files during initial order creation.
* **Functional Changes**:
  1. **Remove Pre-Save Lock**: Remove the `disabled={!orderId}` guard on the attachment upload control.
  2. **Staged File Uploads**: Stage uploaded files in React form state (`stagedFiles: File[]`) and commit them to storage when the merchandiser clicks **Save Order**.

---

### **6. Material BOM: +5% / -5% Excess Allowance & UOM-Aware Rounding Rules**
* **Rationale**: Trims and accessories incur handling waste and bulk packaging limits. The Material BOM grid requires an excess percentage field (\\(\pm 5\%\\)) and UOM-aware rounding rules.
* **Functional & Calculation Logic**:
  * **Excess Percentage Field**: Allow entering positive or negative allowance percentage (e.g., `+5.00%`, `-5.00%`).
  * **Required Quantity Formula**:
    \\[\text{Required Qty} = \text{Calculated Qty} \times \left(1 + \frac{\text{Excess \%}}{100}\right)\\]
  * **UOM-Aware Rounding Rules**:
    * **Whole-Unit UOMs** (`Pcs`, `Gross`, `Pack`, `Box`, `Cone`, `Roll`): Apply standard rounding `Math.round()` (or `Math.ceil()` if fractional).
    * **Measured Continuous UOMs** (`Mtrs`, `Yds`, `Kgs`): Preserve 2 decimal places (`precision = 2`).

---

### **7. Order Budget & MD Approval Screen Specification (Discussed Details Only)**

Here is the consolidated developer implementation specification for the **Order Budget & MD Approval Module** based strictly on our discussed requirements:

#### **A. 5-Bucket Visual Cost Progress Bar**
Render a 5-bucket stacked horizontal progress bar showing cost ratios:
1. 🟦 **Fabric Cost %** *(Greige + Yarn Purchase + Fabric Purchase)* — *Roll Yarn purchases into Fabric*.
2. 🟩 **Process Cost %** *(Knitting + Dyeing + Compacting + Washing + Accessory Processing)* — *Roll Accessory Processing into Process*.
3. 🟨 **Trims & Accessories %**
4. 🟧 **CMT & Overheads %**
5. 🟩 **Net Profit Margin %** *(Highlighted in bold green if \\(\ge 15\%\\), amber if \\(< 15\%\\))*.

#### **B. Local Currency (INR) & Flat Expense Entry**
* **Local Currency Math**: All job-work rates calculate directly in local currency (INR) as \\(\text{Weight/Qty} \times \text{Unit Rate}\\).
* **Flat Value Entry**: Flat/lump-sum charges (Bank Charges, Testing Charges, Special Freight) allow direct numeric entry in the `VALUE` column, bypassing unit rate multipliers.

#### **C. Budget Financial Variance Matrix (\\(V_0\\) vs \\(V_{\text{latest}}\\))**
Render a right-aligned financial matrix comparing the baseline approved budget (\\(V_0\\)) against the proposed budget (\\(V_1\\)), showing cost variance across Fabric, Process, Trims, Overheads, and Net Margin %.

#### **D. MD Mobile Approval Card & Click-to-Modal Data Drill-Down**
* **Click Anywhere**: Tapping/clicking anywhere on the **Itemized Budget & Profit Margin** card or table row on the Approval screen triggers the `OrderEntryFullDataModal`.
* **360° Order Pop-Up Modal**: The pop-up displays complete, read-only data across 4 tabs:
  1. **Order Info & Size Assortment** (Customer, RE No, Earlier Shipment Date, Size Matrix).
  2. **Fabric BOM & Yarn Sourcing** (Greige Wt, Stage Loss %, Conversion Yarn Colors).
  3. **Accessories BOM** (Items, Specifications, Consumption, Required Qty).
  4. **Itemized Budget Sheet** (Full cost breakdown, selling price, and Net Margin per pc).

#### **E. Database Locking & Revert Engine**
* **Order Lock**: Submitting a budget for MD approval sets `re_status = 'PENDING'` and activates `refuse_when_order_locked()` across 47 database tables.
* **Rejection / Rework Engine**: Rejecting triggers `order_amendment_revert` to restore the baseline \\(V_0\\) budget snapshot, requiring mandatory rejection remarks and sending an alert to the assigned merchandiser.

---

### 📋 **Developer Execution Checklist**

| Module / Component | Target Feature | Developer Action |
| :--- | :--- | :--- |
| **Admin User Mgmt** | Multi-Location Selection | Implement multi-select checkbox/tag component and `allowed_locations UUID[]` array filtering. |
| **Order Info Tab** | PO No Field | Remove `.toUpperCase()` and regex pattern restrictions; accept all cases. |
| **Size Selector UI** | Dropdown Layout | Set `max-h-60`, `overflow-y-auto`, `z-50`, and sort by Size Master sequence numbers. |
| **Order Info File** | Attachment Focus Jump | Isolate file state handler and prevent re-render focus shifts. |
| **Order Entry Draft** | Pre-Save Attachment Lock | Remove `disabled={!orderId}` on upload control; stage attachments in form state. |
| **Material BOM** | Excess % & Rounding | Add Excess % field, apply \\(\text{Calc Qty} \times (1 + \text{Excess}\%)\\), and enforce UOM-aware rounding. |
| **Approval Screen** | Budget Click Pop-Up Modal | Wire click handler on Budget Card to open `OrderEntryFullDataModal` displaying full order entry details. |

---

💡 *The downloadable PDF document **`garment-erp-developer-updates-spec.pdf`** is now ready in your Studio panel for direct sharing with your development team!*