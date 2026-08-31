-- ============================================================================
-- Raagam ERP — 0485 Phase 2: the order tree inherits its unit from the order
--
-- 0484 scoped the 32 tables that CARRY a `location_id`. That left the largest
-- body of transactional data in the database unprotected, because it does not
-- carry one:
--
--   * 46 tables hang off `sales_orders` (sales_order_id / order_id / sc_no_id)
--   * 26 hang off `garment_order_amendments` (amendment_id / garment_order_id)
--   * and `garment_order_amendments` ITSELF has no location_id — only an FK to
--     the order, which is where the unit actually lives.
--
-- So a Unit-2 operator could not read HO's `sales_orders` row, and could read
-- every `so_line_item`, `order_price`, `ta_plan` and amendment hanging off it
-- by querying those tables directly. RLS is per-table; there is no "reachable
-- only through the parent" in PostgREST.
--
--
-- ## DERIVED, NOT DENORMALISED. THIS IS THE WHOLE DESIGN.
--
-- The obvious fix is `alter table ... add column location_id` on all 72 and let
-- 0484's catalog loop pick them up. It is wrong here, and AGENTS.md says why in
-- the Created Date section: a copy is free to disagree with its source. An
-- amendment stamped HO whose order says Unit 2 is a row that two screens
-- describe differently, and nothing would ever reconcile them — an order moved
-- between units (or corrected) would silently strand every child.
--
-- It is also the same judgement AGENTS.md already records for `created_by`:
-- **"Line-item tables are exempt — a PO line has no creator worth a column;
-- the document above it does."** A PO line has no UNIT of its own either. The
-- document above it does.
--
-- So access is DERIVED, through two functions:
--
--   has_order_access(sales_order_id)  -> the order's location
--   has_amendment_access(amendment_id) -> its order's location
--
-- One source of truth (`sales_orders.location_id`), one rule, and a child can
-- never disagree with its parent because it holds no opinion of its own.
--
--
-- ## BOTH ARE SECURITY DEFINER, AND THAT IS LOAD-BEARING
--
-- `has_order_access()` reads `sales_orders`, which is itself RLS-protected by
-- 0484. Called as INVOKER from inside a policy on a child table, the read would
-- re-enter `sales_orders`'s own policy — and that policy would be evaluating
-- while already evaluating. SECURITY DEFINER reads the parent row directly and
-- ends the chain.
--
-- It is the same reason `user_roles` had to stay exempt in 0484: a predicate
-- that reads a table cannot also be the predicate guarding it.
--
--
-- ## NULL IS PERMISSIVE AT EVERY LEVEL, FOR ONE REASON
--
-- A child whose parent FK is NULL, and an order whose location is NULL, both
-- pass. That matches 0484's `location_id is null or ...` exactly and for the
-- same transitional reason — an unstamped row must not vanish from a
-- unit-scoped operator's screen with no error and no explanation. Phase 3
-- removes the concession at the root (`sales_orders.location_id` NOT NULL), and
-- because everything here derives from that root, it tightens everywhere at
-- once without this file being touched.
-- ============================================================================

