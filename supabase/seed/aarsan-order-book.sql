-- ============================================================================
-- Raagam ERP — AARSAN AMERICAS order book, for the dashboard
--
-- Source: `doc/demo.xlsx` as supplied by the client on 2026-08-21. Despite the
-- extension it is a TAB-SEPARATED text file, not a workbook — `exceljs` refuses
-- it ("Can't find end of central directory"), and that is the file being read
-- here, not a conversion of it. Generated, never hand-typed: every figure below
-- is copied from a row of that file, so a re-supply regenerates rather than
-- being reconciled by eye.
--
-- ## What it is
--
-- 86 order lines, one customer, USD at 84.00 throughout:
--
--     ordered        241,084 pcs
--     shipped         19,247 pcs   (11 lines have shipped anything)
--     pending        221,837 pcs
--     order value      USD   2,047,168.40   (Order Qty x Price)
--     pending value    USD   1,908,672.70   = INR 160,328,506.80 at 84.00
--
-- ## THE FILE'S "VALUE" COLUMNS ARE THE PENDING BALANCE, NOT THE ORDER
--
-- `FGN Value` is `QTY x Price` where `QTY` is Order Qty MINUS Shipped Qty, and
-- `INRValue` is that times the Ex Rate. They are what is still to ship, which is
-- the number an exporter's order book is about — and it is NOT what
-- `sales_orders.total_value` means. That column holds the value of the order, so
-- it is loaded as `Order Qty x Price`. The two differ by the shipped portion
-- (USD 138,495.70 across 11 lines) and conflating them would
-- overstate neither figure but silently answer a different question.
--
-- There is no column anywhere for shipped-to-date on an order, so the pending
-- balance is NOT stored: it would have to be invented as a shipment or an
-- invoice, and this file names no shipment and no invoice.
--
-- ## Every row is tagged and reversible
--
-- Ids are deterministic under `aa45a400-0000-4000-8000-...`, a prefix no
-- `gen_random_uuid()` will produce, so `aarsan-order-book-cleanup.sql` removes
-- exactly this dataset and nothing else. It is deliberately a DIFFERENT prefix
-- from `decade00-...` (the invented demo dataset in `demo-data.sql`): this is
-- the client's own trading data, and the two must be removable independently.
-- Re-running this script is safe — it begins with the same delete.
--
-- ## Dates
--
-- `created_at` carries `Received Dt`, because that is the column
-- `analytics_monthly_sales` buckets on (0042) and therefore what every
-- order figure on the dashboard is grouped by. `order_date` gets the same date —
-- it decides which fiscal year an SC No numbers into. `ship_date` and
-- `delivery_date` carry `Delivery Dt`.
--
-- ## What this does NOT touch
--
-- Production (`production_entries`), dispatch (`shipments`), purchases
-- (`purchase_orders`) and inventory (`stock_ledger`) — the file says nothing
-- about any of them, so nothing here writes to them. Revenue IS written, but
-- only the part that can be dated; see section 3.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Remove any previous run of THIS dataset (not the decade00 one)
-- ---------------------------------------------------------------------------
delete from public.sales_orders where id::text like 'aa45a400-0000-4000-8000-%';
delete from public.buyers        where id::text like 'aa45a400-0000-4000-8000-%';

-- ---------------------------------------------------------------------------
-- 1. The customer
--    `buyers` is the party `sales_orders.buyer_id` points at, and the dashboard's
--    recent-orders list embeds `buyers(name)` — an order with a null buyer shows
--    no customer at all, which the four existing live orders already demonstrate.
-- ---------------------------------------------------------------------------
insert into public.buyers (id, code, name, country, currency_code, is_active)
values ('aa45a400-0000-4000-8000-000000000001'::uuid, 'AARSAN', 'AARSAN AMERICAS', 'United States', 'USD', true);

