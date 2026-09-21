# Plan — Order Entry ▸ T&A ▸ Work Flow (6 office milestones)

Source spec: `doc/order/orderentry workflow feature.md` (2026-09-21).
Status: **BUILT 2026-09-21** — migration **0607** applied to the live DB and verified
from the catalog. 0605 was abandoned because a parallel session applied 0606
mid-build, so 0605 may be held.

## Built — and where the build departed from this plan

| Piece | Where |
|---|---|
| Table, triggers, backfill, grants | `supabase/migrations/0607_order_work_flow.sql` |
| Milestone list, state, owner options | `lib/orders/work-flow/types.ts` |
| Load / edit actions | `lib/orders/work-flow/actions.ts` |
| Alert sweep + cron (hourly) | `lib/orders/work-flow/sweep.ts`, `app/api/cron/work-flow/route.ts`, `vercel.json` |
| UI: T&A ▸ **Work Flow** segment | `components/orders/ta/work-flow-panel.tsx`, `garment-order-screen.tsx` (`taView`) |
| Dashboard alert | `lib/dashboard/service.ts` `getAlerts` |
| Vectors (26, including the SQL-mirror guard, which was made to fail first) | `scripts/check-work-flow.mts`, `npm run check:work-flow` |

**Departures, decided while building:**

1. **Own table `order_work_flow_milestones`, keyed by `sales_order_id` (the RE),
   instead of rows on the ladder table.** Read closely, the ladder is saved by
   delete-and-reinsert from the screen's `taRows`, so database-stamped rows would
   have had to be threaded through that 23k-line save. A trigger stamp landing
   mid-save would also have been lost. Keeping them separate means the order's
   Save never touches them. §1's "no new table" and Phase 1's
   `ta_activities.system_code` / `schedule_basis` / six seeded activities are
   therefore **not** built. Phase 3 (ladder changes) was not needed at all.
2. **The panel saves its own rows** (Owner on pick, Days / Remarks on leaving the
   box), as the TA Followup tab does. It is editable from any document of the RE
   (§3 decision 8's "read-only on amendments" was dropped: the row is the RE's,
   so editing it from either document is the same edit).
3. **Status and actual date cannot be typed.** This is enforced by column grants:
   `authenticated` may UPDATE only `days`, `owner_id` and `remarks`.
4. **Backfill left `actual_date` NULL where the module kept no timestamp** (the
   BOMs), and marked rows that were already overdue as notified, so the first
   sweep does not flood people about old orders.
5. The worklist was not touched: it is being retired, and these rows are not in
   its table.

**Not verified in a browser.** The app needs a login. Unrun: QA-WP-04 (the owner
dropdown), Tab order in the new segment, and the live cron (needs `CRON_SECRET`
plus linked logins; see Phase 7).

---

## 0. Verdict in one paragraph

The spec's *intent* is right and small: six office milestones per order, dated
forward from the Order Received Date, each with an owner, going red when late.
The spec's *implementation* (a new `order_ta_work_plans` table, a stored
`OVERDUE` status, `/api/v1` REST routes, `staff_users`, `orders`) is generic
boilerplate that doesn't match this repo. Its `[871–875, 1346–1350]` citations
point at nothing (`doc/file.md` is 157 lines long). **Build it as a third
segment of the existing T&A tab, on the existing T&A row table**, because
almost everything the spec asks for already exists there for the production
ladder: the owner column, the worklist with "My Tasks", overdue buckets,
escalation, delay reasons, the KPI, the dashboard widget, and a save path that
cannot overwrite a completion.

---

## 1. Spec → repo translation

