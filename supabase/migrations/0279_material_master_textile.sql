-- ============================================================================
-- Raagam ERP — 0279 Material Master textile logic (Fabric/Yarn)
-- Client walkthrough (doc/raagam.mpeg + doc/recording/discussion.md): Fabric
-- structure (on Category, inherited) drives UOM; Fabric Type / Yarn Type
-- taxonomies; Yarn mixing gets a real component+% shape; "Button" item class
-- removed per client (code '1000' — confirmed by the exact match in data).
-- ============================================================================

-- 1) Structure lives on Category, inherited by Material (not re-picked per item).
alter table public.categories
  add column if not exists fabric_structure_id uuid references public.config_lookups(id) on delete set null;

-- 2) Fabric Type / Yarn Type taxonomies + Ply, directly on the material (items).
alter table public.items
  add column if not exists fabric_type_id uuid references public.config_lookups(id) on delete set null,
  add column if not exists yarn_type_id   uuid references public.config_lookups(id) on delete set null,
  add column if not exists ply            integer;

-- 3) Mixing grid gets a real component-yarn + count + blend % shape (was
--    description/shade/uom only) — links to an actual Yarn `items` row.
alter table public.material_mixings
  add column if not exists component_item_id uuid references public.items(id) on delete set null,
  add column if not exists count_id          uuid references public.config_lookups(id) on delete set null,
  add column if not exists blend_pct         numeric(6,2);

create index if not exists idx_categories_fabric_structure on public.categories(fabric_structure_id);
create index if not exists idx_items_fabric_type on public.items(fabric_type_id);
create index if not exists idx_items_yarn_type on public.items(yarn_type_id);
create index if not exists idx_material_mixings_component on public.material_mixings(component_item_id);

-- 4) Widen config_lookups.kind CHECK: add fabric_structure / fabric_type / yarn_type.
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups
  add constraint config_lookups_kind_check
  check (kind in (
    'attribute','levy','material_category','material_attribute','yarn_count',
    'yarn_purity','composition','process','component','gauge','knitting_dia',
    'out_doc_term','commodity','item_class','hsn_code','city','state','department',
    'designation','internal_department','ship_type','payment_term','employee_category',
    'team','account_schedule','vendor_group','agent_type','agent','packing_list_format',
    'commercial_invoice_format','shift_category',
    'doc_track','doc_menu','doc_value_type','doc_value_from',
    'style_category','coordinate','style_component','structure','trims_category','size',
    'roll_form_print','warehouse',
    'ta_activity_type',
    'fabric_structure','fabric_type','yarn_type'
  ));

-- 5) Seed the new taxonomies. Reuse the same codes as styles.fabric_type /
--    styles.fabric_subtype (0005_sales.sql) for consistency across modules.
insert into public.config_lookups (kind, code, name, is_active)
select 'fabric_structure', v.code, v.name, true
from (values
  ('circular',  'Circular Knit'),
  ('flat_knit', 'Flat Knit'),
  ('woven',     'Woven')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups where kind = 'fabric_structure' and code = v.code
);

insert into public.config_lookups (kind, code, name, is_active)
select 'fabric_type', v.code, v.name, true
from (values
  ('solid',     'Grey'),
  ('yarn_dyed', 'Yarn-dyed'),
  ('melange',   'Melange')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups where kind = 'fabric_type' and code = v.code
);

insert into public.config_lookups (kind, code, name, is_active)
select 'yarn_type', v.code, v.name, true
from (values
  ('grey',     'Grey'),
  ('melange',  'Melange'),
  ('doubling', 'Doubling')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups where kind = 'yarn_type' and code = v.code
);

-- 6) Client confirmed: remove "Button" as an item class (code '1000' — matches
--    exactly). Block, not hard-delete, per the block-vs-delete rule.
update public.config_lookups
set is_active = false
where kind = 'item_class' and code = '1000';
