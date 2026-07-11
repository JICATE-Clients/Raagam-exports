-- ============================================================================
-- Raagam ERP — 0122 Orders ▸ Garment Order Cancellation
-- Additive sub-module (legacy EDP2: Sales ▸ Garment Orders ▸ "Garment order
-- cancellation"). Upgrades the bare cancel-status (◐) with a reason-logged
-- cancellation record; the action also sets sales_orders.status='cancelled'.
-- One cancellation per order. Gated by the EXISTING 'orders' permission.
-- ============================================================================

create sequence if not exists public.seq_order_cancellation;
create table if not exists public.order_cancellations (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- GOC-0001
  order_id       uuid not null references public.sales_orders(id) on delete cascade,
  reason         text not null,
  cancelled_date date not null default current_date,
  remarks        text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (order_id)                                           -- one cancellation per order
);
create trigger trg_ordcancel_code before insert on public.order_cancellations
  for each row execute function public.assign_code('GOC','public.seq_order_cancellation');
create index if not exists idx_ordcancel_order on public.order_cancellations(order_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['order_cancellations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
