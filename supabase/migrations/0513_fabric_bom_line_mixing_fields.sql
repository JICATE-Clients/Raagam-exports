-- ============================================================================
-- Raagam ERP — 0513 Fabric BOM ▸ Fabric Lines ▸ the two YARN-DYED-ONLY cells
--
-- Client field spec, 2026-09-02: `Type` (Solid | Melange | Yarn Dyed) "controls
-- the visibility of all subsequent mixing fields". Solid and Melange are dyed as
-- a whole roll, so Mixing UOM and No Of Colors mean nothing and are hidden; Yarn
-- Dyed is knit from pre-dyed yarns, so both become live and Mixing UOM becomes
-- mandatory.
--
-- Catalog, 2026-09-02: the `fabric_type` vocabulary is exactly the client's
-- three — Solid (11 fabrics), Yarn Dyed (2), Melange (1). Nothing had to be
-- seeded, and there is no fourth value for a branch to fall through to.
--
--
-- WHY THESE ARE NOT `not null`
--
-- The requiredness is conditional on the FABRIC'S type, which lives on
-- `items.fabric_type_id` and not on this row, so a column constraint cannot
-- express it without copying the fabric's type onto every line — a second place
-- for it to disagree with the master. It is enforced instead by
-- `missingFabricLineFields()` in lib/orders/fabric-bom/fabric-line-rules.ts, the
-- one function the star, the cursor hold, the Save gate and the server action all
-- read. AGENTS.md's "one declaration, four enforcers", and its own note that
-- "requiredness is often a property of the field FOR A CASE, not of the column".
--
--
-- `mixing_uom` IS NOT A UOM-MASTER REFERENCE
--
-- Which is why it is text and not a uuid FK to `uoms`. The client's two values
-- are Percentage and Centimeters, and they describe how a STRIPE REPEAT RATIO is
-- expressed — "60% blue / 40% white", or a physical stripe height in cm. That is
-- not the unit a quantity is measured in.
--
-- The unit the consumption figure is in remains `consumption_uom_id`, a different
-- question with a different answer. It loses its cell in this change and is now
-- AUTO-FILLED from the fabric's own `items.base_uom_id`, which is set on all 14
-- live fabrics (checked 2026-09-02). That measurement is the whole reason the
-- derivation is safe here and was not safe from `material_mixings.uom_id`, which
-- is NULL on all 18 of its rows — the reading this column was given for about an
-- hour earlier the same day.
-- ============================================================================

alter table public.order_fabric_bom_lines
  add column if not exists mixing_uom text,
  add column if not exists no_of_colors integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_fabric_bom_lines_mixing_uom_check'
  ) then
    alter table public.order_fabric_bom_lines
      add constraint order_fabric_bom_lines_mixing_uom_check
      check (mixing_uom is null or mixing_uom in ('percent', 'cm'));
  end if;

  -- A colour count is a count. Zero is not "no colours declared" (that is NULL),
  -- so the floor is 1 and a negative is nonsense rather than an empty state.
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_fabric_bom_lines_no_of_colors_check'
  ) then
    alter table public.order_fabric_bom_lines
      add constraint order_fabric_bom_lines_no_of_colors_check
      check (no_of_colors is null or no_of_colors between 1 and 99);
  end if;
end $$;

comment on column public.order_fabric_bom_lines.mixing_uom is
  'Yarn-dyed only. How the stripe repeat ratio is expressed: percent | cm (0513).';
comment on column public.order_fabric_bom_lines.no_of_colors is
  'Yarn-dyed only. Distinct yarn colours knit into the pattern; the Repeats panel maps them (0513).';
