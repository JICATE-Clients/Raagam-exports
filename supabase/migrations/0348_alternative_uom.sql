-- =============================================================================
-- 0348 — Alternative UOM: declaration flag, unique conversion lines, BOM pack
-- -----------------------------------------------------------------------------
-- A factory PLANS in one unit and BUYS in another: thread is consumed in metres
-- and purchased in cones, buttons are consumed in numbers and purchased in
-- gross. material_uom_conversions (0226) has stored that pairing since day one,
-- but nothing ever divided the two numbers, so the planner still did the
-- arithmetic by hand.
--
-- ~90% of materials use one unit for everything, so the material now DECLARES
-- whether it needs an alternative UOM. When the flag is off the screen collapses
-- to Base UOM alone and the server points every other UOM slot at the base unit
-- (see normConversions in lib/masters/material-actions.ts) — downstream readers
-- of stock_uom_id / purchase_uom_id keep working instead of hitting nulls.
-- =============================================================================

alter table public.items
  add column if not exists has_alternate_uom boolean not null default false;

-- Backfill, so real data does not vanish behind an off-by-default toggle.
-- A material qualifies if it already has conversion rows, or if ANY of the four
-- downstream UOM slots differs from its base unit — that difference is the
-- definition of "this material uses more than one unit". Checking only the
-- purchase slot would miss a billing-only difference and silently flatten it on
-- the next save.
update public.items i set has_alternate_uom = true
where exists (select 1 from public.material_uom_conversions c where c.item_id = i.id)
   or (i.base_uom_id is not null and (
        i.stock_uom_id    is distinct from i.base_uom_id
     or i.billing_uom_id  is distinct from i.base_uom_id
     or i.planning_uom_id is distinct from i.base_uom_id
     or i.purchase_uom_id is distinct from i.base_uom_id));

-- Two identical "1 Cone = 2,500 MTR" rows are indistinguishable to the planner,
-- because the pack label is DERIVED from these numbers rather than typed. The
-- second one is always a mistake, so reject it at the DB.
-- `nulls not distinct` (PG15+; this project is on 17.6) so a half-filled row
-- still collides with another identical half-filled row — the default NULL-is-
-- distinct behaviour would let unlimited blank duplicates through.
create unique index if not exists uq_material_uom_conversions_line
  on public.material_uom_conversions (item_id, alt_qty, alt_uom_id, base_qty, base_uom_id)
  nulls not distinct;

-- Which pack size this BOM line buys. It cannot live on the material: a material
-- may offer 2,500m / 3,000m / 5,000m cones and items.purchase_uom_id holds a
-- single UOM ("Cone"), which cannot tell them apart. The choice is per BOM line.
-- ON DELETE SET NULL so removing a conversion blanks the pick rather than
-- cascading away the amendment line.
alter table public.material_bom_amendment_items
  add column if not exists uom_conversion_id uuid
    references public.material_uom_conversions(id) on delete set null;

create index if not exists idx_mba_items_uom_conversion
  on public.material_bom_amendment_items(uom_conversion_id);
