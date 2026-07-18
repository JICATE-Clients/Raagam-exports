-- ============================================================================
-- Raagam ERP — 0323 Sales ▸ Style Catalogue, Style Price List, PI Enquiries
--
-- Catalogue = reusable product templates with styles, pack types, components.
-- Style Price List = zone-based pricing for styles by size.
-- PI Enquiries = proforma invoice enquiries with product/trim breakdown.
-- ============================================================================

-- ==========================================================================
-- 1. Style Catalogues
-- ==========================================================================
create sequence if not exists public.seq_catalogue;
create table if not exists public.style_catalogues (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  cr_no                 text,
  cr_date               date,
  style_category        text,
  size_group_id         uuid references public.size_groups(id) on delete set null,
  catalogue_description text,
  basic_price           numeric(14,2),
  pcs_per_box           integer,
  hsn_code              text,
  catalogue_for         text,
  blocked               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_catalogue_code before insert on public.style_catalogues
  for each row execute function public.assign_code('CAT','public.seq_catalogue');
create trigger trg_catalogue_updated before update on public.style_catalogues
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 2. Catalogue Styles
-- ==========================================================================
create table if not exists public.catalogue_styles (
  id                    uuid primary key default gen_random_uuid(),
  catalogue_id          uuid not null references public.style_catalogues(id) on delete cascade,
  sno                   integer not null default 0,
  base_style            text,
  design                text,
  style_no              text,
  style_description     text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_cat_styles_cat on public.catalogue_styles(catalogue_id);

-- ==========================================================================
-- 3. Catalogue Pack Types
-- ==========================================================================
create table if not exists public.catalogue_pack_types (
  id                    uuid primary key default gen_random_uuid(),
  catalogue_id          uuid not null references public.style_catalogues(id) on delete cascade,
  sno                   integer not null default 0,
  style_no              text,
  style_description     text,
  combo                 text,
  no_of_pcs             integer,
  created_at            timestamptz not null default now()
);
create index if not exists idx_cat_packs_cat on public.catalogue_pack_types(catalogue_id);

-- ==========================================================================
-- 4. Style Price Lists
-- ==========================================================================
create sequence if not exists public.seq_style_pricelist;
create table if not exists public.style_price_lists (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  pricelist_date        date,
  reference             text,
  effective_from        date,
  style_type            text,
  rate_for              text check (rate_for is null or rate_for in ('bulk','sample')),
  blocked               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_pricelist_code before insert on public.style_price_lists
  for each row execute function public.assign_code('SPL','public.seq_style_pricelist');
create trigger trg_pricelist_updated before update on public.style_price_lists
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 5. Price List Styles (items in a price list)
-- ==========================================================================
create table if not exists public.pricelist_styles (
  id                    uuid primary key default gen_random_uuid(),
  pricelist_id          uuid not null references public.style_price_lists(id) on delete cascade,
  sno                   integer not null default 0,
  style_no              text,
  style_description     text,
  uom_id                text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pl_styles_pl on public.pricelist_styles(pricelist_id);

-- ==========================================================================
-- 6. Price List Size Prices (price per size per style)
-- ==========================================================================
create table if not exists public.pricelist_size_prices (
  id                    uuid primary key default gen_random_uuid(),
  pricelist_style_id    uuid not null references public.pricelist_styles(id) on delete cascade,
  garment_size          text not null,
  price                 numeric(14,2) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pl_size_prices_ps on public.pricelist_size_prices(pricelist_style_id);

-- ==========================================================================
-- 7. PI Enquiries (Proforma Invoice Enquiries)
-- ==========================================================================
create sequence if not exists public.seq_pi_enquiry;
create table if not exists public.pi_enquiries (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  enquiry_date          date not null default current_date,
  enquiry_against       text,
  sample_type           text,
  order_type            text check (order_type is null or order_type in ('new','repeat')),
  action_type           text,
  customer_id           uuid references public.buyers(id),
  country_code          text,
  customer_department   text,
  season                text,
  season_yr             text,
  customer_reference    text,
  agent_name            text,
  received_date         date,
  receipt_mode          text,
  delivery_to           text,
  delivery_mode         text,
  status                text not null default 'draft'
    check (status in ('draft','sent','confirmed','cancelled')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_pi_enquiry_code before insert on public.pi_enquiries
  for each row execute function public.assign_code('PIE','public.seq_pi_enquiry');
create trigger trg_pi_enquiry_updated before update on public.pi_enquiries
  for each row execute function public.set_updated_at();
create index if not exists idx_pi_enquiries_cust on public.pi_enquiries(customer_id);

-- ==========================================================================
-- 8. PI Enquiry Styles
-- ==========================================================================
create table if not exists public.pi_enquiry_styles (
  id                    uuid primary key default gen_random_uuid(),
  pi_enquiry_id         uuid not null references public.pi_enquiries(id) on delete cascade,
  sno                   integer not null default 0,
  style_no              text,
  article_no            text,
  style_description     text,
  fabric_structure      text,
  fabric_description    text,
  uom_id                text,
  order_qty             numeric(14,3),
  expected_order_qty    numeric(14,3),
  delivery_date         date,
  ship_type             text,
  ship_mode             text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pi_styles_pie on public.pi_enquiry_styles(pi_enquiry_id);

-- ==========================================================================
-- 9. PI Enquiry Products (SKU-level under styles)
-- ==========================================================================
create table if not exists public.pi_enquiry_products (
  id                    uuid primary key default gen_random_uuid(),
  pi_style_id           uuid not null references public.pi_enquiry_styles(id) on delete cascade,
  sno                   integer not null default 0,
  product_code          text,
  product_description   text,
  order_qty             numeric(14,3),
  expected_order_qty    numeric(14,3),
  created_at            timestamptz not null default now()
);
create index if not exists idx_pi_products_pis on public.pi_enquiry_products(pi_style_id);

-- ==========================================================================
-- 10. Sample Costing Consumption (fabric consumption for sample costing)
-- ==========================================================================
create table if not exists public.sample_costing_consumptions (
  id                    uuid primary key default gen_random_uuid(),
  cost_sheet_id         uuid not null references public.cost_sheets(id) on delete cascade,
  item_name             text,
  coordinate            text,
  uom_id                text,
  gsm                   numeric(10,2),
  measurement_unit      text,
  is_sizewise           boolean not null default false,
  consumption_type      text,
  calculated_qty        numeric(14,4) default 0,
  calculated_wt         numeric(14,4) default 0,
  consumption_qty       numeric(14,4) default 0,
  consumption_wt        numeric(14,4) default 0,
  additional_consumption_qty numeric(14,4) default 0,
  additional_consumption_wt  numeric(14,4) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_sample_costing_cons_updated before update on public.sample_costing_consumptions
  for each row execute function public.set_updated_at();
create index if not exists idx_sample_cons_cs on public.sample_costing_consumptions(cost_sheet_id);

-- ==========================================================================
-- 11. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'style_catalogues','catalogue_styles','catalogue_pack_types',
    'style_price_lists','pricelist_styles','pricelist_size_prices',
    'pi_enquiries','pi_enquiry_styles','pi_enquiry_products',
    'sample_costing_consumptions'
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
