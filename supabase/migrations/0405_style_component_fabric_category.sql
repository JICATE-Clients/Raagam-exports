-- 0405 — a component's "Structure" IS a fabric CATEGORY
--
-- Client, 2026-08-11: "structure is fabric category data, type will
-- automatically list based on that — remove the fabric field for now."
--
-- The Components grid asked for Structure from `config_lookups` kind
-- 'fabric_structure', which holds three MACHINE classes: Circular Knit, Flat
-- Knit, Woven. What the client means by a component's structure is the knit
-- itself — SINGLE JERSEY, FLEECE, 1X1 LYCRA RIB, INTERLOCK, COLLAR, CUFF — and
-- those already exist, as the FABRIC categories of the Category master (0223):
--
--   select c.name, fs.name
--     from categories c
--     join config_lookups ic on ic.id = c.item_class_id and ic.code = 'FABRIC'
--     left join config_lookups fs on fs.id = c.fabric_structure_id;
--   -- 1X1 LYCRA RIB | Circular Knit      COLLAR   | Flat Knit
--   -- SINGLE JERSEY | Circular Knit      CHAMBRAY | Woven
--
-- AND THAT SECOND COLUMN IS WHY "TYPE FILLS ITSELF". A category already
-- declares its own `fabric_structure_id`, so picking SINGLE JERSEY answers
-- Circular Knit exactly — a FETCH from the master, not a correlation invented
-- on the screen. It is the same guarantee the Fabric -> Structure/Type auto-fill
-- had, moved to the field that survives the client's removal of Fabric.
--
-- The three-value lookup is NOT dropped. It is what a category points AT, it is
-- what Type now displays, and `items.fabric_structure_id` still uses it.

begin;

-- Both existing rows hold a `config_lookups` id — a fabric STRUCTURE, which is
-- not a category and cannot become one by being repointed. They are the two
-- test components on the one test style, and there is no honest mapping: a row
-- saying "Circular Knit" does not tell us whether the operator meant SINGLE
-- JERSEY or FLEECE. Guessing one would put a knit on a garment part that nobody
-- chose, which is worse than an empty cell the screen marks required.
--
-- `comp_type` goes with it for the same reason: it holds 'Circular' / 'Flat'
-- from the superseded Structure->Type rename, and Type now shows the structure
-- NAME ('Circular Knit'), so the old values would render as unmatched options —
-- a filled cell showing blank, blanked on the next save.
update public.garment_style_components
   set structure_id = null,
       comp_type    = null
 where structure_id is not null
    or comp_type is not null;

alter table public.garment_style_components
  drop constraint if exists garment_style_components_structure_id_fkey;

alter table public.garment_style_components
  rename column structure_id to fabric_category_id;

alter table public.garment_style_components
  add constraint garment_style_components_fabric_category_id_fkey
  foreign key (fabric_category_id) references public.categories(id);

comment on column public.garment_style_components.fabric_category_id is
  'The FABRIC category this component is made in (0405) - SINGLE JERSEY, FLEECE, '
  '1X1 LYCRA RIB. Labelled "Structure" on screen. Was structure_id -> '
  'config_lookups kind fabric_structure, which held only the machine class.';

comment on column public.garment_style_components.comp_type is
  'Labelled "Type". The fabric structure implied by fabric_category_id - filled '
  'from categories.fabric_structure_id, editable (0405).';

create index if not exists garment_style_components_fabric_category_id_idx
  on public.garment_style_components (fabric_category_id);

commit;

-- ---------------------------------------------------------------------------
-- FROZEN, NOT DROPPED: `item_id` (the Fabric column) and `trims` /
-- `trims_category_id`.
--
-- The client removed Fabric "for now", so the COLUMN and every stored value
-- stay exactly as they are, and the screen keeps sending `item_id` in the save
-- payload. That last part is not optional and it is the opposite of the rule for
-- a header field: `writeChildren` DELETES AND REINSERTS a child grid wholesale,
-- so a field dropped from the payload is NULLED on the next save rather than
-- left alone. Keeping it in the Zod input is what freezes it.
--
-- Verify from the catalog, never from this file reporting success (0386):
--
--   select conname, confrelid::regclass::text from pg_constraint
--    where conrelid = 'public.garment_style_components'::regclass
--      and contype = 'f' and conname like '%fabric_category%';
--   -- expect: garment_style_components_fabric_category_id_fkey | categories
