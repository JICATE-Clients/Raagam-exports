-- ============================================================================
-- Raagam ERP — location scoping check
--
-- Companion to scripts/check-anon-grants.sql, and it exists for the same
-- reason: 0326 added `location_id` to a pile of tables and defined
-- `has_location_access()`, and then NO POLICY EVER CALLED IT — five references
-- in the whole repo, all five inside 0326 itself. It applied cleanly, reported
-- success, and enforced nothing for months. 0484-0488 fixed it; this is what
-- stops it rotting back.
--
-- Reads the catalog, never a migration. Every check must return ZERO ROWS.
-- (CHECKS 7-8 added by 0680: detail tables, and the one source of unit access.)
--
--   psql "$DATABASE_URL" -f scripts/check-location-scope.sql
--
--
-- ## THE MODEL IN ONE PARAGRAPH
--
-- Only **Master Data module** entities are common across units; everything else
-- is maintained separately (client 2026-08-31). Two questions, two functions,
-- and confusing them breaks the app in opposite directions:
--
--   has_location_access(loc)  MAY I reach it?  -> my_locations(), switching
--   is_current_location(loc)  AM I in it now?  -> every row policy
--
-- The current unit is `profiles.current_location_id` (0487), falling back to
-- `default_location_id` (0487a), because an RLS policy cannot read a cookie.
--
--
-- ## IT ASKS THE INVERSE QUESTION, DELIBERATELY
--
-- Not "did the tables we remembered get scoped?" but "which table carrying a
-- `location_id` is NOT scoped and has not said why?". A list of tables to check
-- can only go stale — that is exactly how 0326's own prose fell behind, saying
-- 19 while the catalog held 46. Same flip AGENTS.md records for `caps-input`.
--
-- Exemptions are a table COMMENT containing `location-scope: exempt -- reason`.
-- One declaration, one reader; a table that is exempt says so to anyone reading
-- the schema. To list them:
--
--   select c.relname, obj_description(c.oid,'pg_class')
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public'
--     and obj_description(c.oid,'pg_class') like '%location-scope: exempt%';
-- ============================================================================

-- ==========================================================================
-- CHECK 1 — a table carrying `location_id` that no policy narrows to the
--           current unit. This is the 0326 failure, named.
-- ==========================================================================
select 'CHECK 1: table not narrowed to current unit' as failure,
       c.relname as table_name,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a
  on a.attrelid = c.oid and a.attname = 'location_id'
 and a.attnum > 0 and not a.attisdropped
where n.nspname = 'public' and c.relkind = 'r'
  and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%location-scope: exempt%'
  and not exists (
    select 1 from pg_policy p
    where p.polrelid = c.oid
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
          ~ '(is_current_location|has_order_access|has_amendment_access)'   -- direct, or through its order (packing_advices)
  )
order by c.relname;

-- ==========================================================================
-- CHECK 2 — a single policy left unscoped on a non-exempt table.
--
-- THIS IS THE ONE THAT HIDES. A table whose SELECT is scoped but whose UPDATE
-- is not reads as done from every angle — the list filters correctly, the
-- screen looks right — while any user can still edit another unit's row by id.
-- CHECK 1 passes on such a table. It also catches a NEW policy added later to
-- an already-scoped table, where nothing else would complain.
-- ==========================================================================
select 'CHECK 2: policy not narrowed to current unit' as failure,
       c.relname as table_name, p.polname as policy_name,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                     when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as cmd
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_policy   p on p.polrelid = c.oid
join pg_attribute a
  on a.attrelid = c.oid and a.attname = 'location_id'
 and a.attnum > 0 and not a.attisdropped
where n.nspname = 'public' and c.relkind = 'r'
  and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%location-scope: exempt%'
  and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
      !~ '(is_current_location|has_order_access|has_amendment_access)'
order by c.relname, p.polname;

-- ==========================================================================
-- CHECK 3 — the recursion guard.
--
-- `has_location_access()` READS `user_roles`. If that table ever loses its
-- exemption marker, 0484's catalog-driven loop would scope it on the next run
-- and every policy evaluation in the database would recurse. Cheap to assert,
-- catastrophic to discover live.
-- ==========================================================================
select 'CHECK 3: user_roles lost its exemption marker' as failure,
       'scoping it recurses through has_location_access()' as detail
where coalesce(obj_description('public.user_roles'::regclass, 'pg_class'), '')
        not like '%location-scope: exempt%';

-- ==========================================================================
-- CHECK 4 — the transitional NULL escape must be gone.
--
-- 0484 wrote `location_id is null or ...` as an explicit concession while rows
-- were unstamped. 0488 made every scoped column NOT NULL, so the branch is now
-- unsatisfiable — and a policy still carrying it is a hole waiting for one
-- unstamped row to become visible to every unit.
-- ==========================================================================
select 'CHECK 4: NULL escape still in policy' as failure,
       c.relname as table_name, p.polname as policy_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_policy   p on p.polrelid = c.oid
join pg_attribute a
  on a.attrelid = c.oid and a.attname = 'location_id'
 and a.attnum > 0 and not a.attisdropped
