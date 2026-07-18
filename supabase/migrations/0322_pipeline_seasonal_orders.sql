-- ============================================================================
-- Raagam ERP — 0322 Sales ▸ Pipeline Orders + Seasonal Orders
--
-- Pipeline Orders = forecast/planned orders for production planning.
-- Links customer, styles, combos, sizes with expected quantities.
-- Tracks fabric/yarn dyeing colors and roll form prints.
--
-- Seasonal Orders = seasonal order planning with styles, combos, sizes.
--
-- Also enriches samples table with work order fields.
-- ============================================================================

-- ==========================================================================
-- 1. Pipeline Orders
-- ==========================================================================
create sequence if not exists public.seq_pipeline_order;
create table if not exists public.pipeline_orders (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  oc_date               date not null default current_date,
  customer_id           uuid references public.buyers(id),
  order_no              text,
  order_date            date,
  is_repeat_order       boolean not null default false,
  customer_department   text,
  season                text,
  season_yr             text,
  sample_for            text,
  receipt_mode          text,
  received_date         date,
  order_category        text,
  previous_oc_ref       text,
  status                text not null default 'draft'
    check (status in ('draft','confirmed','cancelled')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_pipeline_order_code before insert on public.pipeline_orders
  for each row execute function public.assign_code('PLO','public.seq_pipeline_order');
create trigger trg_pipeline_order_updated before update on public.pipeline_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_pipeline_orders_cust on public.pipeline_orders(customer_id);

-- ==========================================================================
-- 2. Pipeline Order Styles
-- ==========================================================================
create table if not exists public.pipeline_order_styles (
  id                    uuid primary key default gen_random_uuid(),
  pipeline_order_id     uuid not null references public.pipeline_orders(id) on delete cascade,
  sno                   integer not null default 0,
  style_ref_no          text,
  style_no              text,
  article_no            text,
  category_name         text,
  style_description     text,
  uom_id                text,
  plan_uom_id           text,
  plan_uom_conv         numeric(14,4),
  order_qty             numeric(14,3) default 0,
  customer_style_desc   text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pipeline_styles_po on public.pipeline_order_styles(pipeline_order_id);

-- ==========================================================================
-- 3. Pipeline Order Style Combos
-- ==========================================================================
create table if not exists public.pipeline_order_combos (
  id                    uuid primary key default gen_random_uuid(),
  pipeline_style_id     uuid not null references public.pipeline_order_styles(id) on delete cascade,
  sno                   integer not null default 0,
  combo                 text,
  percentage            numeric(8,2) default 0,
  calculated_qty        numeric(14,3) default 0,
  order_qty             numeric(14,3) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pipeline_combos_style on public.pipeline_order_combos(pipeline_style_id);

-- ==========================================================================
-- 4. Pipeline Order Combo Sizes
-- ==========================================================================
create table if not exists public.pipeline_order_sizes (
  id                    uuid primary key default gen_random_uuid(),
  pipeline_combo_id     uuid references public.pipeline_order_combos(id) on delete cascade,
  pipeline_style_id     uuid references public.pipeline_order_styles(id) on delete cascade,
  sno                   integer not null default 0,
  garment_size          text not null,
  percentage            numeric(8,2) default 0,
  calculated_qty        numeric(14,3) default 0,
  order_qty             numeric(14,3) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pipeline_sizes_combo on public.pipeline_order_sizes(pipeline_combo_id);
create index if not exists idx_pipeline_sizes_style on public.pipeline_order_sizes(pipeline_style_id);

-- ==========================================================================
-- 5. Pipeline Dyeing Colors (yarn + fabric)
-- ==========================================================================
create table if not exists public.pipeline_dyeing_colors (
  id                    uuid primary key default gen_random_uuid(),
  pipeline_order_id     uuid not null references public.pipeline_orders(id) on delete cascade,
  color_type            text not null check (color_type in ('yarn','fabric')),
  sno                   integer not null default 0,
  description           text,
  process_loss_pct      numeric(8,2) default 0,
  dye_type              text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pipeline_dye_colors_po on public.pipeline_dyeing_colors(pipeline_order_id);

-- ==========================================================================
-- 6. Pipeline Roll Form Prints
-- ==========================================================================
create table if not exists public.pipeline_roll_form_prints (
  id                    uuid primary key default gen_random_uuid(),
  pipeline_order_id     uuid not null references public.pipeline_orders(id) on delete cascade,
  sno                   integer not null default 0,
  description           text,
  print_type            text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pipeline_prints_po on public.pipeline_roll_form_prints(pipeline_order_id);

-- ==========================================================================
-- 7. Seasonal Orders
-- ==========================================================================
create sequence if not exists public.seq_seasonal_order;
create table if not exists public.seasonal_orders (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  oc_date               date not null default current_date,
  customer_id           uuid references public.buyers(id),
  vendor_id             uuid,
  style_no              text,
  season                text,
  season_yr             text,
  order_no              text,
  status                text not null default 'draft'
    check (status in ('draft','confirmed','cancelled')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_seasonal_order_code before insert on public.seasonal_orders
  for each row execute function public.assign_code('SNO','public.seq_seasonal_order');
create trigger trg_seasonal_order_updated before update on public.seasonal_orders
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 8. Seasonal Order Sizes
-- ==========================================================================
create table if not exists public.seasonal_order_sizes (
  id                    uuid primary key default gen_random_uuid(),
  seasonal_order_id     uuid not null references public.seasonal_orders(id) on delete cascade,
  sno                   integer not null default 0,
  garment_size          text not null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_seasonal_sizes_so on public.seasonal_order_sizes(seasonal_order_id);

-- ==========================================================================
-- 9. Seasonal Order Combos
-- ==========================================================================
create table if not exists public.seasonal_order_combos (
  id                    uuid primary key default gen_random_uuid(),
  seasonal_order_id     uuid not null references public.seasonal_orders(id) on delete cascade,
  sno                   integer not null default 0,
  combo                 text,
  combo_description     text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_seasonal_combos_so on public.seasonal_order_combos(seasonal_order_id);

-- ==========================================================================
-- 10. Enrich samples with work order fields
-- ==========================================================================
alter table public.samples
  add column if not exists stage_from      text check (stage_from is null or stage_from in ('cut','fabric')),
  add column if not exists stage_to        text check (stage_to is null or stage_to in ('pack','fabric')),
  add column if not exists sourcing_type   text check (sourcing_type is null or sourcing_type in ('in_house','outsource')),
  add column if not exists vendor_id       uuid,
  add column if not exists fabric_value    numeric(14,2) default 0,
  add column if not exists cmt_value       numeric(14,2) default 0,
  add column if not exists accessories_value numeric(14,2) default 0,
  add column if not exists garment_process_value numeric(14,2) default 0,
  add column if not exists net_value       numeric(14,2) default 0,
  add column if not exists overhead_pct    numeric(8,2) default 0,
  add column if not exists overhead_value  numeric(14,2) default 0,
  add column if not exists gross_value     numeric(14,2) default 0,
  add column if not exists remarks         text;

-- ==========================================================================
-- 11. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'pipeline_orders','pipeline_order_styles','pipeline_order_combos',
    'pipeline_order_sizes','pipeline_dyeing_colors','pipeline_roll_form_prints',
    'seasonal_orders','seasonal_order_sizes','seasonal_order_combos'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated
        using (public.has_permission('sales','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (public.has_permission('sales','create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (public.has_permission('sales','edit'))
        with check (public.has_permission('sales','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (public.has_permission('sales','delete'));
    $f$, t);
  end loop;
end $$;
