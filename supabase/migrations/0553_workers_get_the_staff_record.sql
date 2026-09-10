-- ===========================================================================
-- 0553 — a worker gets the same record a staff member has.
--
-- The client wants Workers to carry everything Staff does — the identity block
-- and all six tabs — with the Detail tab differing only where legacy's Worker
-- screen differs: a production department, a CTC per shift, the worker's rate
-- Type, and the contractor they work under (2026-09-09).
--
-- ## THE CHILD TABLES ARE SHARED, NOT DUPLICATED
--
-- The seven `staff_*` child tables become `hr_*` and take EITHER parent. Seven
-- more `worker_*` tables would have been seven more sets of policies, triggers
-- and indexes to keep in step, and — worse — a second copy of every grid on the
-- screen. A family member is a family member; whose family it is, is the FK.
--
-- `staff_id` therefore stops being NOT NULL and a check enforces that exactly
-- one parent is set. Without it a row could name both, or neither, and belong
-- to nobody.
--
-- ## TWO COLUMNS ARE RENAMED, ON BOTH TABLES
--
-- `staff_type` → `employment_type` and `salary_paid` → `pay_frequency`. They
-- hold Permanent/Temporary/… and Monthly/Weekly/Daily/Piece Rate — neither is
-- about being staff or about salary, and `workers.staff_type` would have been
-- a column arguing with its own table. Legacy calls them "Type" and
-- "Salary Paid"/"Wages Paid", which is a LABEL difference the screen can carry.
--
-- ## WHAT WORKERS DELIBERATELY DO NOT GET
--
-- `monthly_salary`. A worker is paid by shift, hour or piece —
-- `computeActualWage` (lib/hr/calc.ts) reads `shift_wage_per_day`,
-- `hourly_wage` and `piece_rate`, and those columns stay exactly as they are.
-- Giving workers a monthly salary would be a fourth wage basis nothing reads.
--
-- `designation_legacy`, which is 0548's holding pen for staff text that matched
-- no master row. Workers never had a text designation, so there is nothing to
-- hold.
--
-- Checked before writing: workers 0 rows, staff 0 rows.
-- ===========================================================================

-- ---------- rename the two mis-named columns on staff ----------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='staff' and column_name='staff_type') then
    alter table public.staff rename column staff_type to employment_type;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='staff' and column_name='salary_paid') then
    alter table public.staff rename column salary_paid to pay_frequency;
  end if;
end $$;

