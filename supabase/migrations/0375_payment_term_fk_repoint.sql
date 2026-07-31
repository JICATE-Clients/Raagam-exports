-- =============================================================================
-- 0375 — Point every payment-term FK at the Payment Term master, not config_lookups
-- -----------------------------------------------------------------------------
-- LIVE BUG, reported 2026-07-31: saving an Applicant with a Payment Term picked
-- fails with
--
--     insert or update on table "applicants" violates foreign key constraint
--     "applicants_payment_term_id_fkey"
--
-- This is the SAME defect 0355 fixed for `state_id`, on a different column. The
-- READ side and the WRITE side point at different tables:
--
--   * READ  — `app/(app)/masters/[submodule]/[entity]/page.tsx` feeds all three
--             screens `paymentTermsAsLookups(await listPaymentTerms())`, i.e.
--             rows of `public.payment_terms` (the Associates ▸ Payment Term
--             master, 0242) reshaped to look like ConfigLookups. The id the
--             operator picks is a `payment_terms.id`.
--   * WRITE — `applicants.payment_term_id` / `consignees.payment_term_id` were
--             declared `references public.config_lookups(id)` in 0241 and 0248,
--             back when Payment Terms were a lookup list and the master did not
--             exist yet. 0242 created the master a migration later and nothing
--             ever repointed the FKs.
--
-- So EVERY selection from the list is rejected. Unlike the state case there was
-- no coincidence keeping it alive: not one payment term shares a uuid across the
-- two tables, so the field has never been able to save a picked value at all.
--
-- 0315 looks like it already fixed this — it declares the same two columns
-- `references public.receivable_terms(id)` — but it uses `add column if not
-- exists`, and both columns already existed from 0241/0248. Postgres skips the
-- whole clause, FK included. The constraint on file is still 0241's. (Had it
-- applied it would have been wrong anyway: receivable terms are the customer-side
-- master, 0237.)
--
-- The four vendor tables added later (0369, 0370, 0372) reference
-- `public.payment_terms` correctly, which is what makes that the right target
-- here rather than the other way round: repointing these three is what makes all
-- seven payment-term columns agree.
--
-- SCOPE
--   * `garment_order_amendments.pay_terms_id` is included. It holds no rows yet
--     and its screen still reads `config_lookups` where kind = 'payment_term' —
--     but leaving one column behind means keeping the lookup rows alive, which
--     is precisely how this bug survived 0242. The screen moves to the master in
--     the same change.
--   * `customers.receivable_term_id` is NOT touched: it already references
--     `public.receivable_terms`, a genuinely different master.
--   * ON DELETE SET NULL is preserved, for the reason 0355 gives at :32-36 —
--     an in-use term is already deactivated rather than deleted by the
--     `deleteOrDeactivate` / `first_referencing_table` guard (0344).
--
-- DATA — unlike 0355 this cannot be a pure constraint swap. The values on file
-- ARE config_lookups ids (they could not have been anything else), so each one
-- is carried into the master first and then remapped. Nothing is discarded.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Carry every lookup payment term into the master.
-- ---------------------------------------------------------------------------
-- Matched on the display text, case- and space-insensitively, so a term the
-- operator entered in both places collapses to the master's copy instead of
-- being duplicated. `entry_no` is an identity column and assigns itself; the
-- lookup's `code`, where one exists, is a config_lookups artefact and is
-- deliberately dropped rather than forced into an auto-numbered field.
insert into public.payment_terms (description, inactive)
select distinct on (upper(btrim(l.name)))
       btrim(l.name),
       not l.is_active
  from public.config_lookups l
 where l.kind = 'payment_term'
   and btrim(coalesce(l.name, '')) <> ''
   and not exists (
         select 1
           from public.payment_terms p
          where upper(btrim(coalesce(p.description, ''))) = upper(btrim(l.name))
       )
 order by upper(btrim(l.name)), l.created_at;

