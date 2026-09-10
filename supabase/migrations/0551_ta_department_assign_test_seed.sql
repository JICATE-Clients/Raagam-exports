-- ============================================================================
-- Raagam ERP — 0551 Orders ▸ T&A ▸ test departments + staff for the 6
-- production-floor activities (Cutting, Sewing, Checking, Ironing, Packing,
-- Inspection)
--
-- Reported live on a garment order's T&A tab (HO/RE/26-27/0005, 2026-09-10):
-- every one of these six activities showed "No department" with the hint
-- "This activity has no department assigned yet — set one on T&A ▸
-- Department Assign." That message is `taOwnerOptions()`'s
-- (`lib/ta/task-owners.ts`), which is scoped ONLY by
-- `ta_department_assign_lines` rows with `is_owner = true` — the free-text
-- `ta_activities.department` column (already set to 'Quality' / 'Finishing'
-- for CHECK / IRON by 0539) is deliberately NOT read here; see
-- `getTaOwnerDepartments()`'s own comment in
-- `lib/orders/amendments/service.ts` for why the worklist's more lenient
-- `activityDepartments()` is not reused for Task Owner scoping.
--
-- So fixing the hint needs a REAL `ta_department_assigns` row per activity,
-- not an edit to `ta_activities.department`. This migration is test/demo
-- data for that: one department per activity (matching the activity's own
-- name, so "CUTTING" the department owns "CUTTING" the activity) and two
-- test staff per department, so the Task Owner picker on each of these six
-- rows has real options to test against.
--
-- IDEMPOTENT throughout (`where not exists`, keyed on the same natural key
-- the app's own dup-check would use — kind+name for config_lookups, code for
-- employees, department_id for the assign header) — safe to re-run.
-- ============================================================================

-- ---------- 1. one department per activity, at Head Office ------------------

insert into public.config_lookups (kind, code, name, is_active)
select 'department', v.code, v.name, true
from (values
  ('DEPT-CUT',   'CUTTING'),
  ('DEPT-SEW',   'SEWING'),
  ('DEPT-CHECK', 'CHECKING'),
  ('DEPT-IRON',  'IRONING'),
  ('DEPT-PACK',  'PACKING'),
  ('DEPT-INSP',  'INSPECTION')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups d
   where d.kind = 'department' and upper(d.name) = v.name
);

-- ---------- 2. TA Department Assign: one header + one owning line per dept -

do $seed$
declare
  v_ho_location_id uuid;
  v_pair record;
  v_dept_id uuid;
  v_activity_id uuid;
  v_assign_id uuid;
begin
  select id into v_ho_location_id from public.locations where code = 'HO' limit 1;

  for v_pair in
    select * from (values
      ('CUT',   'CUTTING'),
      ('SEW',   'SEWING'),
      ('CHECK', 'CHECKING'),
      ('IRON',  'IRONING'),
      ('PACK',  'PACKING'),
      ('INSP',  'INSPECTION')
    ) as v(activity_short_name, dept_name)
  loop
    select id into v_dept_id from public.config_lookups
     where kind = 'department' and upper(name) = v_pair.dept_name limit 1;
    select id into v_activity_id from public.ta_activities
     where upper(short_name) = v_pair.activity_short_name limit 1;

    if v_dept_id is null or v_activity_id is null then
      raise exception '0551: could not resolve department "%" or activity "%"',
        v_pair.dept_name, v_pair.activity_short_name;
    end if;

    -- one header per department (skip if this department already has one)
    select id into v_assign_id from public.ta_department_assigns
     where department_id = v_dept_id limit 1;

    if v_assign_id is null then
      insert into public.ta_department_assigns (entered_date, location_id, department_id)
      values (current_date, v_ho_location_id, v_dept_id)
      returning id into v_assign_id;
    end if;

    insert into public.ta_department_assign_lines (assign_id, sno, activity_id, is_owner)
    select v_assign_id, 1, v_activity_id, true
    where not exists (
      select 1 from public.ta_department_assign_lines
       where assign_id = v_assign_id and activity_id = v_activity_id
    );
  end loop;
end $seed$;

-- ---------- 3. two test staff per department, at Head Office ----------------

insert into public.employees (code, name, department_id, location_id, inactive)
select v.code, v.name, d.id,
       (select id from public.locations where code = 'HO' limit 1),
       false
from (values
  ('TST-CUT-1',   'CUTTING STAFF 1',    'CUTTING'),
  ('TST-CUT-2',   'CUTTING STAFF 2',    'CUTTING'),
  ('TST-SEW-1',   'SEWING STAFF 1',     'SEWING'),
  ('TST-SEW-2',   'SEWING STAFF 2',     'SEWING'),
  ('TST-CHECK-1', 'CHECKING STAFF 1',   'CHECKING'),
  ('TST-CHECK-2', 'CHECKING STAFF 2',   'CHECKING'),
  ('TST-IRON-1',  'IRONING STAFF 1',    'IRONING'),
  ('TST-IRON-2',  'IRONING STAFF 2',    'IRONING'),
  ('TST-PACK-1',  'PACKING STAFF 1',    'PACKING'),
  ('TST-PACK-2',  'PACKING STAFF 2',    'PACKING'),
  ('TST-INSP-1',  'INSPECTION STAFF 1', 'INSPECTION'),
  ('TST-INSP-2',  'INSPECTION STAFF 2', 'INSPECTION')
) as v(code, name, dept_name)
join public.config_lookups d on d.kind = 'department' and upper(d.name) = v.dept_name
where not exists (
  select 1 from public.employees e where e.code = v.code
);

-- ---------- assertions ------------------------------------------------------

do $assert$
declare
  v_missing text;
begin
  select string_agg(short_name, ', ') into v_missing
  from public.ta_activities a
  where upper(a.short_name) in ('CUT','SEW','CHECK','IRON','PACK','INSP')
    and not exists (
      select 1 from public.ta_department_assign_lines l
       where l.activity_id = a.id and l.is_owner = true
    );

  if v_missing is not null then
    raise exception '0551: these activities still have no owning department: %', v_missing;
  end if;

  if (select count(*) from public.employees where code like 'TST-%') <> 12 then
    raise exception '0551: expected 12 test employees (2 per department), found %',
      (select count(*) from public.employees where code like 'TST-%');
  end if;

  if exists (
    select 1 from public.employees e
     where e.code like 'TST-%' and e.department_id is null
  ) then
    raise exception '0551: a test employee was seeded without a department_id';
  end if;
end $assert$;
