-- ============================================================================
-- Raagam ERP — 0021 Planning ▸ Shipment Plans
-- Additive sub-module of the existing Planning module (legacy EDP2:
-- Planning ▸ Materials ▸ "Create Shipment plan").
--
-- Groups one or more sales orders into a planned shipping window (draft →
-- confirmed → cancelled). This is a PLANNING artifact and is intentionally
-- distinct from the Logistics `shipments` register (which is the execution
-- document). Gated by the EXISTING 'planning' permission — no new module,
-- no changes to any existing table.
-- ============================================================================

create sequence if not exists public.seq_shipment_plan;
create table if not exists public.shipment_plans (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,                                  -- SP-0001 (assign_code)
  name         text not null,
  buyer_id     uuid references public.buyers(id) on delete set null,
  planned_date date,
  status       text not null default 'draft'
                 check (status in ('draft','confirmed','cancelled')),
  notes        text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_shipplan_code before insert on public.shipment_plans
  for each row execute function public.assign_code('SP','public.seq_shipment_plan');
create trigger trg_shipplan_updated before update on public.shipment_plans
  for each row execute function public.set_updated_at();
create index if not exists idx_shipplan_status on public.shipment_plans(status);
create index if not exists idx_shipplan_buyer  on public.shipment_plans(buyer_id);

create table if not exists public.shipment_plan_orders (
  shipment_plan_id uuid not null references public.shipment_plans(id) on delete cascade,
  sales_order_id   uuid not null references public.sales_orders(id) on delete cascade,
  planned_qty      numeric(14,3) not null default 0,
  primary key (shipment_plan_id, sales_order_id)
);
create index if not exists idx_shipplanorders_plan on public.shipment_plan_orders(shipment_plan_id);

-- ---------- RLS (reuse the existing 'planning' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['shipment_plans','shipment_plan_orders'] loop
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
