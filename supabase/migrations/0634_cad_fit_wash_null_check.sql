-- ============================================================================
-- Raagam ERP — 0634 fix 0632's Fit Wash check: a NULL percentage passed it.
--
-- 0632 wrote `case when fit_wash then length_shrink_pct > 0 and … end`. With
-- a percentage left blank, `NULL > 0` is NULL, the whole expression is NULL,
-- and A CHECK THAT EVALUATES TO NULL PASSES — so Fit Wash = Yes with no
-- shrinkage was accepted. Found by the rolled-back behaviour test the same
-- day (2026-09-25), before any row used it. `is not null` makes the Yes arm
-- TRUE-or-FALSE, never NULL.
-- ============================================================================

alter table public.order_cad_allocations drop constraint if exists chk_oca_fit_wash_shrinkage;
alter table public.order_cad_allocations
  add constraint chk_oca_fit_wash_shrinkage check (
    case when fit_wash
         then length_shrink_pct is not null and length_shrink_pct > 0 and length_shrink_pct < 100
          and width_shrink_pct  is not null and width_shrink_pct  > 0 and width_shrink_pct  < 100
         else length_shrink_pct is null and width_shrink_pct is null end);
