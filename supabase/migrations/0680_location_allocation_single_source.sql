-- ============================================================================
-- Raagam ERP — 0680 Locations: Unit 1, one allocation, and the detail tables
--
-- Client 2026-10-03, the rule in one line:
--
--   NORMAL USER = ALLOCATED LOCATIONS ONLY.  SUPER ADMIN = ALL LOCATIONS.
--   MASTER DATA = SHARED.
--
-- Head Office is ONE unit, not a consolidation: an HO user sees HO only, and
-- anyone who needs more is allocated more. Work still happens in one unit at a
-- time (the topbar switcher, 0487); the allocation is the set a person may
-- switch BETWEEN.
--
-- Four things, in one migration because the self-test at the bottom has to see
-- all four at once.
--
-- ---------------------------------------------------------------------------
-- 1. UNIT 1.
--
-- The third GST entity. Its RE series is `U1/RE/<fy>/0001` with no code
-- change: `assign_order_number()` reads `locations.code`, and
-- `sales_order_no_counters` is keyed (location_id, fy), so a new location
-- starts its own series at 0001 the first time it raises an order.
-- Stores, staff, production lines etc. are per-unit DATA and start empty —
-- nothing is copied from Head Office.
--
-- ---------------------------------------------------------------------------
-- 2. ONE SOURCE FOR "WHICH UNITS MAY THIS PERSON OPEN".
--
-- Before this, three things answered it, OR-ed together in
-- `has_location_access`: super admin, the person's Units allocation
-- (`user_access` + `user_access_locations`, 0665), and the location stamped on
-- each ROLE they hold (`user_roles.location_id`, NULL = every unit). The role
-- branch is the one that made "allocated locations only" untrue: a role given
-- "at any location" silently opened every unit, from a screen whose question
-- was "what may they DO", not "where".
--
-- A role's location never affected WHAT a person may do — `has_permission`
-- ignores it — so it carried nothing except this second, competing answer. It
-- is dropped from `has_location_access`. Users & Access ▸ User Permissions ▸
-- Units is now the only place a normal user's units are set.
--
-- NOBODY LOSES A UNIT IN THE SWITCH. Every non-super-admin's role locations are
-- copied into their allocation first (a NULL role location becomes "All
-- units"). On 2026-10-03 there were none to copy — every role holder is a
-- super admin — but the backfill is written for the general case anyway.
--
-- ---------------------------------------------------------------------------
-- 3. THE DETAIL TABLES FOLLOW THEIR DOCUMENT.
--
-- 0484/0485 scoped every table carrying `location_id`, and the order tree
-- through `has_order_access` / `has_amendment_access`. The tables BELOW those
-- — BOM lines, PO/GRN lines, payroll lines, CAD pattern lines, IWO BOM rows,
-- staff sub-records — gated on module permission only. The 2026-09-22 RBAC
-- audit counted 97; the catalog held ~150 by today. A Unit 2 user could read
-- Head Office lines directly through PostgREST.
--
-- THE RULE: a detail row is visible exactly when the document that OWNS it is
-- visible in the current unit. Derived, never denormalised — same reason as
-- 0485: a copied `location_id` on 150 tables is 150 chances to disagree with
-- the source.
--
-- MECHANISM: one SECURITY DEFINER predicate per parent table, `lv_<table>(id)`,
-- generated from the catalog. A table with `location_id` answers
-- `is_current_location(location_id)`; a table without one answers its own
-- owner's predicate. DEFINER for the reason 0485 gives: as INVOKER the walk
-- would also demand the parent's MODULE permission (a payroll clerk would lose
-- payroll lines for lacking HR ▸ Staff view), and would re-enter the parent's
-- own policy. These functions answer "which unit" and nothing else; the
-- table's existing module check stays exactly as it was and is AND-ed.
--
-- THE OWNER, NOT EVERY PARENT. A row points at many things. A CAD allocation
-- names an order AND a pattern maker; a payroll line names a run AND a worker.
-- AND-ing every parent would hide a row whenever one reference belongs to
-- another unit — a disappearance nobody can explain. So:
--   * REFERENCE tables — staff, workers, contractors, stores, production_lines,
--     assets — are ignored as owners whenever the row has any other parent.
--     They own only the rows that hang off nothing else (hr_* sub-records,
--     worker attendance, store-level stock documents).
--   * NOT NULL owner FKs win over nullable ones.
--   * A nullable owner reads `fk is null OR visible`. A parentless row stays
--     visible everywhere — the 0485 decision (a leak you can SEE beats a
--     disappearance you cannot), monitored by check-location-scope CHECK 5.
--
-- EXEMPT, said in the table comment (one declaration, one reader):
--   approval_runs / approval_run_events — subject-polymorphic; a run's
--     DOCUMENT is unit-scoped already. Follow-up, not forgotten.
--   store_access, user_access_locations — access grants. The second is read by
--     `has_location_access` itself; scoping it would recurse.
--   approval_flows — configuration; NULL location = every unit.
--   iwo_no_counters, pla_no_counters — number counters, like
--     sales_order_no_counters (0484).
--
-- ---------------------------------------------------------------------------
-- 4. PACKING ADVICES — CHECKED, ALREADY CORRECT.
--
-- CHECK 1 of check-location-scope.sql named it: `location_id` and no policy
-- calling `is_current_location`. Its policies narrow through its ORDER
-- (`has_order_access(sales_order_id)`), which is right; the loop below skips
-- any table already narrowed that way, so nothing changed on it. The CHECK was
-- widened to recognise the order-derived form instead.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Unit 1
-- ---------------------------------------------------------------------------
insert into public.locations (code, name, is_active, is_default)
select 'U1', 'Unit 1', true, false
where not exists (select 1 from public.locations where code = 'U1');

