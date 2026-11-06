-- ============================================================================
-- Raagam ERP — 0817 HR requests go Department HOD → HR Manager → ED
--
-- User 2026-11-05: "there is 3 stages — employees' HR related requests go to
-- their respective dept HOD, next HR Manager, next ED (which is the owner)".
--
-- Before this, every leave / permission / on duty / comp-off booking and
-- every encashment went straight to "MD / HR Manager" in one step (0770).
--
-- 1. hr_department_heads — who heads each department. One staff member per
--    department, set on HR ▸ Time Off ▸ Time Off Setup ▸ Approval Flow. A
--    table of its own rather than a column on `departments`: departments is a
--    shared Master Data screen, and this is HR's decision about HR's flow.
-- 2. Three resolvers in the engine's shim. NONE OF THEM MAY RETURN NOBODY:
--    `approval_start_run` refuses a request whose step 1 resolves to nobody,
--    and `approval_act` refuses to approve into an empty next step — so an
--    empty resolver is every apply refused, or a request stuck at HOD.
--      hr_department_head  the HOD's login. No HOD set, no login on the HOD's
--                          staff record (matched by e-mail, the same way
--                          `timeoff_my_staff_id` does), or the HOD is the
--                          person on leave → the HR Manager takes the step.
--      hr_manager          holders of HR Manager; nobody holds it → the MD.
--      hr_executive_director  holders of Managing Director — the owner. The
--                          app has no separate ED role: the owner's login
--                          holds Managing Director, so that is who the ED is.
-- 3. timeoff_apply / timeoff_request_encashment add staff_id and worker_id to
--    the run's context, so the HOD resolver knows WHOSE department — the one
--    applying may be HR, applying on someone's behalf. Patched in place with
--    the same anchor-replace 0770 used for approval_apply_terminal, and
--    refused loudly if the anchor is missing.
-- 4. The two default flows (timeoff_request, timeoff_encashment) become the
--    three steps. A run already open keeps the steps it started with (the
--    engine freezes them onto the run), so nothing in flight changes.
-- 5. An HOD reads the requests of their department (they could not see the
--    rows they were asked to approve), and `hr_approval_stage` says which
--    step each pending request is waiting on, for the Approvals screen.
--
-- Nothing is deleted; no existing row changes except the two flows' steps.
-- ============================================================================

-- ─── 1. Department heads ────────────────────────────────────────────────────

