-- ============================================================================
-- Raagam ERP — 0331 Orders ▸ Audit catch-up
-- Fixes from integrity audit of migrations 0327-0330:
-- 1. Missing updated_at + triggers on 4 child tables
-- 2. Missing trigger on order_price_combo_rates
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'order_pack_ratio_size_labels',
    'excess_order_item_sizes',
    'order_price_size_rates',
    'pc_process_items',
    'pc_cmt_operation_details'
  ] loop
    execute format(
      'alter table public.%I add column if not exists updated_at timestamptz not null default now();',
      t
    );
    if not exists (
      select 1 from pg_trigger where tgname = 'trg_' || t || '_updated'
    ) then
      execute format(
        'create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.set_updated_at();',
        t
      );
    end if;
  end loop;

  -- order_price_combo_rates already has updated_at but missing trigger
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_order_price_combo_rates_updated'
  ) then
    create trigger trg_order_price_combo_rates_updated
      before update on public.order_price_combo_rates
      for each row execute function public.set_updated_at();
  end if;
end $$;
