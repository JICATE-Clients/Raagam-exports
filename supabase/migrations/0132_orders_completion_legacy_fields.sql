-- ============================================================================
-- Raagam ERP — 0132 Orders ▸ Garment Orders ▸ step 14 "Garment Order Completion"
-- Enrich the 0123 order_completions screen to the legacy form: Completion No
-- (code) · Date · Customer ⓘ · SC No ⓘ · Order No · Remarks. Mirrors the 0131
-- cancellation enrichment. Customer is the order's buyer, auto-filled from the
-- SC No. Reuses the existing GCM code trigger, order_id NOT NULL + unique, and
-- the 'orders' RLS — no new permission/trigger.
-- ============================================================================

alter table public.order_completions
  add column if not exists customer_id uuid references public.buyers(id),
  add column if not exists order_no    text;

create index if not exists idx_ordcompl_customer on public.order_completions(customer_id);