where n.nspname = 'public' and c.relkind = 'r'
  and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%location-scope: exempt%'
  and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')      like '%location_id IS NULL%'
    or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%location_id IS NULL%')
order by c.relname, p.polname;

-- ==========================================================================
-- CHECK 5 — the ORPHAN monitor, and the one check expected to stay quiet
--           rather than to have been fixed.
--
-- 20 order-tree tables have a NULLABLE parent FK. `has_order_access(null)`
-- returns TRUE, so a row with no parent is visible in EVERY unit.
--
-- That is deliberate: hiding a legitimately parentless row would make it vanish
-- from every screen with no error, which is the "empty report gets believed"
-- failure AGENTS.md warns about and the harder of the two to notice. A leak
-- someone can SEE beats a disappearance nobody can.
--
-- There were zero orphans when 0488 shipped. This reports the first one, so the
-- trade-off is monitored rather than forgotten. A hit is NOT automatically a
-- bug — it is a prompt to decide whether that table should carry its own
-- `location_id` instead of deriving one.
-- ==========================================================================
do $$
declare r record; v_n bigint;
begin
  for r in
    select distinct on (c.oid) c.relname as tbl, a.attname as fk
    from pg_constraint con
    join pg_class c   on c.oid  = con.conrelid
    join pg_class cf  on cf.oid = con.confrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
    where con.contype = 'f' and n.nspname = 'public' and c.relkind = 'r'
      and array_length(con.conkey, 1) = 1
      and cf.relname in ('sales_orders', 'garment_order_amendments')
      and not a.attnotnull
      and not exists (
        select 1 from pg_attribute a2 where a2.attrelid = c.oid
          and a2.attname = 'location_id' and a2.attnum > 0 and not a2.attisdropped)
    order by c.oid, case cf.relname when 'sales_orders' then 0 else 1 end
  loop
    execute format('select count(*) from public.%I where %I is null', r.tbl, r.fk) into v_n;
    if v_n > 0 then
      raise warning 'CHECK 5: %.% has % orphan row(s) — visible from EVERY unit. Decide whether this table needs its own location_id.', r.tbl, r.fk, v_n;
    end if;
  end loop;
end $$;

-- ==========================================================================
-- CHECK 6 — the switcher must never narrow to the current unit.
--
-- If `my_locations()` ever starts using `is_current_location`, it returns only
-- the unit already selected — and the operator can never switch away from it.
-- The app locks itself into one GST entity permanently, and the symptom is a
-- dropdown with one option rather than an error.
-- ==========================================================================
select 'CHECK 6: my_locations() narrowed to the current unit' as failure,
       'the switcher could never leave the unit it is on' as detail
where pg_get_functiondef('public.my_locations()'::regprocedure)
        not like '%has_location_access%';

-- ==========================================================================
-- CHECK 7 — a DETAIL table whose document is unit-scoped, but which is not.
--
-- CHECKS 1-2 only see tables that carry `location_id`. The tables BELOW them —
-- BOM lines, PO/GRN lines, payroll lines, staff sub-records — carry none, so
-- they were invisible to this script while ~150 of them leaked across units
-- (RBAC audit 2026-09-22; fixed by 0680, which narrows each one through a
-- generated `lv_<parent>()` predicate). A new child table copied from an old
-- migration arrives with module-permission policies only; this names it.
-- Fix: AND `public.lv_<owner>(<fk>)` into each of its policies, as 0680 does,
-- or mark it `location-scope: exempt -- <reason>`.
-- ==========================================================================
with recursive
t as (
  select c.oid, c.relname,
         exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'location_id'
                  and a.attnum > 0 and not a.attisdropped) as has_loc,
         coalesce(obj_description(c.oid, 'pg_class'), '') like '%location-scope: exempt%' as exempt
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
),
fk as (select conrelid as child, confrelid as parent from pg_constraint
        where contype = 'f' and array_length(conkey, 1) = 1 and conrelid <> confrelid),
tree(oid) as (
  select oid from t where has_loc and not exempt
  union
  select f.child from fk f join tree on tree.oid = f.parent
    join t on t.oid = f.child where not t.has_loc and not t.exempt
)
select 'CHECK 7: detail table not narrowed to current unit' as failure,
       t.relname as table_name, p.polname as policy_name
from tree join t using (oid)
join pg_policy p on p.polrelid = t.oid
where not t.has_loc
  and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      !~ '(is_current_location|has_order_access|has_amendment_access|lv_)'
order by t.relname, p.polname;

-- ==========================================================================
-- CHECK 8 — "which units may I open" has ONE source (0680).
--
-- Super admin, or the person's Units allocation on Users & Access ▸ User
-- Permissions. A role's location used to answer it too, and a role given "at
-- any location" silently opened every unit. If `user_roles` ever comes back
-- into `has_location_access`, this fires.
-- ==========================================================================
select 'CHECK 8: has_location_access reads user_roles again' as failure,
       'a role''s location must not grant a unit — the allocation is the only source' as detail
where pg_get_functiondef('public.has_location_access(uuid,uuid)'::regprocedure) like '%user_roles%';
