-- ============================================================================
-- Raagam ERP — 0272 Sales ▸ Marketing ▸ Samples (first-class fields)
-- Make samples match the legacy "By Sample No." grid: a Sample No (code), plus
-- Sample Qty · Unit · Delivery Date · Customer Reference. (style_id / type /
-- status already exist on the table.) Additive; RLS already gated on 'sales'.
-- ============================================================================

create sequence if not exists public.seq_sample;

alter table public.samples
  add column if not exists code               text,
  add column if not exists sample_qty         numeric(14,3),
  add column if not exists unit_id            uuid references public.uoms(id),
  add column if not exists delivery_date      date,
  add column if not exists customer_reference text;

-- Sample No (SMP-0001) assigned on insert; unique (multiple NULLs allowed for
-- any pre-existing rows).
create unique index if not exists uq_samples_code on public.samples(code);
drop trigger if exists trg_sample_code on public.samples;
create trigger trg_sample_code before insert on public.samples
  for each row execute function public.assign_code('SMP','public.seq_sample');

create index if not exists idx_samples_unit on public.samples(unit_id);
