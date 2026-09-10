# **END-TO-END TECHNICAL DEVELOPMENT SPECIFICATION: TIME & ACTION (T&A) MODULE**

This specification serves as the complete, single source of truth for the development team to build, integrate, and verify the **Time & Action (T&A) Engine, Daily Production Bypass Workflow, and Customer Approvals System**.

---

## **1. SYSTEM ARCHITECTURE & DUAL-NAV PLACEMENT**

The T&A system operates across two complementary UI entry points using a shared database backend:

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                SYSTEM ARCHITECTURE MAP                                │
├──────────────────────────────────┬────────────────────────────────────────────────────┤
│ 1. Global Cross-Order Views      │ Top-level Sidebar Links:                           │
│    (Daily Triage & Management)   │  • /orders/ta-worklist (Daily Tasks & Backlog)     │
│                                  │  • /orders/ta-followup (Global Approvals Board)   │
├──────────────────────────────────┼────────────────────────────────────────────────────┤
│ 2. Order-Scoped Entry Rail       │ Tabs inside Order Entry Screen:                    │
│    (Single-Order Editing)        │  • T&A Tab (9-Step Calendar & Owner Assignments)   │
│                                  │  • TA Followup Tab (Interactive Order Approvals)   │
└──────────────────────────────────┴────────────────────────────────────────────────────┘
```

---

## **2. BACKWARD SCHEDULING CALENDAR ENGINE (9-STEP CHAIN)**

The scheduling engine operates using a **backward calculation model** anchored to the **Earlier Shipment Date** (`delivery_date - 1 day` from the Logistics/Qty tab).

```
[Earlier Shipment Date] (Logistics Anchor)
          │
          ▼ (-1 Day) [HARDLOCKED]
  1. Inspection
          │
          ▼ (-2 Days Default) [EDITABLE]
  2. Packing ──► 3. Ironing ──► 4. Checking ──► 5. Sewing ──► 6. Cutting
                    (-2 Days)      (-2 Days)      (-5 Days)      (-2 Days)
                                                                    │
                                                                    ▼ (-1 Day) [HARDLOCKED]
                                                            7. PP Approval
                                                                    │
                                                                    ▼ (-Customer Review Lead Days)
                                                            8. PP Send
                                                                    │
                                                                    ▼ (-1 Day) [HARDLOCKED]
                                                            9. Material Inhouse
