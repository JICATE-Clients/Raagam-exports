-- ============================================================================
-- Raagam ERP — 0337 Planning ▸ Add missing location_id
-- domestic_production_plans needs location_id (production is per-factory).
-- Also adds updated_at to fabric_order_dye_colors (missing from 0336).
-- ============================================================================

alter table public.domestic_production_plans
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_dpp_location on public.domestic_production_plans(location_id);

-- fabric_order_dye_colors missing updated_at
alter table public.fabric_order_dye_colors
  add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_fabric_order_dye_colors_updated') then
    create trigger trg_fabric_order_dye_colors_updated
      before update on public.fabric_order_dye_colors
      for each row execute function public.set_updated_at();
  end if;
end $$;
