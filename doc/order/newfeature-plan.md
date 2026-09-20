# newfeature.md — implementation plan

Source: `doc/order/newfeature.md` (client audio `record-1789900034494.wav`).

## What was ALREADY built, and is not re-built here

The spec reads as four new features. Three of them are mostly standing already, so
this plan is the REMAINDER and nothing else. Re-stating a built rule as a task is
how a module gets written twice.

| Spec § | Standing today | Remainder this plan builds |
|---|---|---|
| 1 CAD hand-off | `lib/orders/cad/*` (0460): sheet per order, marker per layout, gram weight per panel, marker PDF upload, `seedFabricBomFromCad` pushing weights into the Fabric BOM, a CAD queue screen with `pending / draft / measuring / submitted` | the two NOTIFICATIONS (order → CAD, CAD submit → merchandiser). Acknowledge: already the Pending → Draft step, see Phase 5 |
| 2 PWA mobile | Serwist PWA + install prompt, `notifications-bell.tsx` with an unread badge, web push (`lib/notifications/notify.ts`), Approve / Return / Reject with mandatory comment (`approval-action-bar.tsx`) | an executive view sized for a phone: the budget's own KPIs on the card, then decide |
| 3 SLA escalation | `sla_hours` + `on_sla_breach` declared in `lib/approvals/types.ts` — **and read by nothing** | the whole Tier‑2B unit |
| 4 RBAC + locks | 0576/0577 lock 47 tables per RE No; the Amendment Protocol reopens; `orders:approve` gates the decision | the ONE role the matrix names that does not exist — `Factory Manager` (the other four do, incl. `CAD Technician`) |

**§3 is the only section that is genuinely absent**, and the state it is in is the
one the `dynamic-approval-flow` skill calls out by name: *"SLA columns and the SLA
sweeper ship together or not at all. A column no code reads is worse than a missing
one: it lies to the admin who set it."* An admin can type an SLA into a flow today
and nothing will ever read it.

---

## Phase 1 — the clock (§3) · `0601_approval_sla_escalation.sql`

**Numbered 0601, not 0600.** A parallel session took `0600` the same day for
`approval_super_admin_role_holders`, which rewrites
`approval_rbac_users_with_role` so a super admin who HOLDS a role resolves as an
approver. This work depends on it: without it the escalation step resolves to
nobody and the sweeper declines every escalation — correctly, and invisibly.

Tier 2B of the skill, adapted in exactly two places, both recorded in the migration:

1. **`sla_minutes`, not `sla_hours`.** The client's matrix is "30–120 mins". Hours
   with a fraction (`0.5`) would be the same number wearing the wrong unit, and the
   admin field would then have to convert — two vocabularies for one declaration.
   `lib/approvals/types.ts` loses `sla_hours` in the same change, so the dead field
   cannot be set by anyone.
2. **The sweeper returns the run ids it touched.** The shipped one returns counts.
   Web push is a Node concern (`web-push` + VAPID), so the notification cannot be
   sent from SQL — the ids are what let the TypeScript half tell the right people.

Also here:

- `approval_validate_steps()` gains two rules, so a mis-set SLA fails at the flow
  rather than becoming dead data: `sla_minutes` must be a positive number, and
  `on_sla_breach = 'escalate'` is REFUSED on the last step — escalating into a void
  is the stranding bug wearing a different hat.
- `approval_my_queue` is recreated carrying `sla_due_at` / `sla_breached_at`, so the
  inbox can say "overdue" from the same read that builds it.

## Phase 2 — the tick (§3)

No `pg_cron` on this project (checked against `pg_extension`). Chosen: **Vercel cron
plus a lazy sweep**, belt and braces.

- `lib/approvals/sla.ts` — `sweepSla()`: call the RPC under the service role, then
  notify per run. Escalated runs notify the NEW step's approvers through
  `notifyCurrentApprovers` (the engine's own resolver — never a second answer to
  "who approves this"). Notify-only breaches raise a reminder.
- `app/api/cron/approval-sla/route.ts` — bearer `CRON_SECRET`.
- `vercel.json` — `*/5 * * * *`.
- The `/approvals` page sweeps opportunistically on load, throttled, so a
  misconfigured cron degrades to "escalates when someone opens the app" rather than
  to nothing.

