Technical Development Specification: HR Staff Fine and Salary Deduction Workflow

1. Executive Summary and Strategic Rationale

The implementation of a controlled workflow for HR staff fines and salary deductions is a strategic necessity to prevent financial leakage within the garment manufacturing environment. Historically, "automated deductions for budget mistakes" have created significant fiscal discrepancies and sparked industrial relations issues. This module shifts the paradigm from unverified automated triggers to an intentional, human-verified approval process.

By introducing high-friction verification points, the system serves as a fiscal safeguard against arbitrary penalties. This workflow ensures that every deduction is a validated, legally defensible artifact. The strategic goal is to maintain absolute payroll integrity while providing a clear, auditable lifecycle for every financial record, moving from a tentative entry to a committed ledger impact.

2. Business Process Lifecycle and Workflow Architecture

The architecture of the fine and deduction workflow is explicitly aligned with the "Order Amendment" lifecycle used elsewhere in the ERP. This ensures system-wide consistency and leverages existing database-level lock logic to protect data integrity.

Fine Record Journey

* Draft State
  * Initiation: A Supervisor or HR Junior enters fine details.
  * Record Status: Editable and non-committal. The is_submitted flag remains false.
  * Impact: Zero impact on payroll engine or staff ledger.
* Pending MD/HR Manager Approval
  * Submission: Setting is_submitted to true triggers the "Locked" state.
  * Database Lock: Mirroring the "Order Locked" rule, the record becomes read-only to the initiator and is moved to the reviewer’s queue.
* Approved State
  * Commitment: Upon manager authorization, the record is flagged as an "Approved" artifact.
  * Locked Artifact: Once approved, the record is locked from further HR edits. It becomes a read-only source of truth for the Payroll Engine.
  * Payroll Integration: The deduction is queued for the next batch calculation.
* Rejected/Abandoned State
  * Reversion: If a manager rejects the fine or an HR Junior "Abandons" it (mirroring the merchandiser’s "gave up" logic), the system reverts all mathematical impact.
  * Audit Preservation: The record is preserved for audit transparency but is flagged as non-calculable and excluded from the payroll engine math.

The transition from physical UI interaction to persistent data follows the "Locked" state logic used in the Order Entry modules, preventing concurrent modifications during the deliberation period.

3. Frontend UI/UX Component Specifications

The UI/UX design adheres to a "Safety First" philosophy, prioritizing deliberate interaction over speed to prevent erroneous data entry.

The Fine Confirmation Modal

* Default State & Logic: The confirmation toggle must default to 'NO'. This follows the "deliberately abstains rather than guessing" logic found in the Fabric BOM module.
* Controlled Component: The 'Submit' button must remain disabled until the user explicitly toggles the state to 'YES'. This friction point ensures the operator has consciously verified the Staff ID and Amount.
* Input Validation: The 'Remarks' field is "Mandatory," mirroring the strict Amendment Remarks rule. The system shall refuse to advance any record with an empty remarks field.
* Conditional Visibility: The interface must utilize "Direct mode vs. Calculated mode" logic, similar to the Fabric BOM measurement inputs.
  * Direct Mode: Only the flat deduction amount field is visible.
  * Calculated Mode: Hides the flat amount and displays derived fields (e.g., "Days of Pay" or "Percentage of Gross"), mirroring how the system hides Width and Length during direct weight entry.

4. PostgreSQL Database Schema Definition

The schema is designed to meet the audit-heavy requirements of a garment ERP, utilizing patterns from the Fabric BOM and Order Amendment modules.

Table: hr_staff_fine_deductions

Column	Type	Constraints	Description
id	UUID	Primary Key	Unique identifier for the record.
staff_id	UUID	Foreign Key	References staff_master(id).
staff_incident_id	UUID	Unique Constraint	Prevents duplicate fines for the same incident.
fine_amount	Decimal(10,2)	Non-nullable	The final monetary value to be deducted.
status	Enum	Default: 'Draft'	(Draft, Pending, Approved, Rejected, Abandoned).
is_submitted	Boolean	Default: false	CAD-style flag to trigger record locking.
remarks	Text	Non-nullable	Mandatory reason for the fine/deduction.
created_by	UUID	Foreign Key	References user_master(id).
approved_by	UUID	Foreign Key	Manager ID who authorized the fine.
approved_at	Timestamp	Nullable	Exact time of management authorization.

Indexes:

* CREATE INDEX idx_fine_staff_id ON hr_staff_fine_deductions(staff_id);
* CREATE INDEX idx_fine_status ON hr_staff_fine_deductions(status);

5. Backend Next.js API Logic and Approval Hooks

The API layer enforces business rules that cannot be bypassed by frontend state. As per the Yarn Process rule, "The server refuses even if the screen is bypassed."

Approval Hook Logic

Upon a status change to 'Approved', the API must:

1. Permission Validation: Verify the user holds 'MD' or 'HR Manager' credentials.
2. Payroll Record Lock: Trigger a temporary "Payroll Lock" on the specific staff record for the current month.
3. Active Status Check: Query staff_master for the is_active flag. Deductions against inactive staff must be refused.
4. Idempotency Check: Execute a pre-flight check against staff_id, fine_amount, and staff_incident_id to prevent double-charging for the same event.

Save Refusal Conditions

The API will return a 400 Bad Request and refuse to save if:

* The remarks field is empty or contains only whitespace.
* The fine_amount is ≤ 0.
* The staff member is marked as 'Inactive'.

6. HR Payroll Engine Integration and Batch Calculation

The Payroll Engine maintains mathematical precision, ensuring that all deductions are processed as an atomic operation.

Net Salary Formula

The engine applies the following formula:

Net Salary = (Basic + Allowances) − (Standard Deductions + Approved Fines)

Batch Calculation and Recalculation Logic

Mirroring the "BOMs Recalculate" feature, the payroll engine operates on a "requirement ladder" principle. If a fine is approved after the initial payroll draft has been generated, the system must trigger an atomic recalculation. This recalculation must be isolated to the affected unit or department to ensure the payroll ledger reflects the latest approved artifacts without disrupting unaffected records.

Arithmetic Checks

Similar to "BOM arithmetic tests," the engine must run automated verification to ensure that the total sum of Approved Fines does not exceed a configurable percentage of the gross pay (e.g., 25%). If the arithmetic check fails, the engine must flag the record for review rather than allowing a negative net salary payout.

7. Audit Logging, Security, and Reporting

Financial transparency is critical for staff trust and regulatory compliance.

Audit Log Requirements

Every change to a fine’s status must be recorded in an immutable log containing:

* Timestamp: Precision to the millisecond.
* User ID: The actor performing the state change.
* Change Type: Must specify the nature of the transition: Initial Entry, Manager Review, Approval, or Rejection Revert.

Fine Summary Report

Following the "Fabric BOM Entry Register" format, this report must be a static, non-interactive Markdown table or PDF export.

Staff Name	Fine Reason (Remarks)	Amount	Approver Name
{Employee Name}	{Mandatory Remarks}	{00.00}	{Manager Name}

Interactive charts and visualizations are strictly forbidden in this module. The report serves as a standard "Entry Register" for management to verify monthly financial conduct. This specification fulfills the mission of ensuring a professional, error-free HR environment through intentional workflow design.
