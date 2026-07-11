-- ============================================================================
-- Raagam ERP — 0270 Sales ▸ Marketing ▸ Product Development Request (extra fields)
-- Legacy "Product development request — By Sample No." captures more per-request
-- detail than the base handoff: Style · Sample Type · Sample Qty · Unit ·
-- Delivery Date · Customer Reference. Add them to public.pd_requests (additive;
-- RLS already gated on 'planning'; the Sales screen writes/reads via admin client).
-- ============================================================================

alter table public.pd_requests
  add column if not exists style_id           uuid references public.styles(id) on delete set null,
  add column if not exists sample_type        text
    check (sample_type in ('proto','fit','sms','pp','top')),
  add column if not exists sample_qty         numeric(14,3),
  add column if not exists unit_id            uuid references public.uoms(id),
  add column if not exists delivery_date      date,
  add column if not exists customer_reference text;

create index if not exists idx_pd_req_style on public.pd_requests(style_id);
