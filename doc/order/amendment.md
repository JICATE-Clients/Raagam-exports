🛠️ Developer Technical Specification: Garment Order Amendment System
Module: Order Management / Garment Order Amendment
Target Screens: Order Entry, Material BOM, Fabric BOM, Budgeting, Garment Order Amendment

1. System Operating Philosophy & Locking Rules
Pre-Approval Flexibility vs. Post-Approval Lock
Pre-Approval State (Pending / Unapproved):
As long as the budget for a specific Order Reference (RE Number) is unapproved, merchandisers have full edit privileges across Order Entry, Material BOM, Fabric BOM, and Budgeting [18-19, 44-46, 54-55, 80-82].
Post-Approval Lock State (APPROVED):
The moment the budget is approved by Management/MD, the entire system LOCKS the RE Number across all upstream and budgeting screens [18-19, 45-46, 54-55, 81-82].
Direct editing or row deletion is strictly blocked to protect approved target margins, order costs, and planned material requirements [45-46, 81-82].
System Validation Error: Attempting to open or save modifications on an approved order triggers the system alert:
"Selected Budget Has Been Approved. Direct edits are disabled. Please use Garment Order Amendment." [47, 83]
2. Trigger Conditions for Garment Order Amendments
When post-approval changes occur, merchandisers cannot modify records directly. They must navigate to Garment Order Amendment to execute controlled updates [47-48, 83-84]. Valid trigger events include:

Order Quantity Revisions: Adding additional order pieces or cancelling partial order quantities [47-48, 83-84].
Colorway & Combo Changes: Adding new garment colors/combos, removing existing colorways, or changing combo allocations [47-48, 83-84].
Price & Rate Adjustments: Revising FOB unit prices, currency conversion rates, or buyer allowance terms [47, 83].
Schedule Changes: Extending or revising target ex-factory delivery dates [49, 85].
Specification / Consumption Revisions: Adding or removing trim accessories, updating fabric construction specs, or adjusting consumption formulas [48, 84].
3. Garment Order Amendment Screen Specification
A. Header Data Fields & Controls
Field Name	Type	UI Behavior & Rules
Amendment Entry No	Auto-Generated	Sequential internal amendment ID (e.g., AMD-001).
Date	System Date	Creation timestamp of the amendment request.
Order Ref No (RE No)	Dropdown / Lookup	Select target locked RE Number. Loads master order baseline into draft state [49, 85].
Responsibility Origin	Radio Buttons	Options: By Customer vs. By Us [49, 85]. Categorizes whether the revision was buyer-driven or an internal factory correction.
Amendment Type	Dropdown	Options: Quantity Addition, Quantity Cancellation, Price Change, Delivery Date Extension, Combo/Color Change, BOM Revision [49-50, 85-86].
Reason / Remarks	Text Area	Mandatory detailed explanation logging business justification for audit compliance [50, 86].
B. Field-Level Edit Scoping
Selecting the Amendment Type dynamically unlocks only the relevant input fields on the screen (e.g., selecting Delivery Date Extension unlocks only the delivery date picker, keeping price and quantity read-only) [49-50, 85-86].

4. Downstream Data Propagation & Re-Approval Flow
 ┌──────────────────────────────────────────────────────────────┐
 │ 1. Save Garment Order Amendment                              │
 │    • Updates Master Order record                             │
 │    • Logs amendment entry in audit history                   │
 └──────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ 2. Automated Downstream Propagation                          │
 │    • Recalculates Material BOM required quantities           │
 │    • Recalculates Fabric BOM weights & process routes        │
 │    • Updates Purchase & Process Rate tabs in Budgeting       │
 └──────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ 3. Revised Budget Approval Cycle                             │
 │    • Pushes revised budget to PWA Mobile / Web Approval UI   │
 │    • Level 1 / Level 2 Management approval required          │
 │    • Upon Approval: Order is RE-LOCKED with updated baseline │
 └──────────────────────────────────────────────────────────────┘
Master Update: Saving the amendment updates the core order database and generates a permanent historical log entry [50, 86].
Auto-Propagation: Updated quantities and specifications automatically propagate forward into the Material BOM, Fabric BOM, and Budgeting modules [50-51, 86-87].
Re-Approval SLA: The revised financial budget is flagged as Pending Re-Approval and routed to the Mobile PWA Approval Dashboard [40-42, 76-78].
Re-Locking: Once management approves the revised budget, the order returns to the APPROVED state and is re-locked [42, 51, 78, 87].
5. Developer Acceptance Criteria Checklist
[ ] Direct edits on Order Entry, Material BOM, Fabric BOM, and Budgeting are blocked if Budget.status === 'APPROVED' [18-19, 45-46, 54-55, 81-82].
[ ] Attempting direct edit on a locked order displays error: "Selected Budget Has Been Approved" [47, 83].
[ ] Garment Order Amendment screen captures RE No, Responsibility Origin (By Customer / By Us), Amendment Type, and Reason / Remarks [49-50, 85-86].
[ ] Saving an amendment automatically updates Material BOM, Fabric BOM, and Budgeting figures [50-51, 86-87].
[ ] Amended budgets reset status to Pending and require a fresh approval cycle before re-locking [41-42, 51, 77-78, 87].