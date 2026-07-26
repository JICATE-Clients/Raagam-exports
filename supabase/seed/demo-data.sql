-- ============================================================================
-- Raagam ERP — demo dataset for client walkthroughs
--
-- Populates twelve months of trading history so the dashboard, analytics and
-- module screens have something to show. NOT a migration and NOT test
-- fixtures: this exists to make a demo legible, and it must never be present
-- in a database anyone is running the business on.
--
-- ## Every row is tagged and reversible
--
-- Demo rows use deterministic UUIDs under a single prefix:
--
--     decade00-0000-4000-8000-<12 hex digits>
--
-- so `demo-data-cleanup.sql` removes exactly this dataset and nothing else —
-- no marker column, no naming convention that could accidentally match a real
-- record, no dependence on created_at windows. Re-running this script is safe:
-- it begins with the same deletes.
--
-- Existing rows are never modified. The real items carry no `category`, and the
-- yarn/fabric tiles group on that column, so this adds its own categorised
-- items rather than back-filling yours.
--
-- ## Dates
--
-- Everything is relative to `current_date`, so the twelve-month window stays
-- current however long the demo database sits. The analytics RPCs in
-- 0042_analytics.sql bucket on specific columns, and those are the ones
-- back-dated here:
--   sales_orders.created_at · receivables.invoice_date ·
--   receivable_receipts.receipt_date · purchase_orders.order_date ·
--   stock_ledger.created_at · production_entries.entry_date
--
-- ## Determinism
--
-- Values come from modular arithmetic on the row index, never random(), so two
-- runs produce identical data and a screenshot taken today still matches the
-- database next week.
--
-- ## A note on the id arithmetic
--
-- Master ids end in a literal decimal-looking suffix (…000000000021). Child
-- rows that reference them must build that suffix with `lpad(n::text, 2, '0')`
-- — NOT `to_hex(n)`, which turns 21 into '15' and produces a foreign key that
-- doesn't exist. The generated-series ids use to_hex deliberately; the
-- hand-written master ids do not.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Remove any previous run
--    Reverse dependency order. stock_balances is included because the
--    stock_ledger trigger only maintains it on INSERT — deleting ledger rows
--    alone would leave phantom balances behind.
-- ---------------------------------------------------------------------------
delete from public.stock_ledger              where id::text like 'decade00-%';
delete from public.stock_balances            where item_id::text like 'decade00-%';
delete from public.packing_lists             where id::text like 'decade00-%';
delete from public.knitting_programs         where id::text like 'decade00-%';
delete from public.production_entries        where id::text like 'decade00-%';
delete from public.shipments                 where id::text like 'decade00-%';
delete from public.receivable_receipts       where id::text like 'decade00-%';
delete from public.receivables               where id::text like 'decade00-%';
delete from public.payables                  where id::text like 'decade00-%';
delete from public.material_requisitions     where id::text like 'decade00-%';
delete from public.po_rate_amendments        where id::text like 'decade00-%';
delete from public.over_budget_confirmations where id::text like 'decade00-%';
delete from public.grn_line_items            where id::text like 'decade00-%';
delete from public.grns                      where id::text like 'decade00-%';
delete from public.po_line_items             where id::text like 'decade00-%';
delete from public.purchase_orders           where id::text like 'decade00-%';
delete from public.purchase_indents          where id::text like 'decade00-%';
delete from public.order_amendments          where id::text like 'decade00-%';
delete from public.ta_milestones             where id::text like 'decade00-%';
delete from public.ta_plans                  where id::text like 'decade00-%';
delete from public.so_line_items             where id::text like 'decade00-%';
delete from public.sales_orders              where id::text like 'decade00-%';
delete from public.items                     where id::text like 'decade00-%';
delete from public.vendors                   where id::text like 'decade00-%';
delete from public.buyers                    where id::text like 'decade00-%';

-- ---------------------------------------------------------------------------
-- 1. Masters
-- ---------------------------------------------------------------------------
insert into public.buyers (id, code, name, country, currency_code, is_active) values
  ('decade00-0000-4000-8000-000000000001', 'HBS', 'H&B Sourcing Ltd',  'United Kingdom', 'GBP', true),
  ('decade00-0000-4000-8000-000000000002', 'NRD', 'Nordheim Apparel',  'Germany',        'EUR', true),
  ('decade00-0000-4000-8000-000000000003', 'CCO', 'Cotton & Co, UK',   'United Kingdom', 'GBP', true),
  ('decade00-0000-4000-8000-000000000004', 'AUR', 'Aurelia Retail',    'United States',  'USD', true);

