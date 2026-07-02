-- ============================================================================
-- Raagam ERP — 0026 Planning ▸ BOM for Internal Work Orders
-- Additive sub-module (legacy EDP2: Planning ▸ "BOM for internal orders /
-- Prepare material BOM for internal work order"). The MATERIAL breakdown for
-- an internal work order (the IWO itself is Orders ▸ 0024). References
-- internal_work_orders; gated by the EXISTING 'planning' permission.
-- ============================================================================

create sequence if not exists public.seq_iwo_bom;
create table if not exists public.iwo_boms (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,                                     -- IWB-0001
  iwo_id     uuid not null references public.internal_work_orders(id) on delete cascade,
  status     text not null default 'draft' check (status in ('draft','final')),
  notes      text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (iwo_id)
);
create trigger trg_iwo_bom_code before insert on public.iwo_boms
  for each row execute function public.assign_code('IWB','public.seq_iwo_bom');
create trigger trg_iwo_bom_updated before update on public.iwo_boms
  for each row execute function public.set_updated_at();

create table if not exists public.iwo_bom_items (
  id          uuid primary key default gen_random_uuid(),
  iwo_bom_id  uuid not null references public.iwo_boms(id) on delete cascade,
  item_id     uuid references public.items(id),
  description text not null,
  quantity    numeric(14,3) not null default 0,
  uom_id      uuid references public.uoms(id),
  unit_cost   numeric(14,4) not null default 0,
  sort_order  int not null default 0
);
create index if not exists idx_iwo_bom_items_bom on public.iwo_bom_items(iwo_bom_id);

do $$
declare t text;
begin
  foreach t in array array['iwo_boms','iwo_bom_items'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
