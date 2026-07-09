-- ============================================================================
-- Raagam ERP — 0231 Master Data ▸ HSN Code master
-- Legacy HSN Code is a ⓘ picker (Add/Modify) on Material/Process/Commodity.
-- Model it as a config_lookups kind `hsn_code` (code = HSN number, name = desc)
-- so every HSN field reuses LookupPicker (inline Add/Modify) with no new CRUD.
-- Adds items.hsn_id (FK) mirroring count_id/purity_id; old items.hsn_code text
-- is left untouched.
-- ============================================================================

alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check check (kind in (
  'attribute','levy','material_category','material_attribute','yarn_count','yarn_purity',
  'composition','process','component','gauge','knitting_dia','out_doc_term','commodity',
  'item_class','hsn_code'));

alter table public.items
  add column if not exists hsn_id uuid references public.config_lookups(id) on delete set null;
