-- 0698 — Sample Costing ▸ Fabric: the Fabric field names a STRUCTURE.
--
-- User 2026-10-09: "costing child fabric tab fabric field need to list the
-- fabric structure". A costing is priced before the cloth exists, so the
-- operator picks the construction (SINGLE JERSEY, FLEECE, 1X1 LYCRA RIB …) and
-- types the quality beside it — not a finished FABRIC item from Materials.
--
-- A structure is a FABRIC-class CATEGORY (same as order_fabric_bom_lines.
-- structure_id, 0405). `fabric_id` keeps its name so the save RPC (last
-- re-created in 0694) and every reader are untouched; only its target moves
-- from items to categories. Rows already saved are converted to the category
-- of the fabric they named, so nothing held is lost — their typed quality text
-- is left exactly as it was.

alter table public.sample_costing_fabrics
  drop constraint if exists sample_costing_fabrics_fabric_id_fkey;

update public.sample_costing_fabrics f
   set fabric_id = i.category_id
  from public.items i
 where i.id = f.fabric_id;

-- A fabric_id that was not an item (none today) cannot name a structure.
update public.sample_costing_fabrics f
   set fabric_id = null
 where fabric_id is not null
   and not exists (select 1 from public.categories c where c.id = f.fabric_id);

alter table public.sample_costing_fabrics
  add constraint sample_costing_fabrics_fabric_id_fkey
  foreign key (fabric_id) references public.categories(id) on delete set null;

comment on column public.sample_costing_fabrics.fabric_id is
  'The fabric STRUCTURE (a FABRIC-class categories row) since 0698; was items(id).';
