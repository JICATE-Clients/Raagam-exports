-- ============================================================================
-- Raagam ERP — 0329 Orders ▸ Order Detail Enrichment
--
-- Adds 5 child table groups to sales_orders for detailed order specifications:
-- 1. Coordinate Colors — color per garment coordinate
-- 2. Order Descriptions — process descriptions (printing/embroidery/packing)
-- 3. Order Trims — trims with supply type (nominated/FOC/purchase)
-- 4. Order Fabrics — 3-level fabric specs (structure→components→yarn colors)
-- 5. Approval Parameters — approval checklist (predefined or custom)
-- ============================================================================

-- ==========================================================================
-- 1. Order Coordinate Colors
-- ==========================================================================
create table if not exists public.order_coordinate_colors (
  id                    uuid primary key default gen_random_uuid(),
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  style_ref_no          text,
  style_no              text,
  combo                 text,
  sno                   integer not null default 0,
  coordinate            text not null,
  color                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_occ_updated before update on public.order_coordinate_colors
  for each row execute function public.set_updated_at();
create index if not exists idx_occ_so on public.order_coordinate_colors(sales_order_id);

-- ==========================================================================
-- 2. Order Descriptions (process descriptions)
-- ==========================================================================
create table if not exists public.order_descriptions (
  id                    uuid primary key default gen_random_uuid(),
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  style_ref_no          text,
  style_no              text,
  sno                   integer not null default 0,
  description_type      text check (description_type is null or description_type in ('printing','embroidery','packing')),
  description           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_od_updated before update on public.order_descriptions
  for each row execute function public.set_updated_at();
create index if not exists idx_od_so on public.order_descriptions(sales_order_id);

-- ==========================================================================
-- 3. Order Trims
-- ==========================================================================
create table if not exists public.order_trims (
  id                    uuid primary key default gen_random_uuid(),
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  style_ref_no          text,
  style_no              text,
  sno                   integer not null default 0,
  category              text,
  trims_specifications  text,
  supply_type           text check (supply_type is null or supply_type in (
    'nominated','recommended','foc_csp','foc_ssp','purchase','csp_purchase','none'
  )),
  vendor_name           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ot_updated before update on public.order_trims
  for each row execute function public.set_updated_at();
create index if not exists idx_ot_so on public.order_trims(sales_order_id);

-- ==========================================================================
-- 4. Order Fabrics (3-level hierarchy)
-- ==========================================================================
create table if not exists public.order_fabrics (
  id                    uuid primary key default gen_random_uuid(),
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  style_ref_no          text,
  style_no              text,
  combo                 text,
  sno                   integer not null default 0,
  structure_name        text,
  fabric_type           text check (fabric_type is null or fabric_type in ('main','trims_fabric')),
  composition           text,
  gsm                   numeric(10,2),
  gsm_tolerance         numeric(6,2),
  item_sub_type         text check (item_sub_type is null or item_sub_type in ('solid','melange','yarn_dyed')),
  other_details         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_of_updated before update on public.order_fabrics
  for each row execute function public.set_updated_at();
create index if not exists idx_of_so on public.order_fabrics(sales_order_id);

-- Order Fabric Components (child of order_fabrics)
create table if not exists public.order_fabric_components (
  id                    uuid primary key default gen_random_uuid(),
  order_fabric_id       uuid not null references public.order_fabrics(id) on delete cascade,
  sno                   integer not null default 0,
  coordinate            text,
  component             text,
  fabric_color          text,
  fabric_print          text,
  specifications        text,
  other_details         text,
  processed_as_trim     boolean not null default false,
  fabric_name           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ofc_updated before update on public.order_fabric_components
  for each row execute function public.set_updated_at();
create index if not exists idx_ofc_fabric on public.order_fabric_components(order_fabric_id);

-- Order Fabric Yarn Dyed Colors (child of order_fabric_components)
create table if not exists public.order_fabric_yarn_colors (
  id                    uuid primary key default gen_random_uuid(),
  fabric_component_id   uuid not null references public.order_fabric_components(id) on delete cascade,
  sno                   integer not null default 0,
  yarn_dyed_color       text not null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_ofyc_comp on public.order_fabric_yarn_colors(fabric_component_id);

-- ==========================================================================
-- 5. Order Approval Parameters
-- ==========================================================================
create table if not exists public.order_approval_params (
  id                    uuid primary key default gen_random_uuid(),
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  sno                   integer not null default 0,
  parameter_name        text not null,
  status                text check (status is null or status in ('ok','not_ok')),
  comment               text,
  is_user_defined       boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_oap_updated before update on public.order_approval_params
  for each row execute function public.set_updated_at();
create index if not exists idx_oap_so on public.order_approval_params(sales_order_id);

-- Approval remarks (header-level)
alter table public.sales_orders
  add column if not exists approval_remarks text;

-- ==========================================================================
-- 6. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'order_coordinate_colors','order_descriptions','order_trims',
    'order_fabrics','order_fabric_components','order_fabric_yarn_colors',
    'order_approval_params'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated
        using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (public.has_permission('orders','delete'));
    $f$, t);
  end loop;
end $$;