insert into public.vendors (id, code, name, vendor_type, is_active) values
  ('decade00-0000-4000-8000-000000000011', 'VKS', 'Kandagiri Spinning', 'yarn',   true),
  ('decade00-0000-4000-8000-000000000012', 'VSV', 'Sri Vari Yarns',     'yarn',   true),
  ('decade00-0000-4000-8000-000000000013', 'VSD', 'Sakthi Dyeing',      'dyeing', true),
  ('decade00-0000-4000-8000-000000000014', 'VKT', 'Kumaran Trims',      'trims',  true);

insert into public.items (id, code, name, category, uom_id, is_active) values
  ('decade00-0000-4000-8000-000000000021', 'DMY-Y34',   '34''S COTTON COMBED',   'yarn',   (select id from public.uoms where code = 'KGS' limit 1), true),
  ('decade00-0000-4000-8000-000000000022', 'DMY-P26',   '26''S POLYESTER SPUN',  'yarn',   (select id from public.uoms where code = 'KGS' limit 1), true),
  ('decade00-0000-4000-8000-000000000023', 'DMF-SJ180', 'SINGLE JERSEY 180 GSM', 'fabric', (select id from public.uoms where code = 'KGS' limit 1), true),
  ('decade00-0000-4000-8000-000000000024', 'DMF-IL220', 'INTERLOCK 220 GSM',     'fabric', (select id from public.uoms where code = 'KGS' limit 1), true),
  ('decade00-0000-4000-8000-000000000025', 'DMF-PQ200', 'PIQUE 200 GSM',         'fabric', (select id from public.uoms where code = 'KGS' limit 1), true),
  ('decade00-0000-4000-8000-000000000026', 'DMT-BTN18', 'BUTTON 4-HOLE 18L',     'trim',   (select id from public.uoms where code = 'KGS' limit 1), true);

-- ---------------------------------------------------------------------------
-- 2. Sales orders — 66 across twelve months
--    Buyer is picked by `n % 10` rather than evenly so one buyer clearly leads
--    the Top Customers board; a flat distribution makes that card look broken.
-- ---------------------------------------------------------------------------
insert into public.sales_orders
  (id, order_number, buyer_id, location_id, currency_code, order_qty, fob_price,
   total_value, ship_date, status, created_at)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + n), 12, '0'))::uuid,
  'SO/26-27/' || lpad((400 + n)::text, 4, '0'),
  case
    when n % 10 < 4 then 'decade00-0000-4000-8000-000000000001'::uuid
    when n % 10 < 6 then 'decade00-0000-4000-8000-000000000002'::uuid
    when n % 10 < 8 then 'decade00-0000-4000-8000-000000000003'::uuid
    else 'decade00-0000-4000-8000-000000000004'::uuid
  end,
  case when n % 3 = 0
    then (select id from public.locations where code = 'U2' limit 1)
    else (select id from public.locations where code = 'HO' limit 1) end,
  case when n % 10 < 4 or n % 10 = 6 then 'GBP' when n % 10 < 6 then 'EUR' else 'USD' end,
  (2400 + (n * 617) % 16000)::numeric,
  round((3.4 + ((n * 37) % 45) / 10.0)::numeric, 2),
  round(((2400 + (n * 617) % 16000) * (3.4 + ((n * 37) % 45) / 10.0))::numeric, 2),
  (d.created + ((60 + (n * 13) % 60) || ' days')::interval)::date,
  -- Older orders are finished, the newest are still live: that spread is what
  -- makes the status donut and the T&A alerts read like a real order book.
  case
    when d.created < current_date - interval '8 months' then 'closed'
    when d.created < current_date - interval '5 months' then 'shipped'
    when d.created < current_date - interval '2 months' then 'in_production'
    when n % 17 = 0                                     then 'cancelled'
    else 'confirmed'
  end,
  d.created
from generate_series(1, 66) as n,
lateral (
  select (date_trunc('month', current_date)
          - (((66 - n) % 12) || ' months')::interval
          + (((n * 7) % 26) || ' days')::interval) as created
) d;

