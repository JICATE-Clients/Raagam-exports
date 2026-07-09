-- ============================================================================
-- Raagam ERP — 0228 Master Data ▸ Materials ▸ Components (master-detail)
-- Legacy EDP2 "Component" form: header (Short Name req · Description ·
-- All Coordinates · Blocked) + a "Coordinates" line grid (S No · Coordinate
-- free-text). Promoted from the flat config_lookups kind 'component' (too thin
-- for this form), so it gets its own two tables. RLS = 0218 style (open read;
-- write gated by 'masters').
-- ============================================================================

create table if not exists public.components (
  id              uuid primary key default gen_random_uuid(),
  short_name      text not null,
  description     text,
  all_coordinates boolean not null default true,
  blocked         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_components_updated before update on public.components
  for each row execute function public.set_updated_at();

create table if not exists public.component_coordinates (
  id           uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.components(id) on delete cascade,
  sno          integer not null default 0,
  coordinate   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_component_coordinates_updated before update on public.component_coordinates
  for each row execute function public.set_updated_at();
create index if not exists idx_component_coordinates_component
  on public.component_coordinates(component_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['components','component_coordinates'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- Carry over any existing flat 'component' lookup rows (harmless if none) ----------
insert into public.components (short_name, description)
select coalesce(nullif(code, ''), name), name
from public.config_lookups
where kind = 'component';
