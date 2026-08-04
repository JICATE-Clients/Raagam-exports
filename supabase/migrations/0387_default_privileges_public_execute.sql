-- ============================================================================
-- Raagam ERP — 0387 The half of 0386 that did nothing
--
-- 0386 revoked the anon grant from nine functions and then tried to close the
-- default that keeps creating it, with two statements. ONE OF THEM IS A NO-OP:
--
--     alter default privileges for role postgres in schema public
--       revoke execute on functions from public;      -- <- does nothing
--
-- It runs, it reports success, and it changes nothing. Verified by creating a
-- throwaway function immediately afterwards and reading what it was born with:
--
--     acl = {=X/postgres, postgres=X/postgres, authenticated=X/postgres,
--            service_role=X/postgres}
--            ^^^^^^^^^^^  PUBLIC still has EXECUTE
--     has_function_privilege('anon', ..., 'EXECUTE') = TRUE
--
-- So a brand-new function was STILL born anon-callable, and 0386's own assertion
-- passed anyway — it only inspected functions that already existed, which were
-- genuinely fixed. The assertion was true and the goal was still unmet.
--
--
-- WHY THE SCHEMA-SCOPED FORM CANNOT WORK
--
-- A new function's ACL is built by starting from Postgres's BUILT-IN default —
-- `acldefault()`, which for functions is `{=X/owner, owner=X/owner}`, i.e. PUBLIC
-- gets EXECUTE — and then merging the pg_default_acl entries on top. Merging only
-- ever ADDS. So an `in schema …` entry cannot subtract the built-in `=X`; it is
-- applied after the thing it is trying to remove.
--
-- That is also why Supabase's shipped entry has no `=X` in it and functions were
-- getting one anyway. The stored entry was never the whole story.
--
-- The GLOBAL entry (no `in schema`) is the one that replaces the built-in
-- default rather than adding to it, and it is the only form that removes PUBLIC.
-- Same statement, one clause shorter, completely different outcome:
--
--     alter default privileges for role postgres
--       revoke execute on functions from public;      -- <- works
--
--
-- BLAST RADIUS, AND WHY THE GRANT BELOW IS NOT OPTIONAL
--
-- Global means every schema, not just public. On its own that would leave a
-- future function — an extension installed later into `extensions`, say —
-- executable by NOBODY but its owner, because PUBLIC was how `authenticated`
-- reached those functions in the first place. That is a foot-gun waiting for
-- whoever next runs `create extension`.
--
-- So the two statements are a pair, and neither is correct alone: take EXECUTE
-- away from "everyone, including a caller who never logged in", and hand it back
-- to the two roles the app actually runs as. Net effect on `authenticated` and
-- `service_role`: nothing. Net effect on anon and PUBLIC: gone.
--
-- NOT touched: the `storage` schema keeps its own anon=X default entry. That is
-- Supabase's schema and nothing here creates functions in it. If that ever
-- changes, it needs its own decision rather than a silent inheritance.
-- ============================================================================


-- Remove the built-in "PUBLIC may execute" from every function created by
-- postgres from here on. Global, because the schema-scoped form is the no-op
-- above. Existing functions are untouched — 0386 already dealt with those.
alter default privileges for role postgres
  revoke execute on functions from public;

-- Hand EXECUTE back to the two roles that are supposed to have it, at the same
-- level, so nothing loses access. See "blast radius" above: without this, the
-- revoke is not a lockdown, it is a trap.
alter default privileges for role postgres
  grant execute on functions to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- Prove it on a function that does not exist yet.
--
-- This is the assertion 0386 should have made. Checking the functions already in
-- the catalog cannot detect a broken default — they were fixed by hand and will
-- pass no matter what the default does. The only honest test is to CREATE
-- something and read what it was born with.
--
-- The probe is dropped before the check, so it is gone whether this passes or
-- raises (a raise rolls the whole block back regardless).
-- ----------------------------------------------------------------------------

do $$
declare
  v_anon boolean;
  v_auth boolean;
begin
  execute 'create function public._acl_probe_0387() returns int language sql immutable as $probe$ select 1 $probe$';

  v_anon := has_function_privilege('anon',          'public._acl_probe_0387()', 'EXECUTE');
  v_auth := has_function_privilege('authenticated', 'public._acl_probe_0387()', 'EXECUTE');

  execute 'drop function public._acl_probe_0387()';

  if v_anon then
    raise exception
      '0387: a newly created function is STILL executable by anon — the default privilege is not closed';
  end if;

  if not v_auth then
    raise exception
      '0387: a newly created function is NOT executable by authenticated — the grant above did not take, and every new RPC would 403';
  end if;
end $$;
