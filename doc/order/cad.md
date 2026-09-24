Technical Specification: CAD Lifecycle, T&A Integration, and Reporting

1. Executive Summary

The CAD (Computer-Aided Design) module is the technical gateway for data integrity within the Garment ERP. Its primary objective is to centralize CAD allocation and approval workflows to ensure that the Fabric Bill of Materials (BOM) is seeded only with verified, buyer-approved consumption data.

To resolve existing system vulnerabilities, this module implements a strict "CAD submission flag" (is_submitted). No Fabric BOM may be generated or saved unless the corresponding CAD marker has been finalized and flagged as submitted. This ensures procurement and production planning are grounded in technical reality, preventing the "empty row" and "cleared consumption" defects identified in previous audit cycles.

2. Pre-Sending: CAD Allocation Module

The allocation module governs the internal assignment of pattern-making tasks. It serves as the start point for measuring departmental lead time and accountability.

2.1 Staff Assignment Logic

The system pulls staff names from the 'Staff Master'. Selection must be strictly filtered by the Designation field. Only employees designated as "Pattern Maker" or "CAD Technician" shall be visible in the allocation dropdown to ensure task-specific accountability.

2.2 CAD Type Classification

To enable accurate reporting and process tracking, every allocation must be categorized into one of the following technical classifications:

* First Pattern: Initial creation from tech pack/sketch.
* Grading: Sizing expansion based on the approved base size.
* Marker Planning: Nesting of patterns for consumption calculation.

2.3 Target Date Management

* Allocation Date: The date the task is assigned (current system date, non-editable).
* Internal Target Date: The mandated completion date for internal review before customer dispatch.

CAD Allocation UI Layout

Field Name	Data Source	Validation Rule
Style Reference	Style Master	Mandatory; Read-only
Pattern Maker	Staff Master	Mandatory; Filter: Designation = 'Pattern Maker'
CAD Type	System List	Mandatory; Selection: First Pattern, Grading, Marker Planning
Allocation Date	System Date	Mandatory; Entry date (cannot be future)
Internal Target Date	User Entry	Mandatory; Must be ≥ Allocation Date

3. CAD Sending Form & Dispatch Tracking

This module tracks the external transmission of technical files to the buyer or external stakeholders.

3.1 File Attachment Specifications

The system acts as a Document Management System (DMS) for technical assets. Attachment is mandatory for the 'Dispatch' status to trigger. Supported formats:

* Standard Exchange: .DXF
* Pattern Data System: .PDS
* Plotter Files: .PLT

3.2 Dispatch Proofing

Audit trails require evidence of transmission. Users must populate at least one proof field:

* Courier Tracking Number: For physical pattern shipments.
* Email Timestamp: For digital transfers.

3.3 Expected Approval Date Calculation

The system shall auto-populate the 'Expected Approval Date' to assist Merchandisers in T&A tracking. Formula: Dispatch Date + Customer Review Lead Days (Lead days are fetched from the Customer Master).

TECHNICAL IMPACT: FILE REVISION ARCHITECTURE
To prevent file overwriting and maintain version history, CAD files must 
be stored using a standardized naming convention:
{style_id}_{version_no}_{timestamp}.{extension}
Storage Path: /uploads/cad/styles/{style_id}/v{version_no}/


4. Post-Sending Decision Logic & T&A Integration

This section defines the workflow following buyer feedback and the subsequent automation triggers.

4.1 Decision Tree

The CAD record must be updated to one of three states:

1. Pending: Awaiting response (default state post-dispatch).
2. Approved: Moves the workflow to BOM seeding.
3. Rework Required: Triggers a version increment and re-allocation.

4.2 Versioning & Rework Logic

The system maintains strict sequential versioning (version_no).

* Increment Logic: If 'Rework Required' is selected, a new record is generated with version_no = n + 1.
* Mandatory Feedback: 'Buyer Alteration Comments' must be populated to unlock the 'Rework' submission.

4.3 T&A Milestone Triggers

CAD statuses are mapped to the Time & Action calendar via the following triggers:

* Action: CAD Dispatch -> Updates 'Pattern Sent' milestone (actual_date = dispatch_date).
* Action: CAD Approved -> Updates 'Pattern Approval' milestone and sets the is_submitted flag to TRUE.

