-- ============================================================================
-- Raagam ERP — 0488 A unit-less row becomes impossible
--
-- The last gap. ~30 forms never set `location_id` — `new-po-form.tsx` opens its
-- picker on `useState("")` and writes `locationId || null`, and GRN, DC, the
-- finance forms, assets, HR and TA do the same. A document saved without
-- touching that box belonged to NO unit, and because 0484/0487 left
-- `location_id is null` permissive during the transition, it was then visible
-- from EVERY unit.
--
-- Editing thirty forms would fix thirty forms. This fixes the shape.
--
--
-- ## THE DEFAULT IS ONLY POSSIBLE BECAUSE 0487 MOVED THE UNIT INTO THE DATABASE
--
--     alter column location_id set default public.current_location()
--
-- While the current unit lived in a cookie, Postgres could not see it and no
-- default could be written — the note in `lib/auth/location.ts` said exactly
-- that. Now that it is `profiles.current_location_id`, an INSERT that omits the
-- column lands in the unit the operator is actually working in, whether or not
-- the form remembered to send it.
--
-- This is the same argument AGENTS.md makes for putting the CAPITALS transform
-- in the Zod schema rather than the server action: `lib/data-io` writes straight
-- to Postgres, so a rule that lives in application code is a rule some writer
-- bypasses. A column default is under ALL of them.
--
--
-- ## AND NOT NULL IS WHAT MAKES IT A GUARANTEE RATHER THAN A HABIT
--
-- A default fills a column that was omitted. It does nothing about a form that
-- explicitly sends `location_id: null` — which is precisely what those thirty
-- forms do (`locationId || null`), so the default alone would not have helped
-- them. NOT NULL rejects it.
--
-- Safe to apply today, verified rather than assumed: every scoped table has
-- ZERO null location_ids right now (sales_orders 93/93, receivables 8/8,
-- production_lines 8/8, stores 5/5, everything else empty). Section 2 re-checks
-- before altering rather than trusting that sentence.
--
-- **The failure mode is deliberately LOUD.** With no unit selected,
-- `current_location()` returns NULL, the default fills nothing and the INSERT
-- fails. That is the intended outcome: `resolveWriteLocation()` catches it
-- first and says "No unit is selected — choose one from the Location box", and
-- the constraint is the backstop for every path that does not. Silently writing
-- a row into the wrong company's books is the alternative, and it is worse.
--
--
-- ## THE NULL ESCAPE COMES OUT OF EVERY POLICY, AND IT MUST
--
-- 0484 wrote `(location_id is null or is_current_location(location_id))` as an
-- explicitly transitional concession, and `scripts/check-location-scope.sql`
-- CHECK 4 has been waiting for this moment: once the column is NOT NULL,
-- `location_id is null` is unsatisfiable, and a policy still carrying it is a
-- hole that one unstamped row would walk through. Section 4 removes it.
--
--
-- ## ONE HOLE LEFT OPEN ON PURPOSE, AND IT IS NAMED
--
-- 20 order-tree tables have a NULLABLE parent FK (despatches, lab_tests,
-- purchase_indents, packing_lists, …). `has_order_access(null)` returns TRUE,
-- so a row with no parent would be visible in every unit.
--
-- There are ZERO such rows today — checked, not assumed. It stays permissive
-- because the alternative hides data: a legitimately parentless lab test would
-- vanish from every screen with no error, which is the "empty report gets
-- believed" failure AGENTS.md warns about, and the harder of the two to notice.
-- A leak that someone can SEE beats a disappearance that nobody can.
--
-- CHECK 5 in the check script reports any orphan the moment one appears, so the
-- trade-off is monitored rather than forgotten.
-- ============================================================================

-- ==========================================================================
-- 1. DEFAULT current_location() on every non-exempt scoped column
-- ==========================================================================
do $$
declare
  r       record;
  v_count int := 0;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid and a.attname = 'location_id'
     and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and coalesce(obj_description(c.oid, 'pg_class'), '')
            not like '%location-scope: exempt%'
    order by c.relname
  loop
    execute format(
      'alter table public.%I alter column location_id set default public.current_location()',
      r.relname);
    v_count := v_count + 1;
  end loop;

  raise notice '0488: default set on % columns', v_count;
  if v_count = 0 then
    raise exception '0488: no columns got a default — the catalog query matched nothing';
  end if;
end $$;

-- ==========================================================================
-- 2. NOT NULL — re-checking for nulls first rather than trusting the header
-- ==========================================================================
do $$
declare
  r       record;
  v_nulls bigint;
  v_count int := 0;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid and a.attname = 'location_id'
     and a.attnum > 0 and not a.attisdropped and not a.attnotnull
    where n.nspname = 'public' and c.relkind = 'r'
      and coalesce(obj_description(c.oid, 'pg_class'), '')
            not like '%location-scope: exempt%'
    order by c.relname
  loop
    execute format('select count(*) from public.%I where location_id is null', r.relname)
      into v_nulls;

    if v_nulls > 0 then
      raise exception '0488: %.location_id has % null rows — backfill them before NOT NULL. Do NOT default them to HO blindly: which unit a document belongs to is a fact, and guessing it puts a row in the wrong company''s books.', r.relname, v_nulls;
    end if;

    execute format('alter table public.%I alter column location_id set not null', r.relname);
    v_count := v_count + 1;
  end loop;

  raise notice '0488: NOT NULL set on % columns', v_count;
