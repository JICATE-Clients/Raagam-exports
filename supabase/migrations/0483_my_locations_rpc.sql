-- ============================================================================
-- Raagam ERP — 0483 my_locations(): the units THIS operator may work in
--
-- Phase 0 of multi-unit (user decision 2026-08-31). The application currently
-- handles Head Office only; Unit 1 / Unit 2 arrive as separate GST entities
-- sharing one master list, and the operator switches between them in the app
-- chrome.
--
--
-- ## WHAT WAS ALREADY HERE, AND WHY NONE OF IT WORKED
--
-- Three halves of multi-unit were built and none was connected to another:
--
--   * 0001 · 0002  `locations` exists, and HO + U2 are ALREADY SEEDED. The
--                  table's own comment reads "HO + Unit 2 = separate GST
--                  entities", so this was the intent from the first migration.
--   * 0326         `location_id` on ~19 transactional tables, plus
--                  `has_location_access()` — WHICH NO POLICY CALLS. Five
--                  references in the whole repo, all five inside 0326 itself.
--   * 0395         `sales_order_no_counters (location_id, fy)`, with a self-test
--                  asserting a second unit's first order reads 0001, not 0003.
--
-- And `components/shell/topbar.tsx` has shipped a Location `<Select>` all
-- along whose `onChange` writes a `useState` **that nothing else reads**. An
-- operator changing it changed nothing, anywhere, silently.
--
-- That is this repo's recurring failure shape, now for the fourth time: the
-- structural half lands, the enforcement half does not, and the result is not
-- an error but a quiet wrong answer. See AGENTS.md on `created_by` (columns
-- swept app-wide, `withCreators()` only in masters — 143 list functions showing
-- dashes), on the cascade-filter data half, and on 0387's
-- `alter default privileges ... in schema public`, which "runs, succeeds, and
-- does nothing".
--
--
-- ## THIS MIGRATION ADDS EXACTLY ONE THING, AND DELIBERATELY NO POLICIES
--
-- `my_locations()` — the list of units the caller may act in. It is the feeder
-- for the chrome switcher and for the server-side resolver that decides the
-- session's current unit (`lib/auth/location.ts`).
--
-- RLS enforcement is Phase 1 and is NOT in this file. Wiring
-- `has_location_access()` into ~19 tables' policies is a separate, reviewable
-- change with its own catalog check; folding it in here would mean a switcher
-- and a lockdown landing together, with no way to tell which one broke a screen.
--
--
-- ## IT DELEGATES TO has_location_access() RATHER THAN RESTATING THE RULE
--
-- The obvious body is a direct join on `user_roles`. It is wrong for the reason
-- AGENTS.md gives for `nominatedVendorOptions()` and `isInactive()`: one rule,
-- one place. Re-deriving "which units may this user see" here would put a
-- SECOND definition beside the one Phase 1's policies will read, free to
-- disagree with it — and the disagreement would be invisible, because each
-- half would look correct in isolation. The switcher offering a unit whose rows
-- RLS then hides is an empty screen with no error on it.
--
-- So `my_locations()` IS `has_location_access()`, evaluated per row. When
-- Phase 1 changes the access rule, this follows it for free.
--
--
-- ## INACTIVE UNITS ARE EXCLUDED, AND THIS IS NOT THE "Disabled rows" CASE
--
-- AGENTS.md's rule is that a switched-off master row stays visible on the field
-- that ALREADY HOLDS IT, greyed and tagged `(inactive)`, because dropping it
-- would blank an FK on the next save. That protects a value stored ON a record.
--
-- A session location is not stored on a record — it is the unit the operator is
-- about to WRITE INTO. A retired GST entity must not accept new documents, so
-- there is nothing to preserve and the exemption does not apply. The resolver
-- treats a deactivated current unit as invalid and falls back
-- (`resolveCurrentLocation` in lib/auth/location.ts).
-- ============================================================================

-- ==========================================================================
-- 1. my_locations() — active units the caller may act in, code order
-- ==========================================================================
create or replace function public.my_locations()
returns table(id uuid, code text, name text)
language sql stable security definer set search_path = '' as $$
  select l.id, l.code, l.name
  from public.locations l
  where l.is_active
    and public.has_location_access(l.id)
  order by l.code;
$$;

comment on function public.my_locations() is
  'Active locations the caller may act in. Delegates to has_location_access() '
  'so the chrome switcher and Phase 1 RLS can never disagree. 0483.';

-- ==========================================================================
-- 2. Grants — BOTH revokes, per AGENTS.md "Function grants"
--
-- A new function is born anon-callable by TWO independent grants: Postgres's
-- built-in `EXECUTE TO PUBLIC` (=X/owner) and Supabase's default privileges
-- (anon=X/owner). Revoking one leaves the other standing, and the migration
-- reads as a lockdown either way — that is exactly how 0383 left
-- `creator_names()` an unauthenticated name oracle until 0385 came back for the
-- other half, and how 0386 then found eight more.
--
-- 0387 closed the default globally, so this should be belt-and-braces. It is
-- written out anyway because "should" is what 0386 assumed.
-- ==========================================================================
revoke all on function public.my_locations() from public, anon;
grant execute on function public.my_locations() to authenticated;

-- ==========================================================================
-- 3. Verification — FROM THE CATALOG, NOT BY READING THE SQL ABOVE
--
-- `{"success": true}` means the statements ran, not that they achieved their
-- stated goal. Both bugs 0383/0386 shipped applied cleanly and reported
-- success. So this block re-reads pg_proc/pg_class rather than trusting the
-- lines above it.
-- ==========================================================================
do $$
declare
  v_acl text;
begin
  -- 3a. The function exists with the expected shape.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'my_locations'
  ) then
    raise exception '0483: my_locations() was not created';
  end if;

  -- 3b. It is SECURITY DEFINER. Without this it reads `locations` as the
  --     caller, and Phase 1's policies would filter the feeder that is
  --     supposed to DECIDE the filter — a chicken-and-egg empty dropdown.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'my_locations' and p.prosecdef
  ) then
    raise exception '0483: my_locations() is not SECURITY DEFINER';
  end if;

  -- 3c. THE GRANT ASSERTION. Neither `anon` nor PUBLIC may execute it. This is
  --     the check that would have caught 0383 and 0386 on the day they shipped.
  select array_to_string(p.proacl, ',') into v_acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'my_locations';

  if v_acl is null then
    -- A NULL ACL means "owner default", which INCLUDES execute to PUBLIC.
    raise exception '0483: my_locations() has a null ACL — still PUBLIC-executable';
  end if;

  if v_acl like '%anon=%' then
    raise exception '0483: anon can still execute my_locations() — acl is %', v_acl;
  end if;

  -- An entry with an empty grantee ("=X/owner") is the PUBLIC grant.
  if v_acl like '%,=%' or v_acl like '=%' then
    raise exception '0483: PUBLIC can still execute my_locations() — acl is %', v_acl;
  end if;

  -- 3d. has_location_access() must exist — the whole body depends on it, and a
  --     `create or replace` above would have succeeded even if it did not,
  --     failing only at call time inside a user's first page load.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'has_location_access'
  ) then
    raise exception '0483: has_location_access() is missing — 0326 did not apply';
  end if;

  -- 3e. There is at least one active location to switch TO. Not a style point:
  --     with none, the resolver fails closed and every screen loses its unit.
  if not exists (select 1 from public.locations where is_active) then
    raise exception '0483: no active locations — the switcher would be empty';
  end if;
end $$;
