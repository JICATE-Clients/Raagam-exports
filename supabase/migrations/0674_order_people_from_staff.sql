-- 0674 — EVERY PERSON THE ORDERS MODULE NAMES IS AN HR ▸ STAFF MEMBER
-- (user 2026-10-01, "do by your suggestion": Phase 0 of the per-user
-- dashboard plan — one people list, then "my work").
--
-- Five columns named a person from `employees`, the old Employee master:
--   garment_order_amendments.merchandiser_id            (0478)
--   garment_order_amendment_ta_activities.assigned_staff_id (0547, the name
--                                                      notwithstanding)
--   order_fabric_ta_marks.assigned_staff_id             (0609)
--   order_trim_ta_marks.assigned_staff_id               (0608)
--   order_work_flow_milestones.owner_id                 (0607)
-- That master holds 19 rows and every one is test data ("SAMPLE
-- MERCHANDISER", "MERCHANDISING STAFF 1" …, codes TST-* / EMP-*); none matches
-- any of the 80 real people on HR ▸ Staff by code, e-mail or name (checked
-- 2026-10-01). 0671 already moved the CAD pattern maker. A "my work" view
-- needs every assignment to name the SAME person a login resolves to, so:
--
--   1. The test assignments are CLEARED (the user's choice: "leave
--      unassigned"): 7 order merchandisers, 54 T&A task owners, 7 work-flow
--      owners; the fabric / trim T&A marks hold none. Each reads "Not
--      assigned" until a real staff member is picked. The order lock is
--      paused for that ONE statement — approved orders are locked, and this
--      repair is not an edit to their substance.
--   2. The five FKs move to `staff(id)`.
--   3. T&A DEPARTMENTS move with them. `ta_department_assigns.department_id`
--      pointed at `config_lookups` departments (all test seed, 0551/0553);
--      a staff member's department is the `departments` master. Matched BY
--      NAME — CUTTING, MERCHANDISING and PACKING exist on both lists; CHECKING,
--      INSPECTION, IRONING, SEWING and SOURCING have no HR department, so
--      those five assigns KEEP their activity lines and lose only the
--      department, to be pointed at a real one on T&A Department Assign.
--      Nothing is deleted.
--   4. The three SQL readers of `employees` move to `staff`:
--      `employee_login_ids` (the person → login resolver every alert uses —
--      its NAME is kept so its callers stay unchanged; it now takes staff
--      ids), `staff_ta_kpi`, `override_grantee_candidates`.
--
-- A login is matched to its staff record by EMPLOYEE CODE, then E-MAIL —
-- `profiles.employee_code` is what `createUserFromStaff` stamps (= staff.code),
-- so the code is the stronger key; e-mail covers a login made by hand.

-- 1. Clear the test assignments.
alter table public.garment_order_amendments disable trigger trg_order_lock;
update public.garment_order_amendments a
   set merchandiser_id = null
 where merchandiser_id is not null
   and not exists (select 1 from public.staff s where s.id = a.merchandiser_id);
alter table public.garment_order_amendments enable trigger trg_order_lock;

update public.garment_order_amendment_ta_activities t
   set assigned_staff_id = null
 where assigned_staff_id is not null
   and not exists (select 1 from public.staff s where s.id = t.assigned_staff_id);
update public.order_fabric_ta_marks t
   set assigned_staff_id = null
 where assigned_staff_id is not null
   and not exists (select 1 from public.staff s where s.id = t.assigned_staff_id);
update public.order_trim_ta_marks t
   set assigned_staff_id = null
 where assigned_staff_id is not null
   and not exists (select 1 from public.staff s where s.id = t.assigned_staff_id);
update public.order_work_flow_milestones m
   set owner_id = null
 where owner_id is not null
   and not exists (select 1 from public.staff s where s.id = m.owner_id);

-- 2. The FKs.
alter table public.garment_order_amendments
  drop constraint if exists garment_order_amendments_merchandiser_id_fkey,
  add constraint garment_order_amendments_merchandiser_id_fkey
    foreign key (merchandiser_id) references public.staff (id);
alter table public.garment_order_amendment_ta_activities
  drop constraint if exists garment_order_amendment_ta_activities_assigned_staff_id_fkey,
  add constraint garment_order_amendment_ta_activities_assigned_staff_id_fkey
    foreign key (assigned_staff_id) references public.staff (id);
alter table public.order_fabric_ta_marks
  drop constraint if exists order_fabric_ta_marks_assigned_staff_id_fkey,
  add constraint order_fabric_ta_marks_assigned_staff_id_fkey
    foreign key (assigned_staff_id) references public.staff (id);
alter table public.order_trim_ta_marks
  drop constraint if exists order_trim_ta_marks_assigned_staff_id_fkey,
  add constraint order_trim_ta_marks_assigned_staff_id_fkey
    foreign key (assigned_staff_id) references public.staff (id);
alter table public.order_work_flow_milestones
  drop constraint if exists order_work_flow_milestones_owner_id_fkey,
  add constraint order_work_flow_milestones_owner_id_fkey
    foreign key (owner_id) references public.staff (id);

-- 3. T&A departments → the HR departments master, by name.
alter table public.ta_department_assigns
  drop constraint if exists ta_department_assigns_department_id_fkey;
update public.ta_department_assigns a
   set department_id = (
         select d.id
           from public.config_lookups l
           join public.departments d on upper(btrim(d.name)) = upper(btrim(l.name))
          where l.id = a.department_id
          limit 1)
 where a.department_id is not null
   and not exists (select 1 from public.departments d where d.id = a.department_id);
alter table public.ta_department_assigns
  add constraint ta_department_assigns_department_id_fkey
    foreign key (department_id) references public.departments (id);

-- 4a. Person → login (name kept; takes STAFF ids now).
create or replace function public.employee_login_ids(p_employees uuid[])
 returns table(employee_id uuid, profile_id uuid)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select distinct on (s.id) s.id, p.id
    from public.staff s
    join public.profiles p
      on coalesce(p.is_active, true)
     and (
          (nullif(btrim(p.employee_code), '') is not null
           and lower(btrim(p.employee_code)) = lower(btrim(s.code)))
       or (nullif(btrim(p.email), '') is not null
           and lower(btrim(p.email)) = lower(btrim(s.email)))
     )
   where s.id = any(p_employees)
   order by s.id,
            (lower(btrim(coalesce(p.employee_code, ''))) = lower(btrim(coalesce(s.code, '')))) desc;
$function$;

-- 4b. The T&A scorecard, over staff.
create or replace function public.staff_ta_kpi(p_from date, p_to date, p_staff_id uuid default null::uuid, p_caller_id uuid default auth.uid())
 returns table(staff_id uuid, staff_name text, total_assigned integer, still_open integer, completed_on_time integer, completed_late integer, buyer_attributed_delays integer, on_time_score_percentage numeric, avg_delay_days numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_caller_staff_id uuid;
  v_can_see_others  boolean;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'staff_ta_kpi: p_from/p_to must be a valid, non-empty date range'
      using errcode = '22007';
  end if;

  -- 0672: the caller's STAFF record — code first, then e-mail (employee_login_ids' rule).
  select s.id into v_caller_staff_id
    from public.profiles pr
    join public.staff s
      on (nullif(btrim(pr.employee_code), '') is not null and lower(btrim(s.code)) = lower(btrim(pr.employee_code)))
      or (nullif(btrim(pr.email), '') is not null and lower(btrim(s.email)) = lower(btrim(pr.email)))
   where pr.id = p_caller_id
   order by (lower(btrim(coalesce(s.code, ''))) = lower(btrim(coalesce(pr.employee_code, '')))) desc
   limit 1;

  v_can_see_others := public.has_permission('orders', 'export', p_caller_id);

  if p_staff_id is not null
     and p_staff_id is distinct from v_caller_staff_id
     and not v_can_see_others then
    raise exception 'staff_ta_kpi: not permitted to view another staff member''s KPI'
      using errcode = '42501';
  end if;

  if p_staff_id is null and not v_can_see_others then
    p_staff_id := v_caller_staff_id;
  end if;

  return query
  select
    s.id,
    s.name,
    count(t.id)::int as total_assigned,
    count(*) filter (where t.id is not null and t.actual_date is null)::int as still_open,
    count(*) filter (where t.actual_date is not null and t.actual_date <= t.target_date)::int as completed_on_time,
    count(*) filter (where t.actual_date is not null and t.actual_date > t.target_date)::int as completed_late,
    count(*) filter (
      where t.actual_date is not null and t.actual_date > t.target_date
        and t.delay_attribution = 'buyer_delay'
    )::int as buyer_attributed_delays,
    case
      when count(*) filter (
        where t.actual_date is not null
          and not (t.actual_date > t.target_date and t.delay_attribution = 'buyer_delay')
      ) = 0 then null
      else round(
        100.0 * count(*) filter (where t.actual_date is not null and t.actual_date <= t.target_date)
        / count(*) filter (
            where t.actual_date is not null
              and not (t.actual_date > t.target_date and t.delay_attribution = 'buyer_delay')
          ),
        2
      )
    end as on_time_score_percentage,
    case
      when count(*) filter (where t.actual_date is not null and t.actual_date > t.target_date) = 0 then null
      else round(
        avg(t.actual_date - t.target_date) filter (
          where t.actual_date is not null and t.actual_date > t.target_date
        ),
        2
      )
    end as avg_delay_days
  from public.staff s
  left join public.garment_order_amendment_ta_activities t
    on t.assigned_staff_id = s.id
   and t.target_date between p_from and p_to
  where (p_staff_id is null and coalesce(s.is_active, true) and not coalesce(s.blocked, false)) or s.id = p_staff_id
  group by s.id, s.name
  having p_staff_id is not null or count(t.id) > 0
  order by s.name;
end;
$function$;

-- 4c. Override grantee picker: name / department / designation from staff.
create or replace function public.override_grantee_candidates()
 returns table(user_id uuid, email text, full_name text, employee_name text, department text, designation text, can_edit_orders boolean)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if not public.can_manage_permission_overrides() then
    raise exception 'Only an administrator or the Managing Director can manage override access.'
      using errcode = '42501', hint = 'override_forbidden';
  end if;
  return query
    select p.id, lower(btrim(p.email)), p.full_name,
           s.name, d.name, g.name,
           public.has_permission('orders', 'edit', p.id)
      from public.profiles p
      left join lateral (
        select s.name, s.department_id, s.designation_id
          from public.staff s
         where (nullif(btrim(p.employee_code), '') is not null and upper(btrim(s.code)) = upper(btrim(p.employee_code)))
            or (nullif(btrim(p.email), '') is not null and lower(btrim(s.email)) = lower(btrim(p.email)))
         order by (upper(btrim(coalesce(s.code, ''))) = upper(btrim(coalesce(p.employee_code, '')))) desc
         limit 1
      ) s on true
      left join public.departments d on d.id = s.department_id
      left join public.designations g on g.id = s.designation_id
     where p.is_active
       and coalesce(btrim(p.email), '') <> ''
       and p.id <> auth.uid()
     order by lower(coalesce(p.full_name, p.email));
end;
$function$;

-- Grants unchanged by CREATE OR REPLACE; restated for the record (AGENTS.md).
revoke all on function public.employee_login_ids(uuid[]) from public, anon;
revoke all on function public.staff_ta_kpi(date, date, uuid, uuid) from public, anon;
revoke all on function public.override_grantee_candidates() from public, anon;
