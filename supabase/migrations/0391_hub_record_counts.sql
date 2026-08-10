-- ============================================================================
-- Raagam ERP — 0391 hub_record_counts(): one round-trip for a hub page's cards
--
-- A sub-module hub renders up to 13 cards, and each card wants the number of
-- records behind it (`/masters/materials` has done this since it was built).
-- Done the obvious way that is 13 PostgREST requests per page load —
-- `.select("id", { count: "exact", head: true })` thirteen times — which is
-- what `lib/dashboard/service.ts` already does and is not something to repeat
-- 37 hubs wide. This is the batched form: one array in, one row per countable
-- table out.
--
--
-- WHY SECURITY INVOKER, AND WHY THAT IS THE WHOLE SECURITY ARGUMENT
--
-- Every table in `public` has RLS enabled (356 of 356 at the time of writing).
-- A SECURITY INVOKER function runs as the calling role — `authenticated` — so
-- the policies apply to the count exactly as they apply to the SELECT the app
-- would otherwise issue. The function therefore reveals NOTHING a caller could
-- not already learn with `supabase.from(t).select("id", { count: "exact" })`
-- using the same session. It is a round-trip optimisation, not a privilege.
--
-- A SECURITY DEFINER version would have been a genuine hole: it would count
-- rows the caller's policies hide, on any table named, for any signed-in user.
-- Do not "fix" a missing count by switching this to definer.
--
-- Two guards on top of RLS, because RLS is not the only failure:
--
--   * `has_table_privilege(reg, 'SELECT')` — a caller with no SELECT grant at
--     all raises `permission denied`, and one such table in the array would
--     abort the whole batch. Skipped instead, so the card resolves to NO COUNT
--     rather than the page 500ing.
--   * `relkind in ('r','p','v','m','f')` — `to_regclass` resolves indexes and
--     sequences too, and `count(*)` on those errors.
--
-- A skipped table returns NO ROW. That distinction is the point: the UI shows
-- a number when a row comes back and shows nothing when one does not. Zero
-- means "this table is empty, go add a record"; absent means "counting does
-- not apply / is not permitted here". Returning 0 for an unmeasurable card
-- makes every such card look like an empty screen.
--
--
-- INJECTION
--
-- The only dynamic part is a table name, and it is triple-guarded: matched
-- against `^[a-z_][a-z0-9_]*$`, resolved through `to_regclass` (a name that is
-- not a real relation in `public` is dropped), and interpolated with `%I`.
-- `search_path` is pinned so `to_regclass` cannot be pointed at another schema.
--
--
-- COST
--
-- `count(*)` under RLS is a scan, so this is deliberately capped at 40 tables
-- per call (a hub has at most 13 cards) and the caller's map in
-- `lib/nav/hub-counts.ts` deliberately omits the append-only giants —
-- `record_audit`, `stock_ledger` — where a row count is both expensive and
-- meaningless to an operator.
--
--
-- GRANTS — both grantees, one statement
--
-- Per AGENTS.md "Function grants": a new function is born anon-callable by TWO
-- independent grants (Postgres's built-in `=X/owner` and Supabase's default
-- privileges). 0387 closed the global default, so this one should be born
-- clean — but "should be" is exactly what 0383 and 0386 each believed, so the
-- revoke names both and the DO block below reads the answer out of the catalog
-- instead of trusting that these statements achieved anything.
-- ============================================================================

create or replace function public.hub_record_counts(p_tables text[])
returns table (table_name text, row_count bigint)
language plpgsql
security invoker
stable
set search_path = pg_catalog, public
as $$
declare
  t    text;
  reg  regclass;
  kind "char";
  n    bigint;
  seen text[] := array[]::text[];
begin
  if p_tables is null then
    return;
  end if;

  if array_length(p_tables, 1) > 40 then
    raise exception 'hub_record_counts: at most 40 tables per call (got %)',
      array_length(p_tables, 1);
  end if;

  foreach t in array p_tables loop
    -- Shape guard first: cheapest, and it is what makes the `%I` below the
    -- second line of defence rather than the only one.
    continue when t is null or t !~ '^[a-z_][a-z0-9_]*$';
    continue when t = any (seen);
    seen := seen || t;

    reg := to_regclass('public.' || quote_ident(t));
    continue when reg is null;

    select c.relkind into kind from pg_class c where c.oid = reg;
    continue when kind is null or kind not in ('r', 'p', 'v', 'm', 'f');

    -- No SELECT grant → no row. See the header: an error here would take the
    -- other twelve cards down with it.
    continue when not has_table_privilege(reg, 'SELECT');

    execute format('select count(*) from public.%I', t) into n;

    table_name := t;
    row_count  := n;
    return next;
  end loop;
end;
$$;

comment on function public.hub_record_counts(text[]) is
  'Batched per-table row counts for sub-module hub cards. SECURITY INVOKER: '
  'counts are exactly what the caller''s RLS policies allow. A table that is '
  'unknown, unreadable or not a relation returns NO ROW (never 0).';

revoke all on function public.hub_record_counts(text[]) from public, anon;
grant execute on function public.hub_record_counts(text[]) to authenticated;


-- ----------------------------------------------------------------------------
-- Read the grant back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its stated goal —
-- 0383 and 0386 both applied cleanly and both left the function anon-callable.
-- Same check as scripts/check-anon-grants.sql, run here so the migration cannot
-- report success while missing its own point.
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.hub_record_counts(text[])', 'EXECUTE') then
    raise exception
      '0391: hub_record_counts is executable by anon — the revoke did not take';
  end if;

  if not has_function_privilege('authenticated', 'public.hub_record_counts(text[])', 'EXECUTE') then
    raise exception
      '0391: hub_record_counts is NOT executable by authenticated — every hub would show no counts at all';
  end if;
end $$;
