-- ============================================================================
-- Raagam ERP — 0283 Levy Master: TDS Structure (Type = TDS)
-- Legacy EDP2 "TDS Structure" screen: same `levies` record, Type=TDS swaps in
-- TDS%/Surcharge/Addnl Surcharge — but reuses the SAME Annexure block
-- (Category + Category Slno + Calc/Exempt) and single Account Head already
-- built for Duty Structure (0282), so that column is renamed to reflect it's
-- now shared by both types rather than Duty-specific.
-- ============================================================================

alter table public.levies rename column duty_ac_head to annexure_ac_head;

alter table public.levies
  add column if not exists tds_pct numeric(6,2) not null default 0,
  add column if not exists surcharge_pct numeric(6,2) not null default 0,
  add column if not exists addnl_surcharge_pct numeric(6,2) not null default 0;
