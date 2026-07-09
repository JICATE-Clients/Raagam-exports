-- ============================================================================
-- Raagam ERP — 0243 Master Data ▸ Associates ▸ Employee
-- Legacy EDP2 "Employee" form: a header (ID · Name · S/O + guardian · Category ⓘ
-- · Department ⓘ · Location ⓘ · Designation ⓘ · DOB + Age · Team ⓘ · Manager ⓘ ·
-- Photo · Blocked) + a single "General" panel (Permanent Address · Correspondence
-- Address [Same as Permanent] · E-Mail · Qualification · Blood Group · Marital
-- Status · Sex · Nationality · Religion).
--
-- This is a NEW, dedicated master — distinct from the lean payroll `staff` table
-- (0013), which only carries salary/ESI/PF. The two may be linked later.
--
-- Picker fields reference masters:
--   category / department / designation / team → public.config_lookups kinds
--     (department + designation already exist from 0236; category + team added
--      to the kind CHECK below).
--   location                                   → public.locations (GST entities)
--   manager                                    → public.employees (self-ref)
-- ============================================================================

-- 1) Widen the config_lookups kind CHECK: add 'employee_category' + 'team'
--    (re-add every existing kind — 0241 shape — plus the two new ones).
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check
  check (kind in (
    'attribute',
    'levy',
    'material_category',
    'material_attribute',
    'yarn_count',
    'yarn_purity',
    'composition',
    'process',
    'component',
    'gauge',
    'knitting_dia',
    'out_doc_term',
    'commodity',
    'item_class',
    'hsn_code',
    'city',
    'state',
    'department',
    'designation',
    'internal_department',
    'ship_type',
    'payment_term',
    'employee_category',
    'team'
  ));

-- 2) Employees master.
create table if not exists public.employees (
  id                 uuid primary key default gen_random_uuid(),
  code               text,                                    -- "ID"
  name               text not null,
  guardian_relation  text check (guardian_relation in ('S/O','D/O','W/O','C/O')),
  guardian_name      text,
  category_id        uuid references public.config_lookups(id) on delete set null,
  department_id      uuid references public.config_lookups(id) on delete set null,
  location_id        uuid references public.locations(id) on delete set null,
  designation_id     uuid references public.config_lookups(id) on delete set null,
  team_id            uuid references public.config_lookups(id) on delete set null,
  manager_id         uuid references public.employees(id) on delete set null,  -- self-ref
  dob                date,
  blocked            boolean not null default false,
  photo_url          text,
  -- General: Permanent Address
  perm_addr1         text,
  perm_addr2         text,
  perm_addr3         text,
  perm_pin           text,
  perm_phone         text,
  perm_mobile        text,
  -- General: Correspondence Address
  corr_same_as_perm  boolean not null default false,
  corr_addr1         text,
  corr_addr2         text,
  corr_addr3         text,
  corr_pin           text,
  corr_phone         text,
  corr_mobile        text,
  -- General: personal
  email              text,
  qualification      text,
  blood_group        text,
  marital_status     text check (marital_status in ('Single','Married','Divorced')),
  sex                text check (sex in ('Male','Female')),
  nationality        text,
  religion           text,
  is_draft           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_employees_updated before update on public.employees
  for each row execute function public.set_updated_at();
create index if not exists idx_employees_manager on public.employees(manager_id);
create index if not exists idx_employees_department on public.employees(department_id);

-- 3) RLS (read open like other masters; write gated by 'masters').
alter table public.employees enable row level security;
create policy employees_read on public.employees for select to authenticated using (true);
create policy employees_insert on public.employees for insert to authenticated
  with check (public.has_permission('masters','create'));
create policy employees_update on public.employees for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy employees_delete on public.employees for delete to authenticated
  using (public.has_permission('masters','delete'));
