-- ============================================================================
-- Raagam ERP — 0131 Orders ▸ Garment Orders ▸ step 13 "Garment Order Cancellation"
-- Enrich the 0122 order_cancellations screen to the legacy form: Cancel No (code)
-- · Date · Customer ⓘ · SC No ⓘ · Order No · Remarks. The legacy form has NO
-- "Reason" field, so reason is relaxed to nullable (kept for existing rows, no
-- longer written). Customer is the order's buyer, auto-filled from the SC No.
-- Reuses the existing GOC code trigger, order_id NOT NULL + unique(order_id),
-- and the 'orders' RLS — no new permission/trigger.
-- ============================================================================

alter table public.order_cancellations
  add column if not exists customer_id uuid references public.buyers(id),
  add column if not exists order_no    text;

alter table public.order_cancellations
  alter column reason drop not null;

create index if not exists idx_ordcancel_customer on public.order_cancellations(customer_id);