create table if not exists public.hr_department_heads (
  department_id uuid primary key references public.departments(id) on delete cascade,
  staff_id      uuid not null references public.staff(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);
comment on table public.hr_department_heads is
  '0807 — the HOD of each department: step 1 of every HR request (Department HOD → HR Manager → ED).';

drop trigger if exists trg_hr_department_heads_updated on public.hr_department_heads;
create trigger trg_hr_department_heads_updated before update on public.hr_department_heads
  for each row execute function public.set_updated_at();

alter table public.hr_department_heads enable row level security;
drop policy if exists hr_department_heads_read  on public.hr_department_heads;
drop policy if exists hr_department_heads_write on public.hr_department_heads;
create policy hr_department_heads_read on public.hr_department_heads for select
  using (public.has_permission('hr_payroll', 'view'));
create policy hr_department_heads_write on public.hr_department_heads for all
  using (public.has_permission('hr_payroll', 'edit'))
  with check (public.has_permission('hr_payroll', 'edit'));
grant select, insert, update, delete on public.hr_department_heads to authenticated;

-- A staff record's login: the active profile with the same e-mail.
create or replace function public.hr_staff_login(p_staff uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select pr.id
    from public.staff s
    join public.profiles pr on lower(btrim(pr.email)) = lower(btrim(s.email))
   where s.id = p_staff
     and s.email is not null and btrim(s.email) <> ''
     and coalesce(pr.is_active, true)
   order by pr.created_at
   limit 1;
$$;

-- The HOD (a staff id) over a staff member or a worker.
create or replace function public.hr_hod_of(p_staff uuid, p_worker uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select h.staff_id
    from public.hr_department_heads h
   where h.department_id = coalesce(
           (select s.department_id from public.staff s where s.id = p_staff),
           (select w.department_id from public.workers w where w.id = p_worker));
$$;

-- "Am I the HOD of this person?" — for the read policies below.
create or replace function public.hr_i_am_hod_of(p_staff uuid, p_worker uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.hr_hod_of(p_staff, p_worker) = public.timeoff_my_staff_id(), false);
$$;

-- ─── 2. Resolvers (0629's body + three branches) ────────────────────────────

create or replace function public.approval_rbac_resolve_dynamic(p_resolver_key text, p_requester uuid, p_context jsonb default '{}'::jsonb)
returns setof uuid language plpgsql stable security definer set search_path = '' as $function$
declare
    v_staff  uuid;
    v_worker uuid;
    v_hod    uuid;
    v_user   uuid;
begin
    if p_resolver_key is null or p_resolver_key = '' then
        return;
    end if;

    -- 0629 — a fine is approved by the MD OR an HR Manager (doc/order/punishment
    -- fine.md §5). A step carries one role key, so "either role" is a resolver.
    if p_resolver_key = 'md_or_hr_manager' then
        return query
          select u from public.approval_rbac_users_with_role('Managing Director', '{}'::jsonb) u
          union
          select u from public.approval_rbac_users_with_role('HR Manager', '{}'::jsonb) u;
        return;
    end if;

    -- 0817 — step 1: the HOD of the person's department.
    if p_resolver_key = 'hr_department_head' then
        v_staff  := nullif(p_context ->> 'staff_id', '')::uuid;
        v_worker := nullif(p_context ->> 'worker_id', '')::uuid;
        v_hod    := public.hr_hod_of(v_staff, v_worker);
        if v_hod is not null and v_hod is distinct from v_staff then
            v_user := public.hr_staff_login(v_hod);
            if v_user is not null and v_user is distinct from p_requester then
                return next v_user;
                return;
            end if;
        end if;
        -- No HOD to ask: the HR Manager takes this step.
        return query select u from public.approval_rbac_resolve_dynamic('hr_manager', p_requester, p_context) u;
        return;
    end if;

    -- 0817 — step 2: HR Manager; with nobody holding it, the MD.
    if p_resolver_key = 'hr_manager' then
        if exists (select 1 from public.approval_rbac_users_with_role('HR Manager', '{}'::jsonb) u
                    where u is distinct from p_requester) then
            return query select u from public.approval_rbac_users_with_role('HR Manager', '{}'::jsonb) u;
        else
            return query select u from public.approval_rbac_users_with_role('Managing Director', '{}'::jsonb) u;
        end if;
        return;
    end if;

    -- 0817 — step 3: the ED, the owner — whoever holds Managing Director.
    if p_resolver_key = 'hr_executive_director' then
        return query select u from public.approval_rbac_users_with_role('Managing Director', '{}'::jsonb) u;
        return;
    end if;

    raise exception
        'approval_rbac_resolve_dynamic: resolver "%" is not implemented in Raagam. Implement it in the shim (0500) or stop referencing it from a flow step.',
        p_resolver_key
        using errcode = '0A000';
end $function$;

-- ─── 3. Whose request: staff_id / worker_id into the run's context ──────────

-- The anchor is a regex so it holds whatever line endings the body was saved
-- with; each function carries it exactly once (0770).
do $$
declare
  v_fn  text;
  v_def text;
  v_old text := 'jsonb_build_object\(\s*''person_name'', p\.name,';
  v_new text := 'jsonb_build_object(''staff_id'', p_staff_id, ''worker_id'', p_worker_id, ''person_name'', p.name,';
begin
  foreach v_fn in array array[
    'public.timeoff_apply(uuid, uuid, uuid, date, date, text, time, time, text)',  -- leave, permission, on duty, comp-off
    'public.timeoff_request_encashment(uuid, uuid, uuid, numeric, text)'           -- encashment
  ] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    continue when position('''staff_id'', p_staff_id' in v_def) > 0;  -- already patched
    if v_def !~ v_old then
      raise exception '0807: the approval context in % was not found — add staff_id / worker_id by hand.', v_fn;
    end if;
    execute regexp_replace(v_def, v_old, v_new);
  end loop;
end $$;

-- ─── 4. The flows ───────────────────────────────────────────────────────────

update public.approval_flows
   set steps = '[
         {"step_order":1,"step_key":"hod","step_type":"review","step_label":"Department HOD","approver_resolver":"hr_department_head"},
         {"step_order":2,"step_key":"hr_manager","step_type":"review","step_label":"HR Manager","approver_resolver":"hr_manager"},
         {"step_order":3,"step_key":"ed","step_type":"final","step_label":"ED","approver_resolver":"hr_executive_director"}
       ]'::jsonb,
       description = case workflow_key
         when 'timeoff_request' then 'Every leave, permission, on duty and comp-off booking: the department HOD, then the HR Manager, then the ED.'
         else 'Every leave encashment: the department HOD, then the HR Manager, then the ED.'
       end
 where workflow_key in ('timeoff_request', 'timeoff_encashment')
   and criteria = '{}'::jsonb
   and priority = 900;

-- ─── 5. HOD can read their department's requests; which step is waiting ─────

drop policy if exists timeoff_requests_read_hod on public.timeoff_requests;
create policy timeoff_requests_read_hod on public.timeoff_requests for select
  using (public.hr_i_am_hod_of(staff_id, worker_id));

drop policy if exists timeoff_enc_read_hod on public.timeoff_encashments;
create policy timeoff_enc_read_hod on public.timeoff_encashments for select
  using (public.hr_i_am_hod_of(staff_id, worker_id));

-- For the Approvals screen: the open run's step, and the person's name (an
-- HOD without a unit cannot read the staff row the list embeds).
create or replace function public.hr_approval_stage(p_subject_table text, p_ids uuid[])
returns table (subject_id uuid, step_no int, step_total int, step_label text, person_name text)
language sql stable security definer set search_path = '' as $$
  select r.subject_id,
         r.current_step,
         jsonb_array_length(r.steps_snapshot),
         r.steps_snapshot -> (r.current_step - 1) ->> 'step_label',
         r.context ->> 'person_name'
    from public.approval_runs r
   where r.subject_table = p_subject_table
     and r.subject_id = any (p_ids)
     and r.status = 'in_progress'
     and public.has_permission('hr_payroll', 'view');
$$;

revoke all on function public.hr_staff_login(uuid)                    from public, anon, authenticated;
revoke all on function public.hr_hod_of(uuid, uuid)                   from public, anon, authenticated;
revoke all on function public.hr_i_am_hod_of(uuid, uuid)              from public, anon;
revoke all on function public.hr_approval_stage(text, uuid[])         from public, anon;
revoke all on function public.approval_rbac_resolve_dynamic(text, uuid, jsonb) from public, anon;
grant execute on function public.hr_i_am_hod_of(uuid, uuid)           to authenticated;
grant execute on function public.hr_approval_stage(text, uuid[])      to authenticated;
grant execute on function public.approval_rbac_resolve_dynamic(text, uuid, jsonb) to authenticated;