end $$;

-- ==========================================================================
-- 3. sales_orders is the root the whole order tree derives from, so its own
--    column carries the same guarantee. Asserted separately because if this one
--    were still nullable, section 4's removal of the NULL branch from
--    has_order_access would start hiding orders rather than tightening them.
-- ==========================================================================
do $$
begin
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.sales_orders'::regclass
      and a.attname = 'location_id' and a.attnotnull
  ) then
    raise exception '0488: sales_orders.location_id is still nullable — the order tree derives from it and section 4 would be unsafe';
  end if;
end $$;

-- ==========================================================================
-- 4. Remove the NULL escape from every policy that still carries it
-- ==========================================================================
do $$
declare
  r       record;
  v_qual  text;
  v_check text;
  v_sql   text;
  v_esc   constant text := '((location_id IS NULL) OR is_current_location(location_id))';
  v_new   constant text := 'is_current_location(location_id)';
  v_count int := 0;
begin
  for r in
    select c.relname, p.polname,
           pg_get_expr(p.polqual, p.polrelid)      as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as wcheck
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_policy   p on p.polrelid = c.oid
    join pg_attribute a
      on a.attrelid = c.oid and a.attname = 'location_id'
     and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and coalesce(obj_description(c.oid, 'pg_class'), '')
            not like '%location-scope: exempt%'
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')      like '%location_id IS NULL%'
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%location_id IS NULL%')
    order by c.relname, p.polname
  loop
    v_qual  := replace(coalesce(r.qual, ''),   v_esc, v_new);
    v_check := replace(coalesce(r.wcheck, ''), v_esc, v_new);

    v_sql := format('alter policy %I on public.%I', r.polname, r.relname);
    if r.qual   is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if r.wcheck is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;

    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice '0488: NULL escape removed from % policies', v_count;
end $$;

-- ==========================================================================
-- 5. The order tree follows, again by redefinition rather than rewriting.
--
--    `so.location_id is null` goes: sales_orders.location_id is NOT NULL as of
--    section 2, so the branch is dead code that would only ever hide a bug.
--
--    `p_sales_order_id is null` STAYS, and section "ONE HOLE LEFT OPEN" above
--    says why: hiding a parentless row is worse than showing it.
-- ==========================================================================
create or replace function public.has_order_access(
  p_sales_order_id uuid, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_sales_order_id is null or exists (
    select 1 from public.sales_orders so
    where so.id = p_sales_order_id
      and public.is_current_location(so.location_id, uid)
  );
$$;

-- ==========================================================================
-- 6. Verification — FROM THE CATALOG
-- ==========================================================================
do $$
declare
  v_bad text;
begin
  -- 6a. No non-exempt scoped column is still nullable.
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a
    on a.attrelid = c.oid and a.attname = 'location_id'
   and a.attnum > 0 and not a.attisdropped and not a.attnotnull
  where n.nspname = 'public' and c.relkind = 'r'
    and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%location-scope: exempt%';
  if v_bad is not null then
    raise exception '0488 CHECK A: location_id still nullable on: %', v_bad;
  end if;

  -- 6b. Every one of them carries the default, or a form that OMITS the column
  --     fails instead of landing in the right unit.
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a
    on a.attrelid = c.oid and a.attname = 'location_id'
   and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
    and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%location-scope: exempt%'
    and coalesce(pg_get_expr(d.adbin, d.adrelid), '') not like '%current_location%';
  if v_bad is not null then
    raise exception '0488 CHECK B: no current_location() default on: %', v_bad;
  end if;

  -- 6c. No policy still carries the NULL escape — the hole CHECK 4 of
  --     scripts/check-location-scope.sql has been waiting for.
  select string_agg(c.relname || '.' || p.polname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_policy   p on p.polrelid = c.oid
  join pg_attribute a
    on a.attrelid = c.oid and a.attname = 'location_id'
   and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
    and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%location-scope: exempt%'
    and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')      like '%location_id IS NULL%'
      or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%location_id IS NULL%');
  if v_bad is not null then
    raise exception '0488 CHECK C: NULL escape still present on: %', v_bad;
  end if;

  -- 6d. has_order_access no longer treats an unstamped order as visible.
  if pg_get_functiondef('public.has_order_access(uuid,uuid)'::regprocedure)
       like '%so.location_id is null%' then
    raise exception '0488 CHECK D: has_order_access still carries the NULL escape';
  end if;
end $$;