-- analytics_top_products ranks on `color || ' ' || size`, so this spread is
-- what the Top Colour/Size card actually shows.
insert into public.so_line_items (id, sales_order_id, color, size, quantity)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(5000000 + (so.n * 2) + k), 12, '0'))::uuid,
  so.id,
  (array['Navy','White','Black','Olive','Maroon','Sky'])[1 + (so.n + k) % 6],
  (array['S','M','L','XL'])[1 + (so.n * 3 + k) % 4],
  round((so.qty / 2.0)::numeric, 0)
from (
  select n,
         ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + n), 12, '0'))::uuid as id,
         (2400 + (n * 617) % 16000) as qty
  from generate_series(1, 66) as n
) so
cross join generate_series(0, 1) as k;

-- ---------------------------------------------------------------------------
-- 3. Time & Action — drives the "milestones on time" ring and the overdue alert
-- ---------------------------------------------------------------------------
insert into public.ta_plans (id, sales_order_id, method)
select ('decade00-0000-4000-8000-' || lpad(to_hex(6000000 + n), 12, '0'))::uuid,
       ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + n), 12, '0'))::uuid,
       'template'
from generate_series(40, 66) as n;

insert into public.ta_milestones
  (id, ta_plan_id, sales_order_id, name, sequence, planned_date, actual_date, status)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(7000000 + n * 10 + k), 12, '0'))::uuid,
  ('decade00-0000-4000-8000-' || lpad(to_hex(6000000 + n), 12, '0'))::uuid,
  ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + n), 12, '0'))::uuid,
  (array['Fabric in-house','Cutting start','Sewing complete','Ex-factory'])[k + 1],
  k + 1,
  p.planned,
  -- Closed milestones mostly hit their date; every fourth slips three days,
  -- which gives the on-time ring a believable number instead of 100%.
  case when p.closed then p.planned + (case when n % 4 = 0 then 3 else -1 end) end,
  case when p.closed then 'done' else 'pending' end
from generate_series(40, 66) as n
cross join generate_series(0, 3) as k
cross join lateral (
  select (so.created_at::date + ((15 + k * 20) || ' days')::interval)::date as planned
  from public.sales_orders so
  where so.id = ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + n), 12, '0'))::uuid
) d
cross join lateral (
  select d.planned as planned,
         -- Comfortably past = closed; a slice of the recently lapsed stays open
         -- so the overdue alert has something real to report.
         (d.planned < current_date - 12 or (d.planned < current_date and (n + k) % 3 <> 0)) as closed
) p;

-- NOTE: amendment_type is CHECK-constrained to
-- quantity|colour|price|sizes|delivery_date|consignee|packing|style.
insert into public.order_amendments
  (id, sales_order_id, amendment_type, description, profit_impact, status, created_at)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(8000000 + n), 12, '0'))::uuid,
  ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + n), 12, '0'))::uuid,
  (array['quantity','price','delivery_date','colour'])[1 + n % 4],
  (array['Buyer increased quantity by 1,200 pcs','FOB revised after yarn price move',
         'Ex-factory pulled forward one week','Colour swap: Olive to Sky'])[1 + n % 4],
  round((18000 + (n * 4231) % 90000)::numeric, 2),
  'pending',
  current_date - ((n % 5) || ' days')::interval
from generate_series(58, 62) as n;

-- ---------------------------------------------------------------------------
-- 4. Purchase
-- ---------------------------------------------------------------------------
insert into public.purchase_indents (id, code, department, status, required_date, created_at)
select ('decade00-0000-4000-8000-' || lpad(to_hex(9000000 + n), 12, '0'))::uuid,
       'PIN/26-27/' || lpad((100 + n)::text, 4, '0'),
       (array['Cutting','Sewing','Stores','Finishing','Packing'])[1 + n % 5],
       case when n % 3 = 0 then 'converted' else 'open' end,
       current_date + ((n % 21) || ' days')::interval,
       current_date - ((n * 3) || ' days')::interval
from generate_series(1, 14) as n;

