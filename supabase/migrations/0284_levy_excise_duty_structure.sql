-- ============================================================================
-- Raagam ERP — 0284 Levy Master: Excise Duty Structure (Type = EXCISE DUTY)
-- Legacy EDP2 "Excise Duty Structure" screen: same `levies` record, Type=
-- EXCISE DUTY swaps in Excise Duty %/Cess/Edu.Cess — again reusing the shared
-- Annexure block (Category + Category Slno + Calc/Exempt + annexure_ac_head)
-- already built for Duty (0282) and TDS (0283). Dedicated columns rather than
-- reusing the GST cess_mode/cess_value pair — this "Cess" is a plain % here,
-- no mode toggle, distinct concept from the GST Structure's Cess block.
-- ============================================================================

alter table public.levies
  add column if not exists excise_duty_pct numeric(6,2) not null default 0,
  add column if not exists excise_cess_pct numeric(6,2) not null default 0,
  add column if not exists excise_edu_cess_pct numeric(6,2) not null default 0;
