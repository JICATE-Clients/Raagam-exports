# Technical Development Specification: Order Entry & T&A Work Plan Subsystem

**Document Version:** 1.0  
**Target Audience:** Frontend Engineers, Backend Engineers, Database Administrators  
**Module Scope:** Order Entry Module ▸ T&A Tab ▸ Work Plan / Work Flow Sub-Panel  

---

## 1. Executive Summary & Rationale

### **Problem Statement**
Order execution tracking was historically restricted to factory floor production steps (**Cutting**, **Sewing**, **Packing**) and buyer sample sign-offs (**Lab Dip**, **Fit Sample**, **PP Sample**) [871–872, 1346–1350]. However, internal administrative tasks—such as delayed CAD Tech Packs, incomplete Fabric BOMs, or unapproved order budgets—frequently caused untracked pre-production bottlenecks [871–875, 1346–1350]. Without milestone tracking for office tasks, management could not pinpoint why cutting start dates slipped [871–875, 1346–1350].

### **Solution Overview**
The **T&A Work Plan (Work Flow) Subsystem** introduces an administrative milestone tracking engine directly inside the order's **Time & Action (T&A)** tab [871–872, 1346–1350]. It monitors **six mandatory office milestones** before bulk production begins, auto-calculates sequential target dates from the **Order Received Date**, binds each step to a designated staff owner from the HR Master, and triggers real-time alerts upon milestone delays [872–875, 1347–1350].

---

## 2. Milestone Architecture & Business Workflow Rules

The subsystem tracks **6 compulsory pre-production milestones** in sequential SN order [872–875, 1347–1350]:

```
 [Order Received Date (Day 0)]
              │
              ├──────► 1. ORDER_ENTRY (Day 1)
              │
              ├──────► 2. CAD_COMPLETION (Day 2)
              │
              ├──────► 3. MATERIAL_BOM (Day 3) ──┐
              │                                   ├───► Concurrent Execution
              ├──────► 4. FABRIC_BOM (Day 3)   ──┘
              │
              ├──────► 5. BUDGETING (Day 4)    ──┐
              │                                   ├───► Financial Gating
              └──────► 6. BUDGET_APPROVAL (Day 4)─┘
``` [872–875, 1347–1350]

### **Milestone Definitions & Trigger Handshakes**

| SN | Milestone Code | Description | Default Lead Days | Prerequisite Trigger | Next Dependency |
| :---: | :--- | :--- | :---: | :--- | :--- |
| **1** | **`ORDER_ENTRY`** | Initial order header setup, style assignment, and quantity entry. | **Day 1** | Order Received Date created. | Unlocks CAD pattern blocks & BOM drafting. |
| **2** | **`CAD_COMPLETION`** | Pattern block finalisation, tech pack upload, and marker efficiency check. | **Day 2** | `ORDER_ENTRY` saved. | Provides exact component consumption weights. |
| **3** | **`MATERIAL_BOM`** | Sewing and packing trims BOM completion. | **Day 3** | `ORDER_ENTRY` saved. | Ingests accessory counts into Budgeting. |
| **4** | **`FABRIC_BOM`** | Fabric structure allocation, yarn split, and process loss routing. | **Day 3** | `CAD_COMPLETION` saved. | Ingests yarn purchase and process weights into Budgeting. |
| **5** | **`BUDGETING`** | Cost aggregation (Yarn + Fabric + Trims + CMT + Accounts Overheads). | **Day 4** | `MATERIAL_BOM` & `FABRIC_BOM` marked Completed. | Dispatches push notification to MD Mobile App. |
| **6** | **`BUDGET_APPROVAL`** | Managing Director approval lock and margin sign-off. | **Day 4** | `BUDGETING` saved. | Applies absolute edit lock on order BOMs & rates. |

---

## 3. Mathematical Engine: Sequential Target Date Scheduling

### **Target Date Calculation Formula**
All target dates calculate **forward sequentially** starting from the **Order Received Date** (`order_received_date` = **Day 0**) [873–875, 1348–1350]:

\\[\mathbf{\text{Target Date}_m = \text{Order Received Date} + \text{Target Days From Received}_m}\\] [873–875, 1348–1350]

