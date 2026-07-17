-- ============================================================================
-- Raagam ERP — 0281 Levy Master: Cess mode "Amount" → "Flat"
-- Cess is either ad-valorem (Percent) or a specific/fixed rate (Flat) — "Amount"
-- was an imprecise label for the same concept; align the stored code with the
-- correct terminology (0221_levies_master.sql).
-- ============================================================================

update public.levies set cess_mode = 'flat' where cess_mode = 'amount';

alter table public.levies drop constraint if exists levies_cess_mode_check;
alter table public.levies
  add constraint levies_cess_mode_check check (cess_mode in ('percent', 'flat'));