-- ---------- workers gains the shared record ----------
alter table public.workers
  -- identity
  add column if not exists guardian_relation text
    check (guardian_relation is null or guardian_relation in ('S/O','D/O','W/O','C/O')),
  add column if not exists guardian_name text,
  add column if not exists mother_name text,
  add column if not exists designation_id uuid references public.designations(id),
  add column if not exists category_id uuid references public.employee_categories(id),
  add column if not exists department_id uuid references public.departments(id),
  add column if not exists division_id uuid references public.divisions(id),

  -- employment
  add column if not exists employment_type text not null default 'Permanent'
    check (employment_type in ('Permanent','Temporary','Contract','Probation','Trainee')),
  add column if not exists card_no text,
  add column if not exists pay_frequency text not null default 'Weekly'
    check (pay_frequency in ('Monthly','Weekly','Daily','Piece Rate')),
  add column if not exists week_off text
    check (week_off is null or week_off in
      ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
  add column if not exists hostel_category_id uuid references public.hostel_categories(id),
  add column if not exists vehicle_no text,
  add column if not exists manager_id uuid references public.staff(id) on delete set null,

  -- WORKER-ONLY: the two boxes legacy adds under the pay panels.
  -- `prod_dept_id` is the production department the worker is on — the same
  -- `departments` master `department_id` uses, asked a different question, which
  -- is why it is a second column and not a reuse.
  add column if not exists prod_dept_id uuid references public.departments(id),
  add column if not exists ctc_per_shift numeric(12,2) not null default 0,

  -- pay
  add column if not exists stat_gross numeric(12,2) not null default 0,
  add column if not exists stat_basic numeric(12,2) not null default 0,
  add column if not exists stat_da    numeric(12,2) not null default 0,
  add column if not exists stat_hra   numeric(12,2) not null default 0,
  add column if not exists act_gross  numeric(12,2) not null default 0,
  add column if not exists act_basic  numeric(12,2) not null default 0,
  add column if not exists act_da     numeric(12,2) not null default 0,
  add column if not exists act_hra    numeric(12,2) not null default 0,

  -- statutory status
  add column if not exists migrant_worker boolean not null default false,
  add column if not exists international_worker boolean not null default false,
  add column if not exists disability_type text
    check (disability_type is null or disability_type in ('L','H','V')),
  add column if not exists disability_pct numeric(5,2) not null default 0
    check (disability_pct >= 0 and disability_pct <= 100),

  -- dates
  add column if not exists date_of_birth date,
  add column if not exists stated_age smallint
    check (stated_age is null or (stated_age >= 0 and stated_age <= 120)),
  add column if not exists place_of_birth text,
  add column if not exists date_of_probation date,
  add column if not exists date_of_confirmation date,
  add column if not exists date_of_leaving date,

  -- pay mode, tax, identifiers
  add column if not exists pay_mode text not null default 'Cash'
    check (pay_mode in ('Cash','Bank')),
  add column if not exists tds_applicable boolean not null default false,
  add column if not exists police_station text,
  add column if not exists pan_no text
    check (pan_no is null or pan_no ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  add column if not exists blocked boolean not null default false,

  -- General: permanent address
  add column if not exists perm_address1 text,
  add column if not exists perm_address2 text,
  add column if not exists perm_address3 text,
  add column if not exists perm_city text,
  add column if not exists perm_pin text,
  add column if not exists perm_phone text,

  -- General: correspondence address
  add column if not exists corr_same_as_permanent boolean not null default false,
  add column if not exists corr_address1 text,
  add column if not exists corr_address2 text,
  add column if not exists corr_address3 text,
  add column if not exists corr_city text,
  add column if not exists corr_pin text,
  add column if not exists corr_phone text,

  -- General: personal
  add column if not exists email text,
  add column if not exists qualification text,
  add column if not exists blood_group text
    check (blood_group is null or blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  add column if not exists identification_mark_1 text,
  add column if not exists identification_mark_2 text,
  add column if not exists gender text
    check (gender is null or gender in ('Male','Female','Trans Gender')),
  add column if not exists marital_status text
    check (marital_status is null or marital_status in ('Single','Married','Divorced','Widow')),
  add column if not exists nationality text,
  add column if not exists religion text,
  add column if not exists driving_licence_no text,
  add column if not exists driving_licence_valid_upto date,
  add column if not exists aadhaar_no text
    check (aadhaar_no is null or aadhaar_no ~ '^[0-9]{12}$'),
  add column if not exists general_flag boolean not null default false,

  -- Nomination: ESI / PF
  add column if not exists esi_status text not null default 'No'
    check (esi_status in ('Yes','No','Exempted')),
  add column if not exists esi_no text,
  add column if not exists esi_date_of_joining date,
  add column if not exists esi_date_of_leaving date,
  add column if not exists esi_dispensary text,
  add column if not exists pf_status text not null default 'No'
    check (pf_status in ('Yes','No','Exempted')),
  add column if not exists pf_no text,
  add column if not exists pf_date_of_joining date,
  add column if not exists pf_date_of_leaving date;

-- The same derivation staff has (0536): the boolean payroll reads follows the
-- three-state an operator sets. `computeActualWage` reads these booleans for a
-- worker exactly as `computeStaffSalary` does for staff.
drop trigger if exists trg_workers_statutory_flags on public.workers;
create trigger trg_workers_statutory_flags
  before insert or update of esi_status, pf_status on public.workers
  for each row execute function public.staff_sync_statutory_flags();

update public.workers
   set esi_status = case when esi_applicable then 'Yes' else 'No' end,
       pf_status  = case when pf_applicable  then 'Yes' else 'No' end
 where esi_status = 'No' and pf_status = 'No'
   and (esi_applicable or pf_applicable);

create index if not exists workers_designation_id_idx on public.workers (designation_id);
create index if not exists workers_prod_dept_id_idx   on public.workers (prod_dept_id);

-- ---------- the child tables serve both ----------
do $$
declare
  m record;
begin
  for m in
    select * from (values
      ('staff_family_members',      'hr_family_members'),
      ('staff_work_experience',     'hr_work_experience'),
      ('staff_internal_references', 'hr_internal_references'),
      ('staff_nominations',         'hr_nominations'),
      ('staff_bank_accounts',       'hr_bank_accounts'),
      ('staff_external_references', 'hr_external_references'),
      ('staff_emergency_contacts',  'hr_emergency_contacts')
    ) as t(old_name, new_name)
  loop
    if exists (select 1 from pg_tables where schemaname='public' and tablename=m.old_name) then
      execute format('alter table public.%I rename to %I;', m.old_name, m.new_name);
    end if;

    execute format('alter table public.%I alter column staff_id drop not null;', m.new_name);
    execute format(
      'alter table public.%I add column if not exists worker_id uuid
         references public.workers(id) on delete cascade;', m.new_name);

    -- EXACTLY ONE PARENT. Without this a row could name both — belonging to a
    -- staff member and a worker at once — or neither, and belong to nobody.
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', m.new_name)::regclass
        and conname = m.new_name || '_one_parent'
    ) then
      execute format(
        'alter table public.%I add constraint %I
           check ((staff_id is null) <> (worker_id is null));',
        m.new_name, m.new_name || '_one_parent');
    end if;

    execute format(
      'create index if not exists idx_%1$s_worker on public.%1$s (worker_id);', m.new_name);
  end loop;
end $$;
