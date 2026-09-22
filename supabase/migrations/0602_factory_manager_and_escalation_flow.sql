-- ============================================================================
-- Raagam ERP — 0602 The escalation matrix's Level 1: the Factory Manager role,
-- and the two-step flow that uses it
--
-- `doc/order/newfeature.md` §3 and §4. 0601 built the clock and the sweeper;
-- this is the POLICY they act on, and the role that policy names.
--
--
-- 1. ONE NEW ROLE, NOT FIVE — THE OTHER FOUR ALREADY EXIST
--
-- §4 lists "Merchandiser, CAD Operator, Factory Manager, MD / Approver, and
-- Admin". Read against `public.roles` rather than against the sentence, four of
-- the five are already there and have been for months:
--
--   Merchandiser       0002, 2026-06-30
--   Managing Director  0002, 2026-06-30   (§4's "MD / Approver")
--   Administrator      0002, 2026-06-30   (§4's "Admin")
--   CAD Technician     0460, 2026-08-23   (§4's "CAD Operator" — same job,
--                                          the name the CAD module already
--                                          uses, with its own description
--                                          "Marker layouts and component gram
--                                          weights")
--
-- CREATING A SECOND ROLE CALLED "CAD OPERATOR" WOULD BE THE BUG, not the
-- delivery. Role names are the approval engine's `approver_role_key` — a flow
-- routes by NAME through `approval_rbac_users_with_role` — so two names for one
-- job is two half-populated roles, and a flow pointed at the empty one strands
-- every request it routes. The spec is describing the shape of the business,
-- not naming rows.
--
-- So the remainder is `Factory Manager`, which genuinely does not exist. It is
-- §3's Level 1: the person who sees a budget before the MD does.
--
--
-- 2. WHAT THE ROLE MAY DO
--
-- `orders:approve` is the whole point — without it a Factory Manager cannot act
-- on a budget even when a flow routes one to them, because `actOnRun` gates on
-- `approvals:approve` and the budget's own screen on `orders:approve`. The rest
-- is the reading a person needs in order to approve responsibly: the order, its
-- BOMs, and what the floor is already doing.
--
-- NOT `orders:delete`, and not `masters:edit`. Approving is not editing.
--
--
-- 3. THE SLA GOES ON THE FLOW THAT IS LIVE TODAY, AS A REMINDER
--
-- The active flow is single-step (Managing Director) and 0600 gave it a named
-- approver and self-approval. It gets `sla_minutes: 120, on_sla_breach: notify`
-- — the top of §3's "30–120 mins" band — so the reminder half starts working on
-- the day this ships, with no change to WHO approves anything.
--
-- Written with `jsonb_set` on the step object rather than by replacing `steps`.
-- Replacing it would have overwritten 0600's `approver_user_ids` and
-- `allow_self_approve` — the exact loss that migration's own screen-side fix
-- (`StepRow.rest`) was written to prevent. A migration is not exempt from it.
--
--
-- 4. THE TWO-STEP FLOW IS SEEDED INACTIVE, AND THAT IS THE SAFE ORDER
--
-- `approval_start_run` asserts step 1 has at least one approver and RAISES
-- otherwise — deliberately, because a run created into nobody's queue is the
-- stranded document the engine exists to prevent. Nobody holds Factory Manager
-- yet. So an ACTIVE two-step flow at a winning priority would make every budget
-- submit fail, today, with a message about approver resolution.
--
-- Seeded inactive, it is inert: `approval_resolve_flow` filters on `is_active`,
-- so the MD flow keeps resolving exactly as it does now. Switching it on is one
-- toggle on Approvals ▸ Flows once somebody holds the role — and that screen
-- shows "nobody holds this" in red beside the step, which is the warning this
-- ordering exists to put in front of the right person.
--
-- PRIORITY 800 against the default's 900: lower wins, so activating it is all
-- that is needed. Priority is the ONE ordering (0501) — there is no second
-- specificity ladder to also get right.
-- ============================================================================


-- ─── 1. The role ────────────────────────────────────────────────────────────

insert into public.roles (name, description, is_system) values
  ('Factory Manager',
   'Reviews order budgets before the MD; escalates on timeout',
   false)
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on (
       (p.module = 'orders'      and p.action in ('view','approve'))
    or (p.module = 'planning'    and p.action = 'view')
    or (p.module = 'production'  and p.action = 'view')
    or (p.module = 'approvals'   and p.action = 'approve')
    or (p.module in ('dashboard','masters','reports') and p.action = 'view')
)
where r.name = 'Factory Manager'
on conflict do nothing;


-- ─── 2. A reminder on the flow that is live ─────────────────────────────────
-- Only the flows that declare NO SLA today, so re-running this never overwrites
-- a number an admin has since chosen on the Flows screen.
update public.approval_flows f
   set steps = jsonb_set(
         jsonb_set(f.steps, '{0,sla_minutes}',  to_jsonb(120), true),
         '{0,on_sla_breach}', to_jsonb('notify'::text), true)
 where f.workflow_key = 'order_budget'
   and f.is_active
   and jsonb_array_length(f.steps) = 1
   and not (f.steps -> 0 ? 'sla_minutes');


-- ─── 3. The escalating chain, switched off ──────────────────────────────────
insert into public.approval_flows
  (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select
  'order_budget',
  'Order Budget — Factory Manager, escalating to MD',
  'Level 1 reviews within 2 hours; if untouched it escalates to the Managing '
  || 'Director automatically. Switch this on once somebody holds the Factory '
  || 'Manager role — until then it is inert and the single-step MD flow applies.',
  '{}'::jsonb,
  jsonb_build_array(
    jsonb_build_object(
      'step_order',        1,
      'step_key',          'factory_manager_review',
      'step_label',        'Factory Manager',
      'step_type',         'review',
      'approver_role_key', 'Factory Manager',
      -- 120 MINUTES IS THE TOP OF THE CLIENT'S BAND, not a guess: §3 says
      -- "Configurable (e.g. 30–120 mins)", and the generous end is the right
      -- default for a step that escalates — a deadline too short escalates work
      -- nobody neglected, and teaches people to ignore the escalation.
      'sla_minutes',       120,
      'on_sla_breach',     'escalate'),
    jsonb_build_object(
      'step_order',        2,
      'step_key',          'md_final',
      'step_label',        'Managing Director',
      'step_type',         'final',
      'approver_role_key', 'Managing Director',
      -- NO SLA ON THE LAST STEP. `approval_validate_steps` (0601) refuses
      -- 'escalate' here — there is nothing above it — and a reminder to the MD
      -- about a budget that reached them BY escalation is the second message
      -- they would get about the same document. Level 2 is the end of the line.
      'on_sla_breach',     'none')),
  800,
  false
where not exists (
  select 1 from public.approval_flows
   where workflow_key = 'order_budget'
     and flow_name = 'Order Budget — Factory Manager, escalating to MD'
);
