-- ============================================================================
-- Raagam ERP — remove the AARSAN AMERICAS order book
--
-- Deletes every row created by `aarsan-order-book.sql` and nothing else.
--
-- Safety rests on the same property `demo-data-cleanup.sql` relies on: those
-- rows were inserted with deterministic ids under the prefix
-- `aa45a400-0000-4000-8000-…`, which no `gen_random_uuid()` will ever produce.
-- Real records — including the four live orders created through the Garment
-- Order screen — are therefore untouchable by these statements, regardless of
-- when they were made or what they are named.
--
-- IT IS A SEPARATE PREFIX FROM `decade00-…` ON PURPOSE. That one tags the
-- INVENTED demo dataset in `demo-data.sql`; this one tags the client's own
-- trading data. Removing the invented figures must not remove the real order
-- book, and this is what lets either go without the other.
--
-- Verify afterwards with:
--   select
--     (select count(*) from public.sales_orders where id::text like 'aa45a400-%'),
--     (select count(*) from public.receivables  where id::text like 'aa45a400-%');
-- ============================================================================

begin;

-- Reverse dependency order — both the orders and the receivables reference the
-- buyer, so it goes last.
delete from public.receivables  where id::text like 'aa45a400-0000-4000-8000-%';
delete from public.sales_orders where id::text like 'aa45a400-0000-4000-8000-%';
delete from public.buyers       where id::text like 'aa45a400-0000-4000-8000-%';

commit;
