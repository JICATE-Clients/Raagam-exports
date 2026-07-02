-- ============================================================================
-- Raagam ERP — 0216 Administration ▸ Asset management   [Lane B · band 0200–0299]
-- ADD-ONLY: does not touch existing admin (users/roles) tables. Legacy EDP2:
-- Administration ▸ Asset (Groups/Activities/Categories/Openings/No-Assigns/
-- Deliveries/Returns). Asset master (code = asset no.) + assignment history
-- (delivery/return). Gated by the EXISTING 'system_admin' permission.
-- ============================================================================

create sequence if not exists public.seq_asset;
create table if not exists public.assets (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                  -- AST-0001 (asset no.)
  name          text not null,
  category      text,
  asset_group   text,
  location_id   uuid references public.locations(id) on delete set null,
  status        text not null default 'active'
                  check (status in ('active','assigned','retired','disposed')),
  purchase_date date,
  value         numeric(14,2),
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_asset_code before insert on public.assets
  for each row execute function public.assign_code('AST','public.seq_asset');
create trigger trg_asset_updated before update on public.assets
  for each row execute function public.set_updated_at();
create index if not exists idx_asset_status on public.assets(status);

create table if not exists public.asset_assignments (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references public.assets(id) on delete cascade,
  assignee_name text not null,
  department    text,
  assigned_date date,
  returned_date date,
  status        text not null default 'assigned' check (status in ('assigned','returned')),
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_asset_assign on public.asset_assignments(asset_id);

do $$
declare t text;
begin
  foreach t in array array['assets','asset_assignments'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('system_admin','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('system_admin','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('system_admin','edit')) with check (public.has_permission('system_admin','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('system_admin','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
