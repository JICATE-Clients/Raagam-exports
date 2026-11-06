-- ============================================================================
-- Raagam ERP — 0819 Requests still waiting on the old one-step flow move to
-- the three stages (Department HOD → HR Manager → ED)
--
-- User 2026-11-05, on a pending leave showing "Stage 1 of 1 — MD / HR
-- Manager": "I said 3 stage flow, I want to see the whole flow".
--
-- The engine freezes a flow's steps onto the run when the request is applied
-- (`steps_snapshot`), so 0817 changed only requests applied after it. This
-- moves the ones still OPEN and NOT YET ACTED ON — a run that has a decision
-- on it already is history and is left alone.
--
-- For each such run:
--   * steps_snapshot ← the current default flow's steps (0807's three);
--   * flow_id        ← that flow;
--   * context        ← + staff_id / worker_id from the request, which the HOD
--                       step needs to find the department (0817 adds them at
--                       apply time; these runs predate it);
--   * current_step stays 1, and the run's history gets a note saying so.
--
-- Step 1 always resolves to somebody (no HOD → HR Manager → MD, 0817), so no
-- moved run can land in nobody's queue. Nothing is deleted.
-- ============================================================================

do $$
declare
  v_flow  public.approval_flows;
  v_run   record;
  v_moved int := 0;
begin
  for v_run in
    select r.id, r.workflow_key, r.subject_table, r.subject_id, r.context
      from public.approval_runs r
     where r.workflow_key in ('timeoff_request', 'timeoff_encashment')
       and r.status = 'in_progress'
       and r.current_step = 1
       and jsonb_array_length(r.steps_snapshot) = 1
       and not exists (select 1 from public.approval_run_events e
                        where e.run_id = r.id and e.action <> 'submit')
  loop
    select * into v_flow from public.approval_flows
     where workflow_key = v_run.workflow_key and is_active
       and criteria = '{}'::jsonb and priority = 900
     limit 1;
    continue when v_flow.id is null or jsonb_array_length(v_flow.steps) <> 3;

    update public.approval_runs r
       set steps_snapshot = v_flow.steps,
           flow_id        = v_flow.id,
           context        = r.context || coalesce((
             select jsonb_build_object('staff_id', d.staff_id, 'worker_id', d.worker_id)
               from (select t.staff_id, t.worker_id from public.timeoff_requests t
                      where v_run.subject_table = 'timeoff_requests' and t.id = v_run.subject_id
                     union all
                     select x.staff_id, x.worker_id from public.timeoff_encashments x
                      where v_run.subject_table = 'timeoff_encashments' and x.id = v_run.subject_id) d
              limit 1), '{}'::jsonb),
           lock_version   = r.lock_version + 1
     where r.id = v_run.id;

    insert into public.approval_run_events (run_id, step_order, step_key, action, actor_id, comment, metadata)
    select v_run.id, 1, 'hod', 'submit', r.requested_by,
           'Moved to the three-stage flow (Department HOD → HR Manager → ED)',
           jsonb_build_object('flow_id', v_flow.id, 'flow_name', v_flow.flow_name, 'migration', '0809')
      from public.approval_runs r where r.id = v_run.id;

    v_moved := v_moved + 1;
  end loop;
  raise notice '0809: % open request(s) moved to the three-stage flow', v_moved;
end $$;