| Spec says | This repo has | Decision |
|---|---|---|
| `orders(id)` | `garment_order_amendments`. **One RE No can hold several documents**: an amendment is another row on the same `sales_order_id` (0517), and "current" means latest by `created_at` | the six rows live on the RE's **original** document; triggers resolve any document of the RE to it (decision 8) |
| `staff_users` / "HR Staff Master" | `employees` (0243); designation/department → `config_lookups` | use it |
| `order_received_date` | `garment_order_amendments.received_date` — **optional** on Order Info (client 09-09); 5 of 13 live orders have it blank | Day 0 = `received_date ?? amend_date`, and the panel says which one it used |
| new table `order_ta_work_plans` | `garment_order_amendment_ta_activities` already has `target_date`, `actual_date`, `status`, `assigned_staff_id`, `delay_attribution`, `notes` | **no new table** — 6 new `ta_activities` of Type **Work Flow** (0266 already seeded that type; the legacy T&A panel grouped by it) |
| enum `PENDING/IN_PROGRESS/COMPLETED/OVERDUE`, stored | stored `pending / in_progress / done`; overdue is **derived** at read time (worklist `daysLate`, approvals `is_overdue`) | keep 3 stored states; OVERDUE is computed. A stored "overdue" goes stale the moment the clock moves with nobody writing the row |
| `GET/PATCH /api/v1/orders/:id/ta-work-plans` | server components + server actions; no REST layer anywhere | server actions |
| `task_owner_id → staff_users` | `assigned_staff_id → employees` (0547) | reuse the column |
| "Red Alert Card on owner's dashboard" | `/orders/ta-worklist` (My Tasks) + "My Daily T&A Tasks" dashboard widget + `notifications` + web push (`lib/notifications/notify.ts`) | reuse, add one sweep |
| "push notification to MD" (Budgeting) · "absolute edit lock" (Approval) | **already built** — approval engine 0500–0505, SLA 0601–0603, lock 0576/0577 | no work, only the milestone observes them |
| red `animate-pulse` badge | the app's status-pill tones (`lib/ui/tone.ts`) | danger tone, no animation |

---

## 2. The six milestones and where "done" comes from

The milestones **observe** existing modules. Nobody types an Actual Date. A
database trigger stamps it when the module is finalised, so the milestone
cannot say "done" while the BOM is still a draft.

| SN | Code | Days | In progress when | Done when (stamps `actual_date` = IST today) |
|:-:|---|:-:|---|---|
| 1 | `ORDER_ENTRY` | 1 | order row exists as a draft (`is_draft = true`) | first save with `is_draft = false` on `garment_order_amendments` |
| 2 | `CAD_COMPLETION` | 2 | an `order_cad_markers` row exists (`status='draft'`) | `order_cad_markers.status → 'submitted'` (`submitted_at`) |
| 3 | `MATERIAL_BOM` | 3 | `material_bom_amendments` row exists, `is_draft` | `is_draft → false` (same test as `bomStatusOf` "updated") |
| 4 | `FABRIC_BOM` | 3 | `order_fabric_boms` row exists, `is_draft` | `is_draft → false` |
| 5 | `BUDGETING` | 4 | budget linked to the order (`order_budget_orders`), `status='draft'` | `order_budgets.status → 'submitted'` |
| 6 | `BUDGET_APPROVAL` | 4 | budget `submitted` | `order_budgets.status → 'approved'` (`decided_at`) |

The prerequisites in the spec (CAD before Fabric BOM, both BOMs before
Budgeting) are **already enforced** by those modules: the Fabric BOM seed
refuses without a submitted CAD sheet, and `bomRefusalOf` / `refuseUnreadyOrders`
refuse a budget without both BOMs. Work Flow adds no gates of its own.

---

## 3. Decisions (you may change any of these)

1. **Working days, Sunday off.** The spec says "+N days" and its worked example
   (12-10-2026 is a Monday, targets 13 → 16) crosses no Sunday, so it reads the
   same either way. The rest of T&A already counts working days
   (`lib/ta/schedule.ts`), and a Day-1 target that lands on a Sunday cannot be
   met. So this uses `addWorkingDays` from the same file. Holidays are not passed,
   for the same "both halves or neither" reason `taActivityRows` gives.
2. **The completion date is history.** If a BOM is later reopened as a draft,
   the milestone keeps its first completion date and does not go back to
   "pending". A reopened BOM is an amendment, not a missed deadline. The BOM
   queue already shows "recalculate" for that case.
3. **No manual Actual Date on Work Flow rows.** The module is the evidence. A
   typed date could show "done" over a draft BOM. Only Days, Owner and Remarks
   are editable.
4. **The Budget Approval row sends no separate overdue alert.** Its owner is the
   MD. On 2026-09-20 you decided that nagging approvers produces rubber-stamping.
   The approval engine's SLA already escalates that step, so a second alert from
   Work Flow would undo that decision through a side door. The row still turns
   red on screen.
5. **Escalation after 2 calendar days (48 h, as the spec says).** The production
   worklist uses 3 days (`ESCALATE_AFTER_DAYS`). Office tasks are one-day tasks,
   so 2 is proportionate. It is stated as its own constant rather than changing
   the production one.
6. **Owner defaults.** ORDER_ENTRY defaults to the order's own Merchandiser
   (`merchandiser_id` is already an `employees` id since 0478). The other rows
   copy the owners from the most recent order, the same auto-populate rule as
   the 0547 ladder. The owner stays optional, like the rest of the tab since
   2026-08-31. An unowned row falls back to department scope in the worklist, as
   it already does.
