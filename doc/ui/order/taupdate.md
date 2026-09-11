# **TECHNICAL DEVELOPMENT SPECIFICATION: BACKWARD SCHEDULING ENGINE & DUAL PP APPROVAL RULES**

---

## **1. EXECUTIVE SUMMARY & ARCHITECTURE**

The **Time & Action (T&A) Calendar Engine** automates production milestone planning for garment manufacturing orders by calculating target dates **backward sequentially starting from the Earlier Shipment Date**. This ensures that every manufacturing operation (Inspection, Packing, Ironing, Checking, Sewing, Cutting) and pre-production checkpoint (PP Approval, PP Send, Material In-House) is assigned a strict deadline to prevent shipment delays, air-freight penalties, and dead stock.

---

## **2. BACKWARD SCHEDULING CALCULATION ENGINE**

### **A. Core Calculation Pipeline & Formulas**
All milestone dates are derived by stepping backward from the **Earlier Shipment Date** based on user-entered required duration days (`Req DAYS`):

```
[Earlier Shipment Date]
       │
       ├─► 1. Inspection Date      = Earlier Shipment Date - 1 Day (Fixed Rule)
       ├─► 2. Packing Start Date   = Inspection Date - Packing Req DAYS
       ├─► 3. Ironing Start Date   = Packing Start Date - Ironing Req DAYS
       ├─► 4. Checking Start Date  = Ironing Start Date - Checking Req DAYS
       ├─► 5. Sewing Start Date    = Checking Start Date - Sewing Req DAYS
       ├─► 6. Cutting Start Date   = Sewing Start Date - Cutting Req DAYS
       ├─► 7. PP Approval Date     = Cutting Start Date - 1 Day (Fixed Rule)
       ├─► 8. PP Send Date         = PP Approval Date - Customer Review Days
       └─► 9. Material In-House    = PP Send Date - 1 Day (or Cutting Start - 1 Day)
```

#### **Detailed Formula Breakdown**:
1. **`Inspection Date`**:
   * **Formula**: \\(\mathbf{\text{Earlier Shipment Date} - 1 \text{ Day}}\\).
   * **Rationale**: Final pre-shipment quality inspection must be completed at least 1 day prior to dispatch.
2. **`Packing Start Date`**:
   * **Formula**: \\(\mathbf{\text{Inspection Date} - \text{Packing Req DAYS}}\\).
   * **Rationale**: Determines when poly-bagging and carton packing must commence.
3. **`Ironing Start Date`**:
   * **Formula**: \\(\mathbf{\text{Packing Start Date} - \text{Ironing Req DAYS}}\\).
   * **Rationale**: Sets the deadline for garment steam pressing.
4. **`Checking Start Date`**:
   * **Formula**: \\(\mathbf{\text{Ironing Start Date} - \text{Checking Req DAYS}}\\).
   * **Rationale**: Allocates required days for 100% garment table inspection.
5. **`Sewing Start Date`**:
   * **Formula**: \\(\mathbf{\text{Checking Start Date} - \text{Sewing Req DAYS}}\\).
   * **Rationale**: Determines the stitching line setup and production run timeline.
6. **`Cutting Start Date`**:
   * **Formula**: \\(\mathbf{\text{Sewing Start Date} - \text{Cutting Req DAYS}}\\).
   * **Rationale**: Defines when fabric spreading and panel cutting must start.
7. **`PP Approval Target Date`**:
   * **Formula**: \\(\mathbf{\text{Cutting Start Date} - 1 \text{ Day}}\\).
   * **Rationale**: Pre-production sample approval from the buyer is mandatory at least 1 day before bulk fabric cutting begins.
8. **`PP Send Target Date`**:
   * **Formula**: \\(\mathbf{\text{PP Approval Date} - \text{Customer Master Review Days}}\\).
   * **Rationale**: Auto-populates the sample dispatch deadline by subtracting the buyer's review lead time (stored in `Customer Master`).
