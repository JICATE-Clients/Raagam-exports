-- ============================================================================
-- Raagam ERP — 0484 Phase 1: has_location_access() finally enforces something
--
-- 0326 added `location_id` to a pile of tables and defined
-- `has_location_access()`. NO POLICY EVER CALLED IT — five references in the
-- whole repo, all five inside 0326 itself. The migration applied cleanly,
-- reported success, and enforced nothing. Until this file, every signed-in user
-- could read every unit's rows.
--
-- Same shape as the `created_by` sweep (columns app-wide, `withCreators()` only
-- in masters), the cascade-filter data half, and 0387's
-- `alter default privileges ... in schema public`, which "runs, succeeds, and
-- does nothing". The structural half lands, the enforcement half does not, and
-- nothing errors.
--
--
-- ## 46 TABLES CARRY location_id, NOT THE 19 IN 0326's PROSE
--
-- Enumerated from pg_attribute, not from 0326's list — later migrations added
-- more (purchase_price_confirmations, order_budgets, ta_department_assigns,
-- delivery_challans, ...). A hand-kept list is exactly what would have missed
-- them, which is the reason both this migration and its check script drive
-- themselves off the catalog.
--
--
-- ## THE NULL BRANCH IS LOAD-BEARING, AND IT IS TEMPORARY
--
-- The predicate is
--
--     (location_id is null or public.has_location_access(location_id))
--
-- and NOT the obvious `has_location_access(location_id)` alone. With a NULL
-- argument that function returns FALSE for a unit-scoped user: its `exists`
-- clause tests `ur.location_id = p_location_id`, which is NULL, so the row is
-- refused. Almost every row in this database has `location_id IS NULL` today
-- (only sales_orders, receivables and a handful of masters are stamped), so the
-- strict form would have made a unit-scoped operator's screens go blank —
-- silently, and looking exactly like "there is nothing here".
--
-- 0326's own design rule says NULL = company-wide / unassigned, and this keeps
-- that promise. It is a TRANSITIONAL branch: Phase 3 stamps every write,
-- backfills the existing rows to HO, and makes the column NOT NULL — at which
-- point `location_id is null` is unsatisfiable and should be deleted from every
-- policy here. Leaving it in after that would be a hole: one unstamped row
-- would be visible to every unit.
--
--
-- ## EXEMPTIONS LIVE IN THE TABLE COMMENT, NOT IN A LIST IN THIS FILE
--
-- A list here plus a list in `scripts/check-location-scope.sql` is two
-- hand-edited literals nothing keeps in sync — the failure AGENTS.md records
-- for the reports catalog ("the nav list and the landing grid were once two
-- hand-edited literals"). So an exemption is written where the repo writes
-- every other exemption: as a marker with a reason, on the thing itself.
--
--     comment on table public.foo is '... location-scope: exempt -- <reason>';
--
-- The check reads `obj_description`. One declaration, one reader, and a table
-- that is exempt says so to anyone inspecting the schema.
--
-- FOUR ARE STRUCTURAL and the first is not a preference:
--   * user_roles — RECURSION. has_location_access() READS user_roles. A policy
--     on user_roles calling it recurses. This table DEFINES the scope, so it
--     cannot also be subject to it.
--   * department_locations — the department-to-location map itself.
--   * sales_order_no_counters — the SC No allocator. A policy here can only
--     fail an INSERT mid-allocation and strand a document number.
--   * audit_log — an audit trail must record and show everything, including a
--     cross-unit action. Scoping it hides the evidence it exists to keep.
--
-- NINE ARE MASTERS, per the client's 2026-08-31 decision that units share ONE
-- master list. They carry a location_id from earlier migrations and it stays
-- meaningful as "where this usually sits" — it is simply not an access
-- boundary.
--
-- ONE IS DEFERRED AND SAYS SO (`assets`), because guessing is how a table ends
-- up in the wrong half with an official-looking justification beside it.
-- ============================================================================

-- ==========================================================================
-- 1. Declare the exemptions, each with its reason.
--
--    `sales_order_no_counters` already carries a comment worth keeping, so its
--    marker is APPENDED. Overwriting it would trade one piece of documentation
--    for another and lose the note about why it has no DELETE policy.
-- ==========================================================================
comment on table public.user_roles is
  'Grants a role to a user, optionally scoped to a location. '
  'location-scope: exempt -- RECURSION: has_location_access() reads THIS table, '
  'so a policy here calling it would recurse. This table defines the scope and '
  'cannot be subject to it.';

comment on table public.department_locations is
  'Department-to-location mapping. '
  'location-scope: exempt -- this IS the map; scoping the map by the map is the '
  'same circularity as user_roles, one step removed.';

comment on table public.sales_order_no_counters is
  'Running SC No per (location, fiscal year). Resets each April by virtue of a '
  'new fy key rather than by anything resetting it. No DELETE policy: dropping '
  'a row restarts that branch at 0001 and mints duplicates. '
  'location-scope: exempt -- the allocator itself. Its rows are not data anyone '
  'reads, and a policy here can only fail an INSERT mid-allocation and strand a '
  'document number.';

comment on table public.audit_log is
  'Append-only audit trail. '
  'location-scope: exempt -- an audit trail must record and show everything, '
  'including a cross-unit action. Scoping it hides the evidence it exists for.';

comment on table public.bins is
  'location-scope: exempt -- master, shared across units (client 2026-08-31).';
comment on table public.stores is
  'location-scope: exempt -- master, shared across units (client 2026-08-31). '
  'Store access is already governed by can_access_store(), a finer mechanism.';
comment on table public.employees is
  'location-scope: exempt -- master, shared across units (client 2026-08-31).';
comment on table public.staff is
  'location-scope: exempt -- master, shared across units (client 2026-08-31).';
comment on table public.workers is
  'location-scope: exempt -- master, shared across units (client 2026-08-31).';
comment on table public.contractors is
  'location-scope: exempt -- master, shared across units (client 2026-08-31).';
comment on table public.merchandising_teams is
  'location-scope: exempt -- master, shared across units (client 2026-08-31).';
comment on table public.work_timings is
  'location-scope: exempt -- master, shared across units (client 2026-08-31).';
comment on table public.production_lines is
  'location-scope: exempt -- master, shared across units (client 2026-08-31).';

comment on table public.assets is
  'location-scope: exempt -- UNCLASSIFIED, deferred to Phase 2. A fixed asset '
  'physically sits at one unit (argues for scoping) but is a register rather '
  'than a document. 0 rows today, so nothing is at stake in deciding it later.';

-- ==========================================================================
-- 2. AND the location predicate into every policy of every non-exempt table
--    carrying `location_id`.
--
--    Driven off the catalog rather than a table list, so a table that grew a
--    location_id in some other migration cannot be missed.
--
--    IDEMPOTENT: a policy whose expression already mentions
--    has_location_access is skipped, so re-running cannot double-AND.
--
--    Only the clauses that already exist are re-stated — a SELECT policy has no
--    WITH CHECK and a WITH CHECK on it is a syntax error, so the two are set
--    independently rather than assumed to come in pairs.
-- ==========================================================================
do $$
declare
  r         record;
  v_pred    constant text :=
    '(location_id is null or public.has_location_access(location_id))';
  v_qual    text;
  v_check   text;
  v_sql     text;
  v_changed boolean;
  v_count   int := 0;
begin
  for r in
    select c.relname,
           p.polname,
           pg_get_expr(p.polqual, p.polrelid)      as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as wcheck
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_policy   p on p.polrelid = c.oid
    join pg_attribute a
      on a.attrelid = c.oid and a.attname = 'location_id'
     and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind = 'r'
      and coalesce(obj_description(c.oid, 'pg_class'), '')
            not like '%location-scope: exempt%'
    order by c.relname, p.polname
  loop
    v_qual    := r.qual;
    v_check   := r.wcheck;
    v_changed := false;

    if v_qual is not null and position('has_location_access' in v_qual) = 0 then
      v_qual := '(' || v_qual || ') and ' || v_pred;
      v_changed := true;
    end if;

    if v_check is not null and position('has_location_access' in v_check) = 0 then
      v_check := '(' || v_check || ') and ' || v_pred;
      v_changed := true;
    end if;

    if not v_changed then
      continue;
    end if;

    v_sql := format('alter policy %I on public.%I', r.polname, r.relname);
    if v_qual  is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;

    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice '0484: location predicate added to % policies', v_count;

  if v_count = 0 then
    raise exception '0484: no policies were altered — either the catalog query '
                    'matched nothing or every table was exempt. Both mean this '
                    'migration did nothing while reporting success.';
  end if;
end $$;

-- ==========================================================================
-- 3. Verification — FROM THE CATALOG, and it is the same pair of questions
--    scripts/check-location-scope.sql asks. `{"success": true}` means the
--    statements ran, not that they achieved their goal.
-- ==========================================================================
do $$
declare
  v_bad text;
begin
  -- CHECK 1 — a non-exempt table carrying location_id whose policies never
  -- mention has_location_access. This is the 0326 failure, named.
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a
    on a.attrelid = c.oid and a.attname = 'location_id'
   and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind = 'r'
    and coalesce(obj_description(c.oid, 'pg_class'), '')
          not like '%location-scope: exempt%'
    and not exists (
      select 1 from pg_policy p
      where p.polrelid = c.oid
        and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')      like '%has_location_access%'
          or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%has_location_access%')
    );

  if v_bad is not null then
    raise exception '0484 CHECK 1: tables still unscoped: %', v_bad;
  end if;

  -- CHECK 2 — a PARTIALLY scoped table. This is the one that hides: a table
  -- whose SELECT is scoped but whose UPDATE is not reads as done from every
  -- angle (the list filters correctly, the screen looks right) while any user
  -- can still edit another unit's row by id. CHECK 1 passes on such a table.
  select string_agg(c.relname || '.' || p.polname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_policy   p on p.polrelid = c.oid
  join pg_attribute a
    on a.attrelid = c.oid and a.attname = 'location_id'
   and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind = 'r'
    and coalesce(obj_description(c.oid, 'pg_class'), '')
          not like '%location-scope: exempt%'
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '')      not like '%has_location_access%'
    and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') not like '%has_location_access%';

  if v_bad is not null then
    raise exception '0484 CHECK 2: policies left unscoped on scoped tables: %', v_bad;
  end if;

  -- CHECK 3 — the recursion guard. If user_roles ever loses its exemption
  -- marker, the loop above would scope it and every policy evaluation in the
  -- database would recurse. Cheap to assert, catastrophic to discover live.
  if coalesce(obj_description('public.user_roles'::regclass, 'pg_class'), '')
       not like '%location-scope: exempt%' then
    raise exception '0484 CHECK 3: user_roles lost its exemption marker — '
                    'scoping it recurses through has_location_access()';
  end if;
end $$;
