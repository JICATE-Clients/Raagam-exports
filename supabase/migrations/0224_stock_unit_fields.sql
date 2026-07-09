-- ============================================================================
-- Raagam ERP — 0224 Master Data ▸ Materials ▸ Stock Units: enrich `uoms`
-- Legacy EDP2 "Stock unit" form is richer than the thin uoms table: it adds a
-- description, a decimal-places setting, and an Item Classes applicability list
-- (multi-select, or "for all item classes"). ADD-ONLY — never touches the
-- existing code/name/is_active columns, so the ~10 tables that reference
-- uoms(id) via uom_id are unaffected. uoms already carries masters RLS (0004).
-- ============================================================================

alter table public.uoms
  add column if not exists description          text,
  add column if not exists decimal_places       integer not null default 0,
  add column if not exists for_all_item_classes boolean not null default true,
  add column if not exists item_classes         text[]  not null default '{}';
