-- 0663 — Material BOM: a NEGATIVE Excess % and WHOLE-UNIT UOMs
-- (client 2026-09-30, doc/order/budgetupdate.md §6).
--
-- 1. EXCESS % MAY BE NEGATIVE. The spec: "allow entering positive or negative
--    allowance percentage (e.g. +5.00%, -5.00%)". A negative figure is a trim
--    the buyer supplies part of, or a consumption the merchandiser knows runs
--    under the sheet's figure. 0418 / 0450 held it to 0..100; the floor is now
--    -50 — a cut deeper than half the calculated quantity is a typo far more
--    often than a real allowance, and at -100 the line would ask for nothing
--    while still showing a consumption, which is a row lying about itself.
--    The ceiling stays 100.
--
-- 2. WHOLE-UNIT UOMs round TO A WHOLE NUMBER. (CORRECTED BY 0664: the
--    rounding is HALF-UP, the app's existing whole-unit rule, and DZN is whole
--    too — read 0664 before the paragraph below.) The spec: Pcs, Gross, Pack,
--    Box, Cone, Roll are counted, so "16.67 Gross" is not something anyone can
--    buy. The flag is the UOM master's own `decimal_places_allowed` (0309), set
--    to 0 — editable on Masters ▸ Stock Units, so the client decides which
--    units are whole without a code change. Every UOM holds 2 today.
--
--    Only the Material BOM reads the 0 as "whole" (`ceilForUom` in
--    lib/orders/material-bom/requirement.ts). Every other reader goes through
--    `uomPrecision`, which floors at 2 on purpose (lib/uom/convert.ts), so the
--    Fabric BOM, the requirement reports and every quantity display are
--    unchanged by this data.
--
--    DZN is left at 2: a dozen is bought in halves as often as whole, and the
--    spec does not list it. ROLL has no row today; a new one takes 0 on the
--    master screen.

alter table public.material_bom_amendment_items
  drop constraint if exists material_bom_amendment_items_excess_pct_check;
alter table public.material_bom_amendment_items
  add constraint material_bom_amendment_items_excess_pct_check
  check (excess_pct >= -50 and excess_pct <= 100);

alter table public.material_bom_amendment_item_slices
  drop constraint if exists chk_mba_slice_excess_pct;
alter table public.material_bom_amendment_item_slices
  add constraint chk_mba_slice_excess_pct
  check (excess_pct is null or (excess_pct >= -50 and excess_pct <= 100));

update public.uoms
   set decimal_places_allowed = 0
 where upper(code) in ('PCS', 'NOS', 'GROSS', 'BOX', 'PACKET', 'PACK', 'CONE', 'ROLL')
   and decimal_places_allowed is distinct from 0;
