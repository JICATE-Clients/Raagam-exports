-- ============================================================================
-- Raagam ERP -- 0356 Inter-department Deliveries
-- From VB.NET FrmFN_Inderdepartmentmaterialdelivery, FrmFN_InterdepartmentMaterialRcpt
-- Material flow between departments within the organization.
-- ============================================================================

create sequence if not exists public.seq_interdept;

create table if not exists public.interdept_deliveries (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  from_department text not null,
  to_department   text not null,
  from_store_id   uuid not null references public.stores(id),
  to_store_id     uuid not null references public.stores(id),
  delivery_date   date,
  status          text not null default 'draft'
                    check (status in ('draft','delivered','received')),
  notes           text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_idd_code before insert on public.interdept_deliveries
  for each row execute function public.assign_code('IDD','public.seq_interdept');
create trigger trg_idd_updated before update on public.interdept_deliveries
  for each row execute function public.set_updated_at();

create table if not exists public.interdept_delivery_lines (
  id            uuid primary key default gen_random_uuid(),
  delivery_id   uuid not null references public.interdept_deliveries(id) on delete cascade,
  item_id       uuid references public.items(id),
  quantity      numeric(14,3) not null default 0,
  uom_id        uuid references public.uoms(id),
  sort_order    int not null default 0
);

create index if not exists idx_iddl_del on public.interdept_delivery_lines(delivery_id);

-- RLS
do $$
declare t text;
begin
  foreach t in array array['interdept_deliveries','interdept_delivery_lines'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('stores','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('stores','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('stores','edit'))
        with check (public.has_permission('stores','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('stores','delete'));
    $f$, t);
  end loop;
end $$;
