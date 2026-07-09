-- ============================================================================
-- Raagam ERP — 0259 Master Data ▸ HR ▸ Department
-- Legacy EDP2 "Department" form: a rich master (NOT the simple `department`
-- config_lookups kind that the Employee/Consignee/Courier pickers reference):
--   Header : Short Name (req) · Name · Doc Prefix · Warehouse · Blocked ·
--            Item-Class applicability checklist (Yarn/Fabric/Sewing/Packing/
--            Garments/General) stored as text[]
--   Grid   : Location (→ locations) · All Divisions flag
-- RLS = masters. Kept distinct from the `department` config_lookups kind — see
-- doc/masters-open-questions.md (should the pickers re-point at this table?).
-- ============================================================================

create table if not exists public.departments (
  id           uuid primary key default gen_random_uuid(),
  short_name   text not null,
  name         text,
  doc_prefix   text,
  warehouse    boolean not null default false,
  blocked      boolean not null default false,
  item_classes text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_departments_updated before update on public.departments
  for each row execute function public.set_updated_at();

create table if not exists public.department_locations (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  sno           integer not null default 0,
  location_id   uuid references public.locations(id) on delete set null,
  all_divisions boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_department_locations_updated before update on public.department_locations
  for each row execute function public.set_updated_at();
create index if not exists idx_department_locations_department on public.department_locations(department_id);
create index if not exists idx_department_locations_location on public.department_locations(location_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['departments','department_locations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
