-- ============================================================================
-- Raagam ERP — 0019 Orders ▸ Garment Processes
-- Additive sub-module of Orders (legacy EDP2: Sales ▸ Garment Orders ▸
-- "Define Garment Processes for accepted orders").
--
-- The ordered sequence of garment processes an accepted order goes through
-- (e.g. Cutting → Printing → Embroidery → Sewing → Washing → Finishing → Packing),
-- each marked in-house or outsourced. Child of sales_orders, gated by 'orders'.
-- ============================================================================

create table if not exists public.order_garment_processes (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  sequence       int  not null default 0,
  name           text not null,
  mode           text not null default 'in_house'
                   check (mode in ('in_house','outsourced')),
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_ogp_order on public.order_garment_processes(sales_order_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['order_garment_processes'] loop
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
