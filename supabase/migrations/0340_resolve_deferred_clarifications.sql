-- ============================================================================
-- Raagam ERP — 0340 Resolve Deferred Clarifications
--
-- Items resolved by reading actual VB.NET source at:
--   C:/Users/admin/Desktop/Rp software/Decompiled/ValuePlus/
--
-- 1. Seed missing "Twisted" yarn_type in config_lookups
-- 2. Department per-location division picker: new child table
-- ============================================================================

-- ==========================================================================
-- 1. Seed missing "Twisted" yarn_type value
--    VB.NET CmbTypeY has: G=Grey, M=Melange, T=Twisted, D=Doubling
--    Current config_lookups has grey, melange, doubling — missing "twisted"
-- ==========================================================================
insert into public.config_lookups (kind, code, name)
select 'yarn_type', 'twisted', 'Twisted'
where not exists (
  select 1 from public.config_lookups
  where kind = 'yarn_type' and code = 'twisted'
);

-- ==========================================================================
-- 2. Department per-location division picker
--    VB.NET FrmDepartment.vb: each location row has "All Divisions" checkbox
--    + a child band "Divisions" with DivisionShortName picker.
--    When All Divisions is unchecked, specific divisions are picked.
-- ==========================================================================
create table if not exists public.department_location_divisions (
  id                      uuid primary key default gen_random_uuid(),
  department_location_id  uuid not null references public.department_locations(id) on delete cascade,
  division_id             uuid not null references public.divisions(id) on delete cascade,
  sno                     integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint dept_loc_div_unique unique (department_location_id, division_id)
);

create trigger trg_dept_loc_div_updated before update on public.department_location_divisions
  for each row execute function public.set_updated_at();

create index if not exists idx_dept_loc_divs_parent
  on public.department_location_divisions(department_location_id);

-- RLS
alter table public.department_location_divisions enable row level security;

create policy dept_loc_div_read on public.department_location_divisions
  for select to authenticated using (true);
create policy dept_loc_div_insert on public.department_location_divisions
  for insert to authenticated with check (public.has_permission('masters','create'));
create policy dept_loc_div_update on public.department_location_divisions
  for update to authenticated
  using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));
create policy dept_loc_div_delete on public.department_location_divisions
  for delete to authenticated using (public.has_permission('masters','delete'));