-- ---------------------------------------------------------------------------
-- 2. Remap the three columns from the lookup id to the master id.
-- ---------------------------------------------------------------------------
-- ORDER MATTERS, and it is the opposite of the obvious one: the old constraint
-- is DROPPED FIRST, then the values are remapped, then the new constraint is
-- added. Remapping under the old FK fails with the very error this migration
-- exists to fix — the new value is a `payment_terms.id`, which is exactly what
-- `applicants_payment_term_id_fkey` still rejects at that point. The window
-- where the column is unconstrained lasts three statements inside one
-- transaction; the orphan check below closes it before the new FK goes on.
--
-- Guarded twice over: the WHERE only touches rows whose current value really is
-- a payment-term lookup (a value already pointing at the master is left alone,
-- making this re-runnable), and the ORDER BY / LIMIT keeps the subquery scalar
-- even if the master holds two terms sharing a description.
do $$
declare
  spec   text[][] := array[
    ['applicants',               'payment_term_id'],
    ['consignees',               'payment_term_id'],
    ['garment_order_amendments', 'pay_terms_id']
  ];
  i       int;
  tbl     text;
  col     text;
  orphans bigint;
begin
  for i in 1 .. array_length(spec, 1) loop
    tbl := spec[i][1];
    col := spec[i][2];

    execute format('alter table public.%I drop constraint if exists %I',
                   tbl, tbl || '_' || col || '_fkey');

    execute format(
      'update public.%I x
          set %I = (
            select p.id
              from public.payment_terms p,
                   public.config_lookups l
             where l.id = x.%I
               and l.kind = ''payment_term''
               and upper(btrim(coalesce(p.description, ''''))) = upper(btrim(l.name))
             order by p.entry_no
             limit 1
          )
        where x.%I is not null
          and exists (
            select 1 from public.config_lookups l
             where l.id = x.%I and l.kind = ''payment_term''
          )',
      tbl, col, col, col, col
    );

    -- Fail loudly and by name rather than letting the ALTER abort with only a
    -- constraint name to go on (0355:57-59 does the same). With the old FK
    -- already dropped this is now the ONLY thing standing between a bad remap
    -- and an unconstrained column, so it runs before the new FK, not after.
    execute format(
      'select count(*) from public.%I x
        where x.%I is not null
          and not exists (select 1 from public.payment_terms p where p.id = x.%I)',
      tbl, col, col
    ) into orphans;

    if orphans > 0 then
      raise exception
        '0375: %.% has % row(s) that resolve to no payment term — resolve these before repointing the FK',
        tbl, col, orphans;
    end if;

    execute format(
      'alter table public.%I
         add constraint %I foreign key (%I)
         references public.payment_terms(id) on delete set null',
      tbl, tbl || '_' || col || '_fkey', col
    );
  end loop;
end $$;

comment on column public.applicants.payment_term_id is
  'FK to public.payment_terms (the Payment Term master), NOT config_lookups — see 0375.';
comment on column public.consignees.payment_term_id is
  'FK to public.payment_terms (the Payment Term master), NOT config_lookups — see 0375.';
comment on column public.garment_order_amendments.pay_terms_id is
  'FK to public.payment_terms (the Payment Term master), NOT config_lookups — see 0375.';

-- ---------------------------------------------------------------------------
-- 3. Remove the now-dead lookup rows.
-- ---------------------------------------------------------------------------
-- Same reasoning as 0374 did for states, and safe for the same four reasons:
-- their values were copied into the master in step 1, no FK can reference them
-- after step 2, `payment_term` is not in the `LookupMasterScreen` registry
-- (`app/(app)/masters/config-sections.tsx`), and `lib/data-io` has no descriptor
-- that resolves one. The kind stays in the CHECK constraint and in the
-- `LookupKind` union as a SHAPE-only discriminator — `paymentTermsAsLookups()`
-- stamps it onto rows built from `public.payment_terms`.
--
-- Leaving them would re-arm the bug: the fields' inline "+ Add" wrote here,
-- while their options came from the master, so an added term vanished on refresh
-- AND handed back an id no save would accept. Those fields now render
-- `components/masters/payment-term-picker.tsx`, which writes the master.
delete from public.config_lookups
where kind = 'payment_term';
