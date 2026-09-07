-- 0524 — Fabric BOM ▸ Manual: the cutting allowance moves back off the width
-- and onto the length, reversing 0523 a few hours after it landed.
--
-- 0523 read a written client spec verbatim — "Tolerance (cm): extra safety
-- margin added to the width", "Calculated Width (cm) = Width + Tolerance" —
-- and renamed `length_tolerance` to `width_tolerance` on that authority, naming
-- legacy's own `Length | Length Tolerance | Length` column band as the earlier
-- (0491) misreading it was correcting.
--
-- This reverts it, on the operator's explicit instruction after being shown
-- that written spec side by side with a fresh legacy screenshot (2026-09-03
-- 19:58) of this exact band, and confirming twice — once after being shown the
-- quoted spec directly — that the length reading is what is wanted on this
-- screen. See `effectiveLength` in lib/orders/fabric-bom/manual.ts for the
-- full history and the arithmetic this changes.
--
-- NOTHING TO BACK-FILL, AGAIN. `order_fabric_bom_manual_sizes` still holds 0
-- rows (catalog, 2026-09-03, hours after 0523 made the same observation) — the
-- module has no save flow exercised yet. A rename is therefore free a second
-- time.

alter table public.order_fabric_bom_manual_sizes
  rename column width_tolerance to length_tolerance;

comment on column public.order_fabric_bom_manual_sizes.length_tolerance is
  'The cutting allowance ADDED TO THE LENGTH (0524, reverting 0523). Effective length = length + this, and the piece weight multiplies that by the raw table_width. It was briefly width_tolerance, added to table_width, for a few hours on 2026-09-03 (0523) on the authority of a written spec; 0524 reverts it back to the length on the operator''s explicit instruction.';
