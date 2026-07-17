-- ============================================================================
-- Raagam ERP — 0287 Levy Master: VAT/CST Structure (Type = VAT or CST)
-- Confirmed from the legacy Levies list screenshot: pre-GST entries dated
-- 2014-2016 with Type VAT/CST, "Effective From" 01-07-2017 marking when GST
-- superseded them. Single flat rate + one shared account head (only one of
-- VAT/CST is ever active per record) — no CGST/SGST/IGST split, no Annexure.
-- ============================================================================

alter table public.levies
  add column if not exists vat_cst_pct numeric(6,2) not null default 0,
  add column if not exists vat_cst_ac_head uuid references public.gl_accounts(id) on delete set null;
