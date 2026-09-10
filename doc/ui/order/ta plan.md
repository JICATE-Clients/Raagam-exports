UNIFIED SPECIFICATION PLAN: TIME & ACTION (T&A) ENGINE
1. BACKWARD SCHEDULING CALENDAR ENGINE (9-STEP CHAIN)
The scheduling calendar calculates target deadlines backward from the Earlier Shipment Date (from the Logistics/Qty tab)
:
[Earlier Shipment Date] (Logistics Anchor)
          │
          ▼ (-1 Day)
  1. Inspection
          │
          ▼ (-2 Days)
  2. Packing ──► 3. Ironing ──► 4. Checking ──► 5. Sewing ──► 6. Cutting
                    (-2 Days)      (-2 Days)      (-5 Days)      (-2 Days)
                                                                    │
                                                                    ▼ (-1 Day)
                                                            7. PP Approval
                                                                    │
                                                                    ▼ (-Customer Review Days)
                                                            8. PP Send
                                                                    │
                                                                    ▼ (-1 Day)
                                                            9. Material Inhouse
Calculation Rules:
Inspection: Target Date = Earlier Shipment Date - 1 Day (Read-only)
.
Packing: Target Date = Inspection Date - 2 Days (Editable, default offset: 2 days)
.
Ironing: Target Date = Packing Date - 2 Days (Editable, default offset: 2 days)
.
Checking: Target Date = Ironing Date - 2 Days (Editable, default offset: 2 days)
.
Sewing: Target Date = Checking Date - 5 Days (Editable, default offset: 5 days)
.
Cutting: Target Date = Sewing Date - 2 Days (Editable, default offset: 2 days)
.
PP Approval: Target Date = Cutting Date - 1 Day (Read-only)
.
PP Send: Target Date = PP Approval Date - Customer PP Review Days (Read-only, review days pulled dynamically from customer_approval_defaults per buyer)
.
Material Inhouse: Target Date = PP Send Date - 1 Day (Read-only)
.
Database Master Seed: Update ta_activities table default offset days: PACK = 2, SEW = 5, CUT = 2
.
2. TASK OWNER ASSIGNMENT & HR MASTER INTEGRATION
Schema Standardization: Consolidate database columns to use assigned_staff_id on garment_order_amendment_ta_activities (foreign key referencing hr_staff_master). Formally drop orphaned assigned_employee_id.
Grid UI Integration: Third column in the T&A grid uses RecordPicker (employee-picker.tsx) to search and assign staff members from hr_staff_master. Natively supports standard keyboard navigation (↑/↓, Enter, Tab).
Smart Auto-Populate Engine: When creating a new order, auto-fill assigned_staff_id by default from the most recent saved active order, allowing manual overrides.
Form Validation: assigned_staff_id remains nullable in the DB to prevent insertion crashes during draft creation, but UI form submission mandates an assigned task owner for every activity row before saving.
3. USER DAILY ACTION DASHBOARD & WORKLIST
Navigation Access: Add "TA Worklist" as a top-level, standalone sidebar item (/orders/ta-worklist) alongside "TA Followup".
Three-Tier Task Partitioning:
Today's Action Items: Tasks scheduled for CURRENT_DATE.
Backlog & Pending Queue: Overdue tasks where target_date < CURRENT_DATE.
Upcoming 7-Day Horizon: Tasks scheduled within the next 7 working days (HORIZON_DAYS = 7).
Personalized View: Toggle support between Department Tasks and My Tasks (mineOnly = true) scoped to the logged-in staff member.
Dashboard Widget: Embed a "My Daily T&A Tasks" action summary widget directly on the main route (/dashboard).
4. PERFORMANCE ANALYTICS & KPI ENGINE
PostgreSQL RPC Function: staff_ta_kpi() deployed via Migration 0547 as a SECURITY DEFINER function.
Metrics Tracked: Computes total assigned tasks, on-time completions, late completions, and average delay days per staff member.
Mandatory Delay Attribution: On late completion, the server mandates selecting a delay reason (INTERNAL_STAFF, BUYER_DELAY, MATERIAL_SUPPLIER). Tasks marked with BUYER_DELAY are excluded from penalising staff KPI scores.
Reporting: Displays individual KPI score badges on the TA Worklist and unblocks the team-wide Monthly Review Meeting (MRM) report at /reports/ta-performance.
5. DAILY PRODUCTION OUTPUT & FLOOR "BYPASS" WORKFLOW
5 Floor Stages: Expands tracking across Cutting, Sewing, Checking, Ironing, and Packing (production_entries).
Single Source of Truth (stage_cumulative_good_qty): Calculates live cumulative floor output via a SECURITY DEFINER SQL function.
Upstream WIP Safety Guard: Enforces that downstream departments cannot log more pieces than the cumulative output available from the preceding stage (recordEntry()).
Bypass Execution Logic: When partial production flows downstream ahead of scheduled start dates, the system sets the stage state to BYPASS_IN_PROGRESS, displaying real-time floor progress without firing false overdue delay alerts.
6. CUSTOMER APPROVALS FOLLOW-UP BOARD & SAFETY LOCK
4 Lifecycle States: Tasks move through PENDING, SENT, APPROVED, and REWORK.
Dispatch Proof: Mandates logging the dispatch date and attaching file proof (courier slip URL) when transitioning to SENT.
Version-Controlled Rework Loop: Setting a status to REWORK forces mandatory buyer comments, archives the rejected cycle in garment_order_approval_history, increments active_version, and resets the live row to PENDING for Version 2 tracking.
Delay Attribution: Automatically calculates Merchandiser Dispatch Delay vs. Buyer Review Delay.
Cutting Room Safety Lock: Hardlocks the cutting room interface from generating cut sheets or starting production unless PP_SAMPLE holds an APPROVED status.