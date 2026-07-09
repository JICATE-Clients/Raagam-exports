-- ============================================================================
-- Raagam ERP — 0219 Master Data ▸ Materials: extend config_lookups kinds
-- ADD-ONLY. Legacy EDP2 "Material" sub-module lists 15 children; 0218 seeded 9
-- lookup kinds. This adds the 4 remaining pure named-list children so the child
-- selector matches the legacy order 1:1:
--   attribute · levy · material_attribute · out_doc_term
-- (Stock unit -> uoms, Material -> items keep their own rich tables/tabs.)
-- ============================================================================

alter table public.config_lookups
  drop constraint if exists config_lookups_kind_check;

alter table public.config_lookups
  add constraint config_lookups_kind_check check (kind in (
    'attribute','levy','material_category','material_attribute',
    'yarn_count','yarn_purity','composition','process','component',
    'gauge','knitting_dia','out_doc_term','commodity'));
