-- ============================================================================
-- Raagam ERP — 0372 Planning ▸ Production Planning (Phase 5)
-- Rebuilt from VB.NET deep-dive of 2 forms (ver_30A, company 38):
--   FrmCapacityPlanning, FrmProductionPlanning.
-- Both are filter + hierarchical grid (PlanOrders → Details when split).
-- No company gates for company 38. WithSplitTarget=false (company 7 only).
-- ============================================================================

-- ============================================================================
-- 1. CAPACITY PLANNING — pre-production capacity allocation
-- ============================================================================
create sequence if not exists public.seq_capacity_plan;

create table if not exists public.capacity_plans (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  plan_date           date not null default current_date,
  -- Filter context (stored for reload)
  date_type           text default 'E'
                        check (date_type in ('E','P','D')),  -- Plan Period / Plan Date / Delivery Date
  from_date           date,
  to_date             date,
  -- Workflow
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','rejected')),
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  location_id         uuid references public.locations(id),
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_capplan_code before insert on public.capacity_plans
  for each row execute function public.assign_code('CAPPL','public.seq_capacity_plan');
create trigger trg_capplan_updated before update on public.capacity_plans
  for each row execute function public.set_updated_at();
create index if not exists idx_capplan_status on public.capacity_plans(status);

-- ============================================================================
-- 1a. CAPACITY PLAN — Orders (parent band)
-- ============================================================================
create table if not exists public.capacity_plan_orders (
  id                  uuid primary key default gen_random_uuid(),
  capacity_plan_id    uuid not null references public.capacity_plans(id) on delete cascade,
  sno                 int not null default 0,
  plan_no             int default 0,
  plan_date           date,
  sc_no               text,
  order_no            text,
  customer_name       text,
  style_ref_no        text,
  style_no            text,
  order_qty           int default 0,
  delivery_date       date,
  with_learning_curve boolean default false,
  is_split            boolean default false,
  sam                 numeric(10,3) default 0,    -- Standard Allowed Minutes
  m_os                numeric(10,3) default 0,    -- Machines on Style
  qty_100_pct         int default 0,              -- calculated
  target_qty          int default 0,              -- calculated
  target_efficiency   numeric(8,2) default 0,
  location_name       text,
  team_name           text,
  plan_qty            int default 0,
  days_required       int default 0,              -- calculated
  period_from         date,
  period_to           date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_capplan_order_updated before update on public.capacity_plan_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_capplan_order_parent on public.capacity_plan_orders(capacity_plan_id);

-- ============================================================================
-- 1b. CAPACITY PLAN — Details (child of Orders, when is_split=true)
-- ============================================================================
create table if not exists public.capacity_plan_details (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.capacity_plan_orders(id) on delete cascade,
  sno                 int not null default 0,
  location_name       text,
  team_name           text,
  plan_qty            int default 0,
  days_required       numeric(10,2) default 0,
  period_from         date,
  period_to           date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_capplan_detail_updated before update on public.capacity_plan_details
  for each row execute function public.set_updated_at();
create index if not exists idx_capplan_detail_parent on public.capacity_plan_details(order_id);

-- ============================================================================
-- 2. PRODUCTION PLANNING — post-WO production scheduling
-- ============================================================================
create sequence if not exists public.seq_production_plan;

create table if not exists public.production_plans (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  plan_date           date not null default current_date,
  -- Filter context
  date_type           text default 'E'
                        check (date_type in ('E','P','D')),
  from_date           date,
  to_date             date,
  -- Workflow
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','rejected')),
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  location_id         uuid references public.locations(id),
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_prodplan_code before insert on public.production_plans
  for each row execute function public.assign_code('PRDPL','public.seq_production_plan');
create trigger trg_prodplan_updated before update on public.production_plans
  for each row execute function public.set_updated_at();
create index if not exists idx_prodplan_status on public.production_plans(status);

-- ============================================================================
-- 2a. PRODUCTION PLAN — Orders (parent band, with WO No)
-- ============================================================================
create table if not exists public.production_plan_orders (
  id                  uuid primary key default gen_random_uuid(),
  production_plan_id  uuid not null references public.production_plans(id) on delete cascade,
  sno                 int not null default 0,
  plan_no             text,                       -- string with doc prefix/suffix
  plan_date           date,
  wo_no               text,                       -- Work Order No (key diff from capacity)
  sc_no               text,
  order_no            text,
  customer_name       text,
  style_ref_no        text,
  style_no            text,
  order_qty           int default 0,
  delivery_date       date,
  with_learning_curve boolean default false,
  is_split            boolean default false,
  sam                 numeric(10,3) default 0,
  m_os                numeric(10,3) default 0,    -- Machines on Style
  qty_100_pct         int default 0,              -- calculated
  target_qty          int default 0,
  target_efficiency   numeric(8,2) default 0,
  location_name       text,
  team_name           text,
  plan_qty            int default 0,
  days_required       int default 0,
  period_from         date,
  period_to           date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_prodplan_order_updated before update on public.production_plan_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_prodplan_order_parent on public.production_plan_orders(production_plan_id);

-- ============================================================================
-- 2b. PRODUCTION PLAN — Details (child of Orders, when is_split=true)
-- ============================================================================
create table if not exists public.production_plan_details (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.production_plan_orders(id) on delete cascade,
  sno                 int not null default 0,
  location_name       text,
  team_name           text,
  plan_qty            int default 0,
  days_required       numeric(10,2) default 0,
  period_from         date,
  period_to           date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_prodplan_detail_updated before update on public.production_plan_details
  for each row execute function public.set_updated_at();
create index if not exists idx_prodplan_detail_parent on public.production_plan_details(order_id);

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'capacity_plans','capacity_plan_orders','capacity_plan_details',
    'production_plans','production_plan_orders','production_plan_details'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
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
  end loop;
end $$;