9. **`Material In-House Target Date`**:
   * **Formula**: \\(\mathbf{\text{PP Send Date} - 1 \text{ Day}}\\).
   * **Rationale**: Ensures finished fabric and trims arrive at the factory 1 day prior to sample making or bulk cutting.

---

## **3. DUAL PP APPROVAL PRODUCTION RULES**

Factory cash flow and credit period rotation require two configurable production modes:

```
                     ┌────────────────────────────────────────────────────────┐
                     │           DUAL PP APPROVAL PRODUCTION MODES            │
                     └───────────────────────────┬────────────────────────────┘
                                                 │
                   ┌─────────────────────────────┴─────────────────────────────┐
                   ▼                                                           ▼
       [RULE 1: STANDARD MODE]                                     [RULE 2: CREDIT / 90-DAY MODE]
  Cutting Start based on PP Approval                           Yarn Purchase based on PP Approval
  • Raw yarn/fabric bought upfront.                           • Sample fabric used for PP submission.
  • Bulk cutting gated by PP Approval.                        • Bulk yarn procurement held until PP Approval.
  • Formula: PP Appr = Cutting Start - 1                       • Formula: Yarn Purchase = PP Appr + 1
```

### **Rule 1: Cutting Start Based on PP Approval (Standard Rule)**
* **Workflow**: Bulk raw yarn and accessories are purchased upfront. Once fabric rolls arrive, sample yards are cut to stitch the Pre-Production (PP) sample and sent to the buyer.
* **Gating Constraint**: Bulk fabric cutting is strictly locked until the buyer approves the PP sample.
* **Calculation**: \\(\mathbf{\text{PP Approval Date} = \text{Cutting Start Date} - 1 \text{ Day}}\\).

### **Rule 2: Yarn Purchase Based on PP Approval (Long Lead-time / Credit Rule)**
* **Workflow**: For 90-day to 120-day delivery orders, purchasing full bulk yarn upfront consumes supplier credit periods (30–60 days) long before shipment, leading to working capital lockup and bank interest costs.
* **Gating Constraint**: Small sample yarn is used for PP approval first. Bulk yarn procurement POs are triggered **only after securing written PP approval**.
* **Calculation**: \\(\mathbf{\text{Yarn Purchase Date} = \text{PP Approval Date} + 1 \text{ Day}}\\).

---

## **4. COMPLETE STEP-BY-STEP WORKED CALCULATION EXAMPLE**

### **Order Parameters**:
* **Earlier Shipment Date**: `26.09.2026`
* **Customer Review Days**: `3 Days` (from Customer Master)
* **Activity Durations (`Req DAYS`)**: Packing = `2`, Ironing = `2`, Checking = `2`, Sewing = `5`, Cutting = `2`.

### **Calculated Milestone Schedule**:
\\[\begin{array}{|c|l|c|l|l|}
\hline
\mathbf{S.No} & \mathbf{Activity\ Milestone} & \mathbf{Req\ DAYS} & \mathbf{Mathematical\ Calculation} & \mathbf{Target\ Date} \\ \hline
1 & \text{Earlier Shipment Date} & - & \text{Base Date} & \mathbf{26.09.2026} \\ \hline
2 & \text{Inspection Date} & 1 & 26.09.2026 - 1\text{ Day} & \mathbf{25.09.2026} \\ \hline
3 & \text{Packing Start Date} & 2 & 25.09.2026 - 2\text{ Days} & \mathbf{23.09.2026} \\ \hline
4 & \text{Ironing Start Date} & 2 & 23.09.2026 - 2\text{ Days} & \mathbf{21.09.2026} \\ \hline
5 & \text{Checking Start Date} & 2 & 21.09.2026 - 2\text{ Days} & \mathbf{19.09.2026} \\ \hline
6 & \text{Sewing Start Date} & 5 & 19.09.2026 - 5\text{ Days} & \mathbf{14.09.2026} \\ \hline
7 & \text{Cutting Start Date} & 2 & 14.09.2026 - 2\text{ Days} & \mathbf{12.09.2026} \\ \hline
8 & \text{PP Approval Target Date} & 1 & 12.09.2026 - 1\text{ Day} & \mathbf{11.09.2026} \\ \hline
9 & \text{PP Send Target Date} & 3 & 11.09.2026 - 3\text{ Days (Buyer Days)} & \mathbf{08.09.2026} \\ \hline
10 & \text{Material In-House Date} & 1 & 08.09.2026 - 1\text{ Day} & \mathbf{07.09.2026} \\ \hline
\end{array}\\]

