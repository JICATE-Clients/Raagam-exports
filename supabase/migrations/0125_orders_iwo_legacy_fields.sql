-- ============================================================================
-- Raagam ERP — 0125 Orders ▸ Internal Work Order: legacy fields
-- The legacy "Internal work order" form is a trial/work-order header that can be
-- Non-Order Related (no sales order) with Customer / Style / Item Class / Owner
-- of the Trial pickers. The 0024 table was order-authorization only, so this
-- relaxes sales_order_id + title to nullable and adds the legacy header fields.
-- Additive; reuses the existing 'orders' RLS policies on the table.
-- ============================================================================

alter table public.internal_work_orders
  alter column sales_order_id drop not null,
  alter column title          drop not null,
  add column if not exists iwo_type          text,                                   -- Order Related / Non-Order Related
  add column if not exists iwo_for            text,                                   -- "For"
  add column if not exists iwo_date           date not null default current_date,
  add column if not exists item_class_id      uuid references public.config_lookups(id),
  add column if not exists owner_of_trial_id  uuid references public.employees(id),
  add column if not exists customer_id        uuid references public.customers(id),
  add column if not exists reference          text,
  add column if not exists style_id           uuid references public.garment_styles(id),
  add column if not exists deli_date          date,
  add column if not exists remarks            text;

create index if not exists idx_iwo_customer on public.internal_work_orders(customer_id);
create index if not exists idx_iwo_style    on public.internal_work_orders(style_id);
