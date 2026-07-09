-- ============================================================================
-- Raagam ERP — 0262 Master Data ▸ HR ▸ Employee Category
-- Legacy EDP2 "Employee category" form (screenshot _154621): a flat master —
-- Short Name · Name (required) · For (Staff / Worker / Staff-Worker) · Blocked +
-- Save / Save As Draft (→ is_draft). The twin of Designation (0260) with an
-- extra Short Name column.
-- Kept DISTINCT from the simple `employee_category` config_lookups kind that the
-- Employee master's Category picker references (same convention as Department
-- 0259 / Designation 0260) — see doc/masters-open-questions.md (should that
-- picker re-point at this table?).
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

create table if not exists public.employee_categories (
  id         uuid primary key default gen_random_uuid(),
  short_name text,
  name       text not null,
  for_type   text not null default 'staff'
               check (for_type in ('staff','worker','staff_worker')),
  blocked    boolean not null default false,
  is_draft   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_employee_categories_updated before update on public.employee_categories
  for each row execute function public.set_updated_at();

do $$
begin
  execute $f$
    create policy employee_categories_read on public.employee_categories for select to authenticated using (true);
    create policy employee_categories_insert on public.employee_categories for insert to authenticated with check (public.has_permission('masters','create'));
    create policy employee_categories_update on public.employee_categories for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy employee_categories_delete on public.employee_categories for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.employee_categories enable row level security;
end $$;
