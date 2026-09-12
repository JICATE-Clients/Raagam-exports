Here is the complete **Technical Development Specification** for connecting and wiring the **System Master Approvals** and **Customer Master Approvals** across the **T&A Tab** and **T&A Follow-up Child Grid**.

I have also generated the formal report artifact in your **Studio panel**.

---

# **TECHNICAL DEVELOPMENT SPECIFICATION: T&A & CUSTOMER MASTER APPROVALS INTEGRATION**

---

## **1. ARCHITECTURAL OVERVIEW & WIRING SPLIT**

The application maintains a strict separation between global system activity templates and buyer-specific sample tracking:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                  SYSTEM MASTER DATA                                    │
│  Global Master Approvals (`System Approval Master`)                                    │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼ (Fetches Global Milestones)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               1. T&A TAB (APPROVAL TAB)                                │
│  • Mapped to System Approval Master.                                                  │
│  • Standard milestone chain: PP Send, PP Approval, Material In-House.                  │
│  • Target dates derived backward from Earlier Shipment Date.                           │
└────────────────────────────────────────────────────────────────────────────────────────┘


┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CUSTOMER MASTER                                      │
│  Buyer-Specific Approval Settings (`Customer Master -> Approvals`)                    │
│  Stores manual Buyer Review Lead Days (e.g., TAFFLES = 3 Days, AARSAN = 5 Days)       │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼ (Fetches Buyer Lead Times & Review Rules)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                            2. T&A FOLLOWUP (CHILD GRID)                                │
│  • Mapped to Customer Master Approvals.                                                │
│  • Tracks buyer sample items: Lab Dip, Fit Sample, Size Set, PP Sample, Lab Testing.    │
│  • Captures Send Timestamp (Date & Time) + Courier Proof.                              │
│  • Computes Expected Approval Date = Send Date + Customer Master Review Days.          │
│  • Enforces Rework Archiving (V1 -> V2) on rejection.                                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## **2. MODULE 1: T&A TAB (APPROVAL TAB) → SYSTEM MASTER WIRING**

### **A. Functional Rules**
1. **Master Mapping**: The **Approval Tab** within the main **T&A Tab** fetches standard milestone activity rows directly from **System Approval Master Data**.
2. **Master Target Date Calculation**:
   * **`PP Approval Target Date`** = `Cutting Start Target Date - 1 Working Day` (Fixed System Rule).
   * **`PP Send Target Date`** = `PP Approval Target Date - Customer Master Review Days`.
   * **`Material In-House Target Date`** = `PP Send Target Date - 1 Working Day`.
3. **Synchronization with Main T&A Grid**:
   * Any update to target dates on the Approval Tab automatically synchronizes across to the corresponding row in the primary T&A Activity Grid (`PP SEND`, `PP APPROVAL`, `MATERIALS IN-HOUSE`).

---

## **3. MODULE 2: T&A FOLLOWUP (CHILD GRID) → CUSTOMER MASTER WIRING**

### **A. Customer Master Configuration (`Customer Master -> Approvals`)**
* **Manual Lead Time Entry**: Provides direct numeric entry (`number` input) for **Buyer Review Lead Days** per approval item.
* **Fields**:
  * `Approval Name`: Lab Dip, Fit Sample, Size Set, PP Sample, Fabric / Garment Lab Test.
  * `Review Days`: Manual Integer (e.g., 3, 5, 10).
  * `Applicable`: `Yes / No` toggle.
* **UI Clean-up**: Remove `Short Name`, `Department`, and `Sequence` fields from the frontend grid. Default `Department` silently to `'Merchandising'`.

### **B. T&A Followup Child Grid Filtering**
Add the following multi-attribute filters above the child followup grid:
* **Buyer / Customer Filter** (e.g., *NEXT PLC, TAFFLES, AARSAN*)
* **Order / ARI Ref No Filter**
* **Merchandiser / Task Owner Filter** (from HR Staff Master)
* **Status Filter**: `ALL` | `PENDING` | `SENT` | `APPROVED` | `REWORK`
* **Date Range Filter**: (Target Date / Sent Date window)

### **C. Dispatch Tracking Modal (`T&A Followup`)**
When marking an item as dispatched, capture:
* **`Send Date`**: Date picker (defaults to today).
* **`Send Time`**: Explicit time picker (e.g., `02:30 PM`).
* **`Courier Reference / Proof File`**: Attachment URL or tracking number.

