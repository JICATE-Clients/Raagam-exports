-- ============================================================================
-- Raagam ERP — 0034 Orders ▸ Garment Process Amendment
-- Additive sub-module of Orders (legacy EDP2: Sales ▸ Garment Orders ▸
-- "Garment Process Amendment"). Formal, MD-approved record of a change to an
-- accepted order's garment-process plan (see 0019 order_garment_processes).
-- Gated by 'orders'; approval uses 'orders:approve'.
-- ============================================================================

create table if not exists public.garment_process_amendments (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  amendment_type text not null
                   check (amendment_type in ('add','remove','change','resequence')),
  description    text,
  details        jsonb not null default '{}'::jsonb,
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  requested_by   uuid references public.profiles(id) default auth.uid(),
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz,
  decided_reason text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_gpa_order  on public.garment_process_amendments(sales_order_id);
create index if not exists idx_gpa_status on public.garment_process_amendments(status);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['garment_process_amendments'] loop
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