insert into public.purchase_orders
  (id, code, vendor_id, location_id, currency_code, status, order_date, expected_date,
   total_amount, created_at)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(10000000 + n), 12, '0'))::uuid,
  'PO/26-27/' || lpad((1100 + n)::text, 4, '0'),
  case
    when n % 10 < 4 then 'decade00-0000-4000-8000-000000000011'::uuid
    when n % 10 < 7 then 'decade00-0000-4000-8000-000000000012'::uuid
    when n % 10 < 9 then 'decade00-0000-4000-8000-000000000013'::uuid
    else 'decade00-0000-4000-8000-000000000014'::uuid
  end,
  (select id from public.locations where code = 'HO' limit 1),
  'INR',
  case
    when d.ordered < current_date - interval '6 months' then 'closed'
    when d.ordered < current_date - interval '3 months' then 'received'
    when n % 9 = 0                                      then 'pending_approval'
    when n % 5 = 0                                      then 'partially_received'
    else 'approved'
  end,
  d.ordered,
  -- Some land in the past while still open, which is what the supplier-delay
  -- alert keys on.
  (d.ordered + ((20 + (n * 11) % 26) || ' days')::interval)::date,
  round((820000 + (n * 91237) % 2600000)::numeric, 2),
  d.ordered
from generate_series(1, 44) as n,
lateral (select (current_date - (((44 - n) * 8) || ' days')::interval)::date as ordered) d;

-- The date-based branches above leave only one PO in pending_approval, which
-- would make the approvals table look like a bug. Top it up.
update public.purchase_orders set status = 'pending_approval'
where id in (
  select id from public.purchase_orders
  where id::text like 'decade00-%' and status = 'approved'
  order by order_date desc limit 4
);

insert into public.po_line_items
  (id, purchase_order_id, item_id, description, quantity, unit_price, amount, received_qty)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(11000000 + n), 12, '0'))::uuid,
  ('decade00-0000-4000-8000-' || lpad(to_hex(10000000 + n), 12, '0'))::uuid,
  -- lpad(...::text), NOT to_hex — see the id arithmetic note at the top.
  ('decade00-0000-4000-8000-0000000000' || lpad((21 + n % 3)::text, 2, '0'))::uuid,
  (array['34''S Cotton Combed','26''S Polyester Spun','Single Jersey 180 GSM'])[1 + n % 3],
  (1800 + (n * 137) % 4200)::numeric,
  round((240 + (n * 17) % 130)::numeric, 2),
  round(((1800 + (n * 137) % 4200) * (240 + (n * 17) % 130))::numeric, 2),
  case when n % 5 = 0 then round(((1800 + (n * 137) % 4200) * 0.6)::numeric, 0) else 0 end
from generate_series(1, 44) as n;

insert into public.grns (id, code, vendor_id, location_id, grn_date, status, created_at)
select ('decade00-0000-4000-8000-' || lpad(to_hex(12000000 + n), 12, '0'))::uuid,
       'GRN/26-27/' || lpad((700 + n)::text, 4, '0'),
       case when n % 3 = 0 then 'decade00-0000-4000-8000-000000000011'::uuid
            when n % 3 = 1 then 'decade00-0000-4000-8000-000000000012'::uuid
            else 'decade00-0000-4000-8000-000000000013'::uuid end,
       (select id from public.locations where code = 'HO' limit 1),
       (current_date - (((28 - n) * 9) || ' days')::interval)::date,
       'posted',
       current_date - (((28 - n) * 9) || ' days')::interval
from generate_series(1, 28) as n;

insert into public.grn_line_items
  (id, grn_id, description, received_qty, accepted_qty, rejected_qty, qc_status)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(13000000 + n), 12, '0'))::uuid,
  ('decade00-0000-4000-8000-' || lpad(to_hex(12000000 + n), 12, '0'))::uuid,
  (array['34''S Cotton Combed','26''S Polyester Spun','Single Jersey 180 GSM'])[1 + n % 3],
  (1500 + (n * 211) % 3000)::numeric,
  (case when n % 7 = 0 then (1500 + (n * 211) % 3000) * 0.94
        else (1500 + (n * 211) % 3000) end)::numeric,
  case when n % 7 = 0 then round(((1500 + (n * 211) % 3000) * 0.06)::numeric, 0) else 0 end,
  case when n % 7 = 0 then 'partial' when n % 13 = 0 then 'failed' else 'passed' end
from generate_series(1, 28) as n;

insert into public.over_budget_confirmations
  (id, code, purchase_order_id, description, budget_rate, quoted_rate, variance_pct, reason, status, created_at)
