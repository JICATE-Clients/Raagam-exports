-- ============================================================================
-- Raagam ERP — 0285 Master Data ▸ Materials ▸ Attributes / Material Attributes
-- Fix cascading Item Class → Category → Attribute wiring.
--
-- 0220 (attributes.type) and 0222 (material_attributes.item_class) each
-- modeled "Item Class" as their own free-text field, predating the real
-- `item_class` config_lookups kind added in 0223 (which `categories.item_class_id`
-- already references correctly). This migration moves both onto that single
-- real master so Category/Attribute pickers can cascade off the same Item
-- Class everywhere, instead of each screen carrying a disconnected copy.
-- ============================================================================

-- ---------- Seed the one missing item_class row (0223 seeded 8 rows but
-- ---------- missed "Consumables", which `attributes.type` / `material_attributes.item_class`
-- ---------- both already use) ----------
insert into public.config_lookups (kind, code, name)
select 'item_class', 'CONS', 'CONSUMABLES'
where not exists (
  select 1 from public.config_lookups c where c.kind = 'item_class' and c.code = 'CONS'
);

-- ---------- attributes: type (text) → item_class_id (FK) ----------
alter table public.attributes
  add column if not exists item_class_id uuid references public.config_lookups(id);

update public.attributes a
set item_class_id = c.id
from (values
  ('Yarn','YARN'),
  ('Fabric','FABRIC'),
  ('Sewing Accessories','SEW'),
  ('Packing Accessories','PACK'),
  ('General','GEN'),
  ('Garments','GAR'),
  ('Consumables','CONS'),
  ('Capital Items','CAP')
) as map(old_type, code)
join public.config_lookups c on c.kind = 'item_class' and c.code = map.code
where a.type = map.old_type
  and a.item_class_id is null;

alter table public.attributes drop constraint if exists attributes_type_check;
alter table public.attributes drop column if exists type;
create index if not exists idx_attributes_item_class on public.attributes(item_class_id);

-- ---------- material_attributes: item_class (text) → item_class_id (FK) ----------
alter table public.material_attributes
  add column if not exists item_class_id uuid references public.config_lookups(id);

update public.material_attributes m
set item_class_id = c.id
from (values
  ('Yarn','YARN'),
  ('Fabric','FABRIC'),
  ('Sewing Accessories','SEW'),
  ('Packing Accessories','PACK'),
  ('General','GEN'),
  ('Garments','GAR'),
  ('Consumables','CONS'),
  ('Capital Items','CAP')
) as map(old_class, code)
join public.config_lookups c on c.kind = 'item_class' and c.code = map.code
where m.item_class = map.old_class
  and m.item_class_id is null;

alter table public.material_attributes drop column if exists item_class;
create index if not exists idx_material_attributes_item_class on public.material_attributes(item_class_id);

-- ---------- material_attributes.category_id: retarget config_lookups → categories ----------
-- Existing values point at the flat config_lookups(kind='material_category')
-- list, which has no relationship to the rich `categories` table — there is
-- no valid mapping, so these are cleared (pre-production master data).
update public.material_attributes
set category_id = null
where category_id is not null
  and not exists (select 1 from public.categories c where c.id = material_attributes.category_id);

alter table public.material_attributes
  drop constraint if exists material_attributes_category_id_fkey;
alter table public.material_attributes
  add constraint material_attributes_category_id_fkey
    foreign key (category_id) references public.categories(id) on delete set null;