7. **Existing orders get the six rows** (backfill in the migration). This is safe
   where injecting trim rows was not: Work Flow rows sit **off** the backward
   chain, so they cannot move any production date. The backfill sets
   status/actual from each module's current state and marks the source
   `backfill`, so a reconstructed date is never mistaken for a witnessed one.
8. **One Work Flow per RE No, not per document.** These are *pre-production*
   milestones for the order. Suppose an amendment document is raised before the
   Fabric BOM is finished and the BOM is then saved against the amendment. That
   still completes the order's milestone. So each trigger maps
   `garment_order_id → sales_order_id → the earliest document`, and the panel
   shows the same six rows on every document of the RE (read-only on
   amendments).
9. **The T&A feasibility warning keeps using `amend_date`.** Its comment
   (GOS ~20497) says moving it to `received_date` is a separate decision nobody
   has asked for. Only the new Work Flow uses Received Date, because the spec
   asks for exactly that.

---

## 4. Build phases

### Phase 1 — Migration `0605_ta_work_flow.sql`

- `ta_activities.system_code text unique` (nullable). Triggers match on it,
  never on `short_name`, because operators can rename a short name on the TA
  Activity master and that would silently break every trigger.
- `ta_activities.schedule_basis text not null default 'delivery' check in ('delivery','received')`.
  This is explicit rather than inferred from the Type lookup's *name*, which is
  editable text.
- Seed 6 activities: Type = Work Flow, `schedule_basis='received'`,
  `default_offset_days` = 1/2/3/3/4/4, `sequence` ahead of FABPLAN,
  `system_code` = the six codes. **Do not reuse FABPLAN / ACCBOM**: one live
  order already carries FABPLAN *on the backward chain*.
- `garment_order_amendment_ta_activities`: add `actual_source text check in ('auto','manual','backfill')`,
  `overdue_notified_at timestamptz` and `escalated_at timestamptz` (these make
  the sweep idempotent).
- `ta_work_flow_ensure(order_id)`: inserts any missing Work Flow rows, dated from
  Day 0. `ta_work_flow_mark(order_id, code, state)`: moves pending → in_progress
  → done and never moves backward (decision 2). Both SECURITY DEFINER and
  `revoke all … from public, anon` (see AGENTS.md "Function grants"). Both call
  `ensure` first, because the order-row trigger can fire before the save has
  written any T&A rows.
- AFTER triggers (the `trg_ob_sync_re_status` shape: `WHEN old.x IS DISTINCT FROM new.x`)
  on `garment_order_amendments`, `order_cad_markers`, `material_bom_amendments`,
  `order_fabric_boms`, `order_budgets` and `order_budget_orders`. The last one is
  needed because a budget is linked to its order in a second insert.
  - **Triggers, not calls in the server actions.** A budget is decided on two
    paths: the engine (`actOnRun` → `approval_apply_terminal`) and the direct
    `decideBudget`. CAD can also be un-submitted. A trigger on the column sees
    every path; an action call would see only the one it was written into.
  - A budget can cover several orders, so the budget trigger fans out through
    `order_budget_orders`, exactly as `sync_re_status_from_budget` (0576) does.
  - The locked-order trigger `refuse_when_order_locked` sits on the BOMs, not on
    the T&A table (the lock deliberately excludes T&A), so the stamp still
    lands on an approved order.
- Seed the *words* only: department `CAD`, `COSTING`; designation
  `MANAGING DIRECTOR`. No employee rows are invented (the 0482 precedent).
- Backfill (decision 7).
- Verify from the catalog, and run a rolled-back smoke test for each trigger.

### Phase 2 — Pure logic `lib/orders/ta/work-flow.ts` (client-safe)

- `WORK_FLOW_MILESTONES`: code, label, sn, default days, and owner filter
  (designation/department names).
- `workFlowDay0(received, amendDate) → { date, source: "received" | "order" }`.
- `workFlowDates(day0, rows, holidays?)`: forward, working days.
- `workFlowState(row, today) → "pending" | "in_progress" | "overdue" | "done" | "done_late"`,
  plus `daysLate` for display.
- `workFlowOwnerOptions(employees, code, current)`: shaped like
  `merchandiserOptions`, empty-and-explain, keeps the held owner.
- Vectors in `scripts/check-ta-work-flow.mts` and `npm run check:ta-work-flow`,
  including the spec's QA-WP-01/02/03 examples. Make them fail first.

### Phase 3 — Keep the ladder honest (both halves)

- `orderTaLadder`: Work Flow rows are removed from the chain (like 0561 side
  rows) and dated by `workFlowDates`, **before** the delivery-anchor refusal.
  An order with no delivery date must still have a dated Work Flow.
