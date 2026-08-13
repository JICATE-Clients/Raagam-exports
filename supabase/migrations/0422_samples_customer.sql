-- ============================================================================
-- Raagam ERP — 0422 A sample belongs to a customer
--
-- Client, 2026-08-13: on Style Entry the Customer is chosen first, and the
-- **Approved Sample No** list is then narrowed to that customer's samples.
--
-- The screen has refused to do this, in writing, since the field was built —
-- `style-master-screen.tsx`: *"NOT FILTERED BY CUSTOMER, AND THAT IS A DATA
-- FACT, NOT AN OVERSIGHT ... Narrowing it is a schema question, not a screen
-- one. Do not add a join here without that answer."* This is that answer.
--
--
-- WHY THE EXISTING CHAIN CANNOT CARRY IT
--
-- `samples` (0005) reaches a party only through `opportunity_id` →
-- `opportunities.buyer_id` → `buyers`. A style's customer is a `customers` row
-- (`garment_styles.customer_id`), and the two tables are joined only by the
-- NULLABLE `buyers.customer_id` bridge that 0380 added — which is set for NONE
-- of the six buyers in this database.
--
-- So a filter down that chain would silently drop every approved sample whose
-- buyer is unlinked, which today is all of them. That is the "empty report
-- reads as a real answer" failure AGENTS.md names under Cascading filters: the
-- operator sees an empty list and concludes no sample was approved.
--
-- A direct column is the honest fix. It is also the third client requirement
-- this bridge has blocked (the Style picker's customer narrowing and this
-- field's filter were the first two), and the first one that stopped work:
-- "Approved Sample No" was compulsory from 2026-08-11 with zero rows behind
-- it, so no style could be saved at all until the requirement was withdrawn.
--
--
-- NULLABLE, AND A NULL SAMPLE STAYS OFFERED
--
-- Every row is NULL after this migration (see the backfill below), so a strict
-- filter would empty a list that is already empty and read as broken. The
-- screen keeps an unattributed sample in the list, and keeps the one the style
-- already holds whatever it says — the same rule as "Disabled rows", and the
-- same failure if it is skipped: a filled field renders empty and the next save
-- writes that emptiness over a real FK.
--
--
-- THE BACKFILL FINDS NOTHING, AND RUNS ANYWAY
--
-- It resolves through `buyers.customer_id` where that is set. It is set nowhere,
-- so it updates zero rows. It is written because this is the one moment the
-- mapping is cheap to state, and a backfill that finds nothing is honest where a
-- skipped one is a silent assumption about data nobody checked.
-- ============================================================================


alter table public.samples
  add column if not exists customer_id uuid references public.customers(id);

comment on column public.samples.customer_id is
  'Which customer approved this sample. Added by 0422 so the Style master''s "Approved Sample No" can narrow to the style''s customer; NULL means unknown, and such a sample stays offered.';

create index if not exists idx_samples_customer on public.samples(customer_id);

update public.samples s
   set customer_id = b.customer_id
  from public.opportunities o
  join public.buyers b on b.id = o.buyer_id
 where s.opportunity_id = o.id
   and s.customer_id is null
   and b.customer_id is not null;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- NULLABILITY is asserted rather than merely presence: a NOT NULL here would
-- make every existing sample unstorable and every new one require an answer the
-- Sales screen has no field for. The FK is asserted against `customers`
-- specifically — pointing it at `buyers` would compile, run, and reproduce the
-- very mismatch 0355 / 0375 / 0376 were written to clear up.
--
-- The counts are RAISED, not checked. Zero resolved is the expected result
-- today and must not fail the migration; what matters is that the number is
-- printed rather than assumed.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col_null   text;
  n_samples  int;
  n_resolved int;
  n_linked   int;
begin
  select is_nullable into col_null
    from information_schema.columns
   where table_schema = 'public' and table_name = 'samples' and column_name = 'customer_id';

  if col_null is null then
    raise exception '0422: samples.customer_id was not added';
  end if;
  if col_null <> 'YES' then
    raise exception '0422: samples.customer_id is NOT NULL — an unattributed sample must still be storable';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.samples'::regclass
       and contype  = 'f'
       and confrelid = 'public.customers'::regclass
  ) then
    raise exception '0422: samples.customer_id does not reference customers';
  end if;

  select count(*) into n_samples  from public.samples;
  select count(*) into n_resolved from public.samples where customer_id is not null;
  select count(*) into n_linked   from public.buyers  where customer_id is not null;

  raise notice '0422: % samples, % resolved to a customer; % of the buyers bridge is populated',
    n_samples, n_resolved, n_linked;
end $verify$;
