-- ============================================================================
-- Raagam ERP — 0268 Sales ▸ Marketing ▸ Define Styles (extra fields)
-- Legacy "Define Styles — By Enquiry No." grid carries more per-style columns
-- than the base style card: Action · Sample Type · Composition · Sample Qty ·
-- Unit. Add them to public.styles (additive; RLS already gated on 'sales').
-- ============================================================================

alter table public.styles
  add column if not exists action      text,
  add column if not exists sample_type text
    check (sample_type in ('proto','fit','sms','pp','top')),
  add column if not exists composition text,
  add column if not exists sample_qty  numeric(14,3),
  add column if not exists unit_id     uuid references public.uoms(id);

create index if not exists idx_styles_unit on public.styles(unit_id);