- `taActivityRows` (server) makes the same split. `taRowsToWrite` keeps saved
  Work Flow rows even when a payload omits them, because they cannot be deleted.
  Add vectors to `check:ta-merge`.
- **Known race:** a trigger that stamps between the save's read and its
  delete/reinsert would be lost. Mitigation: `taActivityRows` calls
  `ta_work_flow_ensure` + a re-mark pass after the reinsert (idempotent).

### Phase 4 — UI: third segment in the T&A tab

- `taSegNav` (`garment-order-screen.tsx` ~10067) gains **Work Flow** beside
  Activity | Approval, and `taView` widens its union (state at ~5079).
- **Every new hook goes ABOVE `if (mode === "list")` (~5142)** (AGENTS.md
  STANDING; five outages so far). Where possible, use a plain `const` instead of
  a `useMemo`.
- Put the panel in its own component, `components/orders/ta/work-flow-panel.tsx`,
  so the 23,000-line file only gains the segment switch.
- Columns: SN · Milestone · Days (editable) · Target · Actual (read-only, with an
  "auto" or "backfilled" hint) · Owner (`RecordPicker`) · Status pill · Remarks.
  The header line reads "Day 0: 12/10/2026 (Received Date)" or "… (Order Date —
  Received Date not entered)".
- Build it width-laid-out from the start: `FIELD_WIDTH_CSS` steps, a named
  `workFlowColumns`, `tableFrom="5xl"`, and it must appear as `ok` in
  `check:grid-budget`. Dates go through `fmtDate`. Keyboard: Tab visits Days,
  Owner and Remarks only.

### Phase 5 — Dashboard (not the worklist)

- **`/orders/ta-worklist` is being retired.** The client asked for T&A
  information *on the tab* instead (GOS ~5048). So no new features go there.
  Work Flow rows will still appear in it automatically, because it reads the
  same table. Check that this is harmless: a row whose activity maps to no
  department must land in `notes`, not vanish. Add `ta_department_assigns`
  lines for the six activities so they don't.
- **The dashboard's existing overdue alert reads the wrong table.**
  `getAlerts` (`lib/dashboard/service.ts` ~1103) still counts the old 0006
  `ta_milestones`, which Order Entry never writes. Add a "Pre-production
  overdue" alert reading escalated Work Flow rows by RE No. Leave the old count
  alone; retiring it is its own decision.

### Phase 6 — Alerts (sweep)

- Extend the existing tick. Either add `sweepWorkFlow()` to
  `/api/cron/approval-sla`, or add a sibling route plus a `vercel.json` entry.
  The sibling is cleaner; either works because the `CRON_SECRET` gate is shared.
- Rows not done where `target < today` and `overdue_notified_at` is null notify
  the owner through `notify()` (in-app + push). Rows 2+ calendar days late where
  `escalated_at` is null notify holders of `Managing Director`. BUDGET_APPROVAL
  is skipped (decision 4).
- **Recipient resolution is the weak link.** Employee → login is only
  `profiles.employee_code = employees.code`, and **0 of 2 profiles are linked
  today**. So an unlinked owner falls back to the order's merchandiser's login,
  and the sweep reports the unlinked count instead of silently notifying nobody.

### Phase 7 — Data setup (a person, not a migration)

1. Create or tag employees: CAD team (department CAD), costing (COSTING), MD.
2. Set `profiles.employee_code` for each staff login, or no alert reaches anyone.
3. Confirm `CRON_SECRET` is set in Vercel (already required by 0601).

---

## 5. Verification

- `npm run check:ta-work-flow`, `check:ta-merge`, `check:ta-schedule`,
  `check:hooks`, `check:grid-budget`; `tsc --noEmit` + eslint on touched paths.
  A full `npm run build` is only meaningful when no parallel session is
  mid-edit (see memory `raagam-shared-working-tree`).
- SQL smoke test, rolled back: create order → ORDER_ENTRY done; CAD draft →
  in_progress; submit → done; Fabric BOM `is_draft` flip → done; budget
  submit / approve → rows 5 and 6; reopen BOM → stays done.
- Browser (unrun until someone logs in): the QA-WP-01…04 table from the spec,
  plus: Tab order in the new segment, the Day-0 fallback line, and the owner
  empty-hint when nobody is tagged.

## 6. Open with the client (not blocking)

- Is "Order Entry — Day 1" measured from Received Date even when the order is
  keyed on the same day? (It then reads done-early, which is fine.)
- Should an order **amendment** restart any milestone, e.g. re-open Fabric BOM?
  Today, by decision 2, it does not.