-- ==========================================================================
-- 1. The two derivation functions
-- ==========================================================================
create or replace function public.has_order_access(
  p_sales_order_id uuid, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_sales_order_id is null or exists (
    select 1 from public.sales_orders so
    where so.id = p_sales_order_id
      and (so.location_id is null or public.has_location_access(so.location_id, uid))
  );
$$;

comment on function public.has_order_access(uuid, uuid) is
  'Can the caller act on this sales order''s unit? SECURITY DEFINER so a policy on a child table can read the parent without re-entering its RLS. 0485.';

create or replace function public.has_amendment_access(
  p_amendment_id uuid, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_amendment_id is null or exists (
    select 1 from public.garment_order_amendments a
    where a.id = p_amendment_id
      and public.has_order_access(a.sales_order_id, uid)
  );
$$;

comment on function public.has_amendment_access(uuid, uuid) is
  'Can the caller act on this amendment''s unit? Resolves through the amendment''s sales order. 0485.';

-- Grants: BOTH revokes, per AGENTS.md "Function grants". A new function is born
-- anon-callable by Postgres's built-in EXECUTE TO PUBLIC *and* by Supabase's
-- default privileges; revoking one leaves the other standing.
revoke all on function public.has_order_access(uuid, uuid)     from public, anon;
revoke all on function public.has_amendment_access(uuid, uuid) from public, anon;
grant execute on function public.has_order_access(uuid, uuid)     to authenticated;
grant execute on function public.has_amendment_access(uuid, uuid) to authenticated;

-- ==========================================================================
-- 2. AND the derived predicate into every policy of every table that hangs off
--    the order tree and carries no location_id of its own.
--
--    Driven off pg_constraint, NOT off column names. `order_id`, `sc_no_id` and
--    `sales_order_id` all point at sales_orders, and a name-matching loop would
--    have caught two of the three — `order_cancellations.order_id`,
--    `order_completions.order_id`, `ta_completions.order_id` and
--    `packing_advice_lines.sc_no_id` are exactly the rows a tidy convention
--    would have missed.
--
--    A table that HAS a location_id is skipped: 0484 already scoped it directly,
--    and ANDing a second, derived predicate on top would mean an order moved
--    between units silently hid rows whose own column still said otherwise.
-- ==========================================================================
do $$
declare
  r         record;
  v_qual    text;
  v_check   text;
  v_pred    text;
  v_sql     text;
  v_changed boolean;
  v_pols    int := 0;
  v_tables  int := 0;
  v_last    text := '';
begin
  for r in
    with linked as (
      -- One row per (table, parent kind), preferring the SHORTER chain when a
      -- table hangs off both (material_bom_amendments does).
      select distinct on (c.oid)
             c.oid           as reloid,
             c.relname       as tbl,
             a.attname       as fk_col,
             cf.relname      as parent
      from pg_constraint con
      join pg_class c   on c.oid  = con.conrelid
      join pg_class cf  on cf.oid = con.confrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
      where con.contype = 'f'
        and n.nspname = 'public'
        and c.relkind = 'r'
        and array_length(con.conkey, 1) = 1
        and cf.relname in ('sales_orders', 'garment_order_amendments')
        -- carries no unit of its own: 0484 owns those
        and not exists (
          select 1 from pg_attribute a2
          where a2.attrelid = c.oid and a2.attname = 'location_id'
            and a2.attnum > 0 and not a2.attisdropped
        )
        and coalesce(obj_description(c.oid, 'pg_class'), '')
              not like '%location-scope: exempt%'
      order by c.oid,
               case cf.relname when 'sales_orders' then 0 else 1 end
    )
    select l.tbl, l.fk_col, l.parent,
           p.polname,
           pg_get_expr(p.polqual, p.polrelid)      as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as wcheck
    from linked l
    join pg_policy p on p.polrelid = l.reloid
    order by l.tbl, p.polname
  loop
    v_pred := case r.parent
                when 'sales_orders'
                  then format('public.has_order_access(%I)', r.fk_col)
                else format('public.has_amendment_access(%I)', r.fk_col)
              end;

    v_qual    := r.qual;
    v_check   := r.wcheck;
    v_changed := false;

    if v_qual is not null
       and position('has_order_access'     in v_qual) = 0
       and position('has_amendment_access' in v_qual) = 0 then
      v_qual := '(' || v_qual || ') and ' || v_pred;
      v_changed := true;
    end if;

    if v_check is not null
       and position('has_order_access'     in v_check) = 0
       and position('has_amendment_access' in v_check) = 0 then
      v_check := '(' || v_check || ') and ' || v_pred;
      v_changed := true;
    end if;

    if not v_changed then
      continue;
    end if;

    v_sql := format('alter policy %I on public.%I', r.polname, r.tbl);
    if v_qual  is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;

    execute v_sql;
    v_pols := v_pols + 1;
    if r.tbl <> v_last then
      v_tables := v_tables + 1;
      v_last := r.tbl;
    end if;
  end loop;

  raise notice '0485: derived predicate added to % policies across % tables', v_pols, v_tables;

  if v_pols = 0 then
    raise exception '0485: no policies were altered — the catalog query matched '
                    'nothing. That means this migration did nothing while '
                    'reporting success, which is the 0326 failure repeating.';
  end if;
end $$;

-- ==========================================================================
-- 3. Verification — FROM THE CATALOG
-- ==========================================================================
do $$
declare
  v_bad  text;
  v_open text;
begin
  -- CHECK 1 — a table in the order tree, carrying no location_id, whose
  -- policies never mention either derivation function.
  select string_agg(distinct c.relname, ', ') into v_bad
  from pg_constraint con
  join pg_class c   on c.oid  = con.conrelid
  join pg_class cf  on cf.oid = con.confrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f' and n.nspname = 'public' and c.relkind = 'r'
    and array_length(con.conkey, 1) = 1
    and cf.relname in ('sales_orders', 'garment_order_amendments')
    and not exists (
      select 1 from pg_attribute a2
      where a2.attrelid = c.oid and a2.attname = 'location_id'
        and a2.attnum > 0 and not a2.attisdropped)
    and coalesce(obj_description(c.oid, 'pg_class'), '')
          not like '%location-scope: exempt%'
    -- it HAS policies (a table with none is reported separately below) ...
    and exists (select 1 from pg_policy p where p.polrelid = c.oid)
    -- ... and none of them derives access.
    and not exists (
      select 1 from pg_policy p
      where p.polrelid = c.oid
        and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')      ~ 'has_(order|amendment)_access'
          or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'has_(order|amendment)_access')
    );

  if v_bad is not null then
    raise exception '0485 CHECK 1: order-tree tables still unscoped: %', v_bad;
  end if;

  -- CHECK 2 — a single policy left unscoped on such a table. The partial case
  -- is the one that hides: SELECT scoped and UPDATE not reads as done from
  -- every angle while any user can still edit another unit's row by id.
  select string_agg(c.relname || '.' || p.polname, ', ') into v_bad
  from pg_constraint con
  join pg_class c   on c.oid  = con.conrelid
  join pg_class cf  on cf.oid = con.confrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_policy p  on p.polrelid = c.oid
  where con.contype = 'f' and n.nspname = 'public' and c.relkind = 'r'
    and array_length(con.conkey, 1) = 1
    and cf.relname in ('sales_orders', 'garment_order_amendments')
    and not exists (
      select 1 from pg_attribute a2
      where a2.attrelid = c.oid and a2.attname = 'location_id'
        and a2.attnum > 0 and not a2.attisdropped)
    and coalesce(obj_description(c.oid, 'pg_class'), '')
          not like '%location-scope: exempt%'
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '')      !~ 'has_(order|amendment)_access'
    and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') !~ 'has_(order|amendment)_access';

  if v_bad is not null then
    raise exception '0485 CHECK 2: policies left unscoped: %', v_bad;
  end if;

  -- CHECK 3 — a table in the order tree with RLS off or NO POLICIES AT ALL.
  -- Not fatal (some scaffolds legitimately have neither yet) but it is the one
  -- state where everything above passes and the table is still wide open, so it
  -- is said out loud rather than left for someone to discover.
  select string_agg(distinct c.relname, ', ') into v_open
  from pg_constraint con
  join pg_class c   on c.oid  = con.conrelid
  join pg_class cf  on cf.oid = con.confrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f' and n.nspname = 'public' and c.relkind = 'r'
    and array_length(con.conkey, 1) = 1
    and cf.relname in ('sales_orders', 'garment_order_amendments')
    and (not c.relrowsecurity
      or not exists (select 1 from pg_policy p where p.polrelid = c.oid));

  if v_open is not null then
    raise warning '0485: order-tree tables with RLS off or no policies (open to any signed-in user): %', v_open;
  end if;
end $$;
