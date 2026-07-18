-- ============================================================================
-- Raagam ERP — 0325 Sales ▸ Data Integrity Fixes
--
-- Fixes identified by data integrity audit of migrations 0319-0324:
-- 1. RLS missing on 24 child tables (HIGH)
-- 2. seasonal_orders.vendor_id missing FK constraint (CRITICAL)
-- 3. pipeline_order_sizes dual-parent FK clarification (CRITICAL)
-- 4. pi_enquiry qty fields nullable (MEDIUM)
-- 5. sq_detail_notes missing index on created_by (MEDIUM)
-- ============================================================================

-- ==========================================================================
-- 1. Add RLS to all child tables that were missed in 0320-0323
--    (Parent tables already have RLS; children inherit nothing by default)
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    -- 0320 IOC child tables
    'ioc_cmt_operations','ioc_cmt_sizes','ioc_cons_colors',
    'ioc_fabric_process_rates','ioc_fabric_process_details',
    'ioc_fabric_rate_colors','ioc_expense_styles','ioc_budgets',
    -- 0321 SQ child tables
    'sq_quantities','sq_qty_combos','sq_qty_sizes','sq_group_members',
    -- 0322 Pipeline/Seasonal child tables
    'pipeline_order_styles','pipeline_order_combos','pipeline_order_sizes',
    'pipeline_dyeing_colors','pipeline_roll_form_prints',
    'seasonal_order_sizes','seasonal_order_combos',
    -- 0323 Catalogue/PriceList/PI child tables
    'catalogue_styles','catalogue_pack_types',
    'pricelist_styles','pricelist_size_prices',
    'pi_enquiry_styles','pi_enquiry_products'
  ] loop
    -- Enable RLS (idempotent)
    execute format('alter table public.%I enable row level security;', t);
    -- Create policies only if they don't exist
    if not exists (
      select 1 from pg_policies where tablename = t and policyname = t || '_read'
    ) then
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
    end if;
  end loop;
end $$;

-- ==========================================================================
-- 2. Add FK constraint on seasonal_orders.vendor_id → vendors
-- ==========================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_seasonal_orders_vendor'
      and table_name = 'seasonal_orders'
  ) then
    alter table public.seasonal_orders
      add constraint fk_seasonal_orders_vendor
      foreign key (vendor_id) references public.vendors(id) on delete set null;
  end if;
end $$;

create index if not exists idx_seasonal_orders_vendor on public.seasonal_orders(vendor_id);

-- ==========================================================================
-- 3. Fix pipeline_order_sizes — make pipeline_style_id NOT NULL
--    (sizes always belong to a style; combo_id is optional for non-combo orders)
-- ==========================================================================
-- Note: pipeline_style_id should be the required parent.
-- pipeline_combo_id is optional (NULL when order has no combos, sizes are direct).
-- This clarifies the dual-parent ambiguity.
alter table public.pipeline_order_sizes
  alter column pipeline_style_id set not null;

-- ==========================================================================
-- 4. Fix pi_enquiry qty fields — NOT NULL DEFAULT 0
-- ==========================================================================
alter table public.pi_enquiry_styles
  alter column order_qty set default 0,
  alter column order_qty set not null,
  alter column expected_order_qty set default 0,
  alter column expected_order_qty set not null;

alter table public.pi_enquiry_products
  alter column order_qty set default 0,
  alter column order_qty set not null,
  alter column expected_order_qty set default 0,
  alter column expected_order_qty set not null;

-- ==========================================================================
-- 5. Add missing index on sq_detail_notes.created_by
-- ==========================================================================
create index if not exists idx_sq_detail_notes_created_by
  on public.sq_detail_notes(created_by);
