-- ============================================================================
-- Raagam ERP — 0241 Master Data ▸ Associates ▸ Applicant: General tab
-- The Applicant "General" tab (deferred from 0238) wires:
--   Currency 1/2/3  → public.currencies (code)      — blue ⓘ picker (Add/Modify)
--   Ship Mode       → fixed list (AIR/ROAD/SEA/SEA-AIR)         — plain dropdown
--   Ship Type       → public.config_lookups kind 'ship_type'    — Incoterms master
--   Pay Mode        → fixed list (CAD/CASH/CHEQUE/DA/DD/DP/LC/…) — plain dropdown
--   Payment Terms   → public.config_lookups kind 'payment_term' — ⓘ picker
--   Bank            → public.banks (id)              — blue ⓘ picker (Add/Modify)
--   A/c No.         → free text
--
-- Ship Type is built as a REUSABLE master (kind 'ship_type') per the brief
-- ("if we built this table wire it for all applicable fields"): today the
-- logistics/sales screens store `incoterm` as ad-hoc hardcoded strings
-- (`['FOB','CIF','CFR','EXW','DDP','DAP']`) — those fields should later select
-- from this same master (follow-up; those files are owned by the other lane).
-- ============================================================================

-- 1) Widen the config_lookups kind CHECK: add 'ship_type' + 'payment_term'
--    (re-add every existing kind — 0236 shape — plus the two new ones).
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check
  check (kind in (
    'attribute',
    'levy',
    'material_category',
    'material_attribute',
    'yarn_count',
    'yarn_purity',
    'composition',
    'process',
    'component',
    'gauge',
    'knitting_dia',
    'out_doc_term',
    'commodity',
    'item_class',
    'hsn_code',
    'city',
    'state',
    'department',
    'designation',
    'internal_department',
    'ship_type',
    'payment_term'
  ));

-- 2) Seed the Ship Type (Incoterms) master idempotently. Standard Incoterms
--    2020 + the legacy codes still in use (DDU / DAF). code = Incoterm code.
--    Users can Add/Modify more inline via the picker.
insert into public.config_lookups (kind, code, name, is_active)
select 'ship_type', v.code, v.name, true
from (values
  ('EXW', 'Ex Works'),
  ('FCA', 'Free Carrier'),
  ('FAS', 'Free Alongside Ship'),
  ('FOB', 'Free On Board'),
  ('CFR', 'Cost & Freight (C&F)'),
  ('CIF', 'Cost, Insurance & Freight'),
  ('CPT', 'Carriage Paid To'),
  ('CIP', 'Carriage & Insurance Paid To'),
  ('DAP', 'Delivered At Place'),
  ('DPU', 'Delivered At Place Unloaded'),
  ('DDP', 'Delivered Duty Paid'),
  ('DDU', 'Delivered Duty Unpaid'),
  ('DAF', 'Delivered At Frontier')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups c
  where c.kind = 'ship_type' and c.code = v.code
);

-- 3) Applicant General-tab columns (additive; header on public.applicants).
alter table public.applicants
  add column if not exists currency_1       text references public.currencies(code),
  add column if not exists currency_2       text references public.currencies(code),
  add column if not exists currency_3       text references public.currencies(code),
  add column if not exists ship_mode        text,
  add column if not exists ship_type_id     uuid references public.config_lookups(id) on delete set null,
  add column if not exists pay_mode         text,
  add column if not exists payment_term_id  uuid references public.config_lookups(id) on delete set null,
  add column if not exists bank_id          uuid references public.banks(id) on delete set null,
  add column if not exists ac_no            text;
