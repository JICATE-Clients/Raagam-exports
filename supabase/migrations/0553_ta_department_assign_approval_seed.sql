-- ============================================================================
-- Raagam ERP — 0553 Orders ▸ T&A ▸ owning departments + test staff for the 3
-- approval-chain activities (PP Send / PP Approval / Materials In-House)
--
-- 0551 fixed "No department assigned" on the T&A tab for the six production-
-- floor activities (Cutting, Sewing, Checking, Ironing, Packing, Inspection)
-- by giving each a real `ta_department_assigns` + owning
-- `ta_department_assign_lines` row — `taOwnerOptions()` (`lib/ta/task-
-- owners.ts`) reads ONLY that, never the legacy free-text
-- `ta_activities.department` column. The same gap exists for the three
-- activities upstream of Cutting in the ladder: PP SEND, PP APPROVAL and
-- MATERIALS IN-HOUSE all carry a `department` string ('Merchandising' /
-- 'Sourcing', set by 0536) but no owning `ta_department_assign_lines` row, so
-- their Task Owner picker is empty with the same hint 0551 was written to
-- clear.
--
-- Client spec (2026-09-10): PP Send and PP Approval are Merchandiser work
-- (prepare/dispatch the sample, chase the buyer's decision); Materials
-- In-House is Sourcing/Stores work (log the physical receipt, unlock the
-- Cutting Room gate). That is exactly the department split 0536 already
-- recorded in the free-text column — this migration is what makes it reach
-- the Task Owner picker.
--
-- ## REUSING 'MERCHANDISER', NOT INVENTING A SECOND SPELLING
--
-- 0482 already seeded a MERCHANDISER row under `config_lookups` (kind =
-- 'designation'), for the order-level Merchandiser field. That is a
-- DESIGNATION, and `taOwnerOptions()` scopes by DEPARTMENT — a different
-- column, same table shape, and 0551 already established the pattern of a
-- department row per activity area. So this migration adds a MERCHANDISING
-- *department* (0551's own pattern: `ta_activities.department = 'Merchandising'`
-- already uses that spelling) rather than repurposing the designation row —
-- two different questions ("what is this person's job title" vs "which
-- department owns this T&A line") kept as two rows, the same way AGENTS.md's
-- nominated-vendor and disabled-row rules keep a spelling to one column
-- rather than letting two mean the same thing and drift apart.
--
-- The two merchandising test employees ALSO get `designation_id` = the
-- existing MERCHANDISER row, so they are simultaneously valid picks for the
-- order-level Merchandiser field and for the T&A Task Owner column — one
-- person, two independently-scoped pickers, no separate seed needed for
-- either.
--
-- SOURCING carries no matching designation seed anywhere in this repo, so
-- the two sourcing test employees are department-only, exactly as every
-- 0551 employee already is.
--
-- IDEMPOTENT throughout, same shape as 0551: `where not exists`, keyed on
-- the same natural key the app's own dup-check would use.
-- ============================================================================

-- ---------- 1. two departments: MERCHANDISING (PP Send / PP Approval),
-- ---------- SOURCING (Materials In-House) ----------------------------------

insert into public.config_lookups (kind, code, name, is_active)
select 'department', v.code, v.name, true
from (values
  ('DEPT-MERCH', 'MERCHANDISING'),
  ('DEPT-SRC',   'SOURCING')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups d
   where d.kind = 'department' and upper(d.name) = v.name
);

-- ---------- 2. TA Department Assign: one header + one owning line per pair -

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
      ('PPSEND', 'MERCHANDISING'),
      ('PPAPPR', 'MERCHANDISING'),
      ('MATIH',  'SOURCING')
    ) as v(activity_short_name, dept_name)
  loop
    select id into v_dept_id from public.config_lookups
     where kind = 'department' and upper(name) = v_pair.dept_name limit 1;
    select id into v_activity_id from public.ta_activities
     where upper(short_name) = v_pair.activity_short_name limit 1;

    if v_dept_id is null or v_activity_id is null then
      raise exception '0553: could not resolve department "%" or activity "%"',
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
-- Merchandising staff also get designation_id = MERCHANDISER (0482), so the
-- same test rows work for the order-level Merchandiser field too.

insert into public.employees (code, name, department_id, designation_id, location_id, inactive)
select v.code, v.name, d.id,
       case when v.dept_name = 'MERCHANDISING'
            then (select id from public.config_lookups
                   where kind = 'designation' and lower(btrim(name)) = 'merchandiser' limit 1)
            else null
       end,
       (select id from public.locations where code = 'HO' limit 1),
       false
from (values
  ('TST-MERCH-1', 'MERCHANDISING STAFF 1', 'MERCHANDISING'),
  ('TST-MERCH-2', 'MERCHANDISING STAFF 2', 'MERCHANDISING'),
  ('TST-SRC-1',   'SOURCING STAFF 1',      'SOURCING'),
  ('TST-SRC-2',   'SOURCING STAFF 2',      'SOURCING')
) as v(code, name, dept_name)
join public.config_lookups d on d.kind = 'department' and upper(d.name) = v.dept_name
where not exists (
  select 1 from public.employees e where e.code = v.code
);

-- ---------- assertions ------------------------------------------------------

do $assert$
declare
  v_missing text;
  v_untagged text;
begin
  select string_agg(short_name, ', ') into v_missing
  from public.ta_activities a
  where upper(a.short_name) in ('PPSEND','PPAPPR','MATIH')
    and not exists (
      select 1 from public.ta_department_assign_lines l
       where l.activity_id = a.id and l.is_owner = true
    );

  if v_missing is not null then
    raise exception '0553: these activities still have no owning department: %', v_missing;
  end if;

  if (select count(*) from public.employees where code like 'TST-MERCH-%' or code like 'TST-SRC-%') <> 4 then
    raise exception '0553: expected 4 test employees (2 merchandising + 2 sourcing), found %',
      (select count(*) from public.employees where code like 'TST-MERCH-%' or code like 'TST-SRC-%');
  end if;

  if exists (
    select 1 from public.employees e
     where (e.code like 'TST-MERCH-%' or e.code like 'TST-SRC-%') and e.department_id is null
  ) then
    raise exception '0553: a test employee was seeded without a department_id';
  end if;

  select string_agg(code, ', ') into v_untagged
  from public.employees
   where code like 'TST-MERCH-%' and designation_id is null;

  if v_untagged is not null then
    raise exception '0553: merchandising test employee(s) missing designation_id: %', v_untagged;
  end if;
end $assert$;
