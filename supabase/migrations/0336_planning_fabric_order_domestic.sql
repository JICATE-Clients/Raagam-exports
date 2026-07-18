-- ============================================================================
-- Raagam ERP — 0336 Planning ▸ Fabric Order + Domestic Production Plan
--
-- Fabric Order = internal fabric procurement order per sales order.
-- 6-level hierarchy: styles → fabric details → combos → sizes.
-- Includes yarn/fabric dyeing colors and roll form prints.
--
-- Domestic Production Plan = local production by style/pack/size with
-- box distribution for domestic orders.
-- ============================================================================

-- ==========================================================================
-- 1. Fabric Orders
-- ==========================================================================
create sequence if not exists public.seq_fabric_order;
create table if not exists public.fabric_orders (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sales_order_id        uuid references public.sales_orders(id) on delete set null,
  order_date            date not null default current_date,
  customer_id           uuid references public.buyers(id) on delete set null,
  status                text not null default 'draft'
    check (status in ('draft','submitted','approved','cancelled')),
  location_id           uuid references public.locations(id) on delete set null,
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_fo_code before insert on public.fabric_orders
  for each row execute function public.assign_code('FBO','public.seq_fabric_order');
create trigger trg_fo_updated before update on public.fabric_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_fo_so on public.fabric_orders(sales_order_id);
create index if not exists idx_fo_location on public.fabric_orders(location_id);

-- ==========================================================================
-- 2. Fabric Order Styles
-- ==========================================================================
create table if not exists public.fabric_order_styles (
  id                    uuid primary key default gen_random_uuid(),
  fabric_order_id       uuid not null references public.fabric_orders(id) on delete cascade,
  sno                   integer not null default 0,
  style_ref_no          text,
  article_no            text,
  delivery_date         date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_fos_updated before update on public.fabric_order_styles
  for each row execute function public.set_updated_at();
create index if not exists idx_fos_fo on public.fabric_order_styles(fabric_order_id);

-- ==========================================================================
-- 3. Fabric Order Details (per fabric within a style)
-- ==========================================================================
create table if not exists public.fabric_order_details (
  id                    uuid primary key default gen_random_uuid(),
  fabric_style_id       uuid not null references public.fabric_order_styles(id) on delete cascade,
  sno                   integer not null default 0,
  category_name         text,
  fabric_description    text,
  category_type         text,
  gsm                   numeric(10,2),
  fabric_type           text,
  stage                 text,
  uom_id                text,
  plan_uom_id           text,
  plan_uom_conv         numeric(14,4) default 1,
  order_qty             numeric(14,3) default 0,
  rate                  numeric(14,4) default 0,
  freight_per_piece     numeric(14,4) default 0,
  insurance_per_piece   numeric(14,4) default 0,
  total_value           numeric(14,2) default 0,
  plan_qty              numeric(14,3) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_fod_updated before update on public.fabric_order_details
  for each row execute function public.set_updated_at();
create index if not exists idx_fod_style on public.fabric_order_details(fabric_style_id);

-- ==========================================================================
-- 4. Fabric Order Combos (color/print per fabric detail)
-- ==========================================================================
create table if not exists public.fabric_order_combos (
  id                    uuid primary key default gen_random_uuid(),
  fabric_detail_id      uuid not null references public.fabric_order_details(id) on delete cascade,
  sno                   integer not null default 0,
  item_color            text,
  print_name            text,
  specification         text,
  order_qty             numeric(14,3) default 0,
  rate                  numeric(14,4) default 0,
  total_value           numeric(14,2) default 0,
  plan_qty              numeric(14,3) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_foc_updated before update on public.fabric_order_combos
  for each row execute function public.set_updated_at();
create index if not exists idx_foc_detail on public.fabric_order_combos(fabric_detail_id);

-- ==========================================================================
-- 5. Fabric Order Sizes (per combo or direct per detail)
-- ==========================================================================
create table if not exists public.fabric_order_sizes (
  id                    uuid primary key default gen_random_uuid(),
  fabric_combo_id       uuid references public.fabric_order_combos(id) on delete cascade,
  fabric_detail_id      uuid references public.fabric_order_details(id) on delete cascade,
  sno                   integer not null default 0,
  item_size             text not null,
  uom_id                text,
  plan_uom_id           text,
  plan_uom_conv         numeric(14,4) default 1,
  order_qty             numeric(14,3) default 0,
  wt_per_uom            numeric(14,4),
  rate                  numeric(14,4) default 0,
  total_value           numeric(14,2) default 0,
  plan_qty              numeric(14,3) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_fosz_updated before update on public.fabric_order_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_fosz_combo on public.fabric_order_sizes(fabric_combo_id);
create index if not exists idx_fosz_detail on public.fabric_order_sizes(fabric_detail_id);

-- ==========================================================================
-- 6. Fabric Order Dyeing Colors
-- ==========================================================================
create table if not exists public.fabric_order_dye_colors (
  id                    uuid primary key default gen_random_uuid(),
  fabric_order_id       uuid not null references public.fabric_orders(id) on delete cascade,
  color_type            text not null check (color_type in ('yarn','fabric')),
  sno                   integer not null default 0,
  description           text,
  process_loss_pct      numeric(8,2) default 0,
  dye_type              text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_fodc_fo on public.fabric_order_dye_colors(fabric_order_id);

-- ==========================================================================
-- 7. Domestic Production Plans
-- ==========================================================================
create sequence if not exists public.seq_domestic_prod_plan;
create table if not exists public.domestic_production_plans (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sales_order_id        uuid references public.sales_orders(id) on delete set null,
  plan_date             date not null default current_date,
  customer_id           uuid references public.buyers(id) on delete set null,
  status                text not null default 'draft'
    check (status in ('draft','confirmed','cancelled')),
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_dpp_code before insert on public.domestic_production_plans
  for each row execute function public.assign_code('DPP','public.seq_domestic_prod_plan');
create trigger trg_dpp_updated before update on public.domestic_production_plans
  for each row execute function public.set_updated_at();
create index if not exists idx_dpp_so on public.domestic_production_plans(sales_order_id);

-- ==========================================================================
-- 8. Domestic Production Plan Styles
-- ==========================================================================
create table if not exists public.domestic_prod_plan_styles (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               uuid not null references public.domestic_production_plans(id) on delete cascade,
  sno                   integer not null default 0,
  style_ref_no          text,
  style_no              text,
  style_description     text,
  uom_id                text,
  order_qty             numeric(14,3) default 0,
  no_of_box             integer default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_dpps_updated before update on public.domestic_prod_plan_styles
  for each row execute function public.set_updated_at();
create index if not exists idx_dpps_plan on public.domestic_prod_plan_styles(plan_id);

-- ==========================================================================
-- 9. Domestic Production Plan Sizes (per style)
-- ==========================================================================
create table if not exists public.domestic_prod_plan_sizes (
  id                    uuid primary key default gen_random_uuid(),
  plan_style_id         uuid not null references public.domestic_prod_plan_styles(id) on delete cascade,
  sno                   integer not null default 0,
  garment_size          text not null,
  no_of_box             integer default 0,
  order_qty             numeric(14,3) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_dppss_updated before update on public.domestic_prod_plan_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_dppss_style on public.domestic_prod_plan_sizes(plan_style_id);

-- ==========================================================================
-- 10. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'fabric_orders','fabric_order_styles','fabric_order_details',
    'fabric_order_combos','fabric_order_sizes','fabric_order_dye_colors',
    'domestic_production_plans','domestic_prod_plan_styles','domestic_prod_plan_sizes'
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
