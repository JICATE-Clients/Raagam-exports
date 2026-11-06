-- ============================================================================
-- Raagam ERP — 0822 No HOD to ask → the request starts with the HR Manager
--
-- User 2026-11-06, logged in as HR on TEST HOD's own leave: "it should read
-- the HR Manager, right — why is it still in the Department HOD?"
--
-- 0807's HOD resolver falls back to the HR Manager when there is no HOD to
-- ask — the person IS their department's HOD, no HOD is named, or the HOD has
-- no login. That kept the request from being stranded, but it left it on the
-- "Department HOD" stage while the HR Manager held it: the header, the trail
-- and the list all said HOD, and the person it was waiting on was not one.
--
-- 1. hr_hod_login(context, requester) — the real HOD's login, or NULL. The
--    exact test the resolver makes before it falls back, written once.
-- 2. BEFORE INSERT on approval_runs, Time Off workflows only: a run whose
--    stage 1 is the HOD stage and has no real HOD starts at stage 2. The trail
--    then shows stage 1 as skipped, and the HR Manager as the one waiting.
-- 3. The requests already open in that state move to stage 2, with a note in
--    their history. Nothing is deleted; no decision is touched.
-- ============================================================================

create or replace function public.hr_hod_login(p_context jsonb, p_requester uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff  uuid := nullif(p_context ->> 'staff_id', '')::uuid;
  v_worker uuid := nullif(p_context ->> 'worker_id', '')::uuid;
  v_hod    uuid;
  v_user   uuid;
begin
  v_hod := public.hr_hod_of(v_staff, v_worker);
  if v_hod is null or v_hod is not distinct from v_staff then
    return null;
  end if;
  v_user := public.hr_staff_login(v_hod);
  if v_user is null or v_user is not distinct from p_requester then
    return null;
  end if;
  return v_user;
end $$;

create or replace function public.hr_approval_skip_empty_hod()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.workflow_key in ('timeoff_request', 'timeoff_encashment')
     and new.current_step = 1
     and jsonb_array_length(new.steps_snapshot) > 1
     and new.steps_snapshot -> 0 ->> 'approver_resolver' = 'hr_department_head'
     and public.hr_hod_login(new.context, new.requested_by) is null then
    new.current_step := 2;
  end if;
  return new;
end $$;

drop trigger if exists trg_approval_runs_hr_skip_empty_hod on public.approval_runs;
create trigger trg_approval_runs_hr_skip_empty_hod
  before insert on public.approval_runs
  for each row execute function public.hr_approval_skip_empty_hod();

-- The requests already waiting on a HOD stage with no HOD behind it.
do $$
declare
  r       record;
  v_moved int := 0;
begin
  for r in
    select ar.id, ar.requested_by
      from public.approval_runs ar
     where ar.workflow_key in ('timeoff_request', 'timeoff_encashment')
       and ar.status = 'in_progress'
       and ar.current_step = 1
       and jsonb_array_length(ar.steps_snapshot) > 1
       and ar.steps_snapshot -> 0 ->> 'approver_resolver' = 'hr_department_head'
       and public.hr_hod_login(ar.context, ar.requested_by) is null
       and not exists (select 1 from public.approval_run_events e
                        where e.run_id = ar.id and e.action not in ('submit'))
  loop
    update public.approval_runs
       set current_step = 2, lock_version = lock_version + 1
     where id = r.id;
    insert into public.approval_run_events (run_id, step_order, step_key, action, actor_id, comment, metadata)
    values (r.id, 1, 'hod', 'submit', r.requested_by,
            'No HOD to ask — moved to the HR Manager',
            jsonb_build_object('migration', '0816'));
    v_moved := v_moved + 1;
  end loop;
  raise notice '0816: % request(s) moved from the HOD stage to the HR Manager', v_moved;
end $$;

revoke all on function public.hr_hod_login(jsonb, uuid)     from public, anon, authenticated;
revoke all on function public.hr_approval_skip_empty_hod()  from public, anon, authenticated;
