-- ============================================================================
-- Raagam ERP — 0371 Planning ▸ Material Planning (Phase 4)
-- Rebuilt from VB.NET deep-dive of 5 forms (ver_30A, company 38):
--   FrmMaterialExcessPlan, FrmMaterialRate, FrmFabricOrder,
--   FrmFabricConsumption, FrmExcess_Order.
-- ============================================================================

-- ============================================================================
-- 1. MATERIAL EXCESS PLAN — allowance % for BOM items (To Order/Issue/Receive)
-- ============================================================================
create sequence if not exists public.seq_material_excess_plan;

create table if not exists public.material_excess_plans (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  entry_date          date not null default current_date,
  customer_id         uuid references public.customers(id),
  group_no            text,              -- SQ No or PPM No
  group_description   text,
  parent_group_no     text,              -- parent SQ when accessed from PPM
  is_allowance_from_base boolean not null default false,
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

create trigger trg_matexcess_code before insert on public.material_excess_plans
  for each row execute function public.assign_code('MEXPL','public.seq_material_excess_plan');
create trigger trg_matexcess_updated before update on public.material_excess_plans
  for each row execute function public.set_updated_at();
create index if not exists idx_matexcess_customer on public.material_excess_plans(customer_id);
create index if not exists idx_matexcess_status on public.material_excess_plans(status);

-- ============================================================================
-- 1a. MATERIAL EXCESS PLAN — Items (BOM items with allowance bands)
-- ============================================================================
create table if not exists public.material_excess_plan_items (
  id                    uuid primary key default gen_random_uuid(),
  excess_plan_id        uuid not null references public.material_excess_plans(id) on delete cascade,
  sno                   int not null default 0,
  item_class_name       text,
  description           text,
  process_name          text,
  uom_id                uuid references public.uoms(id),
  qty_for_plan          numeric(14,3) default 0,
  wt_for_plan           numeric(14,3) default 0,
  -- To Order band
  allowance_type_to_order  text default 'P'
                             check (allowance_type_to_order in ('P','F','R')),  -- %/Flat/Rounded
  allowed_to_order      numeric(14,3) default 0,
  -- To Issue band
  allowance_type_to_issue  text default 'P'
                             check (allowance_type_to_issue in ('P','F','R')),
  allowed_to_issue      numeric(14,3) default 0,
  -- To Receive band
  allowance_type_to_receive text default 'P'
                              check (allowance_type_to_receive in ('P','F','R')),
  allowed_to_receive    numeric(14,3) default 0,
  is_size_wise          boolean default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_matexcess_item_updated before update on public.material_excess_plan_items
  for each row execute function public.set_updated_at();
create index if not exists idx_matexcess_item_parent on public.material_excess_plan_items(excess_plan_id);

-- ============================================================================
-- 1b. MATERIAL EXCESS PLAN — BOM Sizes (child of Items, for GAR size-wise)
-- ============================================================================
create table if not exists public.material_excess_plan_sizes (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references public.material_excess_plan_items(id) on delete cascade,
  sno                   int not null default 0,
  item_size             text,
  allowed_to_order      numeric(14,3) default 0,
  allowed_to_issue      numeric(14,3) default 0,
  allowed_to_receive    numeric(14,3) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_matexcess_size_updated before update on public.material_excess_plan_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_matexcess_size_parent on public.material_excess_plan_sizes(item_id);

-- ============================================================================
-- 2. MATERIAL RATE — rate fixing for Sewing Thread / Tape BOM items
-- ============================================================================
create sequence if not exists public.seq_material_rate;

create table if not exists public.material_rates (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  entry_date          date not null default current_date,
  customer_id         uuid references public.customers(id),
  group_no            text,              -- J/W No (Jobwork Orders)
  group_description   text,
  parent_group_no     text,              -- PPM No
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

create trigger trg_matrate_code before insert on public.material_rates
  for each row execute function public.assign_code('MRATE','public.seq_material_rate');
create trigger trg_matrate_updated before update on public.material_rates
  for each row execute function public.set_updated_at();
create index if not exists idx_matrate_customer on public.material_rates(customer_id);
create index if not exists idx_matrate_status on public.material_rates(status);

-- ============================================================================
-- 2a. MATERIAL RATE — Items (flat, rate per BOM item)
-- ============================================================================
create table if not exists public.material_rate_items (
  id                  uuid primary key default gen_random_uuid(),
  material_rate_id    uuid not null references public.material_rates(id) on delete cascade,
  sno                 int not null default 0,
  description         text,
  rate_uom_id         uuid references public.uoms(id),
  rate                numeric(14,4) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_matrate_item_updated before update on public.material_rate_items
  for each row execute function public.set_updated_at();
create index if not exists idx_matrate_item_parent on public.material_rate_items(material_rate_id);

-- ============================================================================
-- 3. FABRIC ORDER — the largest form, 4-level hierarchy
-- ============================================================================
create sequence if not exists public.seq_fabric_order;

create table if not exists public.fabric_orders (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  oc_date             date not null default current_date,
  customer_id         uuid references public.customers(id),
  order_no            text,
  is_repeat_order     boolean not null default false,
  amendment_no        int not null default 0,
  order_date          date,
  delivery_date       date,
  currency_code       text default 'INR',
  exchange_rate       numeric(14,4) default 1,
  ship_type           text,              -- FOB/C&F/CFR/CIF
  ship_mode           text,
  pay_mode            text,
  -- Logistic
  received_date       date,
  customer_contact    text,
  customer_department text,
  agent_name          text,
  pay_terms           text,
  country_id          text,
  receipt_mode        text,
  season              text,
  season_year         int,
  -- Pricing / additions / deductions
  gross_value         numeric(16,2) default 0,
  bonus               numeric(14,2) default 0,
  bonus_type          text,              -- A=Amount, F=Fixed
  bonus_rate_mode     text,              -- I=Inclusive, E=Exclusive, B=Both
  buyer_commission    numeric(14,2) default 0,
  buyer_commission_type text,
  buyer_commission_rate_mode text,
  agent_commission    numeric(14,2) default 0,
  agent_commission_type text,
  agent_commission_rate_mode text,
  discount            numeric(14,2) default 0,
  discount_type       text,
  discount_rate_mode  text,
  less_other_desc_1   text,
  less_other_type_1   text,
  less_other_value_1  numeric(14,2) default 0,
  less_other_rate_mode_1 text,
  less_other_desc_2   text,
  less_other_type_2   text,
  less_other_value_2  numeric(14,2) default 0,
  less_other_rate_mode_2 text,
  add_other_desc_1    text,
  add_other_type_1    text,
  add_other_value_1   numeric(14,2) default 0,
  add_other_rate_mode_1 text,
  add_other_desc_2    text,
  add_other_type_2    text,
  add_other_value_2   numeric(14,2) default 0,
  add_other_rate_mode_2 text,
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

create trigger trg_faborder_code before insert on public.fabric_orders
  for each row execute function public.assign_code('FABORD','public.seq_fabric_order');
create trigger trg_faborder_updated before update on public.fabric_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_faborder_customer on public.fabric_orders(customer_id);
create index if not exists idx_faborder_status on public.fabric_orders(status);

-- ============================================================================
-- 3a. FABRIC ORDER — Color/Print/Structure detail grids (Tab 1)
-- ============================================================================
create table if not exists public.fabric_order_colors (
  id                  uuid primary key default gen_random_uuid(),
  fabric_order_id     uuid not null references public.fabric_orders(id) on delete cascade,
  color_type          text not null check (color_type in ('yarn_dye','fabric_dye','dia_size','roll_form_print')),
  sno                 int not null default 0,
  type_code           text,              -- Y/G/F/M/C/T/W/R etc.
  description         text,
  process_loss_pct    numeric(8,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_faborder_color_updated before update on public.fabric_order_colors
  for each row execute function public.set_updated_at();
create index if not exists idx_faborder_color_parent on public.fabric_order_colors(fabric_order_id);

create table if not exists public.fabric_order_structures (
  id                  uuid primary key default gen_random_uuid(),
  fabric_order_id     uuid not null references public.fabric_orders(id) on delete cascade,
  sno                 int not null default 0,
  category_name       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_faborder_struct_updated before update on public.fabric_order_structures
  for each row execute function public.set_updated_at();
create index if not exists idx_faborder_struct_parent on public.fabric_order_structures(fabric_order_id);

-- ============================================================================
-- 3b. FABRIC ORDER — Styles (Band 0 of FabricDetails tab)
-- ============================================================================
create table if not exists public.fabric_order_styles (
  id                  uuid primary key default gen_random_uuid(),
  fabric_order_id     uuid not null references public.fabric_orders(id) on delete cascade,
  sno                 int not null default 0,
  style_ref_no        text,
  article_no          text,
  delivery_date       date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_faborder_style_updated before update on public.fabric_order_styles
  for each row execute function public.set_updated_at();
create index if not exists idx_faborder_style_parent on public.fabric_order_styles(fabric_order_id);

-- ============================================================================
-- 3c. FABRIC ORDER — Fabric Details (child of Styles)
-- ============================================================================
create table if not exists public.fabric_order_details (
  id                  uuid primary key default gen_random_uuid(),
  style_id            uuid not null references public.fabric_order_styles(id) on delete cascade,
  sno                 int not null default 0,
  category_name       text,
  fabric_description  text,
  category_type       text,              -- C=Circular, F=Flat, W=Woven
  description         text,
  gsm                 int,
  fabric_type         text,              -- S=Solid, Y=Yarn Dyed, L=Melange, C=Converted
  stage               text,              -- GREY/DYED/WASH/PRINT
  uom_id              uuid references public.uoms(id),
  plan_uom_id         uuid references public.uoms(id),
  plan_uom_conv       numeric(14,4) default 1,
  order_qty           numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  freight_per_piece   numeric(14,4) default 0,
  insurance_per_piece numeric(14,4) default 0,
  total_value         numeric(16,2) default 0,
  plan_qty            numeric(14,3) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_faborder_detail_updated before update on public.fabric_order_details
  for each row execute function public.set_updated_at();
create index if not exists idx_faborder_detail_parent on public.fabric_order_details(style_id);

-- ============================================================================
-- 3d. FABRIC ORDER — Combos (child of FabricDetails, when stage != GREY)
-- ============================================================================
create table if not exists public.fabric_order_combos (
  id                  uuid primary key default gen_random_uuid(),
  detail_id           uuid not null references public.fabric_order_details(id) on delete cascade,
  sno                 int not null default 0,
  item_color          text,
  print_name          text,
  specification       text,
  order_qty           numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  total_value         numeric(16,2) default 0,
  plan_qty            numeric(14,3) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_faborder_combo_updated before update on public.fabric_order_combos
  for each row execute function public.set_updated_at();
create index if not exists idx_faborder_combo_parent on public.fabric_order_combos(detail_id);

-- ============================================================================
-- 3e. FABRIC ORDER — Sizes (child of Combos OR direct child of FabricDetails for GREY)
-- ============================================================================
create table if not exists public.fabric_order_sizes (
  id                  uuid primary key default gen_random_uuid(),
  combo_id            uuid references public.fabric_order_combos(id) on delete cascade,
  detail_id           uuid references public.fabric_order_details(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  uom_id              uuid references public.uoms(id),
  plan_uom_id         uuid references public.uoms(id),
  plan_uom_conv       numeric(14,4) default 1,
  order_qty           numeric(14,3) default 0,
  wt_per_uom          numeric(14,4) default 0,
  rate                numeric(14,4) default 0,
  total_value         numeric(16,2) default 0,
  plan_qty            numeric(14,3) default 0,
  -- One of combo_id or detail_id must be set
  check (combo_id is not null or detail_id is not null),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_faborder_size_updated before update on public.fabric_order_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_faborder_size_combo on public.fabric_order_sizes(combo_id);
create index if not exists idx_faborder_size_detail on public.fabric_order_sizes(detail_id);

-- ============================================================================
-- 4. FABRIC CONSUMPTION — style/component/fabric consumption setup
-- ============================================================================
create sequence if not exists public.seq_fabric_consumption;

create table if not exists public.fabric_consumptions (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  -- UOM config
  uom_id              uuid references public.uoms(id),
  stock_uom_id        uuid references public.uoms(id),
  prod_uom_id         uuid references public.uoms(id),
  sales_uom_id        uuid references public.uoms(id),
  -- HSN / Size group
  size_group_no       text,
  hsn_code            text,
  -- Coordinates (up to 6)
  no_of_coordinates   int default 0,
  coordinate_1        text,
  coordinate_2        text,
  coordinate_3        text,
  coordinate_4        text,
  coordinate_5        text,
  coordinate_6        text,
  -- Description
  customer_style_description text,
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

create trigger trg_fabcons_code before insert on public.fabric_consumptions
  for each row execute function public.assign_code('FABCON','public.seq_fabric_consumption');
create trigger trg_fabcons_updated before update on public.fabric_consumptions
  for each row execute function public.set_updated_at();
create index if not exists idx_fabcons_status on public.fabric_consumptions(status);

-- ============================================================================
-- 4a. FABRIC CONSUMPTION — Components
-- ============================================================================
create table if not exists public.fabric_consumption_components (
  id                  uuid primary key default gen_random_uuid(),
  consumption_id      uuid not null references public.fabric_consumptions(id) on delete cascade,
  sno                 int not null default 0,
  coordinate          text,
  component           text,
  category_name       text,
  item_type           text,              -- C=Circular, F=Flat, W=Woven
  can_be_sewing_accessories boolean default false,
  sewing_category_name text,
  is_main_component   boolean default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_fabcons_comp_updated before update on public.fabric_consumption_components
  for each row execute function public.set_updated_at();
create index if not exists idx_fabcons_comp_parent on public.fabric_consumption_components(consumption_id);

-- ============================================================================
-- 4b. FABRIC CONSUMPTION — Consumptions (with child sizes)
-- ============================================================================
create table if not exists public.fabric_consumption_entries (
  id                  uuid primary key default gen_random_uuid(),
  consumption_id      uuid not null references public.fabric_consumptions(id) on delete cascade,
  sno                 int not null default 0,
  fabric              text,
  multiple_components text,
  components          text,
  entry_no            text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_fabcons_entry_updated before update on public.fabric_consumption_entries
  for each row execute function public.set_updated_at();
create index if not exists idx_fabcons_entry_parent on public.fabric_consumption_entries(consumption_id);

create table if not exists public.fabric_consumption_sizes (
  id                  uuid primary key default gen_random_uuid(),
  entry_id            uuid not null references public.fabric_consumption_entries(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  dia                 text,
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_fabcons_size_updated before update on public.fabric_consumption_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_fabcons_size_parent on public.fabric_consumption_sizes(entry_id);

-- ============================================================================
-- 4c. FABRIC CONSUMPTION — Combos and Garment Sizes
-- ============================================================================
create table if not exists public.fabric_consumption_combos (
  id                  uuid primary key default gen_random_uuid(),
  consumption_id      uuid not null references public.fabric_consumptions(id) on delete cascade,
  sno                 int not null default 0,
  combo               text,
  combo_description   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_fabcons_combo_updated before update on public.fabric_consumption_combos
  for each row execute function public.set_updated_at();
create index if not exists idx_fabcons_combo_parent on public.fabric_consumption_combos(consumption_id);

create table if not exists public.fabric_consumption_garment_sizes (
  id                  uuid primary key default gen_random_uuid(),
  consumption_id      uuid not null references public.fabric_consumptions(id) on delete cascade,
  sno                 int not null default 0,
  garment_size        text,
  pcs_per_box         int default 0,
  production_ratio    int default 0,
  minimum_stock       int default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_fabcons_garsz_updated before update on public.fabric_consumption_garment_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_fabcons_garsz_parent on public.fabric_consumption_garment_sizes(consumption_id);

-- ============================================================================
-- 5. EXCESS ORDER — Requisition for Shortage
-- ============================================================================
create sequence if not exists public.seq_excess_order;

create table if not exists public.excess_orders (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  req_date            date not null default current_date,
  ppm_code            text,              -- PPM No reference
  garment_ppm_id      uuid references public.garment_ppms(id),
  customer_name       text,
  sq_no               text,
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

create trigger trg_excessord_code before insert on public.excess_orders
  for each row execute function public.assign_code('EXORD','public.seq_excess_order');
create trigger trg_excessord_updated before update on public.excess_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_excessord_ppm on public.excess_orders(garment_ppm_id);
create index if not exists idx_excessord_status on public.excess_orders(status);

-- ============================================================================
-- 5a. EXCESS ORDER — Items
-- ============================================================================
create table if not exists public.excess_order_items (
  id                  uuid primary key default gen_random_uuid(),
  excess_order_id     uuid not null references public.excess_orders(id) on delete cascade,
  sno                 int not null default 0,
  item_class_name     text,
  description         text,
  uom_id              uuid references public.uoms(id),
  qty                 numeric(14,3) default 0,
  is_size_wise        boolean default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_excessord_item_updated before update on public.excess_order_items
  for each row execute function public.set_updated_at();
create index if not exists idx_excessord_item_parent on public.excess_order_items(excess_order_id);

-- ============================================================================
-- 5b. EXCESS ORDER — Item Sizes (child of Items)
-- ============================================================================
create table if not exists public.excess_order_sizes (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.excess_order_items(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  qty                 numeric(14,3) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_excessord_size_updated before update on public.excess_order_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_excessord_size_parent on public.excess_order_sizes(item_id);

-- ============================================================================
-- 6. RLS POLICIES — all Phase 4 tables
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'material_excess_plans','material_excess_plan_items','material_excess_plan_sizes',
    'material_rates','material_rate_items',
    'fabric_orders','fabric_order_colors','fabric_order_structures',
    'fabric_order_styles','fabric_order_details','fabric_order_combos','fabric_order_sizes',
    'fabric_consumptions','fabric_consumption_components','fabric_consumption_entries',
    'fabric_consumption_sizes','fabric_consumption_combos','fabric_consumption_garment_sizes',
    'excess_orders','excess_order_items','excess_order_sizes'
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
