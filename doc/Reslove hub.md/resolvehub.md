ResolveHub
Report. Track. Resolve.



Module sections
- My Reports
- My Work
- Complaints
- Service Requests
- Triage & Assignment
- Analytics & Administration
# Build InstaSolver — Native ERP Issue Management Module

## Objective

Implement InstaSolver as a production-ready module inside the existing Next.js + Supabase ERP.

InstaSolver is a unified reporting and issue-resolution system. Employees can report a broken item, submit a complaint, or raise a purchase need without knowing which department handles it. The system routes each report to the correct accountable owner, tracks its lifecycle and due date, sends notifications, escalates overdue work, and provides management analytics.

Use the supplied InstaSolver flow and build guide as the functional specification.

## 1. Mandatory repository discovery

Before writing code:

1. Inspect the repository structure, Next.js routing conventions, authentication, employee/user tables, organization and department relationships, permission system, Supabase clients, database migrations, shared layouts, design tokens, reusable forms, tables, dialogs, notifications and audit logging.
2. Identify existing Procurement, Inventory/Stores, HR, maintenance and notification modules.
3. Find the established conventions for server actions or API routes, validation, error handling, testing and migrations.
4. Identify how the ERP determines an employee's organization, college, location, department, reporting manager and administrative permissions.
5. Produce a short implementation assessment listing reusable components, existing integration points, schema dependencies, risks and the proposed file plan.

Do not modify files until this assessment is complete.

## 2. Non-negotiable architecture

- Extend the existing ERP; do not create a separate application.
- Reuse the existing authentication and employee identity. Do not create duplicate employee or authentication systems.
- Follow existing Next.js and Supabase conventions.
- Use PostgreSQL migrations for schema changes.
- Use Zod or the repository's established validation library.
- Enforce access control through Supabase Row Level Security (RLS), server-side authorization and guarded database transitions.
- Never rely on UI visibility alone for permissions.
- Use the existing shared ERP design system, table components, status badges, forms, dialogs, icons and notification infrastructure.
- Use lucide-react if that is the repository's established icon library.
- Preserve existing module functionality and routes.
- Avoid unnecessary dependencies, duplicated utilities, hardcoded employee IDs and broad rewrites.
- Use database-backed limits and durable background-job or scheduled-job mechanisms rather than in-memory counters.
- Never expose Supabase service-role credentials or AI API keys to the browser.
- Do not run destructive migrations or modify production data without authorization.

## 3. Module navigation

Add an InstaSolver entry to the existing ERP navigation, respecting the current permission system.

Provide these sections:

1. Report a problem
2. My Reports
3. My Complaints / Track Complaint
4. My Work
5. Triage Queue
6. All Jobs
7. Workload
8. Analytics
9. Administration

Only show navigation items permitted for the current employee. Enforce the same permissions on the server and in the database.

## 4. Reporting entry point

Create three clear cards:

- Something is broken
- Make a complaint
- Need to buy something

Also provide links to My Reports, My Complaints and Track Complaint.

The chooser must not create a ticket. Purchase Need should be visible and actionable only to employees authorized to raise purchase requests. Other employees should receive an appropriate explanation of the existing purchase-request process.

### Broken report

Fields:
- Place or asset, selected from the employee's authorized location/places list where possible.
- What is wrong.
- Optional JPEG photo.
- Dangerous/unsafe checkbox.
- Optional GPS location, subject to privacy controls.

Validate inputs on both client and server. Enforce upload size limits, verify actual file bytes, strip embedded camera/GPS metadata and store files using private Supabase Storage buckets or the repository's equivalent secure storage architecture.

On submission:
1. Apply a database-backed rate limit of 10 reports per employee per rolling 24 hours.
2. Record the rate-limit ledger entry transactionally with ticket creation.
3. Check for similar open reports at the same place within 14 days.
4. Allow the employee to join an existing report when appropriate; never auto-join a dangerous report.
5. Determine the accountable owner using the configured routing rules.
6. Set the due date and record the activity history.
7. Trigger notifications through a durable, failure-aware notification mechanism.
8. Display a receipt containing the reference number, assigned owner, due date and next steps.

