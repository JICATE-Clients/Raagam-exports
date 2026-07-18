-- ============================================================================
-- Raagam ERP — 0333 Planning Phase 1 audit catch-up
-- Adds missing updated_at + trigger to general_stock_item_classes.
-- ============================================================================

alter table public.general_stock_item_classes
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_general_stock_item_classes_updated'
  ) then
    create trigger trg_general_stock_item_classes_updated
      before update on public.general_stock_item_classes
      for each row execute function public.set_updated_at();
  end if;
end $$;
