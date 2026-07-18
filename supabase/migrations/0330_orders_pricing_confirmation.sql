-- ============================================================================
-- Raagam ERP — 0330 Orders ▸ Sale Order Price + Price Confirmation
--
-- Sale Order Price = multi-level pricing (style→combo→size rates + MRP).
-- Price Confirmation = 9-category procurement pricing with amendments.
-- Categories: yarn/fabric/accessories purchases, yarn/fabric/accessories/
-- garment/unplanned processes, CMT operations.
-- ============================================================================

-- ==========================================================================
-- 1. Sale Order Prices (multi-level rate matrix)
-- ==========================================================================
create table if not exists public.order_prices (
  id                    uuid primary key default gen_random_uuid(),
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  sno                   integer not null default 0,
  style_ref_no          text,
  style_no              text,
  article_no            text,
  design                text,
  price_type            text,
  rate_uom              text,
  rate                  numeric(14,4) default 0,
  rate_for_docs         numeric(14,4) default 0,
  mrp_rate              numeric(14,4) default 0,
  rate_uom_conv         numeric(14,4) default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_op_updated before update on public.order_prices
  for each row execute function public.set_updated_at();
create index if not exists idx_op_so on public.order_prices(sales_order_id);

-- ==========================================================================
-- 2. Order Price Combo Rates (per-combo rate override)
-- ==========================================================================
create table if not exists public.order_price_combo_rates (
  id                    uuid primary key default gen_random_uuid(),
  order_price_id        uuid not null references public.order_prices(id) on delete cascade,
  sno                   integer not null default 0,
  combo                 text,
  rate                  numeric(14,4) default 0,
  rate_for_docs         numeric(14,4) default 0,
  mrp_rate              numeric(14,4) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_opcr_op on public.order_price_combo_rates(order_price_id);

-- ==========================================================================
-- 3. Order Price Size Rates (per-size rate override)
-- ==========================================================================
create table if not exists public.order_price_size_rates (
  id                    uuid primary key default gen_random_uuid(),
  order_price_id        uuid references public.order_prices(id) on delete cascade,
  combo_rate_id         uuid references public.order_price_combo_rates(id) on delete cascade,
  sno                   integer not null default 0,
  garment_size          text,
  rate                  numeric(14,4) default 0,
  rate_for_docs         numeric(14,4) default 0,
  mrp_rate              numeric(14,4) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_opsr_op on public.order_price_size_rates(order_price_id);
create index if not exists idx_opsr_cr on public.order_price_size_rates(combo_rate_id);

-- ==========================================================================
-- 4. Price Confirmations (procurement pricing — header)
-- ==========================================================================
create sequence if not exists public.seq_price_conf;
create table if not exists public.price_confirmations (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  amendment_sno         integer not null default 0,
  last_amendment_sno    integer default 0,
  status                text not null default 'draft'
    check (status in ('draft','confirmed','amended','cancelled')),
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_pc_code before insert on public.price_confirmations
  for each row execute function public.assign_code('PC','public.seq_price_conf');
create trigger trg_pc_updated before update on public.price_confirmations
  for each row execute function public.set_updated_at();
create index if not exists idx_pc_so on public.price_confirmations(sales_order_id);

-- ==========================================================================
-- 5. Price Confirmation Purchase Items (yarn/fabric/accessories)
-- ==========================================================================
create table if not exists public.pc_purchase_items (
  id                    uuid primary key default gen_random_uuid(),
  price_conf_id         uuid not null references public.price_confirmations(id) on delete cascade,
  item_class_type       text not null check (item_class_type in ('yarn','fabric','accessories')),
  sno                   integer not null default 0,
  item_name             text,
  stage                 text,
  item_color            text,
  vendor_name           text,
  specifications        text,
  uom_id                text,
  reqd_qty              numeric(14,3) default 0,
  is_foc                boolean not null default false,
  is_import             boolean not null default false,
  currency_code         text,
  rate                  numeric(14,4) default 0,
  exchange_rate         numeric(12,6) default 1,
  inr_rate              numeric(14,4) default 0,
  moq                   numeric(14,3),
  last_po_rate          numeric(14,4),
  levy_description      text,
  is_rate_inclusive_levy boolean not null default false,
  net_rate              numeric(14,4) default 0,
  net_inr_rate          numeric(14,4) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_pcpi_updated before update on public.pc_purchase_items
  for each row execute function public.set_updated_at();
create index if not exists idx_pcpi_pc on public.pc_purchase_items(price_conf_id);
create index if not exists idx_pcpi_class on public.pc_purchase_items(item_class_type);

-- ==========================================================================
-- 6. Price Confirmation Processes (yarn/fabric/accessories/garment/unplanned)
-- ==========================================================================
create table if not exists public.pc_processes (
  id                    uuid primary key default gen_random_uuid(),
  price_conf_id         uuid not null references public.price_confirmations(id) on delete cascade,
  process_type          text not null check (process_type in ('yarn','fabric','accessories','garment','unplanned')),
  sno                   integer not null default 0,
  process_name          text,
  uom_id                text,
  qty                   numeric(14,3) default 0,
  rate                  numeric(14,4) default 0,
  currency_code         text,
  exchange_rate         numeric(12,6) default 1,
  inr_rate              numeric(14,4) default 0,
  vendor_name           text,
  is_foc                boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_pcp_updated before update on public.pc_processes
  for each row execute function public.set_updated_at();
create index if not exists idx_pcp_pc on public.pc_processes(price_conf_id);
create index if not exists idx_pcp_type on public.pc_processes(process_type);

-- ==========================================================================
-- 7. Price Confirmation Process Items (child of pc_processes)
-- ==========================================================================
create table if not exists public.pc_process_items (
  id                    uuid primary key default gen_random_uuid(),
  pc_process_id         uuid not null references public.pc_processes(id) on delete cascade,
  sno                   integer not null default 0,
  item_name             text,
  uom_id                text,
  qty                   numeric(14,3) default 0,
  rate                  numeric(14,4) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pcpitems_proc on public.pc_process_items(pc_process_id);

-- ==========================================================================
-- 8. Price Confirmation CMT Operations
-- ==========================================================================
create table if not exists public.pc_cmt_operations (
  id                    uuid primary key default gen_random_uuid(),
  price_conf_id         uuid not null references public.price_confirmations(id) on delete cascade,
  sno                   integer not null default 0,
  operation_name        text,
  rate                  numeric(14,4) default 0,
  cost                  numeric(14,2) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_pcco_updated before update on public.pc_cmt_operations
  for each row execute function public.set_updated_at();
create index if not exists idx_pcco_pc on public.pc_cmt_operations(price_conf_id);

-- ==========================================================================
-- 9. CMT Operation Details (child of pc_cmt_operations)
-- ==========================================================================
create table if not exists public.pc_cmt_operation_details (
  id                    uuid primary key default gen_random_uuid(),
  cmt_operation_id      uuid not null references public.pc_cmt_operations(id) on delete cascade,
  sno                   integer not null default 0,
  detail_name           text,
  rate                  numeric(14,4) default 0,
  cost                  numeric(14,2) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_pccod_cmt on public.pc_cmt_operation_details(cmt_operation_id);

-- ==========================================================================
-- 10. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'order_prices','order_price_combo_rates','order_price_size_rates',
    'price_confirmations','pc_purchase_items','pc_processes',
    'pc_process_items','pc_cmt_operations','pc_cmt_operation_details'
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
