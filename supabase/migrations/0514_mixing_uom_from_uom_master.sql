-- ============================================================================
-- Raagam ERP — 0514 Fabric BOM ▸ Fabric Lines ▸ Mixing Uom reads the UOM MASTER
--
-- Client 2026-09-02: "the uom master need to connect in that mixing uom".
--
-- THIS SUPERSEDES 0513's `mixing_uom text check (percent|cm)`, added the same
-- afternoon from the client's own earlier written spec ("Manual selection
-- dropdown (Percentage vs. Centimeters)"). The two instructions are not in
-- conflict once the cell is a MASTER REFERENCE whose list contains those units,
-- rather than a hardcoded pair — which is what this migration makes it.
--
-- Read together, this cell has now had FOUR readings in one day:
--   1. `consumption_uom_id`  — a UOM master pick, but the CONSUMPTION unit
--   2. hidden entirely       — while "remove Unit" was in force
--   3. `mixing_uom` text     — percent | cm, hardcoded (0513)
--   4. `mixing_uom_id`       — a UOM master pick that is its OWN column
-- The lesson in the sequence is that 1 and 4 look identical in the UI and are
-- different columns answering different questions: what unit the CONSUMPTION
-- figure is in, versus what unit the stripe REPEAT RATIO is in.
--
-- SAFE TO DROP RATHER THAN MIGRATE. `order_fabric_bom_lines` held 0 rows and
-- `mixing_uom` was non-null on none of them — checked from the catalog before
-- writing this, not assumed. A column added hours ago is still a column: the
-- check is cheap and the alternative is silent data loss.
-- ============================================================================

alter table public.order_fabric_bom_lines
  drop constraint if exists order_fabric_bom_lines_mixing_uom_check;

alter table public.order_fabric_bom_lines
  drop column if exists mixing_uom;

alter table public.order_fabric_bom_lines
  add column if not exists mixing_uom_id uuid references public.uoms(id);

comment on column public.order_fabric_bom_lines.mixing_uom_id is
  'Yarn-dyed only. The UOM the stripe repeat ratio is expressed in - % or CM from the UOM master (0514).';

-- ---------------------------------------------------------------------------
-- THE TWO RATIO UNITS, ADDED TO THE UOM MASTER
--
-- Without them the master cannot express a stripe repeat at all. It held exactly
-- CONE, DZN, GROSS, KGS, LTR, MTR, NOS, PCS (checked 2026-09-02) — none of which
-- can say "60% blue / 40% white". So "connect the UOM master" and the earlier
-- "Percentage vs Centimeters" become one instruction only once these exist.
--
-- GUARDED BY `not exists` ON UPPER(code), so re-running is a no-op and a master
-- row an operator has since created by hand is never duplicated.
--
-- SCOPED TO FABRIC AND YARN rather than `for_all_item_classes`, because a stripe
-- ratio is not a unit anything is bought or stocked in. NOTE, AND THIS IS THE
-- HONEST PART: nothing reads those flags when building a picker today —
-- `getUoms` returns the whole master — so the scoping is a statement of intent
-- that becomes real if the pickers ever honour it. Until then these two DO
-- appear in every other UOM dropdown. That is a thing to know, not a thing to
-- hide; deactivate them on the UOM master if it turns out to be unwanted.
-- ---------------------------------------------------------------------------
insert into public.uoms (code, name, is_active, decimal_places, decimal_places_allowed,
                         for_all_item_classes, is_fabric, is_yarn)
select v.code, v.name, true, 2, 2, false, true, true
from (values ('%', 'Percentage'), ('CM', 'Centimeters')) as v(code, name)
where not exists (
  select 1 from public.uoms u where upper(u.code) = upper(v.code)
);
