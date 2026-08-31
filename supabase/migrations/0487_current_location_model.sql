-- ============================================================================
-- Raagam ERP — 0487 The current unit becomes a fact the DATABASE knows
--
-- User decision 2026-08-31, refining the four of that morning:
--
--   "the master module data only common the locations, otherwise everything
--    will be maintained separately. In future we can transfer from one location
--    to another location, which is not yet discussed."
--
-- Two changes follow, and the second is the one that makes the switcher mean
-- something.
--
--
-- ## 1. "MASTER MODULE" IS NARROWER THAN "MASTER"
--
-- 0484 exempted nine tables as "masters" using the loose sense of the word. The
-- decision is about the **Master Data module** — what `lib/masters/submodules.ts`
-- registers and `/masters` renders. Re-checked against the code, not the word:
--
--   COMMON, stays exempt — reachable under /masters:
--     bins, merchandising_teams  (both rendered by
--       app/(app)/masters/materials/[entity]/page.tsx)
--     employees, work_timings    (registered in submodules.ts)
--
--   SEPARATE, now scoped — they belong to other modules:
--     staff, workers, contractors   -> HR      (lib/hr/, /hr/*)
--     production_lines              -> Production
--     stores                        -> Stores
--     assets                        -> Admin   (0484 deferred this as
--                                    UNCLASSIFIED; the rule now decides it)
--
-- `stores` keeps `can_access_store()` on top. That is a finer, per-store grant
-- and is unaffected — a store now belongs to a unit AND may be restricted
-- further within it.
--
--
-- ## 2. ACCESS IS NOT THE SAME QUESTION AS CURRENT VIEW
--
-- 0484/0485 answered "MAY this user reach this unit?". That is the right
-- question for a permission and the wrong one for a screen. A user entitled to
-- both units — every admin here — saw both units' rows at once, so switching
-- the Location box changed nothing they could see. The requirement is the other
-- question: "is this row in the unit I am working in RIGHT NOW?"
--
-- **A COOKIE CANNOT ANSWER THAT INSIDE A POLICY.** Postgres cannot read an HTTP
-- cookie; PostgREST sets no per-request GUC to carry one. Filtering by the
-- session unit in application code instead would mean editing 170 read paths —
-- 39 on `sales_orders` across 28 files alone — which is the exact shape of the
-- `created_by` sweep AGENTS.md records (143 list functions, 74 files) and which
-- fails silently one call site at a time.
--
-- So the current unit is PROMOTED TO A ROW: `profiles.current_location_id`,
-- written by the switcher. One column, and every one of the 392 policies
-- narrows at once — including for a super_admin, which is the whole point.
--
-- It also unlocks what could not be built before: a column DEFAULT. 0488 can
-- now say `default public.current_location()`, so a form that forgets to send a
-- unit gets the right one instead of NULL. That was impossible while the answer
-- lived only in the browser.
--
--
-- ## WHY BOTH FUNCTIONS SURVIVE
--
--   has_location_access(loc)  — MAY I reach it?   -> my_locations(), switching
--   is_current_location(loc)  — AM I in it now?   -> every row policy
--
-- Collapsing them would break the switcher: `my_locations()` would return only
-- the unit already selected, and there would be no way to choose another.
--
-- `is_current_location()` re-checks access rather than trusting the stored
-- column. `setCurrentLocation` validates before writing, so the column should
-- always be reachable — but "should" is what 0386 assumed. The re-check means a
-- revoked role takes effect on the NEXT REQUEST even though the stale column
-- still names the old unit.
--
--
-- ## NOT IN SCOPE, AND SAID OUT LOUD
--
-- Moving a document from one unit to another is explicitly future work
-- ("not yet discussed"). Nothing here implements it. When it comes, it is a
-- deliberate operation with its own permission and audit trail — NOT an
-- `update ... set location_id`, which would silently move a document out from
-- under everyone currently looking at it and renumber nothing.
-- ============================================================================

-- ==========================================================================
-- 1. Reclassify: five tables leave the Master module, one leaves limbo
-- ==========================================================================
comment on table public.staff is
  'HR module — separate per unit (client 2026-08-31: only Master Data module entities are common).';
comment on table public.workers is
  'HR module — separate per unit (client 2026-08-31: only Master Data module entities are common).';
comment on table public.contractors is
  'HR module — separate per unit (client 2026-08-31: only Master Data module entities are common).';
comment on table public.production_lines is
  'Production module — separate per unit (client 2026-08-31: only Master Data module entities are common).';
comment on table public.stores is
  'Stores module — separate per unit (client 2026-08-31). can_access_store() still applies on top: a store belongs to a unit AND may be restricted further within it.';
comment on table public.assets is
  'Admin module — separate per unit. 0484 deferred this as UNCLASSIFIED; the client 2026-08-31 rule (only Master Data module entities are common) decides it.';

-- The four that ARE Master Data, restated with the sharper reason.
comment on table public.bins is
  'location-scope: exempt -- Master Data module (rendered by /masters/materials/[entity]), common across units per client 2026-08-31.';
comment on table public.employees is
  'location-scope: exempt -- Master Data module (registered in submodules.ts), common across units per client 2026-08-31.';
comment on table public.merchandising_teams is
  'location-scope: exempt -- Master Data module (rendered by /masters/materials/[entity]), common across units per client 2026-08-31.';
comment on table public.work_timings is
  'location-scope: exempt -- Master Data module (registered in submodules.ts), common across units per client 2026-08-31.';

-- ==========================================================================
-- 2. The current unit, as a column
-- ==========================================================================
alter table public.profiles
  add column if not exists current_location_id uuid
    references public.locations(id) on delete set null;

comment on column public.profiles.current_location_id is
  'The unit this operator is working in RIGHT NOW — written by setCurrentLocation. Distinct from default_location_id, which is where they USUALLY work and is only a fallback. Read by current_location(); every row policy narrows to it. 0487.';

-- ==========================================================================
-- 3. current_location() / is_current_location()
-- ==========================================================================
create or replace function public.current_location(uid uuid default auth.uid())
returns uuid language sql stable security definer set search_path = '' as $$
  select p.current_location_id from public.profiles p where p.id = uid;
$$;

comment on function public.current_location(uuid) is
  'The unit the caller is working in now (profiles.current_location_id). SECURITY DEFINER: profiles_read_own would otherwise make this unreadable from inside a policy on another table. 0487.';

create or replace function public.is_current_location(
  p_location_id uuid, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_location_id is not null
     and p_location_id = public.current_location(uid)
     and public.has_location_access(p_location_id, uid);
$$;

comment on function public.is_current_location(uuid, uuid) is
  'Is this row in the unit the caller is working in now? Re-checks has_location_access so a revoked role takes effect on the next request even though the stored current_location_id is stale. 0487.';

revoke all on function public.current_location(uuid)          from public, anon;
revoke all on function public.is_current_location(uuid, uuid)  from public, anon;
grant execute on function public.current_location(uuid)         to authenticated;
grant execute on function public.is_current_location(uuid, uuid) to authenticated;

-- ==========================================================================
-- 4. Seed the column so nobody is stranded on first load.
--
--    default_location_id is the honest fallback — it is an administrator's
--    recorded statement of where this person works. Where that is unset too,
--    the column stays NULL and the operator picks from the switcher, which is
--    the fail-closed behaviour lib/auth/location.ts already implements.
-- ==========================================================================
update public.profiles
   set current_location_id = default_location_id
 where current_location_id is null
   and default_location_id is not null;

-- ==========================================================================
-- 5. Repoint every row policy from "may reach" to "is in now".
--
--    Two cases in one loop:
--      * a policy 0484 wrote  -> textual swap of the predicate
--      * a newly scoped table -> the predicate is appended
--
--    The order-tree policies (0485, 266 of them) are NOT touched here. They
--    call has_order_access() / has_amendment_access(), whose BODIES are
--    redefined in section 6 — so the whole tree follows this change without a
--    single policy being rewritten. That is what deriving bought.
-- ==========================================================================
do $$
declare
  r         record;
  v_pred    constant text :=
    '(location_id is null or public.is_current_location(location_id))';
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

    if v_qual is not null then
      if position('has_location_access' in v_qual) > 0 then
        v_qual := replace(v_qual, 'has_location_access(location_id)',
                                  'is_current_location(location_id)');
        v_changed := true;
      elsif position('is_current_location' in v_qual) = 0 then
        v_qual := '(' || v_qual || ') and ' || v_pred;
        v_changed := true;
      end if;
    end if;

    if v_check is not null then
      if position('has_location_access' in v_check) > 0 then
        v_check := replace(v_check, 'has_location_access(location_id)',
                                    'is_current_location(location_id)');
        v_changed := true;
      elsif position('is_current_location' in v_check) = 0 then
        v_check := '(' || v_check || ') and ' || v_pred;
        v_changed := true;
      end if;
    end if;

    if not v_changed then continue; end if;

    v_sql := format('alter policy %I on public.%I', r.polname, r.relname);
    if v_qual  is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;

    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice '0487: repointed % policies to the current unit', v_count;

  if v_count = 0 then
    raise exception '0487: no policies were repointed — the catalog query matched nothing, so this migration did nothing while reporting success.';
  end if;
end $$;

-- ==========================================================================
-- 6. The order tree follows, by redefinition rather than rewriting.
--
--    One function body each, and 266 policies change meaning with them.
-- ==========================================================================
create or replace function public.has_order_access(
  p_sales_order_id uuid, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_sales_order_id is null or exists (
    select 1 from public.sales_orders so
    where so.id = p_sales_order_id
      and (so.location_id is null or public.is_current_location(so.location_id, uid))
  );
$$;

comment on function public.has_order_access(uuid, uuid) is
  'Is this sales order in the caller''s CURRENT unit? (0487 repointed this from has_location_access; the 266 order-tree policies follow without being rewritten.) SECURITY DEFINER so a child policy can read the parent without re-entering its RLS. 0485.';

create or replace function public.has_amendment_access(
  p_amendment_id uuid, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_amendment_id is null or exists (
    select 1 from public.garment_order_amendments a
    where a.id = p_amendment_id
      and public.has_order_access(a.sales_order_id, uid)
  );
$$;

-- ==========================================================================
-- 7. Verification — FROM THE CATALOG
-- ==========================================================================
do $$
declare
  v_bad text;
begin
  -- 7a. Every non-exempt table carrying location_id filters on the CURRENT
  --     unit. A leftover has_location_access(location_id) means that table
  --     still shows both units to an admin.
  select string_agg(distinct c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_policy   p on p.polrelid = c.oid
  join pg_attribute a
    on a.attrelid = c.oid and a.attname = 'location_id'
   and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
    and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%location-scope: exempt%'
    and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')      like '%has_location_access(location_id)%'
      or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%has_location_access(location_id)%');

  if v_bad is not null then
    raise exception '0487 CHECK A: still filtering on ACCESS rather than CURRENT unit: %', v_bad;
  end if;

  -- 7b. Every policy on such a table is covered.
  select string_agg(c.relname || '.' || p.polname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_policy   p on p.polrelid = c.oid
  join pg_attribute a
    on a.attrelid = c.oid and a.attname = 'location_id'
   and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
    and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%location-scope: exempt%'
    and coalesce(pg_get_expr(p.polqual, p.polrelid), '')      not like '%is_current_location%'
    and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') not like '%is_current_location%';

  if v_bad is not null then
    raise exception '0487 CHECK B: policies not narrowed to the current unit: %', v_bad;
  end if;

  -- 7c. The five reclassified tables really did lose their exemption. Named
  --     individually because a typo in a table name above would silently leave
  --     one common across units, which is the failure this file exists to fix.
  select string_agg(t, ', ') into v_bad
  from unnest(array['staff','workers','contractors','production_lines','stores','assets']) t
  where coalesce(obj_description(('public.' || t)::regclass, 'pg_class'), '')
          like '%location-scope: exempt%';

  if v_bad is not null then
    raise exception '0487 CHECK C: still exempt after reclassification: %', v_bad;
  end if;

  -- 7d. And the four that ARE Master Data kept theirs.
  select string_agg(t, ', ') into v_bad
  from unnest(array['bins','employees','merchandising_teams','work_timings']) t
  where coalesce(obj_description(('public.' || t)::regclass, 'pg_class'), '')
          not like '%location-scope: exempt%';

  if v_bad is not null then
    raise exception '0487 CHECK D: Master Data tables lost their exemption (they must stay COMMON): %', v_bad;
  end if;

  -- 7e. my_locations() must still offer every unit the user may reach. If it
  --     ever starts using is_current_location it returns only the unit already
  --     selected, and there is no way to switch away from it — the app locks
  --     itself into one unit permanently.
  if pg_get_functiondef('public.my_locations()'::regprocedure) not like '%has_location_access%' then
    raise exception '0487 CHECK E: my_locations() no longer uses has_location_access — the switcher would only ever offer the current unit and could never leave it';
  end if;
end $$;
