-- ============================================================================
-- Raagam ERP — 0646 the Fabric BOM no longer waits on the pattern
-- (user 2026-09-26: "the fabric bom is not allowing to putting entry because
-- its asking to fill the pattern sheet … remove the condition, no need it now").
--
-- 0628 put `trg_ofb_cad_guard` on order_fabric_boms and 0641 moved its test to
-- "every style's pattern is Ready". Both refused the INSERT of an order's
-- Fabric BOM; this drops the trigger, so a Fabric BOM can be created whatever
-- the CAD / pattern state.
--
-- KEPT: `cad_pattern_blockers()` and `cad_order_pattern_ready()` — the second
-- still drives the "estimates until every style's pattern is Ready" stamp on
-- the reports, which is advisory and blocks nothing. `cad_guard_fabric_bom()`
-- is dropped with its trigger: nothing else calls it.
-- ============================================================================

drop trigger if exists trg_ofb_cad_guard on public.order_fabric_boms;
drop function if exists public.cad_guard_fabric_bom();
