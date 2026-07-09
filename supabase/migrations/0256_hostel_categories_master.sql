-- ============================================================================
-- Raagam ERP — 0256 Master Data ▸ HR ▸ Hostel Category
-- Legacy EDP2 "Hostel Category" form (Configure ▸ HR): the simplest master —
-- Code (manual, optional) · Name (required) · Blocked. Flat table. RLS = masters.
-- ============================================================================

create table if not exists public.hostel_categories (
  id         uuid primary key default gen_random_uuid(),
  code       text,                                   -- manual, nullable, not unique
  name       text not null,
  blocked    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_hostel_categories_updated before update on public.hostel_categories
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy hostel_categories_read on public.hostel_categories for select to authenticated using (true);
    create policy hostel_categories_insert on public.hostel_categories for insert to authenticated with check (public.has_permission('masters','create'));
    create policy hostel_categories_update on public.hostel_categories for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy hostel_categories_delete on public.hostel_categories for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.hostel_categories enable row level security;
end $$;