select ('decade00-0000-4000-8000-' || lpad(to_hex(14000000 + n), 12, '0'))::uuid,
       'OBC/26-27/' || lpad((10 + n)::text, 4, '0'),
       ('decade00-0000-4000-8000-' || lpad(to_hex(10000000 + 40 + n), 12, '0'))::uuid,
       (array['34''S combed yarn above budget rate','Dyeing charges revised by processor'])[n],
       248.00, round((248 * (1 + n * 0.06))::numeric, 2), round((n * 6)::numeric, 2),
       'Cotton price movement since the budget was frozen',
       'submitted', current_date - ((n * 2) || ' days')::interval
from generate_series(1, 2) as n;

insert into public.po_rate_amendments
  (id, code, purchase_order_id, previous_rate, revised_rate, reason, status, created_at)
select ('decade00-0000-4000-8000-' || lpad(to_hex(15000000 + n), 12, '0'))::uuid,
       'PRA/26-27/' || lpad((10 + n)::text, 4, '0'),
       ('decade00-0000-4000-8000-' || lpad(to_hex(10000000 + 38 + n), 12, '0'))::uuid,
       262.00, round((262 + n * 14)::numeric, 2),
       'Vendor revised rate after yarn index move',
       'submitted', current_date - ((n * 3) || ' days')::interval
from generate_series(1, 2) as n;

-- ---------------------------------------------------------------------------
-- 5. Stores requisitions & payables (the remaining approval queues)
-- ---------------------------------------------------------------------------
insert into public.material_requisitions
  (id, code, store_id, department, status, required_date, created_at)
select ('decade00-0000-4000-8000-' || lpad(to_hex(16000000 + n), 12, '0'))::uuid,
       'MRS/26-27/' || lpad((40 + n)::text, 4, '0'),
       (select id from public.stores where code = 'ST-MAT' limit 1),
       (array['Cutting','Sewing','Finishing','Packing'])[1 + n % 4],
       case when n <= 3 then 'submitted' when n % 2 = 0 then 'issued' else 'approved' end,
       current_date + ((n % 10) || ' days')::interval,
       current_date - ((n * 2) || ' days')::interval
from generate_series(1, 9) as n;

insert into public.payables
  (id, code, vendor_id, bill_no, bill_date, due_date, currency_code, amount, tax_amount,
   total_amount, status, location_id, created_at)
select ('decade00-0000-4000-8000-' || lpad(to_hex(17000000 + n), 12, '0'))::uuid,
       'BILL/26-27/' || lpad((60 + n)::text, 4, '0'),
       ('decade00-0000-4000-8000-0000000000' || lpad((11 + n % 4)::text, 2, '0'))::uuid,
       'INV-' || (7100 + n)::text,
       (current_date - ((n * 6) || ' days')::interval)::date,
       (current_date + ((30 - n * 4) || ' days')::interval)::date,
       'INR',
       round((420000 + (n * 73331) % 1400000)::numeric, 2),
       round(((420000 + (n * 73331) % 1400000) * 0.05)::numeric, 2),
       round(((420000 + (n * 73331) % 1400000) * 1.05)::numeric, 2),
       case when n <= 3 then 'draft' when n % 2 = 0 then 'paid' else 'approved' end,
       (select id from public.locations where code = 'HO' limit 1),
       current_date - ((n * 6) || ' days')::interval
from generate_series(1, 10) as n;

-- ---------------------------------------------------------------------------
-- 6. Receivables & receipts — the revenue trend and Top Customers board
-- ---------------------------------------------------------------------------
insert into public.receivables
  (id, code, buyer_id, invoice_no, invoice_date, due_date, currency_code,
   amount_fc, exchange_rate, amount_inr, received_fc, status, location_id, created_at)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(18000000 + n), 12, '0'))::uuid,
  'AR/26-27/' || lpad((200 + n)::text, 4, '0'),
  case
    when n % 10 < 4 then 'decade00-0000-4000-8000-000000000001'::uuid
    when n % 10 < 6 then 'decade00-0000-4000-8000-000000000002'::uuid
    when n % 10 < 8 then 'decade00-0000-4000-8000-000000000003'::uuid
    else 'decade00-0000-4000-8000-000000000004'::uuid
  end,
  'INV/26-27/' || lpad((900 + n)::text, 4, '0'),
  d.inv, (d.inv + interval '60 days')::date,
  case when n % 10 < 4 or n % 10 = 6 then 'GBP' when n % 10 < 6 then 'EUR' else 'USD' end,
  round((v.inr / 105.0)::numeric, 2), 105.0, v.inr,
  -- Settled invoices are paid in full; anything still open (including overdue)
  -- has received nothing, so the outstanding figure is honest.
  case when st.status = 'received' then round((v.inr / 105.0)::numeric, 2) else 0 end,
  st.status,
  (select id from public.locations where code = 'HO' limit 1),
  d.inv
