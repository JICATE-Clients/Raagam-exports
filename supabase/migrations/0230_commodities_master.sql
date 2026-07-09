-- ============================================================================
-- Raagam ERP — 0230 Master Data ▸ Materials ▸ Commodities (header-only master)
-- Legacy EDP2 "Commodity" form: Short Name · Name · Item Class (req, → the
-- item_class config_lookups picker) · Blocked. Needs its own table (config_lookups
-- can't carry the item_class FK). Promoted from the flat config_lookups kind
-- 'commodity'. RLS = 0218 style (open read; write gated by 'masters').
-- ============================================================================

create table if not exists public.commodities (
  id            uuid primary key default gen_random_uuid(),
  item_class_id uuid not null references public.config_lookups(id),
  short_name    text,
  name          text,
  blocked       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_commodities_updated before update on public.commodities
  for each row execute function public.set_updated_at();
create index if not exists idx_commodities_item_class on public.commodities(item_class_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['commodities'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
