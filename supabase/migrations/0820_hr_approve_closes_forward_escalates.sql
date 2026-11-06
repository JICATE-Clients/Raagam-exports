-- ============================================================================
-- Raagam ERP — 0820 HR requests: whoever has it decides; "send up" escalates
--
-- User 2026-11-06, on a leave reading "1 of 3 approved · now HR Manager":
--   "I don't want it like that. The flow is 3, but in those 3 anyone can
--    approve — once the HOD itself approved, the flow will be closed. But if
--    the HOD thinks it needs HR Manager attention he will send it to HR, and
--    if it's OK HR will approve. Same goes for the ED."
--
-- So the three stages (0817) are an ESCALATION ladder, not three signatures:
--
--   Department HOD ── Approve → APPROVED (closed)
--        │           Reject  → REJECTED (closed)
--        └─ Send to HR Manager
--               HR Manager ── Approve → APPROVED · Reject → REJECTED
--                    └─ Send to ED
--                           ED ── Approve → APPROVED · Reject → REJECTED
--
-- 1. A new event action, 'forward' — "sent to the next stage". It is NOT an
--    approval and must never read as one in the trail.
-- 2. hr_approval_forward(run, comment) — the only way up a stage: the caller
--    must be on the current step (approval_can_act), there must be a next
--    stage, and it must resolve to somebody (else refused, never stranded).
-- 3. trg_approval_runs_hr_approve_closes — BEFORE UPDATE on approval_runs, for
--    the two Time Off workflows only: when an APPROVE would move the run to
--    the next step, it closes the run as completed instead. A trigger, not a
--    change to approval_act (0502), so every way an approver approves — the
--    Time Off screens, My Approvals, a notification — behaves the same, and
--    the engine's core is untouched. It acts only when an 'approve' event
--    was written at that stage in the same transaction, so a forward (its own
--    'forward' event) or any other step move is left alone.
--    approval_apply_terminal (0505) then approves the leave exactly as at the
--    last step — through a second trigger, because 0505's is OF status and
--    does not fire for a status set by another trigger (see below).
--
-- Nothing is deleted; existing runs keep their history. A request already
-- past stage 1 (LV-0003, approved by its HOD under 0807's rule) simply sits
-- at its current stage, where its approver can now approve it closed.
-- ============================================================================

-- ─── 1. 'forward' ───────────────────────────────────────────────────────────

alter table public.approval_run_events drop constraint if exists approval_run_events_action_check;
alter table public.approval_run_events add constraint approval_run_events_action_check
  check (action in ('submit', 'approve', 'reject', 'return', 'cancel', 'delegate', 'sla_breach', 'forward'));

-- ─── 2. Send to the next stage ──────────────────────────────────────────────

create or replace function public.hr_approval_forward(p_run_id uuid, p_comment text default null)
returns public.approval_runs
language plpgsql security definer set search_path = public as $$
declare
  v_run     public.approval_runs;
  v_verdict jsonb;
  v_next    jsonb;
  v_count   int;
begin
  select * into v_run from public.approval_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'This request has no approval to send on — reload' using errcode = '42704';
  end if;
  if v_run.workflow_key not in ('timeoff_request', 'timeoff_encashment') then
    raise exception 'Only an HR request can be sent to the next stage' using errcode = '22023';
  end if;
  if v_run.status <> 'in_progress' then
    raise exception 'This request is already %', v_run.status using errcode = '55000';
  end if;

  v_verdict := public.approval_can_act(p_run_id, auth.uid());
  if not coalesce((v_verdict ->> 'can_act')::bool, false) then
    raise exception 'This is waiting on someone else, not you' using errcode = '42501';
  end if;

  v_next := v_run.steps_snapshot -> v_run.current_step;   -- 0-based → the next stage
  if v_next is null then
    raise exception 'This is the last stage — approve or reject it' using errcode = '22023';
  end if;
  select count(*) into v_count
    from public.approval_step_approvers(v_next, v_run.requested_by, v_run.scope, v_run.context);
  if v_count = 0 then
    raise exception 'Nobody can take the % stage yet — assign that role first', v_next ->> 'step_label'
      using errcode = '23514';
  end if;

  insert into public.approval_run_events (run_id, step_order, step_key, action, actor_id, is_override, comment, metadata)
  values (v_run.id, v_run.current_step, public.approval_current_step(v_run) ->> 'step_key', 'forward', auth.uid(),
          coalesce((v_verdict ->> 'is_override')::bool, false), nullif(btrim(coalesce(p_comment, '')), ''),
          jsonb_build_object('to_step', v_run.current_step + 1, 'to_label', v_next ->> 'step_label'));

  update public.approval_runs
     set current_step = current_step + 1, lock_version = lock_version + 1
   where id = v_run.id
  returning * into v_run;
  return v_run;
end $$;

-- ─── 3. Approve closes ──────────────────────────────────────────────────────

create or replace function public.hr_approval_approve_closes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.workflow_key in ('timeoff_request', 'timeoff_encashment')
     and old.status = 'in_progress' and new.status = 'in_progress'
     and new.current_step = old.current_step + 1
     -- An APPROVE recorded at this stage in this same transaction (approval_act
     -- writes its event before it moves the step). A forward writes forward,
     -- and anything else that advances a step (an SLA escalation) writes
     -- neither, so only a real approval is turned into the close.
     and exists (select 1 from public.approval_run_events e
                  where e.run_id = old.id and e.step_order = old.current_step
                    and e.action = 'approve' and e.created_at = now()) then
    new.current_step   := old.current_step;
    new.status         := 'completed';
    new.completed_at   := now();
    new.final_actor_id := auth.uid();
    -- Name the run for the AFTER trigger below (transaction-local).
    perform set_config('raagam.hr_closed_run', new.id::text, true);
  end if;
  return new;
end $$;

drop trigger if exists trg_approval_runs_hr_approve_closes on public.approval_runs;
create trigger trg_approval_runs_hr_approve_closes
  before update on public.approval_runs
  for each row execute function public.hr_approval_approve_closes();

-- AND THE REQUEST ITSELF IS APPROVED. trg_approval_apply_terminal (0505) is
-- `AFTER UPDATE OF status`, and Postgres fires an OF-column trigger only when
-- the STATEMENT names the column — approval_act's step-advance names
-- current_step, so a status set by the trigger above would close the run and
-- leave the leave pending, the balance untouched. This fires the same
-- function for exactly the run that trigger closed, and never otherwise (a
-- statement that sets status itself already fired the original).
drop trigger if exists trg_approval_runs_hr_apply_closed on public.approval_runs;
create trigger trg_approval_runs_hr_apply_closed
  after update on public.approval_runs
  for each row
  when (old.status = 'in_progress' and new.status = 'completed'
        and current_setting('raagam.hr_closed_run', true) = new.id::text)
  execute function public.approval_apply_terminal();

-- Each stage in words, for Admin ▸ Approval Flows.
update public.approval_flows
   set description = case workflow_key
         when 'timeoff_request' then 'Every leave, permission, on duty and comp-off booking goes to the department HOD, who approves or rejects it — or sends it to the HR Manager, who may send it on to the ED. Whoever approves closes it.'
         else 'Every leave encashment goes to the department HOD, who approves or rejects it — or sends it to the HR Manager, who may send it on to the ED. Whoever approves closes it.'
       end
 where workflow_key in ('timeoff_request', 'timeoff_encashment')
   and criteria = '{}'::jsonb and priority = 900;

revoke all on function public.hr_approval_forward(uuid, text)  from public, anon;
revoke all on function public.hr_approval_approve_closes()     from public, anon, authenticated;
grant execute on function public.hr_approval_forward(uuid, text) to authenticated;