## Phase 3 — the admin half (§3)

`sla_minutes` and `on_breach` as two columns on the flow builder's Steps grid
(vocabulary widths, `tableFrom="5xl"`), and `sla_breach` rendered in the timeline so
a breach is visible in the trail rather than only in the log.

## Phase 4 — the roles (§4) · `0602_factory_manager_and_escalation_flow.sql`

**ONE new role, not the two this plan first said.** Read against `public.roles`
rather than against the spec's sentence, four of §4's five already exist —
Merchandiser, Managing Director ("MD / Approver"), Administrator ("Admin") and
**`CAD Technician`** (0460, "Marker layouts and component gram weights"), which
is §4's "CAD Operator" under the name the CAD module already routes by. Creating
a second role for the spec's wording would split the CAD room in half and point
every notification at the empty side — a role name IS the engine's
`approver_role_key`. So the remainder is `Factory Manager`, seeded with its
grants, plus:

- a 120-minute **notify-only** SLA on the existing single-step MD flows, so reminders
  start working the day this ships;
- the two-step **Factory Manager → MD** escalating flow, seeded `is_active = false`.
  A step whose role has no holders makes `approval_start_run` RAISE, which would fail
  every budget submit. The client activates it on Approvals ▸ Flows once somebody
  holds the role — and that screen already warns "nobody holds this" in red.

## Phase 5 — the CAD hand-off (§1) · no migration

- `lib/orders/cad/notify.ts` — two functions, both fire-and-forget like `writeAudit`.
- `createAmendment` raises the CAD alert **only where a new RE No was minted**;
  an amendment on an existing RE is not a new order and must not re-queue it.
- Submitting the sheet raises the merchandiser's, **on the transition** — a
  submitted sheet saved again does not re-alert.
- Neither can fail the write that triggered it.

**NO `acknowledged_at` COLUMN, and that is a decision rather than an omission.**
§1 asks CAD to "acknowledge the request". `cadQueueStatus` (0460) already
distinguishes **Pending** — no sheet exists, nobody has touched it — from
**Draft**, which is what opening a sheet for the order produces. Creating the
sheet IS the acknowledgement, and it is already visible on the queue to
everybody. A second flag beside it would be a star with nothing behind it: two
fields meaning "CAD has seen this", able to disagree. Raise it with the client if
they want an acknowledgement that is distinct from starting work.

## Phase 6 — the phone (§2)

`/approvals` keeps its table on desktop and renders CARDS below `md`, each carrying
the budget's submitted KPIs (Order Qty · Gross Sales · Total Expenses · Profit % ·
Profit value) and opening a decide sheet.

**The inbox's own rule is kept, not waived.** Its header says there is no approve
button because "an approval nobody read is worse than no approval step at all". The
card shows the FIGURES and only then offers the actions, which is the thing that rule
protects — not a bulk-approve list.

---

## Follow-up — the escalation notification policy (user, 2026-09-20)

Reviewed and decided. **Default OFF** for telling the approver who missed the SLA,
in the user's own reasoning: *"If managers feel penalized or nagged by SLA breach
notifications, they tend to blindly hit Approve just to clear the notification
clock — defeating the purpose of budget oversight."* The requester is always
told; the escalation unblocks the factory; the Level 1 queue updates itself so
nobody acts on a stale item.

Made configurable as `notify_missed_approver` (`0603`), and **on the STEP, not as
an app setting** — a run freezes its steps, so a policy declared there travels
with the request. A global switch read at sweep time would change the rules under
every request already in flight, which is the failure `steps_snapshot` exists to
prevent; and "strict SLA visibility for your team" is itself a per-team phrase, so
per step is also the finer answer. "Globally on" is just "ticked on the steps you
mean", and the Flows screen shows which.

**No separate PWA settings screen for it**, deliberately. A second place to set
the same fact is the "two vocabularies for one declaration" this work already
refused once (`sla_hours` vs `sla_minutes`). If the client wants it presented as
one company-wide switch later, the right build is a control that writes the step
flag across the flows — not a second source of truth beside it.
