-- ============================================================================
-- Raagam ERP — 0287 Item Class "Type" grouping field
-- Legacy "Attributes" screen's item-class list has a 3rd column beyond
-- Code/Name — "Itemclass Type" — a functional grouping distinct from Code
-- (e.g. FABRIC's type is "FAB"; PACK's is "PAK"; Button is grouped under
-- "GEN" despite being its own class). Only meaningful for kind='item_class'
-- rows; null for every other config_lookups kind.
--
-- NOTE: the client asked to hard-delete the deprecated "Button" (code
-- '1000') row, but it's referenced by `internal_work_orders.item_class_id`
-- — delete is blocked by that FK. Left as-is: already deactivated
-- (is_active=false) per the earlier block-not-delete decision, which is the
-- correct outcome here regardless.
-- ============================================================================

alter table public.config_lookups
  add column if not exists type_code text;

update public.config_lookups set type_code = 'GEN' where kind = 'item_class' and code = '1000';
update public.config_lookups set type_code = 'CAP' where kind = 'item_class' and code = 'CAP';
update public.config_lookups set type_code = 'FAB' where kind = 'item_class' and code = 'FABRIC';
update public.config_lookups set type_code = 'GAR' where kind = 'item_class' and code = 'GAR';
update public.config_lookups set type_code = 'GEN' where kind = 'item_class' and code = 'GEN';
update public.config_lookups set type_code = 'PAK' where kind = 'item_class' and code = 'PACK';
update public.config_lookups set type_code = 'SEW' where kind = 'item_class' and code = 'SEW';
update public.config_lookups set type_code = 'YRN' where kind = 'item_class' and code = 'YARN';
