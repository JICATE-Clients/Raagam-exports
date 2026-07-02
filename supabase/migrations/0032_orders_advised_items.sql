-- ============================================================================
-- Raagam ERP — 0025 Orders ▸ Advised Items
-- Additive sub-module of Orders (legacy EDP2: Sales ▸ Garment Orders ▸
-- "Prepare Advised Items"). Items the merchandiser advises for an accepted
-- order ahead of formal BOM/purchase. Flat per-order list, gated by 'orders'.
-- ============================================================================

create table if not exists public.order_advised_items (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  description    text not null,
  attribute      text,
  quantity       numeric(14,2) not null default 0,
  unit           text,
  supplier       text,
  remarks        text,
  status         text not null default 'advised'
                   check (status in ('advised','sourced','dropped')),
  sort_order     int not null default 0,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists idx_oai_order  on public.order_advised_items(sales_order_id);
create index if not exists idx_oai_status on public.order_advised_items(status);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['order_advised_items'] loop
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