#### **Worked Calendar Example**:
If **Order Received Date** = `12-10-2026` (**Day 0**) [873–875, 1348–1350]:
* **`ORDER_ENTRY` Target**: `12-10-2026` + 1 Day = **`13-10-2026`** [873–875, 1348].
* **`CAD_COMPLETION` Target**: `12-10-2026` + 2 Days = **`14-10-2026`** [873–875, 1348].
* **`MATERIAL_BOM` Target**: `12-10-2026` + 3 Days = **`15-10-2026`** [873–875, 1348].
* **`FABRIC_BOM` Target**: `12-10-2026` + 3 Days = **`15-10-2026`** [873–875, 1348].
* **`BUDGETING` Target**: `12-10-2026` + 4 Days = **`16-10-2026`** [873–875, 1348–1349].
* **`BUDGET_APPROVAL` Target**: `12-10-2026` + 4 Days = **`16-10-2026`** [873–875, 1348–1349].

---

### **Status Transition Lifecycle State Machine**

```
 ┌────────────────────────────────────────────────────────┐
 │                      PENDING                           │
 │     (Current Date <= Target Date, Completion Null)     │
 └──────────────────────────┬─────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
 ┌─────────────────────┐         ┌─────────────────────┐
 │      COMPLETED      │         │       OVERDUE       │
 │ Actual Date Filled  │         │ Current Date >      │
 │  <= Target Date     │         │ Target Date &       │
 └─────────────────────┘         │ Completion Null     │
                                 └──────────┬──────────┘
                                            │
                                            ▼
                                 ┌─────────────────────┐
                                 │      COMPLETED      │
                                 │ Actual Date Filled  │
                                 │   > Target Date     │
                                 └─────────────────────┘
``` [874–875, 1349–1350]

#### **Evaluation Rules**:
1. **`PENDING`**: Assigned target date is in the future, and `actual_completion_date` is `NULL`.
2. **`IN_PROGRESS`**: Task owner has saved a draft in the respective module, but the module is not officially finalized.
3. **`COMPLETED`**: Module is saved/finalized. System auto-stamps `actual_completion_date = NOW()`.
4. **`OVERDUE`**: `CURRENT_DATE > target_date` AND `actual_completion_date IS NULL` [874–875, 1349–1350]. The system auto-flags the row with an overdue status badge and triggers an alert [874–875, 1349–1350].

---

## 4. Task Ownership, HR Master Integration & Alert Routing

### **1. Task Owner Binding**
Each milestone row requires assigning a **Task Owner** (`task_owner_id`) [874–875, 1349]. The UI selector filters `staff_users` from the HR Staff Master based on department/designation alignment [133–134, 647–651, 1349]:
* **`ORDER_ENTRY` Owner**: Merchandising Staff (`designation = 'MERCHANDISER'`) [133–134, 1349].
* **`CAD_COMPLETION` Owner**: CAD Team (`department = 'CAD'` or `'SAMPLING'`) [647–651, 1349].
* **`MATERIAL_BOM` Owner**: Accessory Merchandiser (`department = 'MERCHANDISING'`) [133–134, 1349].
* **`FABRIC_BOM` Owner**: Fabric Merchandiser / Technical Team [133–134, 1349].
* **`BUDGETING` Owner**: Senior Merchandiser / Costing Team [133–134, 1349].
* **`BUDGET_APPROVAL` Owner**: Managing Director / Management (`role = 'MD'`) [366–367, 1349].

### **2. Dashboard Notification Engine**
When a milestone becomes **`OVERDUE`**, the backend notification dispatch service performs the following [874–875, 1349–1350]:
* Adds a **Red Alert Card** to the Task Owner's personal ERP Work Dashboard (*"Action Required: Fabric BOM Overdue for ARI HO/RE/26-27/0002"* ) [874–875, 1349–1350].
* Escalates to the **Management Executive Dashboard** if overdue exceeds 48 hours [874–875, 1349–1350].

---

## 5. PostgreSQL Database Schema

```sql
-- Create Enum for Milestone Codes
CREATE TYPE ta_work_plan_milestone_code AS ENUM (
    'ORDER_ENTRY',
    'CAD_COMPLETION',
    'MATERIAL_BOM',
    'FABRIC_BOM',
    'BUDGETING',
    'BUDGET_APPROVAL'
);

-- Create Enum for Work Plan Status
CREATE TYPE ta_work_plan_status AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'OVERDUE'
);

-- Main T&A Work Plan Table
CREATE TABLE order_ta_work_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    milestone_code ta_work_plan_milestone_code NOT NULL,
    sn INTEGER NOT NULL CHECK (sn BETWEEN 1 AND 6),
    target_days_from_received INTEGER NOT NULL DEFAULT 1 CHECK (target_days_from_received >= 0),
    target_date DATE NOT NULL,
    actual_completion_date DATE,
    task_owner_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
    status ta_work_plan_status NOT NULL DEFAULT 'PENDING',
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_order_milestone UNIQUE (order_id, milestone_code)
);

-- Indexes for Fast Querying & Dashboard Aggregations
CREATE INDEX idx_ta_work_plans_order_id ON order_ta_work_plans(order_id);
CREATE INDEX idx_ta_work_plans_owner_status ON order_ta_work_plans(task_owner_id, status);
CREATE INDEX idx_ta_work_plans_target_date ON order_ta_work_plans(target_date) WHERE status != 'COMPLETED';

-- Automated Updated_At Trigger
CREATE OR REPLACE FUNCTION update_ta_work_plans_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_ta_work_plans_timestamp
BEFORE UPDATE ON order_ta_work_plans
FOR EACH ROW EXECUTE FUNCTION update_ta_work_plans_timestamp();
```

