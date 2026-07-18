-- ============================================================================
-- Raagam ERP — 0338 Planning ▸ Capacity Planning + Production Planning
--
-- Capacity Planning = schedule production across locations/teams with SAM,
-- efficiency targets, and timeline calculations.
--
-- Production Planning = master production schedule linking orders to work
-- orders with timeline forecasting.
--
-- Both are location-specific (per-factory scheduling).
-- ============================================================================

-- ==========================================================================
-- 1. Capacity Plans
-- ==========================================================================
create sequence if not exists public.seq_capacity_plan;
create table if not exists public.capacity_plans (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  plan_date             date not null default current_date,
  location_id           uuid references public.locations(id) on delete set null,
  status                text not null default 'draft'
    check (status in ('draft','confirmed','cancelled')),
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_cp_code before insert on public.capacity_plans
  for each row execute function public.assign_code('CAP','public.seq_capacity_plan');
create trigger trg_cp_updated before update on public.capacity_plans
  for each row execute function public.set_updated_at();
create index if not exists idx_cp_location on public.capacity_plans(location_id);

-- ==========================================================================
-- 2. Capacity Plan Orders (production schedule per order)
-- ==========================================================================
create table if not exists public.capacity_plan_orders (
  id                    uuid primary key default gen_random_uuid(),
  capacity_plan_id      uuid not null references public.capacity_plans(id) on delete cascade,
  sno                   integer not null default 0,
  sales_order_id        uuid references public.sales_orders(id) on delete set null,
  order_no              text,
  customer_name         text,
  style_ref_no          text,
  style_no              text,
  order_qty             numeric(14,3) default 0,
  delivery_date         date,
  sam                   numeric(10,2) default 0,
  target_efficiency     numeric(8,2) default 0,
  target_qty            numeric(14,3) default 0,
  plan_qty              numeric(14,3) default 0,
  days_required         numeric(10,2) default 0,
  period_from           date,
  period_to             date,
  location_name         text,
  team_name             text,
  with_learning_curve   boolean not null default false,
  is_split              boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_cpo_updated before update on public.capacity_plan_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_cpo_plan on public.capacity_plan_orders(capacity_plan_id);
create index if not exists idx_cpo_so on public.capacity_plan_orders(sales_order_id);

-- ==========================================================================
-- 3. Production Plans (master schedule)
-- ==========================================================================
create sequence if not exists public.seq_production_plan;
create table if not exists public.production_plans (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  plan_date             date not null default current_date,
  location_id           uuid references public.locations(id) on delete set null,
  status                text not null default 'draft'
    check (status in ('draft','confirmed','cancelled')),
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_pp_code before insert on public.production_plans
  for each row execute function public.assign_code('PPL','public.seq_production_plan');
create trigger trg_pp_updated before update on public.production_plans
  for each row execute function public.set_updated_at();
create index if not exists idx_pp_location on public.production_plans(location_id);

-- ==========================================================================
-- 4. Production Plan Orders (work order schedule per order)
-- ==========================================================================
create table if not exists public.production_plan_orders (
  id                    uuid primary key default gen_random_uuid(),
  production_plan_id    uuid not null references public.production_plans(id) on delete cascade,
  sno                   integer not null default 0,
  sales_order_id        uuid references public.sales_orders(id) on delete set null,
  work_order_no         text,
  order_no              text,
  customer_name         text,
  style_ref_no          text,
  style_no              text,
  order_qty             numeric(14,3) default 0,
  delivery_date         date,
  sam                   numeric(10,2) default 0,
  target_efficiency     numeric(8,2) default 0,
  target_qty            numeric(14,3) default 0,
  plan_qty              numeric(14,3) default 0,
  days_required         numeric(10,2) default 0,
  period_from           date,
  period_to             date,
  location_name         text,
  team_name             text,
  with_learning_curve   boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ppo_updated before update on public.production_plan_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_ppo_plan on public.production_plan_orders(production_plan_id);
create index if not exists idx_ppo_so on public.production_plan_orders(sales_order_id);

-- ==========================================================================
-- 5. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'capacity_plans','capacity_plan_orders',
    'production_plans','production_plan_orders'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated
        using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (public.has_permission('planning','delete'));
    $f$, t);
  end loop;
end $$;