---

## **5. TECHNICAL IMPLEMENTATION SPECIFICATION FOR DEVELOPERS**

### **A. UI Bug Fixes & Input Control (Req DAYS Field)**
* **Problem**: Mouse wheel scrolling over `Req DAYS` input cells decrements values into negative integers (`-1`, `-2`).
* **Technical Fix**:
  ```tsx
  <input
    type="number"
    min="0"
    className="w-16 px-2 py-1 border rounded"
    value={activity.reqDays}
    onWheel={(e) => e.currentTarget.blur()} // Prevents mouse wheel scrolling
    onChange={(e) => {
      const val = Math.max(0, parseInt(e.target.value) || 0);
      updateActivityDays(activity.id, val);
    }}
  />
  ```

### **B. TypeScript Backward Scheduling Service Function**

```typescript
import { addDays, subDays, isSunday, format } from 'date-fns';

export interface TAActivity {
  id: string;
  name: string;
  reqDays: number;
  targetDate: string;
  isReadOnly: boolean;
}

export function calculateTABackwardSchedule(
  earlierShipmentDate: Date,
  customerReviewDays: number,
  activities: { name: string; reqDays: number }[],
  ppRule: 'CUTTING_BASED' | 'YARN_PURCHASE_BASED' = 'CUTTING_BASED'
) {
  // Helper: Skip Sunday factory holidays during backward calculation
  const subtractWorkingDays = (startDate: Date, days: number): Date => {
    let current = startDate;
    let subtracted = 0;
    while (subtracted < days) {
      current = subDays(current, 1);
      if (!isSunday(current)) {
        subtracted++;
      }
    }
    return current;
  };

  // 1. Inspection Date = Earlier Shipment Date - 1 Day
  const inspectionDate = subDays(earlierShipmentDate, 1);

  // 2. Production Stage Chain
  const packingDays = activities.find(a => a.name === 'Packing')?.reqDays || 2;
  const packingDate = subtractWorkingDays(inspectionDate, packingDays);

  const ironingDays = activities.find(a => a.name === 'Ironing')?.reqDays || 2;
  const ironingDate = subtractWorkingDays(packingDate, ironingDays);

  const checkingDays = activities.find(a => a.name === 'Checking')?.reqDays || 2;
  const checkingDate = subtractWorkingDays(ironingDate, checkingDays);

  const sewingDays = activities.find(a => a.name === 'Sewing')?.reqDays || 5;
  const sewingDate = subtractWorkingDays(checkingDate, sewingDays);

  const cuttingDays = activities.find(a => a.name === 'Cutting')?.reqDays || 2;
  const cuttingDate = subtractWorkingDays(sewingDate, cuttingDays);

  // 3. Pre-Production Rules
  const ppApprovalDate = subDays(cuttingDate, 1);
  const ppSendDate = subtractWorkingDays(ppApprovalDate, customerReviewDays);
  const materialInHouseDate = subDays(ppSendDate, 1);

  // Rule 2 Adjustment: Trigger Yarn Purchase after PP Approval
  const yarnPurchaseDate = ppRule === 'YARN_PURCHASE_BASED' ? addDays(ppApprovalDate, 1) : null;

  return {
    earlierShipmentDate: format(earlierShipmentDate, 'yyyy-MM-dd'),
    inspectionDate: format(inspectionDate, 'yyyy-MM-dd'),
    packingDate: format(packingDate, 'yyyy-MM-dd'),
    ironingDate: format(ironingDate, 'yyyy-MM-dd'),
    checkingDate: format(checkingDate, 'yyyy-MM-dd'),
    sewingDate: format(sewingDate, 'yyyy-MM-dd'),
    cuttingDate: format(cuttingDate, 'yyyy-MM-dd'),
    ppApprovalDate: format(ppApprovalDate, 'yyyy-MM-dd'),
    ppSendDate: format(ppSendDate, 'yyyy-MM-dd'),
    materialInHouseDate: format(materialInHouseDate, 'yyyy-MM-dd'),
    yarnPurchaseDate: yarnPurchaseDate ? format(yarnPurchaseDate, 'yyyy-MM-dd') : 'UPFRONT',
  };
}
```

