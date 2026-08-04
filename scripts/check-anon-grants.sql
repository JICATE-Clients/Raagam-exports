-- ============================================================================
-- Raagam ERP — anon EXECUTE audit
--
-- STANDING INVARIANT: no function in schema `public` is executable by `anon`.
-- This app has no logged-out surface — every .rpc() runs behind a session, and
-- the anon key is only the transport key.
--
-- PASS = both queries below return zero rows.
--
--     supabase db execute --file scripts/check-anon-grants.sql
--     -- or paste into the SQL editor / the Supabase MCP execute_sql tool
--
-- Run it after a migration adds a function, after restoring or branching the
-- database, and any time you want to know rather than assume. Reading the
-- migration is NOT a substitute — 0383 said `revoke all ... from public` and
-- left the function wide open; 0386 said `alter default privileges ... in schema
-- public revoke ... from public` and changed nothing at all. Both applied
-- cleanly. Only the catalog tells the truth.
--
-- TWO GRANTS REACH anon, AND THEY ARE INDEPENDENT:
--   `=X/owner`     Postgres's built-in EXECUTE-to-PUBLIC on every new function
--   `anon=X/owner` Supabase's default privileges, a separate direct grant
-- Revoking one leaves the other standing. Always both, in one statement:
--
--     revoke all on function public.foo(text, uuid) from public, anon;
-- ============================================================================


-- ----------------------------------------------------------------------------
-- CHECK 1 — functions that exist right now. Expect zero rows.
--
-- A hit is a function a caller who is not logged in can run. Fix with the
-- `from public, anon` revoke above. The only legitimate hit is a function
-- deliberately meant for a logged-out visitor, granted in writing
-- (`grant execute ... to anon`) and justified in its migration. There are none.
-- ----------------------------------------------------------------------------

select
  'CHECK 1: anon-executable function'              as check,
  n.nspname || '.' || p.proname                    as function,
  pg_get_function_identity_arguments(p.oid)        as args,
  p.prosecdef                                      as security_definer,
  pg_get_userbyid(p.proowner)                      as owner,
  coalesce(p.proacl::text,
           '(null — built-in default, PUBLIC has EXECUTE)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by p.prosecdef desc, p.proname;


-- ----------------------------------------------------------------------------
-- CHECK 2 — the DEFAULT, which is what actually keeps regenerating the problem.
-- Expect zero rows.
--
-- Check 1 alone cannot catch a broken default: every function it inspects was
-- fixed by hand, so it passes while the next `create function` is still born
-- anon-callable. That is exactly how 0386 asserted success and shipped a no-op.
--
-- 0387 set the GLOBAL entry (defaclnamespace = 0). The global form is the only
-- one that removes PUBLIC — a schema-scoped entry is merged ON TOP of the
-- built-in default and can only add. If this returns a row, re-apply 0387.
--
-- Scoped to defaclrole = postgres, which is not a detail: migrations run as
-- postgres and every function in `public` is owned by postgres, so that is the
-- only default that governs anything we create. `supabase_admin` keeps its own
-- entries for public / graphql / graphql_public that still carry anon=X — those
-- are platform-owned and postgres is not a member of that role, so they cannot
-- be changed from a migration and are not this project's to police. CHECK 1 is
-- the backstop: it catches an anon-callable function however it was created.
--
-- `storage` IS a postgres entry and still carries anon=X, and is excluded on
-- purpose: it is Supabase's schema, nothing here creates functions in it, and
-- 0387 deliberately did not touch it. If that ever changes it needs its own
-- decision rather than a silent inheritance.
-- ----------------------------------------------------------------------------

select
  'CHECK 2: default privileges let anon or PUBLIC execute new functions' as check,
  coalesce(nullif(d.defaclnamespace, 0)::regnamespace::text, '(global)')  as scope,
  d.defaclacl::text                                                      as acl
from pg_default_acl d
where d.defaclobjtype = 'f'
  and d.defaclrole = 'postgres'::regrole
  and coalesce(nullif(d.defaclnamespace, 0)::regnamespace::text, '(global)') <> 'storage'
  and (d.defaclacl::text like '%anon=%' or d.defaclacl::text like '%{=X%' or d.defaclacl::text like '%,=X%')

union all

-- The global entry must EXIST. Its absence means the built-in PUBLIC grant is
-- back in force, which is the pre-0387 state and reads identically to "fine"
-- if you only look for offending entries.
select
  'CHECK 2: no global default-ACL entry for functions — built-in PUBLIC grant is live again',
  '(global)', '(missing)'
where not exists (
  select 1 from pg_default_acl
  where defaclobjtype = 'f'
    and defaclnamespace = 0
    and defaclrole = 'postgres'::regrole
);


-- ----------------------------------------------------------------------------
-- The definitive test, if you want certainty rather than inference: create a
-- function and read what it was born with. Run inside a transaction you roll
-- back, or use the do-block in 0387 which drops the probe itself.
--
--     begin;
--     create function public._probe() returns int language sql as $$ select 1 $$;
--     select has_function_privilege('anon','public._probe()','EXECUTE')          as anon_can,
--            has_function_privilege('authenticated','public._probe()','EXECUTE') as auth_can,
--            (select proacl::text from pg_proc where proname='_probe')           as acl;
--     rollback;
--
-- Expect anon_can = false, auth_can = true.
-- ----------------------------------------------------------------------------