### Complaint report

Fields:
- Category
- Subject
- Description
- Anonymous option where enabled
- About my superior option

Implement category-specific handlers and restricted committee-only access for sensitive categories.

For anonymous complaints:
- Do not persist the reporter's identity in the complaint record or expose it to the handler.
- Generate a cryptographically secure tracking token with at least 128 bits of entropy.
- Store only a suitable secure representation of the tracking token where practical.
- Provide a public-safe tracking page that reveals only the reference number, subject, status, key timestamps and resolution message.
- Do not reveal sensitive details or internal notes on the tracking page.

Complaints about a superior must route to the configured independent handler, never to the reporter's own reporting chain.

Create a handler work item with a 72-hour response deadline. Implement complaint-specific statuses: open, assigned, in_progress, escalated, resolved and withdrawn.

### Purchase Need

If the ERP already has Procurement, integrate with its existing purchase-request workflow.

Reuse its vendor, item, unit-of-measure, approval and purchase-request records as appropriate. Do not create a competing procurement approval system.

If no suitable purchase-request module exists, create a minimal Requirement workflow with pending, approved, rejected, fulfilled and withdrawn states.

## 5. Broken-ticket lifecycle

Implement the following transitions:

- open → in_progress
- open / in_progress → blocked
- blocked → in_progress
- in_progress → fixed
- fixed → closed
- closed → in_progress when the reporter disputes the fix within seven days
- open → cancelled by an authorized manager, with a required reason
- open → withdrawn by the reporter before work begins

Rules:
- A worker can claim eligible team work and become its assignee.
- Blocking requires a reason and pauses the SLA clock.
- Unblocking resumes the clock and adjusts the due date for paused time.
- Fixing requires a valid fix photo; a note is optional.
- Closing follows the configured verification policy. Support automatic closure after a fix submission and a configurable random spot-check of 1 in 10 fixes.
- A reporter can mark a closed ticket Not Fixed within seven days. Require a reason, reopen the work and set a fresh due date.
- The second Not Fixed dispute notifies the college head or configured organizational equivalent.
- A reporter can submit a 1–5 star thank-you rating once per fix round.
- Owner-confirmed closure must be distinguishable from a photo-verified fix and excluded from verified fix-rate metrics.

All transitions must be atomic and concurrency-safe. Use guarded updates or database functions that validate the current state, actor authorization and permitted transition.

## 6. Routing and SLA rules

For a new broken ticket, choose the first eligible owner:

1. Explicit authorized owner override.
2. Asset or room caretaker for QR-originated reports.
3. Trade-team lead, then an active team member.
4. Configured estate/administration office owner.
5. College head or the equivalent organization-level fallback.

If the owner is on approved leave, route to their manager or the configured fallback and pause the clock until reassignment.

Default due dates:
- Dangerous/unsafe: same day.
- Ordinary broken: two days.
- Routine/system gap: seven days.
- Purchase need: seven days, unless Procurement owns its own SLA.

Support organization-specific configuration and correct business-timezone handling. Paused time must not count against the SLA.

Do not let reporters select their own owner or priority.

## 7. Core data model

Adapt the supplied schema to existing ERP conventions. At minimum, implement equivalent structures for:

- Trades
- Places and assets/QR identifiers
- Teams and team members
- Unified tickets
- Ticket photos
- Ticket joiners
- Append-only ticket activity
- Internal and reporter-visible notes
- Ratings
- Report/rate-limit ledger
- Complaint categories and sensitive-handler configuration
- Notification delivery attempts and failures
- Reference-number counters
- Module settings
- Scheduled escalation/digest execution records where needed

Use the existing organization, location, employee and department tables instead of duplicating them.

Use a unified tickets table for broken and complaint records when compatible with the existing schema. Model complaint-specific fields and states without weakening access isolation. Integrate purchase requirements with Procurement rather than creating duplicate purchase records.