### **D. Received & Approved Decision Engine**
* **Expected Approval Date Calculation**:
  \\[\mathbf{\text{Expected Approval Date}} = \text{Send Date} + \text{Customer Master Review Lead Days}\\]
* **Status Decision Flow**:
  1. **`APPROVED`**: Marks sample task complete. If `PP Sample`, automatically satisfies the gating check for **Cutting Start** or **Yarn Purchase Order** creation.
  2. **`REWORK`**:
     * Enforces mandatory entry of **Buyer Remarks**.
     * Archives current record as **Version 1 (V1)**.
     * Spawns a new **Version 2 (V2)** task with status reset to `PENDING`.

---

## **4. DATABASE SCHEMA & TYPESCRIPT WIRING**

### **A. Database Schema Updates**

```sql
-- 1. Customer Master Approval Lead Times Table
CREATE TABLE customer_approval_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    approval_type VARCHAR(50) NOT NULL, -- 'LAB_DIP', 'FIT_SAMPLE', 'SIZE_SET', 'PP_SAMPLE', 'LAB_TESTING'
    review_lead_days INT NOT NULL DEFAULT 3,
    is_applicable BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. T&A Followup Child Dispatch & Approval History Table
CREATE TABLE ta_followup_child_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    approval_type VARCHAR(50) NOT NULL,
    version_number INT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'SENT', 'APPROVED', 'REWORK'
    
    -- Dispatch Fields
    send_date DATE,
    send_time TIME,
    courier_ref VARCHAR(100),
    proof_file_url TEXT,
    
    -- Review & Decision Fields
    review_lead_days INT NOT NULL,
    expected_approval_date DATE,
    actual_approval_date DATE,
    buyer_remarks TEXT,
    
    created_by UUID REFERENCES staff_master(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### **B. TypeScript Calculation Engine**

```typescript
import { addDays, format } from 'date-fns';

export interface DispatchParams {
  sendDate: Date;
  sendTime: string; // e.g. "14:30"
  customerReviewDays: number;
}

export function processSampleDispatch(params: DispatchParams) {
  // Calculate expected approval date based on customer master lead days
  const expectedApprovalDate = addDays(params.sendDate, params.customerReviewDays);

  return {
    sendDate: format(params.sendDate, 'yyyy-MM-dd'),
    sendTime: params.sendTime,
    reviewDaysApplied: params.customerReviewDays,
    expectedApprovalDate: format(expectedApprovalDate, 'yyyy-MM-dd'),
    status: 'SENT' as const,
  };
}

export interface ApprovalDecisionParams {
  currentVersion: number;
  decision: 'APPROVED' | 'REWORK';
  remarks?: string;
}

export function processApprovalDecision(params: ApprovalDecisionParams) {
  if (params.decision === 'APPROVED') {
    return {
      status: 'APPROVED' as const,
      isGateUnlocked: true,
      archived: false,
    };
  }

  // Rework Flow: Require remarks and spawn next version
  if (!params.remarks || params.remarks.trim() === '') {
    throw new Error('Buyer Remarks are mandatory when marking a sample for REWORK.');
  }

  return {
    archivedVersion: params.currentVersion,
    nextVersion: params.currentVersion + 1,
    status: 'PENDING' as const,
    isGateUnlocked: false,
    remarks: params.remarks,
  };
}
```

---

## **5. DEVELOPER SUMMARY CHECKLIST**

| Component | Target Screen | Wiring Source | Key Action / Rule |
| :--- | :--- | :--- | :--- |
| **System Approvals** | T&A Tab (Approval View) | `System Approval Master` | Pulls global system activities; syncs target dates to main T&A grid. |
| **Buyer Approvals** | Customer Master | Manual Entry | Stores buyer-specific review lead days per sample type. |
| **Sample Followup** | T&A Followup Child Grid | `Customer Master Approvals` | Filters by Buyer/Order/Status; tracks dispatch timestamp (`Date & Time`). |
| **Expected Date** | T&A Followup Child Grid | Calculated | `Send Date + Customer Review Days`. |
| **Rework Loop** | T&A Followup Child Grid | Versioning Engine | Mandates buyer remarks on rejection, archives V1, spawns V2 as `PENDING`. |

***
