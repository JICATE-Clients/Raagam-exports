-- ============================================================================
-- Raagam ERP — 0271 Orders ▸ TA ▸ TA Plan
-- Legacy RP-Software "TA Plan" form (screenshot _145838): a master-detail
-- Time & Action scheduling DOCUMENT (distinct from the existing per-order
-- ta_plans/ta_milestones in 0006, which stay untouched).
--
--   Header : No (auto TAPLAN) · Dt · Customer (ⓘ buyers) · SC No (ⓘ sales_orders) ·
--            SH Ref No (ⓘ shipment_plans) · Order No · Start Dt · Style (ⓘ garment_styles)
--            + footer: Deliv Dt · Order Qty · Proposed Deliv Dt · Target Dt · No of Days
--   Grid   : S No · Activity (ⓘ ta_activities) · From Activity (▼ predecessor) ·
--            Details · Start Dt · Days Required · End Dt
--
-- Gated by the existing 'orders' module (no new permission).
-- ============================================================================

create sequence if not exists public.seq_ta_plan_doc;

-- ---------- header ----------
create table if not exists public.ta_plan_docs (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique,                                   -- TAPLAN-0001 (No)
  plan_date              date not null default current_date,            -- Dt
  customer_id            uuid references public.buyers(id) on delete set null,
  sales_order_id         uuid references public.sales_orders(id) on delete set null,
  shipment_plan_id       uuid references public.shipment_plans(id) on delete set null,
  order_no               text,
  start_date             date,
  style_id               uuid references public.garment_styles(id) on delete set null,
  delivery_date          date,
  order_qty              numeric(14,0),
  proposed_delivery_date date,
  target_date            date,
  no_of_days             integer,
  created_by             uuid references public.profiles(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_ta_plan_doc_code before insert on public.ta_plan_docs
  for each row execute function public.assign_code('TAPLAN','public.seq_ta_plan_doc');
create trigger trg_ta_plan_doc_updated before update on public.ta_plan_docs
  for each row execute function public.set_updated_at();
create index if not exists idx_ta_plan_docs_order on public.ta_plan_docs(sales_order_id);
create index if not exists idx_ta_plan_docs_customer on public.ta_plan_docs(customer_id);

-- ---------- grid (scheduled activities) ----------
create table if not exists public.ta_plan_activities (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.ta_plan_docs(id) on delete cascade,
  sno              integer not null default 0,
  activity_id      uuid references public.ta_activities(id) on delete set null,
  from_activity_id uuid references public.ta_activities(id) on delete set null,  -- predecessor
  details          text,
  start_date       date,
  days_required    integer,
  end_date         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_ta_plan_activity_updated before update on public.ta_plan_activities
  for each row execute function public.set_updated_at();
create index if not exists idx_ta_plan_activities_plan on public.ta_plan_activities(plan_id);
create index if not exists idx_ta_plan_activities_activity on public.ta_plan_activities(activity_id);

-- ---------- RLS (reuse the existing 'orders' module) ----------
do $$
declare t text;
begin
  foreach t in array array['ta_plan_docs','ta_plan_activities'] loop
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