Rationale for Locking and Watermarking

Similar to the "Order Amendment" logic, the order remains locked for procurement until is_submitted is flipped. Any Fabric BOM reports generated while CAD is 'Pending' or 'Rework Required' must carry a "CAD PENDING" watermark, and consumption figures should be treated as estimates only.

5. Database Schema & API Specifications

5.1 Data Models (SQL)

Migration Requirement: A migration script is required to add the is_submitted column to the existing marker_definitions table to correct the current guard defect.

-- Pattern Maker Filter View
CREATE VIEW view_pattern_makers AS
SELECT staff_id, staff_name FROM staff_master 
WHERE designation_id IN (SELECT id FROM designations WHERE name = 'Pattern Maker');

CREATE TABLE cad_allocations (
    allocation_id SERIAL PRIMARY KEY,
    style_id INT NOT NULL,
    staff_id INT NOT NULL,
    cad_type ENUM('First Pattern', 'Grading', 'Marker Planning') NOT NULL,
    allocation_date DATE DEFAULT CURRENT_DATE,
    target_date DATE NOT NULL,
    version_no TINYINT DEFAULT 1,
    UNIQUE(style_id, version_no),
    FOREIGN KEY (staff_id) REFERENCES staff_master(staff_id)
);

CREATE TABLE cad_dispatches (
    dispatch_id SERIAL PRIMARY KEY,
    allocation_id INT NOT NULL,
    dispatch_date DATE NOT NULL,
    file_path TEXT NOT NULL,
    tracking_info VARCHAR(100),
    FOREIGN KEY (allocation_id) REFERENCES cad_allocations(allocation_id)
);

CREATE TABLE cad_approvals (
    approval_id SERIAL PRIMARY KEY,
    dispatch_id INT NOT NULL,
    status ENUM('Pending', 'Approved', 'Rework Required') DEFAULT 'Pending',
    approval_date DATE,
    buyer_comments TEXT,
    FOREIGN KEY (dispatch_id) REFERENCES cad_dispatches(dispatch_id)
);


5.2 API Route Handlers (TypeScript Interfaces)

interface CadAllocateRequest {
  styleId: number;
  staffId: number;
  cadType: 'First Pattern' | 'Grading' | 'Marker Planning';
  targetDate: string; // ISO Date
}

interface CadDispatchRequest {
  allocationId: number;
  dispatchDate: string;
  trackingInfo: string;
  cadFile: File; // Handled via Multipart/form-data
}

interface CadApproveRequest {
  dispatchId: number;
  status: 'Approved' | 'Rework Required';
  comments?: string; // Mandatory if status is Rework
  approvalDate: string;
}


6. CAD Completion & Order Sheet Reporting

6.1 CAD Completion Report

This management report measures the efficiency of the CAD department. Formula: Final Approval Lead Time = Approval Date - Allocation Date (of V1)

Style Ref	Pattern Maker	Total Versions	Status	Final Approval Lead Time (Days)
T-7721	R. Kumar	2	Approved	14
S-9002	S. Gupta	1	Pending	-

6.2 Garment Order Sheet Integration

The Garment Order Sheet must dynamically pull the latest CAD status. If cad_approvals.status is 'Approved', it must display "Approved (V{n})". If any other status, it must display "Pending" in red text.

7. Functional Changes & Validation Rules

* Fabric BOM Guard: The system must strictly refuse the creation or seeding of a Fabric BOM if the is_submitted flag on the style marker is FALSE.
* Item Form Validation: To ensure CAD markers match physical production, the system must validate the CAD layout against the layout_type (style) field in the Order Master. A mismatch (e.g., Open Width marker for a Tubular fabric declaration) will block approval.
* Sequential Version Control: Version (n+1) cannot be created in the cad_allocations table until Version (n) has a recorded status of 'Rework Required' in cad_approvals.
* Date Integrity: Input dates for Allocation and Dispatch must be \le Current System Date. Future dating is strictly prohibited.
* Mandatory Reporting Fields: To prevent "empty row" errors in the Completion Report, the 'Pattern Maker' and 'CAD Type' fields are hard-validated at the database level.
