-- ============================================================================
-- Raagam ERP — 0024 Orders ▸ Internal Work Order
-- Additive sub-module of Orders (legacy EDP2: Sales ▸ Garment Orders ▸
-- "Internal work order"). An internal instruction authorising a unit to
-- execute production for an accepted order. Header + lines, gated by 'orders'.
-- ============================================================================

create sequence if not exists public.seq_internal_work_order;
create table if not exists public.internal_work_orders (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- IWO-0001 (assign_code)
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  location_id    uuid references public.locations(id),        -- unit / dept executing
  title          text not null,
  instructions   text,
  status         text not null default 'draft'
                   check (status in ('draft','issued','completed','cancelled')),
  issued_at      timestamptz,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_iwo_code before insert on public.internal_work_orders
  for each row execute function public.assign_code('IWO','public.seq_internal_work_order');
create trigger trg_iwo_updated before update on public.internal_work_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_iwo_order  on public.internal_work_orders(sales_order_id);
create index if not exists idx_iwo_status on public.internal_work_orders(status);

create table if not exists public.iwo_lines (
  id          uuid primary key default gen_random_uuid(),
  iwo_id      uuid not null references public.internal_work_orders(id) on delete cascade,
  description text not null,
  quantity    numeric(14,2) not null default 0,
  unit        text,
  notes       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_iwo_lines_iwo on public.iwo_lines(iwo_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['internal_work_orders','iwo_lines'] loop
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
