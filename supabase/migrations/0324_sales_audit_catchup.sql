-- ============================================================================
-- Raagam ERP — 0324 Sales ▸ Audit catch-up
-- Adds missing updated_at columns and set_updated_at triggers to child tables
-- created in migrations 0320-0323 that only had created_at.
-- ============================================================================

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
    -- Add updated_at if missing
    execute format(
      'alter table public.%I add column if not exists updated_at timestamptz not null default now();',
      t
    );
    -- Add trigger if missing
    if not exists (
      select 1 from pg_trigger where tgname = 'trg_' || t || '_updated'
    ) then
      execute format(
        'create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.set_updated_at();',
        t
      );
    end if;
  end loop;
end $$;
