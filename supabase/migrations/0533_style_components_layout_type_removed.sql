-- ============================================================================
-- Raagam ERP — 0533 Order Info ▸ Style(s) ▸ Components: Layout Type removed.
--
-- Client instruction, 2026-09-05: drop the "Fab Rail" per-style Layout Type
-- declaration 0527 added to this grid ("Layout Type remove this field").
--
-- FULL REMOVAL, matching how this repo retires a field elsewhere (0521's
-- `description` drop on order_fabric_bom_processes is the same shape): the
-- column, its CHECK constraint, the screen cell, the save payload and the
-- Zod input schema all go together, not just the cell. `layout_type` was
-- null on all 11 existing rows (verified against the catalog before this
-- migration was written) — nothing is lost.
--
-- THIS ALSO RETIRES RULE 4 (`componentsHiddenForLayout`,
-- lib/orders/fabric-bom/component-map.ts), the Fabric BOM ▸ Manual /
-- Components picker filter that read this column. It was already a no-op on
-- its Components-tab caller (0530's own Layout Type cell was pulled the same
-- day it shipped — see component-map-sheet.tsx's history), so this migration
-- completes an already-started retirement rather than starting a new one.
-- Both call sites were updated in the same change as this migration; see
-- `lib/orders/fabric-bom/component-map.ts` for where the function used to be
-- if this ever needs rebuilding — it needs a place to declare a per-style
-- Layout Type again first, since this migration removes the only one there
-- was.
-- ============================================================================

alter table public.garment_order_amendment_style_components
  drop column if exists layout_type;

-- The CHECK constraint (goa_style_components_layout_type_check) is dropped
-- automatically with the column; nothing else references it.

-- ---------------------------------------------------------------------------
-- VERIFY (run by hand)
--
--   -- the column is gone (expect 0)
--   select count(*) from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'garment_order_amendment_style_components'
--      and column_name  = 'layout_type';
--
--   -- the CHECK went with it (expect 0)
--   select count(*) from pg_constraint
--    where conname = 'goa_style_components_layout_type_check';
-- ---------------------------------------------------------------------------
