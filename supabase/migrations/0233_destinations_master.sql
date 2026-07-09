-- ============================================================================
-- Raagam ERP — 0233 Master Data ▸ Associates ▸ Destinations
-- Legacy EDP2 "Destination" form: Short Name · Country (req, → countries picker
-- with Add) · Name · Blocked. Flat master with a Country FK. RLS = masters.
-- ============================================================================

create table if not exists public.destinations (
  id          uuid primary key default gen_random_uuid(),
  short_name  text,
  country_id  uuid not null references public.countries(id),
  name        text,
  blocked     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_destinations_updated before update on public.destinations
  for each row execute function public.set_updated_at();
create index if not exists idx_destinations_country on public.destinations(country_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy destinations_read on public.destinations for select to authenticated using (true);
    create policy destinations_insert on public.destinations for insert to authenticated with check (public.has_permission('masters','create'));
    create policy destinations_update on public.destinations for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy destinations_delete on public.destinations for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.destinations enable row level security;
end $$;
