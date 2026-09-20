Developer Specification: New Feature Requests
Synthesized from Audio Session record-1789900034494.wav — Garment ERP System
Enhancements

EXECUTIVE SUMMARY: This technical specification outlines the core feature additions and workflow
enhancements discussed in client recording record-1789900034494.wav. It covers the CAD Piece Weight Hand-off
Workflow, PWA Mobile Approval Architecture, Time-based Approval Escalations, and Role-Based Access Control.

1. CAD / CARE Sheet Automated Workflow (Piece Weight Integration)
Current Manual Pain Point: Currently, garment component piece weights (e.g., Front Body: 150g, Back/Sleeve:
200g, Total: 350g) are calculated on standalone CAD software ('CARE sheet'). CAD operators print physical paper
sheets and manually hand them over to merchandisers for manual data entry into Fabric BOM.
Required Automated Workflow:
• Automated CAD Trigger: Saving a new Sales Order Entry triggers an automated notification/alert to the CAD
department.
• CAD Operator Dashboard / Login: CAD team receives dedicated view access to open the order, view required
style components, and acknowledge the request.
• Direct Piece Weight Entry & CAD File Attachment: CAD operators enter calculated average component piece
weights (grams/piece) directly into the ERP and attach/upload the digital CAD/CARE sheet.
• Merchandiser Handoff Alert: Upon CAD submission, an automated notification alerts the Merchandiser that piece
weights are confirmed, auto-populating Fabric BOM calculations.
Workflow Stage Actor System Action / Output
1. Order Creation Merchandiser Saves Sales Order Entry; triggers system event ORDER_CREATED.
2. CAD Notification System Sends notification bell alert & task to CAD Operator dashboard.
3. CAD Sheet Entry CAD Operator Inputs average piece weights (g/pcs), attaches CAD PDF/XLS file, and

submits.

4. Merchandiser Alert System Notifies Merchandiser; auto-populates component weights into Fabric BOM.

2. Progressive Web App (PWA) Mobile Deployment Architecture
Rationale: Delivering mobile budget approval features via PWA (Progressive Web App) instead of Native App Store /
Play Store binaries to eliminate app store submission delays, compliance policies, and version update friction.
• Web Link Installation: Users install the app icon directly to their mobile home screen via a web URL.
• PWA Bell Icon Notifications: Top navigation bar displays a dynamic bell icon with red badge counter for pending
budget approvals.

Ref: record-1789900034494.wav Page 2
• Executive Mobile Dashboard: Approvers (MD / Sugan Sir / Factory Managers) view high-level budget metrics
(Order Qty, Gross Sales, Total Expenses, Profit %, Profit Value) in a clean card format.
• Approval Actions: Provides one-tap actions: Approve, Not Approved, or Rework (with mandatory notes text box).

3. Time-Based Automated Approval Escalation Matrix
Business Logic: Budget approvals are time-critical for material planning. If a pending budget approval request sits
idle past a defined SLA time limit, the system must automatically escalate the request to the next hierarchical
authority.
Escalation Step Target Role SLA / Timeout Automated Action
Level 1 (Initial) Factory Manager / Lead Configurable (e.g.
30–120 mins)

PWA push notification & bell alert on submission.
Level 2 (Escalation) MD / Executive Approver Timeout Exceeded Auto-escalates request to MD; flags level-1 SLA

breach in log.

4. Role-Based Access Control (RBAC) & System Lock Rules
• Role Definitions: Global role mapping for Merchandiser, CAD Operator, Factory Manager, MD / Approver, and
Admin.
• Pre-Approval Modifications: While budget status is Pending / Unapproved, Merchandisers can freely edit Order
Entry, Material BOM, Fabric BOM, and Purchase Rates.
• Post-Approval Edit Lock: The moment MD approves a budget (APPROVED), Order Entry, Material BOM, Fabric
BOM, and Budget rates are strictly LOCKED from editing across all desktop and mobile interfaces.
• Order Amendment Protocol: Any post-approval change (qty, color, price) must be routed through the formal
Garment Order Amendment screen, logging customer vs. internal reasons.