-- ---------------------------------------------------------------------------
-- 2a. Backfill: role locations -> allocation, for non-super-admins only.
-- ---------------------------------------------------------------------------
insert into public.user_access (user_email, is_active, all_locations)
select distinct lower(btrim(p.email)), true, false
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
 where not coalesce(p.is_super_admin, false)
   and p.email is not null
on conflict (user_email) do nothing;

update public.user_access ua
   set all_locations = true
 where exists (
   select 1 from public.user_roles ur
   join public.profiles p on p.id = ur.user_id
  where lower(btrim(p.email)) = ua.user_email
    and not coalesce(p.is_super_admin, false)
    and ur.location_id is null);

insert into public.user_access_locations (user_email, location_id)
select distinct lower(btrim(p.email)), ur.location_id
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
 where not coalesce(p.is_super_admin, false)
   and ur.location_id is not null
   and p.email is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2b. has_location_access: super admin, or the person's active allocation.
-- ---------------------------------------------------------------------------
create or replace function public.has_location_access(p_location_id uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select public.is_super_admin(uid)
    or exists (
      select 1
      from public.profiles p
      join public.user_access ua on ua.user_email = lower(btrim(p.email))
      where p.id = uid
        and ua.is_active
        and (
          ua.all_locations
          or exists (
            select 1
            from public.user_access_locations l
            where l.user_email = ua.user_email
              and l.location_id = p_location_id
          )
        )
    );
$function$;

comment on function public.has_location_access(uuid, uuid) is
  'MAY this person open this unit? Super admin, or their ACTIVE Units allocation '
  '(user_access.all_locations / user_access_locations) — nothing else (0680). '
  'A role''s location no longer grants a unit: has_permission never read it, so '
  'it only ever competed with the allocation. Read by my_locations(), '
  'current_location() and through is_current_location() every unit policy.';

-- ---------------------------------------------------------------------------
-- 3/4. Exemptions, declared where check-location-scope.sql reads them.
-- ---------------------------------------------------------------------------
comment on table public.approval_runs is
  'location-scope: exempt -- subject-polymorphic; the document a run approves is unit-scoped itself (0680 follow-up).';
comment on table public.approval_run_events is
  'location-scope: exempt -- events of an approval run; see approval_runs (0680).';
comment on table public.store_access is
  'location-scope: exempt -- an access grant, not data; the store it names is unit-scoped (0680).';
comment on table public.user_access_locations is
  'location-scope: exempt -- the allocation itself; has_location_access reads it, scoping it would recurse (0680).';
comment on table public.approval_flows is
  'location-scope: exempt -- configuration; a NULL location means the flow serves every unit (0680).';
comment on table public.iwo_no_counters is
  'location-scope: exempt -- IWO number counter, keyed per unit, written by the numbering trigger (0680).';
comment on table public.pla_no_counters is
  'location-scope: exempt -- packing-advice number counter, keyed per unit, written by the numbering trigger (0680).';

-- ---------------------------------------------------------------------------
-- 3. Generate the predicates and narrow every unscoped detail table.
-- ---------------------------------------------------------------------------
do $$
declare
  c_ref constant text[] := array['staff','workers','contractors','stores','production_lines','assets'];
  r record; p record;
  v_cond text; v_body text; v_n_tables int := 0; v_n_pols int := 0;
begin
  -- Every table in the unit tree: roots carry location_id, the rest hang off
  -- one by an FK chain. Exempt tables neither join nor pass the tree on.
  create temp table _lv_tbl on commit drop as
  with recursive
  t as (
    select c.oid, c.relname,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid
                    and a.attname = 'location_id' and a.attnum > 0 and not a.attisdropped) as has_loc,
           coalesce(obj_description(c.oid, 'pg_class'), '') like '%location-scope: exempt%' as exempt
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  ),
  fk as (
    select con.conrelid as child, con.confrelid as parent
      from pg_constraint con
     where con.contype = 'f' and array_length(con.conkey, 1) = 1
       and con.conrelid <> con.confrelid
  ),
  tree(oid) as (
    select oid from t where has_loc and not exempt
    union
    select f.child from fk f join tree on tree.oid = f.parent
      join t on t.oid = f.child
     where not t.has_loc and not t.exempt
  )
  select t.oid, t.relname, t.has_loc from t join tree using (oid);

  -- The OWNER edges of each derived table (see the header for the rule).
  create temp table _lv_own on commit drop as
  with e as (
    select con.conrelid as child, con.confrelid as parent, pc.relname as parent_name,
           a.attname as col, a.attnotnull as nn,
           pc.relname = any(c_ref) as is_ref
      from pg_constraint con
      join pg_attribute a  on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      join pg_attribute ka on ka.attrelid = con.confrelid and ka.attnum = con.confkey[1]
      join pg_class pc on pc.oid = con.confrelid
     where con.contype = 'f' and array_length(con.conkey, 1) = 1
       and con.conrelid <> con.confrelid
       and ka.attname = 'id'
       and con.conrelid in (select oid from _lv_tbl where not has_loc)
       and con.confrelid in (select oid from _lv_tbl)
       and a.attname not in ('referee_id')        -- a referee is a reference, never the owner
  ),
  tier as (
    -- 1 = not-null document, 2 = nullable document, 3 = not-null reference, 4 = nullable reference
    select e.*, case when not is_ref and nn then 1 when not is_ref then 2
                     when nn then 3 else 4 end as tier
      from e
  )
  select child, parent_name, col, nn
    from tier
   where tier = (select min(t2.tier) from tier t2 where t2.child = tier.child);

  -- One predicate per table in the tree.
  for r in select oid, relname, has_loc from _lv_tbl loop
    if r.has_loc then
      v_body := format(
        'select p_id is null or exists (select 1 from public.%I x where x.id = p_id '
        'and public.is_current_location(x.location_id))', r.relname);
    else
      select string_agg(
               case when o.nn then format('public.%I(x.%I)', 'lv_' || o.parent_name, o.col)
                    else format('(x.%I is null or public.%I(x.%I))', o.col, 'lv_' || o.parent_name, o.col) end,
               ' and ' order by o.col)
        into v_cond
        from _lv_own o where o.child = r.oid;
      if v_cond is null then continue; end if;   -- reached only through a non-id key: not ours
      v_body := format(
        'select p_id is null or exists (select 1 from public.%I x where x.id = p_id and %s)',
        r.relname, v_cond);
    end if;

    if not exists (select 1 from pg_attribute a where a.attrelid = r.oid and a.attname = 'id'
                    and a.attnum > 0 and not a.attisdropped) then
      continue;   -- no id column: cannot be a parent, needs no predicate
    end if;

    execute format(
      'create or replace function public.%I(p_id uuid) returns boolean '
      'language sql stable security definer set search_path to '''' as $f$ %s $f$',
      'lv_' || r.relname, v_body);
    execute format('revoke all on function public.%I(uuid) from public, anon', 'lv_' || r.relname);
    execute format('grant execute on function public.%I(uuid) to authenticated', 'lv_' || r.relname);
    execute format(
      'comment on function public.%I(uuid) is %L', 'lv_' || r.relname,
      'Is this ' || r.relname || ' row in the current unit? Generated by 0680 — '
      'answers WHICH UNIT only, never a module permission.');
  end loop;

  -- Narrow every policy of every derived table that is not narrowed yet, plus
  -- packing_advices (a root with no unit policy at all).
  for r in
    select t.oid, t.relname, t.has_loc from _lv_tbl t
     where (not t.has_loc and exists (select 1 from _lv_own o where o.child = t.oid))
        or (t.has_loc and t.relname = 'packing_advices')
  loop
    if r.has_loc then
      v_cond := 'public.is_current_location(location_id)';
    else
      select string_agg(
               case when o.nn then format('public.%I(%I)', 'lv_' || o.parent_name, o.col)
                    else format('(%I is null or public.%I(%I))', o.col, 'lv_' || o.parent_name, o.col) end,
               ' and ' order by o.col)
        into v_cond
        from _lv_own o where o.child = r.oid;
    end if;

    -- Already narrowed by an earlier migration (0485's has_order_access etc.)?
    if exists (
      select 1 from pg_policy pp where pp.polrelid = r.oid
         and coalesce(pg_get_expr(pp.polqual, pp.polrelid), '') || coalesce(pg_get_expr(pp.polwithcheck, pp.polrelid), '')
             ~ '(is_current_location|has_order_access|has_amendment_access|lv_)'
    ) then continue; end if;

    v_n_tables := v_n_tables + 1;
    for p in select pp.polname, pp.polcmd,
                    pg_get_expr(pp.polqual, pp.polrelid) as q,
                    pg_get_expr(pp.polwithcheck, pp.polrelid) as w
               from pg_policy pp where pp.polrelid = r.oid
    loop
      if p.q is not null then
        execute format('alter policy %I on public.%I using ((%s) and %s)', p.polname, r.relname, p.q, v_cond);
      elsif p.polcmd in ('r', 'w', 'd', '*') then
        execute format('alter policy %I on public.%I using (%s)', p.polname, r.relname, v_cond);
      end if;
      if p.w is not null then
        execute format('alter policy %I on public.%I with check ((%s) and %s)', p.polname, r.relname, p.w, v_cond);
      elsif p.polcmd = 'a' then
        execute format('alter policy %I on public.%I with check (%s)', p.polname, r.relname, v_cond);
      end if;
      v_n_pols := v_n_pols + 1;
    end loop;
  end loop;

  raise notice '0680: narrowed % policies across % tables', v_n_pols, v_n_tables;
end $$;

reset check_function_bodies;

-- ---------------------------------------------------------------------------
-- Self-verification — read the CATALOG, never this file.
-- ---------------------------------------------------------------------------
do $$
declare v_left int; v_names text;
begin
  -- A. Unit 1 exists and is not the landing unit.
  if not exists (select 1 from public.locations where code = 'U1' and is_active and not is_default) then
    raise exception '0680: Unit 1 missing, inactive or marked default.';
  end if;

  -- B. has_location_access no longer reads user_roles.
  if pg_get_functiondef('public.has_location_access(uuid,uuid)'::regprocedure) like '%user_roles%' then
    raise exception '0680: has_location_access still reads user_roles.';
  end if;

  -- C. Every derived table with an owner has every policy narrowed.
  with recursive
  t as (
    select c.oid, c.relname,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'location_id'
                    and a.attnum > 0 and not a.attisdropped) has_loc,
           coalesce(obj_description(c.oid, 'pg_class'), '') like '%location-scope: exempt%' exempt
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'),
  fk as (select conrelid child, confrelid parent from pg_constraint
          where contype = 'f' and array_length(conkey, 1) = 1 and conrelid <> confrelid),
  tree(oid) as (select oid from t where has_loc and not exempt
                union select f.child from fk f join tree on tree.oid = f.parent
                  join t on t.oid = f.child where not t.has_loc and not t.exempt)
  select count(*), string_agg(distinct t.relname, ', ')
    into v_left, v_names
    from tree join t using (oid)
    join pg_policy pp on pp.polrelid = t.oid
   where coalesce(pg_get_expr(pp.polqual, pp.polrelid), '') || coalesce(pg_get_expr(pp.polwithcheck, pp.polrelid), '')
         !~ '(is_current_location|has_order_access|has_amendment_access|lv_)';
  if v_left > 0 then
    raise exception '0680: % policies still not narrowed to the unit: %', v_left, v_names;
  end if;

  -- D. No generated predicate is anon-callable.
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname like 'lv\_%' and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception '0680: an lv_ predicate is callable by anon.';
  end if;

  raise notice '0680 OK';
end $$;