***

Here is the complete **UI, Functional, and Technical Specification** for integrating the **Dual PP Approval Production Rule Selector** directly into the Order Entry and T&A Configuration tabs.

---

# **DUAL PP APPROVAL PRODUCTION LOGIC & TOGGLE SPECIFICATION**

## **1. RATIONALE & BUSINESS PROBLEM**
Garment manufacturing orders vary significantly by buyer lead time and financial structure:
* **Standard Orders (30–60 Days)**: Yarn and fabric are bought upfront. Bulk fabric cutting is the only operation held until the Pre-Production (PP) sample is approved.
* **Long Lead-Time / Credit Protection Orders (90–120 Days)**: Buying bulk yarn upfront consumes 30–60 day mill credit limits long before shipment. If a PP sample takes 3 weeks to approve, the factory pays interest on yarn sitting idle. 

By introducing a **`PP Approval Trigger Mode`** toggle in the Order Entry / T&A Configuration screen, merchandisers can dynamically switch between **Cutting-Based Gating** and **Yarn-Purchase-Based Gating**.

---

## **2. UI CONTROL & PLACEMENT**

### **A. UI Location**
Place a dedicated toggle/dropdown control in **Order Info / T&A Configuration Tab**:

* **Label**: `PP Approval Production Rule` (or `PP Approval Trigger Mode`)
* **Control Type**: Radio Button Group / Segmented Toggle
* **Options**:
  1. **`Cutting Start Based`** *(Standard Mode - Default)*
  2. **`Yarn Purchase Based`** *(Credit / 90-Day Protection Mode)*

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PP APPROVAL PRODUCTION RULE                                                        │
│ (●) Cutting Start Based (Standard)    ( ) Yarn Purchase Based (Credit / 90-Day)    │
│     Bulk yarn bought upfront.                Sample yarn used for PP sample.       │
│     Bulk cutting locked until PP approval.   Bulk yarn PO locked until PP approval.│
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## **3. DETAILED FUNCTIONAL RULES & GATING ENGINE**

### **MODE 1: `Cutting Start Based` (Standard Rule)**

1. **Yarn Procurement**:
   * Raw yarn purchase requisitions and supplier POs are generated **immediately upon order confirmation**.
2. **Factory Operations**:
   * Knitting, dyeing, and finishing proceed continuously.
   * Finished fabric rolls arrive in-house and are inspected.
   * Sample yards are cut to stitch the PP Sample and sent to the buyer.
3. **Hard System Gate**:
   * **Bulk Cutting Line Allocation & Fabric Spreading** is **LOCKED / DISABLED** in the ERP until `PP Approval Status = 'APPROVED'`.
4. **T&A Milestone Formulas**:
   * **`PP Approval Target Date`** = `Cutting Start Date - 1 Day`
   * **`PP Send Target Date`** = `PP Approval Target Date - Customer Review Days`
   * **`Yarn Purchase Target Date`** = `Order Receipt Date (Upfront)`

---

