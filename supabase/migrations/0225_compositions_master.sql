-- ============================================================================
-- Raagam ERP — 0225 Master Data ▸ Materials ▸ Compositions (master-detail)
-- Legacy EDP2 "Composition" form: header (Item Class req · Short Name · Name ·
-- Blocked) + a "Mixing" line grid (S No · Description free-text · Mixing %).
-- Too rich for the flat config_lookups engine, so it gets its own two tables.
-- RLS = 0218 style (open read; write gated by 'masters').
-- ============================================================================

create table if not exists public.compositions (
  id            uuid primary key default gen_random_uuid(),
  item_class_id uuid not null references public.config_lookups(id),
  short_name    text,
  name          text,
  blocked       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_compositions_updated before update on public.compositions
  for each row execute function public.set_updated_at();
create index if not exists idx_compositions_item_class on public.compositions(item_class_id);

create table if not exists public.composition_lines (
  id             uuid primary key default gen_random_uuid(),
  composition_id uuid not null references public.compositions(id) on delete cascade,
  sno            integer not null default 0,
  description    text not null,
  mixing_pct     numeric(6,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_composition_lines_updated before update on public.composition_lines
  for each row execute function public.set_updated_at();
create index if not exists idx_composition_lines_composition
  on public.composition_lines(composition_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['compositions','composition_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
