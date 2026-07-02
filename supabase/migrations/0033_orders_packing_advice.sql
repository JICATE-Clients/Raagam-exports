-- ============================================================================
-- Raagam ERP — 0026 Orders ▸ Packing List Advice
-- Additive sub-module of Orders (legacy EDP2: Sales ▸ Garment Orders ▸
-- "Packing List Advice"). Advises how an order is to be packed: pack method
-- + assortment lines (pcs/carton, cartons, weights). Header + lines, 'orders'.
-- ============================================================================

create sequence if not exists public.seq_packing_advice;
create table if not exists public.packing_advices (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- PLA-0001 (assign_code)
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  pack_method    text not null default 'assorted'
                   check (pack_method in ('solid','assorted','ratio')),
  remarks        text,
  status         text not null default 'draft'
                   check (status in ('draft','finalised','cancelled')),
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_pla_code before insert on public.packing_advices
  for each row execute function public.assign_code('PLA','public.seq_packing_advice');
create trigger trg_pla_updated before update on public.packing_advices
  for each row execute function public.set_updated_at();
create index if not exists idx_pla_order  on public.packing_advices(sales_order_id);
create index if not exists idx_pla_status on public.packing_advices(status);

create table if not exists public.packing_advice_lines (
  id              uuid primary key default gen_random_uuid(),
  advice_id       uuid not null references public.packing_advices(id) on delete cascade,
  description     text not null,                              -- assortment / carton contents
  pcs_per_carton  numeric(14,2) not null default 0,
  carton_count    numeric(14,0) not null default 0,
  net_weight      numeric(12,3),
  gross_weight    numeric(12,3),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_pla_lines_advice on public.packing_advice_lines(advice_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['packing_advices','packing_advice_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
