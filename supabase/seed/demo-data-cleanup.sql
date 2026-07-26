-- ============================================================================
-- Raagam ERP — remove the demo dataset
--
-- Deletes every row created by demo-data.sql and nothing else. Run this before
-- the database is used for real trading.
--
-- Safety rests on one property: demo rows were inserted with deterministic ids
-- under the prefix `decade00-0000-4000-8000-…`, which no gen_random_uuid() will
-- ever produce. Real records are therefore untouchable by these statements,
-- regardless of when they were created or what they are named.
--
-- stock_balances is cleared by item because the stock_ledger trigger only
-- maintains balances on INSERT — deleting ledger rows would otherwise leave the
-- demo quantities behind as phantom stock.
--
-- Verify afterwards with:
--   select count(*) from public.sales_orders where id::text like 'decade00-%';
-- ============================================================================

begin;

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

commit;
