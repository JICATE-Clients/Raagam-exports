-- ============================================================================
-- Raagam ERP — 0126 Orders ▸ Garment Orders ▸ Garment Order Amendment
-- Additive sub-module (legacy EDP2: Sales ▸ Garment Orders ▸ step 8
-- "Garment Order Amendment"). A rich amendment document: a header + 10 sub-tabs.
-- This migration builds the header + the two Logistic grids (charges + style
-- prices) + the Reason fields — the tab we have a screenshot for. The other 8
-- tabs (Style(s), Color/Print, Combos, Prices, Pack type(s), Quantities,
-- Approval Qty, Country/Sizewise) become additive child tables in 0127+, one per
-- screenshot, so nothing is guessed here.
--
-- This screen RECORDS an amendment; it does not mutate the live sales_orders
-- (that is the separate step 11 "Approve Amendment"). Kept distinct from the
-- lean order_amendments/order_revisions (0006). Gated by the EXISTING 'orders'
-- permission — no new module. No new config_lookups kinds: the Logistic pickers
-- reuse existing kinds (department, ship_type, agent, payment_term).
-- ============================================================================

-- ---------- amendment header ----------
create sequence if not exists public.seq_garment_order_amendment;
create table if not exists public.garment_order_amendments (
  id               uuid primary key default gen_random_uuid(),
  code             text unique,                                 -- GOA-0001 (assign_code)
  is_draft         boolean not null default false,
  -- order header (from the legacy screen's top band)
  sales_order_id   uuid references public.sales_orders(id),     -- "SCNo" picker
  amend_date       date not null default current_date,          -- "Date"
  initiated        text,                                        -- "Initiated" (By Customer…)
  amend_type       text,                                        -- "Type"
  buyer_id         uuid references public.buyers(id),           -- "Customer" (the order's party)
  po_no            text,                                        -- "PO No"
  po_date          date,
  merchandiser_id  uuid references public.profiles(id),         -- "Merchand."
  season           text,
  amend_year       int,                                         -- "Yr"
  delivery_date    date,                                        -- "Deli.Dt"
  excess_pct       numeric(6,2) not null default 0,             -- "Excess%"
  pack             boolean not null default false,              -- "Pack" Yes/No
  mult_ord         boolean not null default false,              -- "Mult. Ord" Yes/No
  -- logistic tab scalars
  department_id    uuid references public.config_lookups(id),   -- kind department
  ship_type_id     uuid references public.config_lookups(id),   -- kind ship_type
  contact_id       uuid references public.customer_contacts(id),
  logi_po_date     date,                                        -- logistic "PO Date"
  agent_id         uuid references public.config_lookups(id),   -- kind agent
  ship_mode        text,                                        -- fixed list (AIR/ROAD/SEA)
  country_id       uuid references public.countries(id),
  currency_code    text references public.currencies(code),
  received_date    date,
  received_mode    text,                                        -- fixed list (By Mail…)
  pay_mode         text,                                        -- fixed list (CAD/CASH…)
  pay_terms_id     uuid references public.config_lookups(id),   -- kind payment_term
  ex_rate          numeric(14,4) not null default 0,
  avg_rate         numeric(14,6) not null default 0,
  gross_value      numeric(16,2) not null default 0,
  -- logistic tab: cash discount (3 rows)
  cd1_pct          numeric(6,2) not null default 0,
  cd1_days         int not null default 0,
  cd2_pct          numeric(6,2) not null default 0,
  cd2_days         int not null default 0,
  cd3_pct          numeric(6,2) not null default 0,
  cd3_days         int not null default 0,
  -- reason tab
  reason_type      text,
  reason_text      text,
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_goa_code before insert on public.garment_order_amendments
  for each row execute function public.assign_code('GOA','public.seq_garment_order_amendment');
create trigger trg_goa_updated before update on public.garment_order_amendments
  for each row execute function public.set_updated_at();
create index if not exists idx_goa_order on public.garment_order_amendments(sales_order_id);
create index if not exists idx_goa_buyer on public.garment_order_amendments(buyer_id);
create index if not exists idx_goa_status on public.garment_order_amendments(is_draft);

-- ---------- logistic child: Less / Add charges grid ----------
create table if not exists public.garment_order_amendment_charges (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,
  section      text not null default 'less' check (section in ('less','add')),
  label        text,                                            -- Freight/Piece, Bonus, Others…
  calc_mode    text,                                            -- the per-row ▼ (mode)
  amount       numeric(14,2) not null default 0,
  unit         text,                                            -- the trailing ▼ (unit)
  created_at   timestamptz not null default now()
);
create index if not exists idx_goa_charges_amend on public.garment_order_amendment_charges(amendment_id);

-- ---------- logistic child: style-wise price grid ----------
create table if not exists public.garment_order_amendment_style_prices (
  id                uuid primary key default gen_random_uuid(),
  amendment_id      uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno               int not null default 0,
  style_ref_no      text,
  style             text,
  price             numeric(14,2) not null default 0,
  csp_type          text,                                       -- "CSP Purchase" Type
  csp_price         numeric(14,2) not null default 0,           -- "CSP Purchase" Price
  fob_buyer_price   numeric(14,2) not null default 0,           -- FOB Rate (Buyer_Price)
  fob_selling_price numeric(14,2) not null default 0,           -- FOB Rate (Selling_Price)
  created_at        timestamptz not null default now()
);
create index if not exists idx_goa_prices_amend on public.garment_order_amendment_style_prices(amendment_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'garment_order_amendments',
    'garment_order_amendment_charges',
    'garment_order_amendment_style_prices'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
