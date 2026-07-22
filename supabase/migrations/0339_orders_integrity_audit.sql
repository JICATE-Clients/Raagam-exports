-- ============================================================================
-- Raagam ERP — 0339 Orders Integrity Audit Fixes
--
-- Addresses gaps found during VB.NET source-of-truth audit:
--   1. CRITICAL: sales_orders missing delivery_date column
--   2. CRITICAL: excess_order_item_sizes missing updated_at + trigger
--   3. HIGH: ship_date >= order date check
--   4. HIGH: price/rate fields allow negative values
--   5. HIGH: amendment excess_pct unbounded
--   6. HIGH: ta_milestones sequence uniqueness
--   7. HIGH: pack ratio pcs_per fields allow zero/negative
-- ============================================================================

-- ==========================================================================
-- 1. CRITICAL: sales_orders.delivery_date — booking-actions.ts updates this
--    field but it doesn't exist. Due date confirmations propagate here.
-- ==========================================================================
alter table public.sales_orders
  add column if not exists delivery_date date;

-- ==========================================================================
-- 2. CRITICAL: excess_order_item_sizes — missing updated_at + trigger
--    All other child tables have this; consistency fix.
-- ==========================================================================
alter table public.excess_order_item_sizes
  add column if not exists updated_at timestamptz not null default now();

create trigger trg_eois_updated before update on public.excess_order_item_sizes
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 3. HIGH: ship_date must not be before order creation date
-- ==========================================================================
alter table public.sales_orders
  drop constraint if exists chk_ship_date_not_past;

alter table public.sales_orders
  add constraint chk_ship_date_not_past
    check (ship_date is null or ship_date >= date(created_at));

-- ==========================================================================
-- 4. HIGH: price/rate fields — prevent negative values
-- ==========================================================================
-- order_prices
alter table public.order_prices
  drop constraint if exists chk_order_prices_rate,
  drop constraint if exists chk_order_prices_mrp;
alter table public.order_prices
  add constraint chk_order_prices_rate check (rate is null or rate >= 0),
  add constraint chk_order_prices_mrp check (mrp_rate is null or mrp_rate >= 0);

-- order_price_combo_rates
alter table public.order_price_combo_rates
  drop constraint if exists chk_combo_rate,
  drop constraint if exists chk_combo_mrp;
alter table public.order_price_combo_rates
  add constraint chk_combo_rate check (rate is null or rate >= 0),
  add constraint chk_combo_mrp check (mrp_rate is null or mrp_rate >= 0);

-- order_price_size_rates
alter table public.order_price_size_rates
  drop constraint if exists chk_size_rate,
  drop constraint if exists chk_size_mrp;
alter table public.order_price_size_rates
  add constraint chk_size_rate check (rate is null or rate >= 0),
  add constraint chk_size_mrp check (mrp_rate is null or mrp_rate >= 0);

-- pc_purchase_items
alter table public.pc_purchase_items
  drop constraint if exists chk_pc_item_rate;
alter table public.pc_purchase_items
  add constraint chk_pc_item_rate check (rate is null or rate >= 0);

-- pc_processes
alter table public.pc_processes
  drop constraint if exists chk_pc_proc_rate;
alter table public.pc_processes
  add constraint chk_pc_proc_rate check (rate is null or rate >= 0);

-- ==========================================================================
-- 5. HIGH: garment_order_amendments.excess_pct — must be 0–100
-- ==========================================================================
alter table public.garment_order_amendments
  drop constraint if exists chk_goa_excess_pct;
alter table public.garment_order_amendments
  add constraint chk_goa_excess_pct
    check (excess_pct is null or (excess_pct >= 0 and excess_pct <= 100));

-- ==========================================================================
-- 6. HIGH: ta_milestones — sequence must be unique per plan
-- ==========================================================================
create unique index if not exists uq_ta_milestones_plan_seq
  on public.ta_milestones (ta_plan_id, sequence);

-- ==========================================================================
-- 7. HIGH: pack ratio quantity fields — must be positive
-- ==========================================================================
alter table public.order_pack_ratios
  drop constraint if exists chk_packratio_pcs_inner,
  drop constraint if exists chk_packratio_inner_master;
alter table public.order_pack_ratios
  add constraint chk_packratio_pcs_inner
    check (pcs_per_inner is null or pcs_per_inner > 0),
  add constraint chk_packratio_inner_master
    check (inner_per_master is null or inner_per_master > 0);