Reference numbers must be generated atomically, for example BRK-2026-000123, with an appropriate prefix per ticket kind.

Add appropriate foreign keys, indexes, constraints, timestamps and updated-at handling.

## 8. Permissions and RLS

Define permission keys independent of role names:

- instasolver.view
- instasolver.work
- instasolver.triage
- instasolver.analytics
- instasolver.admin

Map these keys to the ERP's existing permission mechanism.

Access expectations:
- Reporter: own reports and reports they joined.
- Worker: work assigned to them or their active team.
- College head / equivalent: read-only access to tickets in their authorized organizational scope, plus analytics.
- Triage: tickets within their authorized organization-wide scope.
- Super admin: global access where explicitly authorized.
- Sensitive complaint handlers: only authorized committee members and explicitly permitted oversight users.

Internal notes must never be visible to reporters.

Use database policies and guarded functions to prevent unauthorized reads, updates and transitions. Non-manager workers must only update whitelisted fields. Reporters may edit their own text only while the ticket remains open, and may use only the permitted dispute, confirmation and withdrawal actions.

Test cross-organization access, direct API calls, anonymous complaint access and attempts to alter protected columns.

## 9. Work management screens

### My Work
Tabs:
- Assigned to me
- In progress
- To claim
- Done

Actions:
- Start
- Block
- Unblock
- Fix with photo
- Reply or add a permitted note

### Ticket details
Show:
- Reference number and status
- Reporter details only when permitted
- Place, trade and category
- Description and attachments
- Owner and assignee
- Due date and SLA state
- Before/after photos
- Internal and reporter-visible notes
- Activity timeline
- A next-action panel containing only actions the current user may perform

### Triage Queue
Provide Decide, Open and All tabs, sorting by a configurable triage score, clear explanations for each score contribution, and bulk assignment with per-ticket authorization checks.

Default score:
- Severity: critical 100, high 60, medium 30, low 10.
- Priority: urgent 80, high 50, medium 20, low 5.
- Two points per day open, capped at 60.
- Reopened: 70.
- Disputed/Not Fixed: 90.
- Repeated place and category: 25.
- Unassigned: 15.
- Closed tickets: zero.

### All Jobs
Include filters for organization, trade, status and overdue state. Show open, late, waiting and completed-in-last-30-days counts. Provide authorized CSV export and assignment controls.

### Workload
Show open work per team and employee, scoped to the current user's permissions.

### Administration
Manage trades, teams, leads, team membership, places, complaint categories, handlers, routing settings, escalation settings and QR stickers.

## 10. Notifications and escalation

Generate notification events from the durable activity-log mechanism so that all supported write paths behave consistently.

Do not notify the actor who performed the action.

Notify:
- New routed ticket: owner or eligible team.
- Dangerous ticket: owner urgently, with in-app plus configured WhatsApp/SMS delivery.
- Assignment or claim: new assignee and appropriate triage oversight.
- Joined report: owner.
- Fixed or closed: reporter and all joiners.
- Not Fixed: owner without disclosing the reporter's identity; notify the college head on the second dispute.
- Thank-you rating: fixer.
- Late work: appropriate escalation recipients.
- New complaint: handler with response deadline.

Use an idempotent notification outbox or equivalent reliable delivery architecture. Record failures and retries. Support suppressing notifications during controlled bulk imports.

Dangerous-report paging must be capped at 20 messages per organization/college per day. If the cap cannot be read safely, do not send the external page, but still save the report and its in-app notification.

Create a daily scheduled job at the configured local time:
- One day late: owner's manager or configured department/estate manager.
- Three days late: college head or equivalent.
- Seven days late: include in the Director/organization-head morning digest.

Never count blocked time as overdue time.

Use existing scheduler infrastructure if available. Otherwise document and implement the repository-compatible scheduled-job integration; do not rely on an unprotected public endpoint.

## 11. QR stickers and duplicate reports

Generate random, unguessable tokens for asset/place URLs such as /r/<token>. Do not expose sequential asset IDs as access credentials.