---

## 6. Frontend Component & React State Specification

### **1. Component Hierarchy**
```
<OrderTaPanel orderId={orderId}>
  ├── <TaTabHeader />
  ├── <WorkPlanSubPanel orderId={orderId} />  ◄── [TARGET MODULE]
  │     ├── <WorkPlanSummaryHeader />
  │     └── <WorkPlanMilestoneTable>
  │           └── <WorkPlanMilestoneRow /> (x6)
  │                 ├── <TargetDateDisplay />
  │                 ├── <ActualDatePicker />
  │                 ├── <TaskOwnerSelect />
  │                 └── <StatusBadge />
  ├── <CustomerApprovalsSubPanel />
  └── <ProductionActivitiesSubPanel />
</OrderTaPanel>
``` [871–875]

### **2. TypeScript Interfaces (`/types/ta-work-plan.ts`)**

```typescript
export type MilestoneCode = 
  | 'ORDER_ENTRY' 
  | 'CAD_COMPLETION' 
  | 'MATERIAL_BOM' 
  | 'FABRIC_BOM' 
  | 'BUDGETING' 
  | 'BUDGET_APPROVAL';

export type WorkPlanStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE';

export interface WorkPlanMilestone {
  id: string;
  orderId: string;
  milestoneCode: MilestoneCode;
  milestoneName: string; // e.g. "Fabric BOM (Fabric Plan)"
  sn: number;
  targetDaysFromReceived: number;
  targetDate: string; // YYYY-MM-DD
  actualCompletionDate: string | null; // YYYY-MM-DD
  taskOwnerId: string | null;
  taskOwnerName?: string;
  status: WorkPlanStatus;
  remarks?: string;
}

export interface WorkPlanSubPanelProps {
  orderId: string;
  orderReceivedDate: string;
  readOnly?: boolean;
}
```

### **3. Frontend Sub-Panel Implementation (`/components/orders/ta/work-plan-sub-panel.tsx`)**

