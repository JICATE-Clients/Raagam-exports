-- ============================================================================
-- Raagam ERP — 0327 Orders ▸ Order Booking + Due Date Confirmations + Contract Review
--
-- Order Booking = formal order confirmation with certifications, shipping
-- terms, merchandiser/agent assignment. Created after SQ is confirmed.
--
-- Due Date Confirmations = confirm/update delivery dates per line item.
-- Propagates date changes to the parent sales_order.
--
-- Contract Review = profitability review and approval. Compares IOC cost vs
-- order value to calculate profit/loss per style. Approve/reject/revision.
-- ============================================================================

-- ==========================================================================
-- 1. Order Bookings
-- ==========================================================================
create sequence if not exists public.seq_order_booking;
create table if not exists public.order_bookings (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  booking_date          date not null default current_date,
  customer_id           uuid references public.buyers(id),
  order_no              text,
  order_type            text check (order_type is null or order_type in ('garment','home_textile')),
  order_category        text,
  order_txn_type        text,
  season                text,
  season_yr             text,
  delivery_date         date,
  merchandiser_id       uuid references public.profiles(id) on delete set null,
  agent_name            text,
  receipt_mode          text check (receipt_mode is null or receipt_mode in ('email','phone','fax','courier','direct')),
  received_date         date,
  ship_type_id          uuid references public.config_lookups(id) on delete set null,
  ship_mode             text check (ship_mode is null or ship_mode in ('air','sea','road')),
  pay_mode              text,
  country_code          text,
  material_composition  text,
  bundle_tag_caption    text,
  location_id           uuid references public.locations(id) on delete set null,
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_order_booking_code before insert on public.order_bookings
  for each row execute function public.assign_code('OBK','public.seq_order_booking');
create trigger trg_order_booking_updated before update on public.order_bookings
  for each row execute function public.set_updated_at();
create index if not exists idx_order_bookings_so on public.order_bookings(sales_order_id);
create index if not exists idx_order_bookings_cust on public.order_bookings(customer_id);
create index if not exists idx_order_bookings_location on public.order_bookings(location_id);

-- ==========================================================================
-- 2. Order Booking Certifications (child)
-- ==========================================================================
create table if not exists public.order_booking_certifications (
  id                    uuid primary key default gen_random_uuid(),
  order_booking_id      uuid not null references public.order_bookings(id) on delete cascade,
  sno                   integer not null default 0,
  certification         text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_obc_updated before update on public.order_booking_certifications
  for each row execute function public.set_updated_at();
create index if not exists idx_obc_booking on public.order_booking_certifications(order_booking_id);

-- ==========================================================================
-- 3. Due Date Confirmations
-- ==========================================================================
create sequence if not exists public.seq_due_date_conf;
create table if not exists public.due_date_confirmations (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  entry_date            date not null default current_date,
  customer_id           uuid references public.buyers(id),
  delivery_date         date,
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ddc_code before insert on public.due_date_confirmations
  for each row execute function public.assign_code('DDC','public.seq_due_date_conf');
create trigger trg_ddc_updated before update on public.due_date_confirmations
  for each row execute function public.set_updated_at();
create index if not exists idx_ddc_so on public.due_date_confirmations(sales_order_id);

-- ==========================================================================
-- 4. Due Date Confirmation Items (per-line delivery dates)
-- ==========================================================================
create table if not exists public.due_date_confirmation_items (
  id                    uuid primary key default gen_random_uuid(),
  confirmation_id       uuid not null references public.due_date_confirmations(id) on delete cascade,
  sno                   integer not null default 0,
  line_item_id          uuid references public.so_line_items(id) on delete set null,
  item_description      text,
  order_qty             numeric(14,3) default 0,
  delivery_date         date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ddc_items_updated before update on public.due_date_confirmation_items
  for each row execute function public.set_updated_at();
create index if not exists idx_ddc_items_conf on public.due_date_confirmation_items(confirmation_id);

-- ==========================================================================
-- 5. Contract Reviews (profitability approval)
-- ==========================================================================
create sequence if not exists public.seq_contract_review;
create table if not exists public.contract_reviews (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sales_order_id        uuid not null references public.sales_orders(id) on delete cascade,
  review_date           date not null default current_date,
  customer_id           uuid references public.buyers(id),
  order_no              text,
  merchandiser_name     text,
  currency_code         text,
  ioc_value             numeric(14,2) default 0,
  order_value           numeric(14,2) default 0,
  profit_loss_value     numeric(14,2) default 0,
  profit_loss_pct       numeric(8,2) default 0,
  approval_status       text not null default 'pending'
    check (approval_status in ('pending','approved','rejected','revision')),
  is_sent_to_revision   boolean not null default false,
  remarks               text,
  approved_by           uuid references public.profiles(id) on delete set null,
  approved_at           timestamptz,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_cr_code before insert on public.contract_reviews
  for each row execute function public.assign_code('CR','public.seq_contract_review');
create trigger trg_cr_updated before update on public.contract_reviews
  for each row execute function public.set_updated_at();
create index if not exists idx_cr_so on public.contract_reviews(sales_order_id);
create index if not exists idx_cr_status on public.contract_reviews(approval_status);

-- ==========================================================================
-- 6. Contract Review Styles (per-style P/L breakdown)
-- ==========================================================================
create table if not exists public.contract_review_styles (
  id                    uuid primary key default gen_random_uuid(),
  contract_review_id    uuid not null references public.contract_reviews(id) on delete cascade,
  sno                   integer not null default 0,
  style_no              text,
  ioc_value             numeric(14,2) default 0,
  order_value           numeric(14,2) default 0,
  profit_loss_value     numeric(14,2) default 0,
  profit_loss_pct       numeric(8,2) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_cr_styles_updated before update on public.contract_review_styles
  for each row execute function public.set_updated_at();
create index if not exists idx_cr_styles_cr on public.contract_review_styles(contract_review_id);

-- ==========================================================================
-- 7. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'order_bookings','order_booking_certifications',
    'due_date_confirmations','due_date_confirmation_items',
    'contract_reviews','contract_review_styles'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated
        using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (public.has_permission('orders','delete'));
    $f$, t);
  end loop;
end $$;
