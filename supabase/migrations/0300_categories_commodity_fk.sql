-- ============================================================================
-- Raagam ERP — 0300 Master Data ▸ Materials ▸ Categories: commodity_id FK fix
-- categories.commodity_id still pointed at the stale config_lookups('commodity')
-- snapshot (frozen since Commodity got its own dedicated table in 0230) —
-- same bug already fixed for processes.commodity_id in 0293. Zero-risk:
-- categories has 1737 rows but 0 with commodity_id set (verified).
-- ============================================================================

alter table public.categories drop constraint if exists categories_commodity_id_fkey;
alter table public.categories
  add constraint categories_commodity_id_fkey
    foreign key (commodity_id) references public.commodities(id) on delete set null;