from generate_series(1, 52) as n
cross join lateral (
  select (date_trunc('month', current_date)
          - (((52 - n) % 12) || ' months')::interval
          + (((n * 5) % 25) || ' days')::interval)::date as inv
) d
cross join lateral (select round((2200000 + (n * 178391) % 6200000)::numeric, 2) as inr) v
cross join lateral (
  select case
    when d.inv < current_date - interval '3 months' then 'received'
    when d.inv < current_date - interval '61 days'  then 'overdue'
    else 'open'
  end as status
) st;

insert into public.receivable_receipts
  (id, receivable_id, receipt_date, amount_fc, exchange_rate, amount_inr, reference)
select ('decade00-0000-4000-8000-' || lpad(to_hex(19000000 + n), 12, '0'))::uuid,
       r.id, (r.invoice_date + interval '52 days')::date,
       r.received_fc, r.exchange_rate, r.amount_inr,
       'SWIFT/' || lpad(n::text, 5, '0')
from generate_series(1, 52) as n
join public.receivables r
  on r.id = ('decade00-0000-4000-8000-' || lpad(to_hex(18000000 + n), 12, '0'))::uuid
where r.status = 'received';

-- ---------------------------------------------------------------------------
-- 7. Shipments
-- ---------------------------------------------------------------------------
insert into public.shipments
  (id, code, buyer_id, port_of_loading, destination_port, destination_country, vessel,
   incoterm, currency_code, etd, eta, invoice_no, invoice_date, total_value, status, created_at)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(20000000 + n), 12, '0'))::uuid,
  'SHP/26-27/' || lpad((150 + n)::text, 4, '0'),
  ('decade00-0000-4000-8000-0000000000' || lpad((1 + n % 4)::text, 2, '0'))::uuid,
  'Tuticorin',
  (array['Felixstowe','Hamburg','Southampton','New York'])[1 + n % 4],
  (array['United Kingdom','Germany','United Kingdom','United States'])[1 + n % 4],
  (array['MV Kota Ratu','MV Maersk Kalmar','MV Ever Lyric','MV CMA Berlioz'])[1 + n % 4],
  'FOB', 'INR',
  d.etd, (d.etd + interval '24 days')::date,
  'EXP/26-27/' || lpad((500 + n)::text, 4, '0'), d.etd,
  round((1800000 + (n * 143711) % 5200000)::numeric, 2),
  case
    when d.etd < current_date - interval '75 days' then 'closed'
    when d.etd < current_date - interval '30 days' then 'delivered'
    when d.etd < current_date - interval '3 days'  then 'shipped'
    when n % 7 = 0                                 then 'docs_ready'
    else 'planning'
  end,
  d.etd
from generate_series(1, 34) as n
cross join lateral (select (current_date - (((26 - n) * 11) || ' days')::interval)::date as etd) d;

-- Two sail dates already passed while still on the dock — the "past ETD" alert.
update public.shipments set status = 'docs_ready'
where id in (
  select id from public.shipments
  where id::text like 'decade00-%' and status = 'shipped' and etd < current_date
  order by etd desc limit 2
);

-- ---------------------------------------------------------------------------
-- 8. Production
-- ---------------------------------------------------------------------------
insert into public.production_entries
  (id, sales_order_id, stage, line_id, entry_date, color, size, good_qty, reject_qty, status)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(21000000 + n), 12, '0'))::uuid,
  ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + 20 + (n % 46)), 12, '0'))::uuid,
  -- stage is CHECK-constrained to cutting|sewing|packing. Knitting, dyeing and
  -- finishing quantities cannot exist in this schema, which is why the
  -- dashboard shows those tiles as "not tracked" rather than empty.
  (array['cutting','sewing','packing'])[1 + n % 3],
  l.id,
  (current_date - (((380 - n) * 0.95)::int || ' days')::interval)::date,
  (array['Navy','White','Black','Olive'])[1 + n % 4],
  (array['S','M','L','XL'])[1 + n % 4],
  (320 + (n * 271) % 1900)::numeric,
  ((n * 13) % 40)::numeric,
  'confirmed'
