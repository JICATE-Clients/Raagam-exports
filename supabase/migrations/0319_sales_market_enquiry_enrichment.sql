-- ============================================================================
-- Raagam ERP — 0319 Sales ▸ Enrich Opportunities with Market Enquiry fields
--
-- The VB.NET FrmMkt_Enquires + FrmSQDetail carry many more header fields than
-- our current opportunities table.  This migration adds them so opportunities
-- become the full "Market Enquiry" entry point for the sales flow.
--
-- Also enriches styles with per-style fields from the enquiry form and adds
-- style_combos + style_combo_sizes child tables for combo/size quantity
-- breakdown (VB.NET OrderCombos → ComboSizes pattern).
-- ============================================================================

-- ==========================================================================
-- 1. Enrich opportunities header
-- ==========================================================================
alter table public.opportunities
  add column if not exists brand_id             uuid references public.brands(id) on delete set null,
  add column if not exists agent_name           text,
  add column if not exists merchandiser_id      uuid references public.profiles(id) on delete set null,
  add column if not exists season_id            uuid references public.seasons(id) on delete set null,
  add column if not exists customer_department  text,
  add column if not exists customer_reference   text,
  add column if not exists enquiry_against      text check (enquiry_against is null or enquiry_against in ('new','repeat','development')),
  add column if not exists order_type           text check (order_type is null or order_type in ('new','repeat')),
  add column if not exists sample_for           text,
  add column if not exists delivery_mode        text check (delivery_mode is null or delivery_mode in ('air','sea','courier','road')),
  add column if not exists delivery_to          text,
  add column if not exists receipt_mode         text check (receipt_mode is null or receipt_mode in ('email','phone','fax','courier','direct')),
  add column if not exists received_date        date;

create index if not exists idx_opp_brand on public.opportunities(brand_id);
create index if not exists idx_opp_season on public.opportunities(season_id);

-- ==========================================================================
-- 2. Enrich styles with per-style Market Enquiry fields
-- ==========================================================================
alter table public.styles
  add column if not exists fabric_structure     text,
  add column if not exists ship_type_id         uuid references public.config_lookups(id) on delete set null,
  add column if not exists ship_mode            text check (ship_mode is null or ship_mode in ('air','sea','road')),
  add column if not exists theme                text,
  add column if not exists expected_order_qty   numeric(14,3),
  add column if not exists order_qty            numeric(14,3),
  add column if not exists delivery_date        date,
  add column if not exists is_costing_option    boolean not null default false,
  add column if not exists price_type           text;

-- ==========================================================================
-- 3. Style combos — color/print combination breakdown per style
-- ==========================================================================
create table if not exists public.style_combos (
  id               uuid primary key default gen_random_uuid(),
  style_id         uuid not null references public.styles(id) on delete cascade,
  sno              integer not null default 0,
  combo            text not null,
  combo_description text,
  order_qty        numeric(14,3),
  expected_order_qty numeric(14,3),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_style_combos_updated before update on public.style_combos
  for each row execute function public.set_updated_at();
create index if not exists idx_style_combos_style on public.style_combos(style_id);

-- ==========================================================================
-- 4. Style combo sizes — size-level qty breakdown per combo
-- ==========================================================================
create table if not exists public.style_combo_sizes (
  id               uuid primary key default gen_random_uuid(),
  style_combo_id   uuid not null references public.style_combos(id) on delete cascade,
  sno              integer not null default 0,
  garment_size     text not null,
  order_qty        numeric(14,3),
  expected_order_qty numeric(14,3),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_style_combo_sizes_updated before update on public.style_combo_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_style_combo_sizes_combo on public.style_combo_sizes(style_combo_id);

-- ==========================================================================
-- 5. Style sizes — direct size breakdown when no combos (flat, no color split)
-- ==========================================================================
create table if not exists public.style_sizes (
  id               uuid primary key default gen_random_uuid(),
  style_id         uuid not null references public.styles(id) on delete cascade,
  sno              integer not null default 0,
  garment_size     text not null,
  order_qty        numeric(14,3),
  expected_order_qty numeric(14,3),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_style_sizes_updated before update on public.style_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_style_sizes_style on public.style_sizes(style_id);

-- ==========================================================================
-- 6. RLS for new tables
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array['style_combos','style_combo_sizes','style_sizes'] loop
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
