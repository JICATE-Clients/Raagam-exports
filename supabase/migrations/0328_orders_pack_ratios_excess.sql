-- ============================================================================
-- Raagam ERP — 0328 Orders ▸ Pack Ratios + Excess Orders
--
-- Pack Ratios = carton structure and size assortment matrix per order pack.
-- Defines how garments are packed into cartons (inner/master) with size
-- distribution (Size1-16 columns per combo/style).
--
-- Excess Orders = supplementary quantities beyond planned order. Tracks
-- extra qty by item class with size-wise breakdown.
-- ============================================================================

-- ==========================================================================
-- 1. Order Pack Ratios (assortment configuration)
-- ==========================================================================
create table if not exists public.order_pack_ratios (
  id                    uuid primary key default gen_random_uuid(),
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  style_ref_no          text,
  style_no              text,
  assort_no             text,
  assortment_type       text,
  delivery_date         date,
  no_of_cartons         integer default 0,
  pcs_per_inner         integer default 0,
  inner_per_master      integer default 0,
  pcs_per_master        integer default 0,
  pcs_per_pack          integer default 0,
  master_carton_name    text,
  inner_carton_name     text,
  pack_description      text,
  is_ratio_wise_pack    boolean not null default false,
  ratio_for             text check (ratio_for is null or ratio_for in ('master','inner')),
  is_single_style_pack  boolean not null default false,
  country_code          text,
  total_qty             numeric(14,3) default 0,
  order_qty             numeric(14,3) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_opr_updated before update on public.order_pack_ratios
  for each row execute function public.set_updated_at();
create index if not exists idx_opr_so on public.order_pack_ratios(sales_order_id);

-- ==========================================================================
-- 2. Pack Ratio Lines (per combo/style with size distribution)
-- ==========================================================================
create table if not exists public.order_pack_ratio_lines (
  id                    uuid primary key default gen_random_uuid(),
  pack_ratio_id         uuid not null references public.order_pack_ratios(id) on delete cascade,
  sno                   integer not null default 0,
  style_ref_no          text,
  style_no              text,
  design                text,
  combo                 text,
  no_of_cartons         integer default 0,
  inner_per_master      integer default 0,
  pcs_per_inner         integer default 0,
  pcs_per_master        integer default 0,
  pcs_per_pack          integer default 0,
  order_qty             numeric(14,3) default 0,
  -- Size distribution (Size1-16 for garment sizes like XS,S,M,L,XL,XXL,etc.)
  size1_qty             numeric(14,3) default 0,
  size2_qty             numeric(14,3) default 0,
  size3_qty             numeric(14,3) default 0,
  size4_qty             numeric(14,3) default 0,
  size5_qty             numeric(14,3) default 0,
  size6_qty             numeric(14,3) default 0,
  size7_qty             numeric(14,3) default 0,
  size8_qty             numeric(14,3) default 0,
  size9_qty             numeric(14,3) default 0,
  size10_qty            numeric(14,3) default 0,
  size11_qty            numeric(14,3) default 0,
  size12_qty            numeric(14,3) default 0,
  size13_qty            numeric(14,3) default 0,
  size14_qty            numeric(14,3) default 0,
  size15_qty            numeric(14,3) default 0,
  size16_qty            numeric(14,3) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_oprl_updated before update on public.order_pack_ratio_lines
  for each row execute function public.set_updated_at();
create index if not exists idx_oprl_ratio on public.order_pack_ratio_lines(pack_ratio_id);

-- ==========================================================================
-- 3. Pack Ratio Size Labels (maps size1..16 to actual size names)
-- ==========================================================================
create table if not exists public.order_pack_ratio_size_labels (
  id                    uuid primary key default gen_random_uuid(),
  pack_ratio_id         uuid not null references public.order_pack_ratios(id) on delete cascade,
  size_position         integer not null check (size_position between 1 and 16),
  size_label            text not null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_oprsl_ratio on public.order_pack_ratio_size_labels(pack_ratio_id);

-- ==========================================================================
-- 4. Excess Orders (supplementary quantities)
-- ==========================================================================
create sequence if not exists public.seq_excess_order;
create table if not exists public.excess_orders (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  req_no                text,
  ppm_no                text,
  customer_name         text,
  status                text not null default 'draft'
    check (status in ('draft','confirmed','cancelled')),
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_excess_order_code before insert on public.excess_orders
  for each row execute function public.assign_code('EXO','public.seq_excess_order');
create trigger trg_excess_order_updated before update on public.excess_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_excess_orders_so on public.excess_orders(sales_order_id);

-- ==========================================================================
-- 5. Excess Order Items
-- ==========================================================================
create table if not exists public.excess_order_items (
  id                    uuid primary key default gen_random_uuid(),
  excess_order_id       uuid not null references public.excess_orders(id) on delete cascade,
  sno                   integer not null default 0,
  item_class_name       text,
  description           text,
  uom_id                text,
  qty                   numeric(14,3) not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_eoi_updated before update on public.excess_order_items
  for each row execute function public.set_updated_at();
create index if not exists idx_eoi_excess on public.excess_order_items(excess_order_id);

-- ==========================================================================
-- 6. Excess Order Item Sizes (size-wise qty breakdown)
-- ==========================================================================
create table if not exists public.excess_order_item_sizes (
  id                    uuid primary key default gen_random_uuid(),
  excess_item_id        uuid not null references public.excess_order_items(id) on delete cascade,
  sno                   integer not null default 0,
  garment_size          text not null,
  qty                   numeric(14,3) not null default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_eois_item on public.excess_order_item_sizes(excess_item_id);

-- ==========================================================================
-- 7. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'order_pack_ratios','order_pack_ratio_lines','order_pack_ratio_size_labels',
    'excess_orders','excess_order_items','excess_order_item_sizes'
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