-- ---------------------------------------------------------------------------
-- 2. The order book
--    `location_id` is looked up by CODE rather than hard-coded: the RE Nos all
--    begin "U2/", which is Unit 2 in `locations`.
--    `status` is derived from the file's own Shipped Qty — nothing shipped is
--    `confirmed`, part-shipped is `in_production`, fully shipped would be
--    `shipped` (no line in this file is fully shipped).
-- ---------------------------------------------------------------------------
insert into public.sales_orders
  (id, buyer_id, location_id, currency_code,
   order_number, order_qty, fob_price, total_value,
   order_date, ship_date, delivery_date, status, created_at)
select
  v.id, 'aa45a400-0000-4000-8000-000000000001'::uuid,
  (select id from public.locations where code = 'U2' limit 1),
  'USD',
  v.order_number, v.order_qty, v.fob_price, v.total_value,
  v.order_date, v.ship_date, v.ship_date, v.status, v.created_at
from (values

  ('aa45a400-0000-4000-8000-000000001001'::uuid, 'U2/RE//2526/2047', 672, 3.8, 2553.6, '2025-11-26'::date, '2026-02-26'::date, 'in_production', '2025-11-26T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001002'::uuid, 'U2/RE//2526/2048', 672, 3.9, 2620.8, '2025-11-26'::date, '2026-02-26'::date, 'in_production', '2025-11-26T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001003'::uuid, 'U2/RE//2526/2049', 1248, 4.5, 5616.0, '2025-11-26'::date, '2026-02-26'::date, 'in_production', '2025-11-26T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001004'::uuid, 'U2/RE//2526/2050', 1344, 3.7, 4972.8, '2025-11-27'::date, '2026-02-26'::date, 'in_production', '2025-11-27T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001005'::uuid, 'U2/RE//2526/2051', 816, 3.8, 3100.8, '2025-11-27'::date, '2026-02-26'::date, 'in_production', '2025-11-27T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001006'::uuid, 'U2/RE//2526/2052', 768, 5.0, 3840.0, '2025-11-27'::date, '2026-02-26'::date, 'in_production', '2025-11-27T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001007'::uuid, 'U2/RE//2526/2053', 1008, 6.3, 6350.4, '2025-11-27'::date, '2026-02-26'::date, 'in_production', '2025-11-27T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001008'::uuid, 'U2/RE//2526/2097', 4512, 6.0, 27072.0, '2026-01-16'::date, '2026-11-02'::date, 'in_production', '2026-01-16T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001009'::uuid, 'U2/RE//2526/2098', 9192, 6.0, 55152.0, '2026-01-16'::date, '2026-10-05'::date, 'in_production', '2026-01-16T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000100a'::uuid, 'U2/RE//2526/2105', 384, 6.0, 2304.0, '2026-01-20'::date, '2026-04-20'::date, 'confirmed', '2026-01-20T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000100b'::uuid, 'U2/RE//2526/2113', 6420, 15.75, 101115.0, '2026-01-30'::date, '2026-10-06'::date, 'in_production', '2026-01-30T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000100c'::uuid, 'U2/RE//2627/2002', 840, 9.2, 7728.0, '2026-04-03'::date, '2026-05-25'::date, 'confirmed', '2026-04-03T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000100d'::uuid, 'U2/RE//2627/2010', 1200, 5.0, 6000.0, '2026-04-09'::date, '2026-06-01'::date, 'confirmed', '2026-04-09T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000100e'::uuid, 'U2/RE//2627/2011', 1032, 10.5, 10836.0, '2026-04-14'::date, '2026-06-30'::date, 'confirmed', '2026-04-14T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000100f'::uuid, 'U2/RE//2627/2012', 1032, 7.3, 7533.6, '2026-04-14'::date, '2026-06-30'::date, 'confirmed', '2026-04-14T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001010'::uuid, 'U2/RE//2627/2013', 1080, 4.16, 4492.8, '2026-04-14'::date, '2026-06-30'::date, 'confirmed', '2026-04-14T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001011'::uuid, 'U2/RE//2627/2014', 1008, 6.5, 6552.0, '2026-04-14'::date, '2026-06-30'::date, 'confirmed', '2026-04-14T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001012'::uuid, 'U2/RE//2627/2015', 1008, 6.65, 6703.2, '2026-04-14'::date, '2026-06-30'::date, 'confirmed', '2026-04-14T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001013'::uuid, 'U2/RE//2627/2016', 1080, 4.29, 4633.2, '2026-04-14'::date, '2026-06-30'::date, 'confirmed', '2026-04-14T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001014'::uuid, 'U2/RE//2627/2017', 1272, 7.25, 9222.0, '2026-04-14'::date, '2026-06-30'::date, 'confirmed', '2026-04-14T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001015'::uuid, 'U2/RE//2627/2018', 1224, 6.5, 7956.0, '2026-04-26'::date, '2026-06-30'::date, 'confirmed', '2026-04-26T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001016'::uuid, 'U2/RE//2627/2019', 1392, 6.8, 9465.6, '2026-04-28'::date, '2026-08-20'::date, 'in_production', '2026-04-28T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001017'::uuid, 'U2/RE//2627/2020', 1824, 6.5, 11856.0, '2026-05-09'::date, '2026-08-10'::date, 'confirmed', '2026-05-09T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001018'::uuid, 'U2/RE//2627/2021', 1896, 7.0, 13272.0, '2026-05-09'::date, '2026-07-10'::date, 'confirmed', '2026-05-09T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001019'::uuid, 'U2/RE//2627/2022', 600, 6.0, 3600.0, '2026-05-09'::date, '2026-07-31'::date, 'confirmed', '2026-05-09T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000101a'::uuid, 'U2/RE//2627/2024', 1968, 7.5, 14760.0, '2026-05-09'::date, '2026-07-10'::date, 'confirmed', '2026-05-09T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000101b'::uuid, 'U2/RE//2627/2026', 1200, 7.0, 8400.0, '2026-05-09'::date, '2026-09-01'::date, 'confirmed', '2026-05-09T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000101c'::uuid, 'U2/RE//2627/2027', 636, 11.3, 7186.8, '2026-05-12'::date, '2026-07-13'::date, 'confirmed', '2026-05-12T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000101d'::uuid, 'U2/RE//2627/2029', 12684, 9.2, 116692.8, '2026-06-12'::date, '2026-08-10'::date, 'confirmed', '2026-06-12T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000101e'::uuid, 'U2/RE//2627/2030', 6192, 9.2, 56966.4, '2026-06-12'::date, '2026-08-10'::date, 'confirmed', '2026-06-12T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000101f'::uuid, 'U2/RE//2627/2031', 1596, 9.2, 14683.2, '2026-06-12'::date, '2026-08-10'::date, 'confirmed', '2026-06-12T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001020'::uuid, 'U2/RE//2627/2032', 10248, 9.2, 94281.6, '2026-06-12'::date, '2026-08-10'::date, 'confirmed', '2026-06-12T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001021'::uuid, 'U2/RE//2627/2033', 2952, 9.2, 27158.4, '2026-06-12'::date, '2026-08-10'::date, 'confirmed', '2026-06-12T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001022'::uuid, 'U2/RE//2627/2034', 1356, 9.2, 12475.2, '2026-06-12'::date, '2026-08-10'::date, 'confirmed', '2026-06-12T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001023'::uuid, 'U2/RE//2627/2035', 5652, 9.2, 51998.4, '2026-06-12'::date, '2026-08-10'::date, 'confirmed', '2026-06-12T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001024'::uuid, 'U2/RE//2627/2036', 3216, 9.2, 29587.2, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001025'::uuid, 'U2/RE//2627/2037', 1128, 9.2, 10377.6, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001026'::uuid, 'U2/RE//2627/2038', 2820, 9.2, 25944.0, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001027'::uuid, 'U2/RE//2627/2039', 1584, 9.2, 14572.8, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001028'::uuid, 'U2/RE//2627/2040', 1164, 9.2, 10708.8, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001029'::uuid, 'U2/RE//2627/2041', 14700, 10.2, 149940.0, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000102a'::uuid, 'U2/RE//2627/2042', 7824, 10.2, 79804.8, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000102b'::uuid, 'U2/RE//2627/2043', 1164, 10.2, 11872.8, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000102c'::uuid, 'U2/RE//2627/2044', 6480, 10.2, 66096.0, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000102d'::uuid, 'U2/RE//2627/2045', 3780, 10.2, 38556.0, '2026-06-13'::date, '2026-08-10'::date, 'confirmed', '2026-06-13T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000102e'::uuid, 'U2/RE//2627/2046', 1296, 6.25, 8100.0, '2026-06-17'::date, '2026-08-10'::date, 'confirmed', '2026-06-17T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000102f'::uuid, 'U2/RE//2627/2047', 1632, 6.25, 10200.0, '2026-06-17'::date, '2026-08-10'::date, 'confirmed', '2026-06-17T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001030'::uuid, 'U2/RE//2627/2048', 4896, 5.6, 27417.6, '2026-06-17'::date, '2026-11-05'::date, 'confirmed', '2026-06-17T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001031'::uuid, 'U2/RE//2627/2049', 7296, 4.5, 32832.0, '2026-06-17'::date, '2026-11-05'::date, 'confirmed', '2026-06-17T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001032'::uuid, 'U2/RE//2627/2050', 1008, 10.2, 10281.6, '2026-06-17'::date, '2026-08-10'::date, 'confirmed', '2026-06-17T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001033'::uuid, 'U2/RE//2627/2051', 4056, 6.0, 24336.0, '2026-06-17'::date, '2026-11-16'::date, 'confirmed', '2026-06-17T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001034'::uuid, 'U2/RE//2627/2052', 4944, 3.75, 18540.0, '2026-06-19'::date, '2026-10-30'::date, 'confirmed', '2026-06-19T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001035'::uuid, 'U2/RE//2627/2053', 3216, 4.15, 13346.4, '2026-06-19'::date, '2026-10-23'::date, 'confirmed', '2026-06-19T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001036'::uuid, 'U2/RE//2627/2054', 3816, 4.0, 15264.0, '2026-06-19'::date, '2026-10-20'::date, 'confirmed', '2026-06-19T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001037'::uuid, 'U2/RE//2627/2055', 2136, 4.1, 8757.6, '2026-06-20'::date, '2026-08-10'::date, 'confirmed', '2026-06-20T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001038'::uuid, 'U2/RE//2627/2056', 5112, 4.5, 23004.0, '2026-06-20'::date, '2026-08-31'::date, 'confirmed', '2026-06-20T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001039'::uuid, 'U2/RE//2627/2057', 1080, 4.5, 4860.0, '2026-06-20'::date, '2026-08-10'::date, 'confirmed', '2026-06-20T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000103a'::uuid, 'U2/RE//2627/2058', 5232, 5.5, 28776.0, '2026-06-29'::date, '2026-08-10'::date, 'confirmed', '2026-06-29T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000103b'::uuid, 'U2/RE//2627/2059', 4464, 13.75, 61380.0, '2026-06-29'::date, '2026-08-10'::date, 'confirmed', '2026-06-29T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000103c'::uuid, 'U2/RE//2627/2060', 3624, 5.5, 19932.0, '2026-06-29'::date, '2026-08-10'::date, 'confirmed', '2026-06-29T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000103d'::uuid, 'U2/RE//2627/2061', 1716, 12.0, 20592.0, '2026-06-30'::date, '2026-09-30'::date, 'confirmed', '2026-06-30T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000103e'::uuid, 'U2/RE//2627/2062', 6144, 12.0, 73728.0, '2026-07-01'::date, '2026-09-30'::date, 'confirmed', '2026-07-01T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000103f'::uuid, 'U2/RE//2627/2063', 3732, 12.0, 44784.0, '2026-07-01'::date, '2026-11-30'::date, 'confirmed', '2026-07-01T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001040'::uuid, 'U2/RE//2627/2064', 3336, 12.0, 40032.0, '2026-07-01'::date, '2027-02-20'::date, 'confirmed', '2026-07-01T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001041'::uuid, 'U2/RE//2627/2065', 2580, 10.75, 27735.0, '2026-07-02'::date, '2026-09-30'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001042'::uuid, 'U2/RE//2627/2066', 1404, 10.75, 15093.0, '2026-07-02'::date, '2026-11-30'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001043'::uuid, 'U2/RE//2627/2067', 1164, 10.75, 12513.0, '2026-07-02'::date, '2027-02-20'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001044'::uuid, 'U2/RE//2627/2068', 216, 10.2, 2203.2, '2026-07-02'::date, '2026-08-10'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001045'::uuid, 'U2/RE//2627/2069', 168, 10.2, 1713.6, '2026-07-02'::date, '2026-08-10'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001046'::uuid, 'U2/RE//2627/2070', 120, 9.2, 1104.0, '2026-07-02'::date, '2026-08-10'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001047'::uuid, 'U2/RE//2627/2071', 168, 9.2, 1545.6, '2026-07-02'::date, '2026-08-10'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001048'::uuid, 'U2/RE//2627/2072', 168, 9.2, 1545.6, '2026-07-02'::date, '2026-08-10'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001049'::uuid, 'U2/RE//2627/2073', 216, 9.2, 1987.2, '2026-07-02'::date, '2026-08-10'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000104a'::uuid, 'U2/RE//2627/2074', 72, 12.0, 864.0, '2026-07-02'::date, '2026-08-10'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000104b'::uuid, 'U2/RE//2627/2075', 1716, 12.0, 20592.0, '2026-07-21'::date, '2026-09-30'::date, 'confirmed', '2026-07-21T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000104c'::uuid, 'U2/RE//2627/2076', 1200, 11.3, 13560.0, '2026-07-02'::date, '2026-09-05'::date, 'confirmed', '2026-07-02T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000104d'::uuid, 'U2/RE//2627/2077', 2300, 5.95, 13685.0, '2026-07-25'::date, '2026-09-30'::date, 'confirmed', '2026-07-25T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000104e'::uuid, 'U2/RE//2627/2078', 2300, 5.25, 12075.0, '2026-07-25'::date, '2026-09-30'::date, 'confirmed', '2026-07-25T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-00000000104f'::uuid, 'U2/RE//2627/2079', 7716, 10.2, 78703.2, '2026-08-01'::date, '2026-11-06'::date, 'confirmed', '2026-08-01T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001050'::uuid, 'U2/RE//2627/2080', 6912, 10.2, 70502.4, '2026-08-01'::date, '2026-11-06'::date, 'confirmed', '2026-08-01T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001051'::uuid, 'U2/RE//2627/2081', 5364, 10.2, 54712.8, '2026-08-01'::date, '2026-11-06'::date, 'confirmed', '2026-08-01T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001052'::uuid, 'U2/RE//2627/2082', 3672, 10.2, 37454.4, '2026-08-01'::date, '2026-11-06'::date, 'confirmed', '2026-08-01T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001053'::uuid, 'U2/RE//2627/2083', 1368, 11.5, 15732.0, '2026-08-08'::date, '2026-09-29'::date, 'confirmed', '2026-08-08T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001054'::uuid, 'U2/RE//2627/2084', 1224, 5.8, 7099.2, '2026-08-11'::date, '2026-10-10'::date, 'confirmed', '2026-08-11T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001055'::uuid, 'U2/RE//2627/2085', 144, 9.2, 1324.8, '2026-08-17'::date, '2026-09-12'::date, 'confirmed', '2026-08-17T09:00:00+05:30'::timestamptz),
  ('aa45a400-0000-4000-8000-000000001056'::uuid, 'U2/RE//2627/2086', 288, 9.2, 2649.6, '2026-08-17'::date, '2026-09-12'::date, 'confirmed', '2026-08-17T09:00:00+05:30'::timestamptz)
) as v(id, order_number, order_qty, fob_price, total_value,
       order_date, ship_date, status, created_at);

-- ---------------------------------------------------------------------------
-- 3. The shipped portion, as receivables — ONLY WHERE IT CAN BE DATED
--
--    `analytics_revenue_trend` (0042) buckets on `invoice_date`, so every row
--    here has to name a month. The file names none: it has a Shipped Qty and no
--    invoice number, no invoice date and no shipment date.
--
--    Delivery Dt is the only shipment-adjacent date it carries, and for THREE of
--    the eleven shipped lines that date has not arrived yet — USD 108,279.00
--    of the USD 138,495.70 shipped, 78% of it. Posting those would put
--    revenue in a month that has not happened, which is worse than omitting it:
--    a future bar on a revenue chart is read as history by everyone who sees it.
--
--    So the eight whose delivery date has passed are loaded, dated on it, and
--    the three are left out and named below. Client decision, 2026-08-21, asked
--    with the arithmetic in front of them.
--
--    NOT LOADED (no defensible date):
--      U2/RE//2526/2097   USD  20,304.00   delivery 2026-11-02
--      U2/RE//2526/2098   USD  36,000.00   delivery 2026-10-05
--      U2/RE//2526/2113   USD  51,975.00   delivery 2026-10-06
-- ---------------------------------------------------------------------------
delete from public.receivables where id::text like 'aa45a400-0000-4000-8000-%';

insert into public.receivables
  (id, buyer_id, location_id, currency_code, invoice_date,
   amount_fc, exchange_rate, amount_inr, status, notes, created_at)
select
  v.id, 'aa45a400-0000-4000-8000-000000000001'::uuid,
  (select id from public.locations where code = 'U2' limit 1),
  'USD', v.invoice_date, v.amount_fc, 84.00, v.amount_inr, 'open', v.notes,
  v.invoice_date::timestamptz
from (values

  ('aa45a400-0000-4000-8000-000000002001'::uuid, '2026-02-26'::date, 2337.0, 196308.0, 'Shipped portion of U2/RE//2526/2047 — 615 pcs. Source file states no invoice number and no invoice date; dated on its delivery date.'),
  ('aa45a400-0000-4000-8000-000000002002'::uuid, '2026-02-26'::date, 2433.6, 204422.4, 'Shipped portion of U2/RE//2526/2048 — 624 pcs. Source file states no invoice number and no invoice date; dated on its delivery date.'),
  ('aa45a400-0000-4000-8000-000000002003'::uuid, '2026-02-26'::date, 5436.0, 456624.0, 'Shipped portion of U2/RE//2526/2049 — 1208 pcs. Source file states no invoice number and no invoice date; dated on its delivery date.'),
  ('aa45a400-0000-4000-8000-000000002004'::uuid, '2026-02-26'::date, 4861.8, 408391.2, 'Shipped portion of U2/RE//2526/2050 — 1314 pcs. Source file states no invoice number and no invoice date; dated on its delivery date.'),
  ('aa45a400-0000-4000-8000-000000002005'::uuid, '2026-02-26'::date, 2815.8, 236527.2, 'Shipped portion of U2/RE//2526/2051 — 741 pcs. Source file states no invoice number and no invoice date; dated on its delivery date.'),
  ('aa45a400-0000-4000-8000-000000002006'::uuid, '2026-02-26'::date, 3430.0, 288120.0, 'Shipped portion of U2/RE//2526/2052 — 686 pcs. Source file states no invoice number and no invoice date; dated on its delivery date.'),
  ('aa45a400-0000-4000-8000-000000002007'::uuid, '2026-02-26'::date, 5638.5, 473634.0, 'Shipped portion of U2/RE//2526/2053 — 895 pcs. Source file states no invoice number and no invoice date; dated on its delivery date.'),
  ('aa45a400-0000-4000-8000-000000002016'::uuid, '2026-08-20'::date, 3264.0, 274176.0, 'Shipped portion of U2/RE//2627/2019 — 480 pcs. Source file states no invoice number and no invoice date; dated on its delivery date.')
) as v(id, invoice_date, amount_fc, amount_inr, notes);

commit;

-- Verify:
--   select count(*), sum(order_qty), sum(total_value)
--   from public.sales_orders where id::text like 'aa45a400-0000-4000-8000-%';
--   -- expect 86 | 241,084 | 2,047,168.40
