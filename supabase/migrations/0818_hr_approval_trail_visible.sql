-- ============================================================================
-- Raagam ERP — 0818 Whoever can see an HR request can see its approval trail
--
-- User 2026-11-05: "if someone applied for a leave, if I click it, it should
-- show all the details and the flow".
--
-- The request's sheet already draws the HOD → HR Manager → ED trail, but the
-- run behind it is read under `approval_runs_read` (0501): the requester, the
-- approvers of the CURRENT step, or `approvals:view`. So the trail vanished
-- for everyone else — the HOD the moment they approved (the step moved on),
-- and HR for any request not on their step. The request was on screen; how
-- it got there was not.
--
-- 1. One more SELECT policy on approval_runs, for the two Time Off subjects
--    only: visible when the request itself is. `exists (select … from
--    timeoff_requests)` runs under that table's own RLS, so this grants
--    nothing new — HR of the unit, the person, and (0817) their HOD.
--    approval_run_events follows approval_runs (its policy reads the run).
-- 2. hr_waiting_on(run) — the NAMES of the people the current step waits
--    for ("SURESH", or "RAAGAM ADMIN"), so the sheet says who, not which rule.
--    Answers only for a run the caller can already see.
-- ============================================================================

drop policy if exists approval_runs_read_hr_subject on public.approval_runs;
create policy approval_runs_read_hr_subject on public.approval_runs for select to authenticated
  using (
    (subject_table = 'timeoff_requests'
       and exists (select 1 from public.timeoff_requests t where t.id = approval_runs.subject_id))
    or
    (subject_table = 'timeoff_encashments'
       and exists (select 1 from public.timeoff_encashments x where x.id = approval_runs.subject_id))
  );

create or replace function public.hr_waiting_on(p_run_id uuid)
returns table (user_id uuid, full_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_runs;
begin
  select * into r from public.approval_runs where id = p_run_id;
  if r.id is null or r.status <> 'in_progress' then
    return;
  end if;
  -- A definer bypasses RLS, so the read rules of 0770 / 0817 are spelled out:
  -- HR of the unit, the person themself, or their HOD.
  if not exists (
    select 1
      from (select t.location_id, t.staff_id, t.worker_id from public.timeoff_requests t
             where r.subject_table = 'timeoff_requests' and t.id = r.subject_id
            union all
            select x.location_id, x.staff_id, x.worker_id from public.timeoff_encashments x
             where r.subject_table = 'timeoff_encashments' and x.id = r.subject_id) d
     where (public.has_permission('hr_payroll', 'view') and public.is_current_location(d.location_id))
        or (d.staff_id is not null and d.staff_id = public.timeoff_my_staff_id())
        or public.hr_i_am_hod_of(d.staff_id, d.worker_id)
  ) then
    return;
  end if;
  return query
    select u, coalesce(nullif(btrim(p.full_name), ''), p.email)
      from public.approval_step_approvers(public.approval_current_step(r), r.requested_by, r.scope, r.context) u
      join public.profiles p on p.id = u
     order by 2;
end $$;

revoke all on function public.hr_waiting_on(uuid) from public, anon;
grant execute on function public.hr_waiting_on(uuid) to authenticated;
