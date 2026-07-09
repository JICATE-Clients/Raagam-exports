-- ============================================================================
-- Raagam ERP — 0227 Master Data ▸ Materials ▸ Processes (master-detail)
-- Legacy EDP2 "Process" form: header (Process name · Short Desc · Commodity →
-- config_lookups commodity · Billing On · HSN Code free-text · "For" 5 flags ·
-- Blocked · 3 planning flags · Has Sub Categories) + a Sub Categories line grid
-- (Sub Category · Short Description · HSN Code). RLS = 0218 style.
-- ============================================================================

create table if not exists public.processes (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  short_description   text,
  commodity_id        uuid references public.config_lookups(id),
  billing_on          text check (billing_on is null or billing_on in (
                        'Outward Qty','Inward Qty/Wt','Outward Qty/Wt')),
  hsn_code            text,
  for_yarn            boolean not null default false,
  for_fabric          boolean not null default false,
  for_trims           boolean not null default false,
  for_garments        boolean not null default false,
  for_components      boolean not null default false,
  no_planning         boolean not null default false,
  designwise_delivery boolean not null default false,
  is_conversion       boolean not null default false,
  has_sub_categories  boolean not null default false,
  blocked             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_processes_updated before update on public.processes
  for each row execute function public.set_updated_at();
create index if not exists idx_processes_commodity on public.processes(commodity_id);

create table if not exists public.process_sub_categories (
  id                uuid primary key default gen_random_uuid(),
  process_id        uuid not null references public.processes(id) on delete cascade,
  sno               integer not null default 0,
  sub_category      text not null,
  short_description text,
  hsn_code          text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_process_sub_categories_updated before update on public.process_sub_categories
  for each row execute function public.set_updated_at();
create index if not exists idx_process_sub_categories_process
  on public.process_sub_categories(process_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['processes','process_sub_categories'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
