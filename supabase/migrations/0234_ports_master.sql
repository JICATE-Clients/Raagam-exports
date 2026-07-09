-- ============================================================================
-- Raagam ERP — 0233 Master Data ▸ Associates ▸ Ports (header-only master)
-- Legacy EDP2 "Port" form: Short Name · Name · Country (req → countries picker,
-- the ⓘ popup) · Type (Air/Sea/Sea-Air). RLS = 0218 style (open read; write
-- gated by 'masters').
-- ============================================================================

create table if not exists public.ports (
  id          uuid primary key default gen_random_uuid(),
  short_name  text,
  name        text,
  country_id  uuid not null references public.countries(id),
  port_type   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_ports_updated before update on public.ports
  for each row execute function public.set_updated_at();
create index if not exists idx_ports_country on public.ports(country_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['ports'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