```tsx
import React, { useState, useEffect } from 'react';
import { WorkPlanMilestone, WorkPlanStatus } from '@/types/ta-work-plan';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { toast } from '@/components/ui/use-toast';

export const WorkPlanSubPanel: React.FC<{ orderId: string; orderReceivedDate: string }> = ({
  orderId,
  orderReceivedDate
}) => {
  const [milestones, setMilestones] = useState<WorkPlanMilestone[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchWorkPlans();
  }, [orderId]);

  const fetchWorkPlans = async () => {
    try {
      const res = await fetch(`/api/v1/orders/${orderId}/ta-work-plans`);
      const data = await res.json();
      setMilestones(data.workPlans);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to load T&A Work Plan', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleOwnerChange = async (id: string, taskOwnerId: string) => {
    await updateMilestone(id, { taskOwnerId });
  };

  const handleDateChange = async (id: string, actualCompletionDate: string | null) => {
    await updateMilestone(id, { actualCompletionDate });
  };

  const updateMilestone = async (id: string, payload: Partial<WorkPlanMilestone>) => {
    try {
      const res = await fetch(`/api/v1/orders/${orderId}/ta-work-plans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        toast({ title: 'Updated', description: 'Work Plan milestone updated successfully' });
        fetchWorkPlans();
      }
    } catch (err) {
      toast({ title: 'Update Failed', variant: 'destructive' });
    }
  };

  const getStatusBadge = (status: WorkPlanStatus) => {
    switch (status) {
      case 'COMPLETED': return <Badge className="bg-green-600 text-white">Completed</Badge>;
      case 'IN_PROGRESS': return <Badge className="bg-blue-600 text-white">In Progress</Badge>;
      case 'OVERDUE': return <Badge className="bg-red-600 text-white animate-pulse">Overdue</Badge>;
      default: return <Badge className="bg-gray-400 text-white">Pending</Badge>;
    }
  };

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading Work Plan...</div>;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm mt-4">
      <div className="flex items-center justify-between pb-3 border-b">
        <h3 className="text-base font-semibold text-foreground">Pre-Production Work Flow / Work Plan</h3>
        <span className="text-xs text-muted-foreground">Base Received Date: <strong>{orderReceivedDate}</strong></span>
      </div>

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="p-2 w-12 text-center">SN</th>
              <th className="p-2">Milestone / Work Flow Activity</th>
              <th className="p-2 w-28 text-center">Lead Days</th>
              <th className="p-2 w-32">Target Date</th>
              <th className="p-2 w-36">Actual Date</th>
              <th className="p-2 w-48">Task Owner</th>
              <th className="p-2 w-28 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="p-2 text-center font-medium">{m.sn}</td>
                <td className="p-2 font-semibold text-foreground">{m.milestoneName}</td>
                <td className="p-2 text-center">{m.targetDaysFromReceived} Day(s)</td>
                <td className="p-2 font-mono text-gray-700">{m.targetDate}</td>
                <td className="p-2">
                  <DatePicker
                    value={m.actualCompletionDate}
                    onChange={(dateStr) => handleDateChange(m.id, dateStr)}
                  />
                </td>
                <td className="p-2">
                  <Select
                    value={m.taskOwnerId || ''}
                    onChange={(ownerId) => handleOwnerChange(m.id, ownerId)}
                    placeholder="Assign Owner..."
                  />
                </td>
                <td className="p-2 text-center">{getStatusBadge(m.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
```

---

## 7. Backend API Specification & Endpoint Contracts

### **1. `GET /api/v1/orders/:orderId/ta-work-plans`**
Fetches or auto-initializes the 6 work plan milestones for a given order.

#### **Response Contract (200 OK)**:
```json
{
  "orderId": "508cbe24-b844-4789-a9b4-03f657522244",
  "orderReceivedDate": "2026-10-12",
  "workPlans": [
    {
      "id": "c1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c",
      "orderId": "508cbe24-b844-4789-a9b4-03f657522244",
      "milestoneCode": "ORDER_ENTRY",
      "milestoneName": "Order Entry Finalisation",
      "sn": 1,
      "targetDaysFromReceived": 1,
      "targetDate": "2026-10-13",
      "actualCompletionDate": "2026-10-13",
      "taskOwnerId": "8f7e6d5c-4b3a-2f1e-0d9c-8b7a6f5e4d3c",
      "status": "COMPLETED"
    },
    {
      "id": "e6f5d4c3-b2a1-0f9e-8d7c-6b5a4f3e2d1c",
      "orderId": "508cbe24-b844-4789-a9b4-03f657522244",
      "milestoneCode": "FABRIC_BOM",
      "milestoneName": "Fabric BOM (Fabric Plan)",
      "sn": 4,
      "targetDaysFromReceived": 3,
      "targetDate": "2026-10-15",
      "actualCompletionDate": null,
      "taskOwnerId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "status": "OVERDUE"
    }
  ]
}
```

---

### **2. `PATCH /api/v1/orders/:orderId/ta-work-plans/:id`**
Updates actual completion dates, task owner assignments, or remarks. Automatically re-evaluates the status lifecycle.

#### **Request Payload**:
```json
{
  "actualCompletionDate": "2026-10-14",
  "taskOwnerId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  "remarks": "Pattern block finalised after CAD review"
}
```

---

## 8. Verification & QA Acceptance Criteria

| QA Test ID | Scenario | Execution Steps | Expected Outcome |
| :---: | :--- | :--- | :--- |
| **QA-WP-01** | **Auto-Initialization** | Create a new order with `Order Received Date = 2026-10-12`. Open T&A tab. | 6 milestone rows auto-populate with target dates `2026-10-13` through `2026-10-16`. |
| **QA-WP-02** | **Overdue Status Evaluation** | Set system clock to `2026-10-17` while `actualCompletionDate` remains null for `FABRIC_BOM`. | Row status changes to **`OVERDUE`** with a red flashing badge [874–875, 1349–1350]. |
| **QA-WP-03** | **Actual Completion Sign-off** | Enter `actualCompletionDate = 2026-10-14` for `CAD_COMPLETION`. | Row status updates to **`COMPLETED`** (Green badge). |
| **QA-WP-04** | **HR Owner Filtering** | Click the `Task Owner` dropdown on the `CAD_COMPLETION` row. | Dropdown lists staff members filtered by CAD/Sampling designation [133, 647–651, 1349]. |

---

💡 **Developer Action Item**: You can copy and pass this specification directly to your frontend and backend developers for immediate execution!