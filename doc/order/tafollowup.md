Here is the **End-to-End Clarified Specification Summary** for the **T&A Followup Child Board, Dispatch Tracking, and Customer Approval Decision Engine**.

---

### **1. T&A Followup Child Grid Filters**
To help merchandisers and managers quickly locate specific tasks without scrolling through long lists, the **T&A Followup Child Board** incorporates the following multi-attribute filters:

* **Buyer / Customer Filter**: Filters tasks by selected buyer (e.g., *NEXT PLC, TAFFLES, AARSAN AMERICAS*).
* **Order / ARI Ref No. Filter**: Filters tasks by Order Number or internal ARI Reference Number.
* **Merchandiser / Task Owner Filter**: Filters tasks by assigned staff member/merchandiser from the HR Staff Master.
* **Status Filter**: Toggle between **`ALL`**, **`PENDING`**, **`SENT`**, **`APPROVED`**, and **`REWORK`**.
* **Date Range Filter**: Select custom target date windows (e.g., *Due Today, Due This Week, Overdue*).

---

### **2. Send Date & Time Tracking (`T&A Followup`)**
When a merchandiser dispatches a sample (Lab Dip, Fit Sample, Size Set, or PP Sample) to a buyer, the dispatch modal captures the following details:

* **`Send Date`**: Date selector (defaults to current date, editable).
* **`Send Time`**: Explicit timestamp input (e.g., `02:30 PM`) to record the exact time the courier or swatch card was dispatched.
* **`Courier Proof / Reference`**: File attachment field for waybill scans, courier receipts, or tracking numbers, serving as digital proof before flipping the task state to **`SENT`**.

---

### **3. Received & Approved Decision Engine (Customer Master Lead Days)**

#### **A. Customer Master Configuration**
* In `Customer Master -> Approvals`, merchandisers manually define the **Review Lead Days** for each buyer and sample type:
  * *Example*: TAFFLES = **3 Days**, AARSAN = **5 Days**, JSTN = **10 Days**.

#### **B. Expected Approval Date Formula**
Once a sample is marked as `SENT`, the system automatically projects the required buyer response date:
\\[\mathbf{\text{Expected Approval Date}} = \text{Send Date} + \text{Customer Master Review Lead Days}\\]

#### **C. Approval Decision Flow & Rework Versioning**
```
                  ┌──────────────────────────────────────────────┐
                  │              SAMPLE DISPATCHED               │
                  │   Status = SENT | Send Date & Time Captured  │
                  └──────────────────────┬───────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
          [STATUS: APPROVED]                         [STATUS: REWORK]
  • Task completed successfully.            • Mandatory Buyer Remarks required.
  • Unlocks downstream operations           • Archive current submission as "Version 1".
    (e.g., Cutting or Yarn POs).            • Auto-generate "Version 2" task.
                                            • Reset Status to "PENDING".
```

1. **Option A: `APPROVED`**:
   * Satisfies the milestone. If this is a Pre-Production (PP) sample, it automatically unlocks bulk fabric cutting or yarn PO creation based on the active PP Approval Production Rule.
2. **Option B: `REWORK`**:
   * Requires mandatory entry of **Buyer Remarks / Reasons**.
   * The system automatically archives the submission record as **Version 1 (V1)**, generates a new **Version 2 (V2)** tracking row, resets the status to **`PENDING`**, and recalculates the new resubmission target dates.

---
