-- 0430 · Combos ▸ Structure Details: the row NAMES THE FABRIC, and the
-- composition is read off it.
--
-- WHY THE COLUMN CHANGES RATHER THAN GAINING A NEIGHBOUR (client 2026-08-17,
-- screenshot 2324: "this section need to fetch from previous tab automatically,
-- now its not doing it").
--
-- 0408 modelled Composition as an FK to the `compositions` master, so the
-- operator answered it by hand from a master nobody fills — and it cannot be
-- fetched from anything the order already knows, because the order knows the
-- STRUCTURE (a fabric category) and a category has no composition. The fabric
-- MATERIAL does: `material_mixings` is a Fabric's yarn blend, and it is
-- mandatory on the Material master ("A Fabric is DEFINED by what it is made
-- of", material-actions.ts). SOLID 1X1 LYCRA RIB under category 1X1 LYCRA RIB
-- already declares 30'S COTTON COMBED 95% / 20'S ELASTANE 5% -- the exact value
-- the screenshot shows blank.
--
-- So the row names the fabric and the composition is DERIVED, the same way
-- `gsm_range` is derived from gsm ± tolerance and the same way the Style
-- master's Type is fetched from its Structure. One source, no second opinion,
-- and nothing for the two to disagree about.
--
-- DROP AND ADD, NOT A REPOINT-IN-PLACE: verified from the catalog, not assumed
-- --  select count(*), count(composition_id) from
--     garment_order_amendment_combo_structures  ->  0, 0
-- The table has never held a row (the tab shipped 2026-08-12 and no order has
-- saved a combo structure yet), so there is no value to convert and no order to
-- re-open with a blanked field. Were it non-empty this would need a data step:
-- resolve each composition's mixture to the fabric that declares it.
--
-- GSM IS NOT PART OF THIS. `items` carries no gsm column, so the fabric cannot
-- supply it; Gsm and Tolerance stay hand-entered and `structureProblems` still
-- insists on GSM for a circular knit. Adding a gsm to the Material master is a
-- separate ask.
--
-- The `compositions` master and `composition_lines` are UNTOUCHED -- 0225's
-- screen keeps working and 0384's category column with it. What goes is this
-- tab's dependence on it.

alter table public.garment_order_amendment_combo_structures
  drop column if exists composition_id;

alter table public.garment_order_amendment_combo_structures
  add column if not exists fabric_item_id uuid references public.items(id);

comment on column public.garment_order_amendment_combo_structures.fabric_item_id is
  'The FABRIC material this combo uses for this structure (items, class FABRIC). Its material_mixings blend IS the composition shown on screen -- never stored a second time. Seeded from the structure''s category when that category holds exactly one fabric.';