```

### **2.1 Milestone Calculation Rules**
1. **Inspection**: `Earlier Shipment Date - 1 Day` (Hardlocked, `FIXED_ONE_DAY_ACTIVITIES`).
2. **Packing**: `Inspection Date - 2 Days` (Default offset: 2 days, editable).
3. **Ironing**: `Packing Date - 2 Days` (Default offset: 2 days, editable).
4. **Checking**: `Ironing Date - 2 Days` (Default offset: 2 days, editable).
5. **Sewing**: `Checking Date - 5 Days` (Default offset: 5 days, editable).
6. **Cutting**: `Sewing Date - 2 Days` (Default offset: 2 days, editable).
7. **PP Approval**: `Cutting Date - 1 Day` (Hardlocked, `FIXED_ONE_DAY_ACTIVITIES`).
8. **PP Send**: `PP Approval Date - Customer Review Lead Days` (Fetched dynamically from `customer_approval_defaults` by buyer and approval type via `getCustomerPpReviewDays()`).
9. **Material In-House**: `PP Send Date - 1 Day` (Hardlocked, `FIXED_ONE_DAY_ACTIVITIES`).

### **2.2 Master Data Seed Script**
Execute this SQL update on the `ta_activities` master table to seed default lead times:
```sql
UPDATE ta_activities SET default_offset_days = 2 WHERE short_name = 'PACK';
UPDATE ta_activities SET default_offset_days = 5 WHERE short_name = 'SEW';
UPDATE ta_activities SET default_offset_days = 2 WHERE short_name = 'CUT';
```

---

## **3. PRODUCTION-BASED PP APPROVAL LOGIC (YES / NO TOGGLE)**

The `production_based_pp_approval` boolean setting governs whether buyer PP Sample approval acts as a strict production hardlock or permits fast-track parallel execution.

### **3.1 YES Mode (Strict Quality Safety Gate)**
* **Cutting Room Hardlock**: Fabric cutting and cut-sheet generation are **strictly blocked** until the `PP_SAMPLE` milestone status reaches `APPROVED`.
* **Procurement Sequence**: Material purchasing and PP sample dispatch follow the standard backward sequence, preventing early yarn/fabric cutting before sample sign-off.

### **3.2 NO Mode (Fast-Track / Payment-Rotation Friendly)**
* **Non-Blocking Execution**: PP Sample approval is decoupled from cutting and material procurement.
* **Cash-Flow Optimization**: Yarn purchasing, fabric knitting, and dyeing are initiated early without waiting for buyer review loops to finish, maximizing supplier credit windows and speeding up order turnover.

---

## **4. TASK OWNER ASSIGNMENT & HR MASTER INTEGRATION**

### **4.1 Schema Consolidation**
* **Active Column**: `assigned_staff_id` on `garment_order_amendment_ta_activities` (Foreign key referencing `hr_staff_master(id)`).
* **Cleanup**: Migration `0547` formally drops the orphaned `assigned_employee_id` column to prevent schema pollution.

### **4.2 UI & Form Validation Contract**
* **Grid Component**: Third column in the Order Entry T&A grid renders `RecordPicker` backed by `employee-picker.tsx`. Supports standard keyboard navigation (`↑`/`↓`, `Enter`, `Tab`).
* **Database Constraint**: `assigned_staff_id` is `NULLable` in the DB schema to prevent insertion crashes when draft orders are initialized.
* **Form Validation**: UI form submission mandates an assigned task owner on **all 9 activity lines** before saving or amending an order.

### **4.3 Smart Auto-Populate Engine**
When opening a new order entry form, the system automatically pre-fills task owner assignments from the most recent active order:
```sql
SELECT activity_code, assigned_staff_id 
FROM garment_order_amendment_ta_activities
WHERE amendment_id = (
    SELECT id FROM garment_order_amendments 
    WHERE status != 'CANCELLED'
    ORDER BY created_at DESC LIMIT 1
);
```

---

## **5. USER DAILY ACTION DASHBOARD & WORKLIST (`/orders/ta-worklist`)**

### **5.1 Three-Tier Task Partitioning**
The worklist queries active tasks assigned to staff members and buckets them using current server time (`CURRENT_DATE`):
1. **Backlog & Pending Queue**: `target_date < CURRENT_DATE` and status incomplete.
2. **Today's Action Items**: `target_date = CURRENT_DATE` and status incomplete.
3. **Upcoming 7-Day Horizon**: `CURRENT_DATE < target_date <= CURRENT_DATE + 7 Days` (`HORIZON_DAYS = 7`).

### **5.2 Scoping & Dashboard Integration**
* **Worklist Toggle**: Switch between **Department Tasks** and **My Tasks** (`mineOnly = true`, filtered by `assigned_staff_id`).
* **Home Dashboard Widget**: A lightweight "My Daily T&A Tasks" summary card embeds directly on `/dashboard`, displaying overdue task counts and today's items with a 1-click link to the full worklist.

---

## **6. PERFORMANCE ANALYTICS & KPI ENGINE (`staff_ta_kpi()`)**

### **6.1 PostgreSQL RPC Function (`0547`)**
Migration `0547` deploys `staff_ta_kpi()` as a `SECURITY DEFINER` function computing:
* Total assigned tasks.
* On-time completion count vs. late completion count.
* Average delay days per staff member.

### **6.2 Mandatory Delay Attribution Gate**
When a staff member marks an overdue task as complete, the server requires selecting a delay reason:
* `INTERNAL_STAFF`: Internal delay; penalizes the staff member's KPI score.
* `BUYER_DELAY`: Delay caused by buyer exceeding agreed review lead times; **excluded from penalizing staff KPI scores**.
* `MATERIAL_SUPPLIER`: Late raw material delivery.

### **6.3 UI & Reporting Output**
* **Operator Badge**: Renders real-time on-time completion percentage badges (Green: \\(\ge 90\%\\), Yellow: \\(75-89\%\\), Red: \\(< 75\%\\)) directly on the TA Worklist.
* **Team MRM Report**: Powers the team-wide Monthly Review Meeting report at `/reports/ta-performance`.

---

## **7. DAILY PRODUCTION OUTPUT & FLOOR "BYPASS" WORKFLOW**

### **7.1 5 Floor Stages (`production_entries`)**
Tracks output across all 5 physical production departments: **Cutting, Sewing, Checking, Ironing, and Packing**.

### **7.2 Cumulative Output RPC (`stage_cumulative_good_qty`)**
A `SECURITY DEFINER` function serves as the single source of truth for cumulative good output per stage, eliminating manual, error-prone `bypassed_qty` inputs.

### **7.3 Upstream WIP Safety Guard (`recordEntry`)**
Downstream departments are physically blocked from logging more pieces than cumulative good output available from the preceding stage:
\\[\text{Downstream Cumulative Qty} + \text{New Entry Qty} \le \text{Upstream Cumulative Good Qty}\\]

### **7.4 Bypass Alert Suppression**
When partial output flows downstream ahead of scheduled start dates:
* The system automatically marks the stage status as `BYPASS_IN_PROGRESS`.
* Displays live floor output and percentage progress on T&A worklists.
* **Suppresses false "Overdue" delay alerts** while active floor piece flow is detected.

---

## **8. CUSTOMER APPROVALS FOLLOW-UP BOARD & INTERACTIVE TAB**

### **8.1 4 Lifecycle States**
Moving across `PENDING`, `SENT`, `APPROVED`, and `REWORK`.

### **8.2 Dispatch Proof Enforcement (`markApprovalSent`)**
Transitioning a milestone to `SENT` requires logging `actual_sent_date` and uploading file proof (courier waybill / receipt PDF URL).

### **8.3 Version-Controlled Rework Loop (`markApprovalRework`)**
Transitioning a milestone to `REWORK`:
1. Server validates that `remarks` (buyer comments) are non-blank.
2. Current attempt is archived in `garment_order_approval_history`.
3. Live row increments `active_version` (`v1` \\(\rightarrow\\) `v2`) and resets status to `PENDING` for re-submission.

### **8.4 Delay Attribution Formulas**
* **Merchandiser Dispatch Delay**: \\(\max(0, \text{Actual Sent Date} - \text{Target Sent Date})\\).
* **Buyer Review Delay**: \\(\max(0, \text{Actual Review Duration} - \text{Master Review Lead Days})\\).

### **8.5 Dual Interaction**
Full interactive capabilities (Send, Upload Proof, Approve, Rework) are enabled on both the global `/orders/ta-followup` board and the order-scoped `TA Followup` tab inside Order Entry.

---

## **9. SUMMARY OF DATABASE MIGRATIONS & VERIFICATION**

| Migration | Key Database Changes | Status |
| :--- | :--- | :---: |
| **`0547`** | Adds `assigned_staff_id` & `delay_attribution` to `garment_order_amendment_ta_activities`. Drops orphaned `assigned_employee_id`. Deploys `staff_ta_kpi()` RPC. | Applied / Ready |
| **`0548`** | Expands `production_entries` to 5 stages, re-points FK to `garment_order_amendments`, deploys `stage_cumulative_good_qty()` RPC. | Applied / Ready |
| **Seed Update** | Sets `PACK`=2, `SEW`=5, `CUT`=2 default offset days in `ta_activities`. | Pending SQL Run |