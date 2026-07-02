-- ============================================================================
-- Raagam ERP — 0218 Master Data ▸ Configure masters   [Lane B band · shared /masters]
-- ADD-ONLY: does not touch existing masters (currencies/uoms/buyers/items).
-- Legacy EDP2: Configure ▸ Materials/Associates/GST. Backfills the material
-- spec masters (via a generic kind-discriminated `config_lookups`), Transporters
-- (Associates), and GST rates. Gated by the EXISTING 'masters' permission
-- (read open like other masters, write gated) — matches 0004 policy style.
-- ============================================================================

-- Generic named-list master (one row per configured value, keyed by `kind`).
create table if not exists public.config_lookups (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in (
               'material_category','composition','yarn_count','yarn_purity',
               'process','component','gauge','knitting_dia','commodity')),
  code       text,
  name       text not null,
  notes      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_config_lookups_updated before update on public.config_lookups
  for each row execute function public.set_updated_at();
create index if not exists idx_config_lookups_kind on public.config_lookups(kind);

create table if not exists public.transporters (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  name           text not null,
  contact_person text,
  phone          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_transporters_updated before update on public.transporters
  for each row execute function public.set_updated_at();

create table if not exists public.gst_rates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  rate_pct   numeric(6,2) not null default 0,
  hsn_code   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_gst_rates_updated before update on public.gst_rates
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['config_lookups','transporters','gst_rates'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
