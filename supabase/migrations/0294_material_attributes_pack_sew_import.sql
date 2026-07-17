-- ============================================================================
-- Raagam ERP — 0294 Master Data ▸ Materials ▸ Material Attributes seed (Pack & Sew)
-- Creates a Material Attribute header row (Item Class + Category, no lines
-- yet) for every category currently under Packing Accessories (PACK) or
-- Sewing Accessories (SEW) — the two item classes the Material Attribute
-- screen is scoped to (0288). Without this, the imported Category data only
-- populated the Category picker; the Material Attribute list itself stayed
-- empty since nothing had created header records yet.
-- ============================================================================

insert into public.material_attributes (item_class_id, category_id)
select c.item_class_id, c.id
from public.categories c
join public.config_lookups cl on cl.id = c.item_class_id and cl.kind = 'item_class'
where cl.code in ('PACK', 'SEW')
  and not exists (
    select 1 from public.material_attributes m where m.category_id = c.id
  );
