-- ============================================================================
-- Raagam ERP — 0293 Merge Attribute master into Item Class
-- The legacy "Attribute" master (0220) turned out to be the same data as
-- Item Class (config_lookups kind='item_class') — confirmed against the
-- client's legacy "Attributes - U2" report, which lists exactly the Item
-- Class rows (Code/Name/Type/Blocked). There is no separate Attribute
-- header entity; `public.attributes` was a duplicate.
--
-- The attribute_values child grid (named properties like GSM/Width, scoped
-- per Item Class) is real and stays — it's what Material Attribute Lines
-- (0222) actually pick from, so it now points at Item Class directly
-- instead of the removed `attributes` header.
--
-- Safe: attributes / attribute_values / material_attribute_lines are all
-- empty in production at the time of this migration (verified via
-- execute_sql) — no data to remap.
-- ============================================================================

alter table public.material_attribute_lines
  drop constraint if exists material_attribute_lines_attribute_id_fkey;

alter table public.attribute_values
  drop constraint if exists attribute_values_attribute_id_fkey;
alter table public.attribute_values
  rename column attribute_id to item_class_id;
alter table public.attribute_values
  add constraint attribute_values_item_class_id_fkey
    foreign key (item_class_id) references public.config_lookups(id) on delete cascade;

alter index if exists idx_attribute_values_attribute
  rename to idx_attribute_values_item_class;

alter table public.material_attribute_lines
  add constraint material_attribute_lines_attribute_id_fkey
    foreign key (attribute_id) references public.attribute_values(id) on delete set null;

drop table public.attributes;