Scanning a sticker should:
- Open the Broken form.
- Pre-fill the authorized place.
- Show the number of reports in the last 90 days when at least two exist.
- Offer to join an open report.
- Route to the caretaker first.
- Record when the sticker was printed.

For duplicate matching, use the same organization, place and 14-day window. Use deterministic safeguards and optional text similarity. Never automatically merge dangerous reports. Make the resulting join action auditable.

## 12. Optional AI-assisted form filling

Implement only after the core reporting flow is stable.

The employee types or speaks a sentence. AI proposes strict, validated JSON with:
- trade
- place
- urgency
- title
- description
- confidence
- one optional clarification question with answer options

Constraints:
- Use only configured trades and authorized places.
- Permit at most one clarification question.
- If the place remains unknown, set an appropriate fallback and needs_sorting=true.
- Never submit automatically; the employee must review and press Send.
- Never send photos to the AI.
- Cache matching requests from the same employee for ten minutes where safe.
- Enforce a database-backed limit of 15 AI requests per employee per hour.
- Validate AI output and treat it as untrusted input.
- Use the ERP's existing AI provider abstraction and secure server-side configuration.

## 13. Analytics

Implement permission-scoped metrics:
- Total, open, late, blocked, fixed, closed, reopened and disputed tickets.
- Resolution rate excluding cancelled, withdrawn and owner-confirmed closures from verified-fix reporting.
- Reopen rate.
- Median days to fix.
- Average resolution time.
- Weekly new versus fixed trend for 12 weeks.
- Late tickets by organization and place.
- Top 20 repeated place/trade pairs.
- Top five employees by completed and overdue work, with appropriate management permissions.
- Reporting source: form, QR or AI-assisted.
- Requirement totals and fulfilment rate when the fallback Requirement workflow is used.

Define metric formulas clearly and avoid counting duplicate join actions as new tickets.

## 14. UI and responsive behavior

Follow the existing ERP design system, typography, spacing, table styling, color tokens, shared status tones and responsive breakpoints.

The UI should feel like a native ERP module, not an embedded external app. Reuse the shared DataTable and child-grid patterns where applicable.

Provide:
- Clear empty states.
- Loading and error states.
- Accessible forms and keyboard navigation.
- Confirmation dialogs for destructive or irreversible actions.
- Status badges consistent with existing ERP conventions.
- Search, filtering and pagination.
- Useful mobile layouts for quick reporting and QR-based use.
- Clear success receipts and actionable error messages.

Do not introduce a competing visual theme or duplicate shared UI components.

## 15. Testing and completion criteria

Write tests for:
- Every ticket-state transition and invalid transition.
- Authorization and RLS boundaries.
- Cross-organization data isolation.
- Sensitive and anonymous complaints.
- Concurrent reference-number generation.
- Rate-limit enforcement under concurrent requests.
- SLA pause/resume calculations.
- Routing fallback and owner leave.
- Photo validation and metadata stripping.
- Duplicate joining and dangerous-report exclusion.
- Notification retries, idempotency and suppression.
- Escalation deadlines and recipient selection.
- Procurement integration and permission boundaries.
- Analytics formulas.

Run the existing test suite, relevant new tests, type checking, linting and production build where feasible. Perform browser-level tests for the main employee, worker and manager workflows if the repository's tooling supports them.

Do not claim tests passed unless they were actually run. Do not mark the module production-ready if critical security checks or migrations remain unverified.

## 16. Execution instructions

First return the repository assessment and phased file/migration plan.

Then implement Phase 1 and the first usable release of the Broken reporting workflow, following the existing repository conventions. Complete each logical stage with migrations, tests and a summary of files changed.

After each stage:
1. Report what was implemented.
2. List migrations and affected modules.
3. Report tests actually run and their results.
4. Identify unresolved risks or required configuration.
5. State the next stage.

Do not build every feature in one giant, untested change. Prioritize secure database foundations and one complete end-to-end reporting workflow before advanced automation and AI.