from generate_series(1, 380) as n
cross join lateral (
  select id from public.production_lines where is_active order by code offset (n % 8) limit 1
) l;

-- Today's shift, so "lines reporting" and the line-output card have something
-- to say on the day of the demo.
insert into public.production_entries
  (id, sales_order_id, stage, line_id, entry_date, good_qty, reject_qty, status)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(21900000 + n), 12, '0'))::uuid,
  ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + 60 + (n % 6)), 12, '0'))::uuid,
  (array['cutting','sewing','packing'])[1 + n % 3],
  l.id, current_date,
  (540 + (n * 313) % 1400)::numeric, ((n * 7) % 25)::numeric, 'confirmed'
from generate_series(1, 11) as n
cross join lateral (
  select id from public.production_lines where is_active order by code offset (n % 6) limit 1
) l;

insert into public.knitting_programs
  (id, code, sales_order_id, fabric_desc, yarn_desc, gsm, planned_qty, uom, machine,
   start_date, status, created_at)
select ('decade00-0000-4000-8000-' || lpad(to_hex(22000000 + n), 12, '0'))::uuid,
       'KP/26-27/' || lpad((30 + n)::text, 4, '0'),
       ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + 60 + n), 12, '0'))::uuid,
       (array['Single Jersey 180 GSM','Interlock 220 GSM','Pique 200 GSM',
              '1x1 Lycra Rib 240 GSM','Single Jersey 160 GSM'])[n],
       '34''S Cotton Combed', (160 + n * 20)::numeric,
       round((2800 + n * 640)::numeric, 2), 'Kg', 'KM-' || lpad(n::text, 2, '0'),
       current_date - ((n * 4) || ' days')::interval,
       case when n <= 3 then 'running' else 'completed' end,
       current_date - ((n * 4) || ' days')::interval
from generate_series(1, 5) as n;

insert into public.packing_lists (id, code, sales_order_id, packing_date, status, created_at)
select ('decade00-0000-4000-8000-' || lpad(to_hex(23000000 + n), 12, '0'))::uuid,
       'PKL/26-27/' || lpad((20 + n)::text, 4, '0'),
       ('decade00-0000-4000-8000-' || lpad(to_hex(4000000 + 55 + n), 12, '0'))::uuid,
       (current_date - ((n * 3) || ' days')::interval)::date,
       case when n <= 4 then 'draft' else 'finalized' end,
       current_date - ((n * 3) || ' days')::interval
from generate_series(1, 7) as n;

-- ---------------------------------------------------------------------------
-- 9. Stock movements
--
--    Receipts must be inserted BEFORE issues. apply_stock_movement() maintains
--    stock_balances on insert and refuses to let a balance go negative, and it
--    sees insertion order — not the back-dated created_at. Issue volumes are
--    kept well under receipt volumes per item for the same reason.
-- ---------------------------------------------------------------------------
insert into public.stock_ledger
  (id, store_id, item_id, movement_type, quantity, reference_type, note, created_at)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(24000000 + n), 12, '0'))::uuid,
  (select id from public.stores where code = 'ST-MAT' limit 1),
  ('decade00-0000-4000-8000-0000000000' || lpad((21 + n % 6)::text, 2, '0'))::uuid,
  'receipt', (900 + (n * 337) % 2300)::numeric, 'grn', 'Goods receipt',
  (date_trunc('month', current_date)
     - (((78 - n) % 12) || ' months')::interval
     + (((n * 9) % 25) || ' days')::interval)
from generate_series(1, 78) as n;

insert into public.stock_ledger
  (id, store_id, item_id, movement_type, quantity, reference_type, note, created_at)
select
  ('decade00-0000-4000-8000-' || lpad(to_hex(24500000 + n), 12, '0'))::uuid,
  (select id from public.stores where code = 'ST-MAT' limit 1),
  -- Yarn and fabric only, so the consumption stage cards have something to sum.
  ('decade00-0000-4000-8000-0000000000' || lpad((21 + n % 5)::text, 2, '0'))::uuid,
  'issue', (280 + (n * 173) % 900)::numeric, 'production', 'Issued to production',
  (date_trunc('month', current_date)
     - (((72 - n) % 12) || ' months')::interval
     + (((n * 11) % 25) || ' days')::interval)
from generate_series(1, 72) as n;

commit;