### **MODE 2: `Yarn Purchase Based` (Credit / 90-Day Protection Rule)**

1. **Yarn Procurement**:
   * Bulk Yarn Purchase Orders (POs) are **STRICTLY BLOCKED / LOCKED**.
   * Only a small sample yarn quantity (e.g., 5–10 Kg) is issued or purchased to make the initial PP Sample.
2. **Factory Operations**:
   * PP Sample is stitched, dispatched, and reviewed by the buyer.
3. **Hard System Gate**:
   * **Bulk Yarn PO Creation & Knitting Job Work Orders** are **LOCKED / DISABLED** until `PP Approval Status = 'APPROVED'`.
4. **T&A Milestone Formulas**:
   * **`PP Approval Target Date`** = Derived backward from shipment or set upon order entry.
   * **`Yarn Purchase Target Date`** = `PP Approval Target Date + 1 Day`
   * **`Knitting Start Target Date`** = `Yarn Purchase Date + Yarn Delivery Lead Time`
   * **`Cutting Start Target Date`** = Dynamically recalculated forward from Yarn Arrival + Fabric Processing Lead Times.

---

## **4. DATABASE SCHEMA & BACKEND IMPLEMENTATION**

### **A. Database Schema Update**

Add `pp_approval_trigger_mode` to `garment_order_headers`:

```sql
ALTER TABLE garment_order_headers 
ADD COLUMN pp_approval_trigger_mode VARCHAR(30) NOT NULL DEFAULT 'CUTTING_BASED';

-- Constraint to enforce valid modes
ALTER TABLE garment_order_headers 
ADD CONSTRAINT chk_pp_approval_trigger_mode 
CHECK (pp_approval_trigger_mode IN ('CUTTING_BASED', 'YARN_PURCHASE_BASED'));
```

---

### **B. Backend Gating Validation Engine (TypeScript)**

```typescript
export interface OrderGatingCheckParams {
  orderId: string;
  ppApprovalStatus: 'PENDING' | 'SENT' | 'APPROVED' | 'REWORK';
  ppApprovalTriggerMode: 'CUTTING_BASED' | 'YARN_PURCHASE_BASED';
}

// 1. Gate Bulk Fabric Cutting
export function canStartBulkCutting(params: OrderGatingCheckParams): { allowed: boolean; reason?: string } {
  if (params.ppApprovalStatus !== 'APPROVED') {
    return {
      allowed: false,
      reason: 'Bulk cutting is locked until PP Sample Approval is secured from the buyer.',
    };
  }
  return { allowed: true };
}

// 2. Gate Bulk Yarn Procurement PO Creation
export function canIssueBulkYarnPO(params: OrderGatingCheckParams): { allowed: boolean; reason?: string } {
  if (params.ppApprovalTriggerMode === 'YARN_PURCHASE_BASED' && params.ppApprovalStatus !== 'APPROVED') {
    return {
      allowed: false,
      reason: 'Order is set to Yarn Purchase Based mode. Bulk Yarn POs are locked until PP Sample Approval is secured.',
    };
  }
  return { allowed: true };
}
```

---

## **5. SUMMARY CHECKLIST FOR DEVELOPERS**

| Feature Component | `CUTTING_BASED` Mode | `YARN_PURCHASE_BASED` Mode |
| :--- | :--- | :--- |
| **Primary Goal** | Minimize production lead time | Optimize cash flow & credit periods |
| **Bulk Yarn PO** | Unlocked upfront at Order Entry | **LOCKED** until PP Approval |
| **PP Sample Source** | Cut from first bulk fabric rolls | Stitched using sample yarn |
| **Bulk Cutting** | **LOCKED** until PP Approval | Locked until PP Approval + Fabric Processing |
| **Yarn PO Target Date** | `Order Date` | `PP Approval Date + 1 Day` |
| **Cutting Target Date** | `Sewing Start - Cutting Days` | Recalculated forward post-Yarn arrival |