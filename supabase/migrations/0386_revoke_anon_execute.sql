-- ============================================================================
-- Raagam ERP — 0386 No function in schema public is executable by anon
--
-- 0385 closed a stray anon EXECUTE grant on creator_names() and named three
-- older SECURITY DEFINER functions carrying the same one. This is that change —
-- widened, because reading the live catalog rather than the migration text
-- showed the leak is not three functions. It is a DEFAULT that fires on every
-- `create function`, and it had caught eight.
--
--
-- WHY THIS KEEPS HAPPENING
--
-- pg_default_acl, schema public, grantor postgres, object type 'f':
--
--     {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
--      service_role=X/postgres}
--
-- Supabase ships that. Every function a migration creates is granted to anon at
-- CREATE time, before the author has written a single GRANT of their own.
-- Nothing you write in the function body prevents it; only an explicit REVOKE
-- undoes it. So `grant execute ... to authenticated` does not mean "and nobody
-- else" — it adds a grant to a set that already contains anon.
--
--
-- TWO GRANTS, NOT ONE — this is the part that made 0383 look locked down
--
-- Every one of the eight read:
--
--     {=X/postgres, postgres=X/postgres, anon=X/postgres,
--      authenticated=X/postgres, service_role=X/postgres}
--      ^^^^^^^^^^^
--
-- The leading `=` is the PUBLIC pseudo-role — Postgres's OWN built-in
-- `EXECUTE TO PUBLIC` on new functions — and `anon=X` is Supabase's default ACL
-- layered on top. They are INDEPENDENT. Revoking one leaves the other standing,
-- and the function stays anon-callable while the migration reads as a lockdown.
--
-- That is the whole history of this bug in one line. 0383 wrote
-- `revoke all ... from public` (killed the `=X`, left `anon=X`); 0385 wrote
-- `revoke all ... from anon` (killed the rest). creator_names only actually
-- closed because those two happened to do one half each. Any function that got
-- just one of them is still open — which is exactly what the eight below are.
--
-- Hence `from public, anon` throughout, the idiom 0042 / 0352 / 0382 already use.
--
--
-- CORRECTION TO 0385's HEADER
--
-- 0385 lists party_setnull_referrers as "WRITES — nulls FK references". It does
-- not. It is declared `stable` and only reads: it returns the referring rows
-- whose FK WOULD be nulled, so party_delete_subtree can re-check them afterwards.
-- The nulling is done by Postgres's ON DELETE SET NULL during the delete itself.
-- All three functions 0385 named are read-only. Corrected here rather than by
-- editing 0385, which is add-only history — the same way 0378 rewrote 0371's
-- column comments instead of touching 0371.
--
-- The sharper finding, and the reason this was still worth doing promptly, is a
-- different function. party_row_exists(p_schema, p_table, p_id) is SECURITY
-- DEFINER, owned by postgres, and interpolates CALLER-SUPPLIED schema and table
-- into `select 1 from %I.%I where id = $1`. %I blocks injection, but it is a
-- generic cross-schema row-existence oracle that bypasses RLS entirely — and
-- until this migration it answered to a caller who was not logged in.
--
--
-- WHY ALL EIGHT, AND WHY THIS IS SAFE
--
-- Every .rpc() in the app runs behind a login (lib/analytics/service.ts,
-- lib/reports/item-service.ts, lib/masters/delete-guard.ts, party-publish.ts,
-- lib/notifications/notify.ts, lib/created-by.ts, lib/auth/server.ts). The anon
-- key is only the transport key; the session upgrades the role to authenticated.
-- No public function is reachable, or needed, before login.
--
-- The four TRIGGER functions are safe for a second, independent reason: a
-- trigger fires regardless of EXECUTE privilege on its function. The repo
-- already depends on this — 0009 revokes handle_new_user() from
-- public, anon, authenticated and signup still works; 0010, 0041 and 0351 do the
-- same for apply_stock_movement, audit_record_change and
-- stamp_stock_movement_defaults. These four were simply missed.
--
-- What that leaves is an invariant a script can check forever — NO function in
-- schema public is executable by anon — rather than a list of functions someone
-- has judged fine, which has to be re-judged by hand every time one is added.
--
--
-- STILL OPEN, deliberately, for its own change:
--
--   party_row_exists stays a generic cross-schema existence oracle for
--   AUTHENTICATED callers. A staff account can probe any table — including
--   auth.users — for a row id its own RLS forbids it to read. Constraining it
--   (require the target to actually carry an FK to a party master, checkable
--   against pg_constraint) is a behaviour change to the party delete path, and
--   that belongs in a reviewed change of its own. Same reason 0385 split these
--   out rather than folding them in.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The eight. Both grants each — see the header; one alone closes nothing.
--
-- The `authenticated` grants from 0344 and 0378 STAY, and are load-bearing.
-- party_delete_subtree is SECURITY INVOKER, so it runs as the caller: the caller
-- must hold EXECUTE on party_row_exists, party_setnull_referrers and party_label
-- even though no TypeScript ever names them.
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER — the three 0385 named.
revoke all on function public.first_referencing_table(text, uuid)   from public, anon;
revoke all on function public.party_row_exists(text, text, uuid)    from public, anon;
revoke all on function public.party_setnull_referrers(text, uuid)   from public, anon;

-- SECURITY INVOKER, but they are the party delete path's entry point and its
-- label helper. RLS is the real guard there; this is the lock on the door.
revoke all on function public.party_delete_subtree(text, uuid)      from public, anon;
revoke all on function public.party_label(text)                     from public, anon;

-- Trigger functions. Nothing calls these directly and triggers do not need the
-- grant; they only ever had it because of the default above.
revoke all on function public.assign_code()                         from public, anon;
revoke all on function public.assign_order_number()                 from public, anon;
revoke all on function public.set_updated_at()                      from public, anon;
revoke all on function public.validate_item_class_category()        from public, anon;


-- ----------------------------------------------------------------------------
-- 2. Close the default itself, so the next `create function` cannot reopen this.
--
-- Both halves again, for the same reason: the anon half is Supabase's default
-- ACL entry, the public half is Postgres's built-in EXECUTE TO PUBLIC (issuing
-- the revoke records an entry that suppresses it).
--
-- Existing functions are untouched — this changes only what NEW functions are
-- granted. authenticated and service_role keep their own default grants, so
-- nothing in the app changes.
--
-- THE ONE CONSEQUENCE, said out loud: a function that genuinely should be
-- callable by a logged-out visitor must now ask for it in writing —
--
--     grant execute on function public.foo() to anon;
--
-- There are none today. If you are reading this because a new function 404s
-- from PostgREST while logged out, that is this migration working.
--
-- >>> THE FIRST OF THE TWO STATEMENTS BELOW IS A NO-OP. FIXED IN 0387. <<<
-- >>>
-- >>> `in schema public … revoke … from public` runs, succeeds, and changes
-- >>> nothing: a new function's ACL starts from Postgres's built-in default
-- >>> (which grants EXECUTE to PUBLIC) and pg_default_acl entries are merged ON
-- >>> TOP, so a schema-scoped entry can only ADD. Only the GLOBAL form replaces
-- >>> the built-in default. Caught by creating a throwaway function immediately
-- >>> after this migration applied and finding it still anon-callable — the
-- >>> assertion in part 3 passed anyway, because it only inspects functions that
-- >>> already exist. Left here as applied; see 0387 for the working statement.
-- ----------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;


-- ----------------------------------------------------------------------------
-- 3. Verify the goal, in the same transaction that claims it.
--
-- The lesson from 0385 was that a green checkmark means the SQL ran, not that it
-- achieved anything — 0383 applied cleanly and left the function wide open. So
-- this migration is not allowed to report success without proving its own claim.
--
-- has_function_privilege resolves PUBLIC and role membership before answering,
-- so it cannot be satisfied by revoking only one of the two grants — which is
-- precisely how this went wrong the first time.
--
-- The re-runnable half lives in scripts/check-anon-grants.sql.
-- ----------------------------------------------------------------------------

do $$
declare
  v_leaks text;
begin
  select string_agg(
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           ', ' order by p.proname
         )
    into v_leaks
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_leaks is not null then
    raise exception '0386: anon can still execute public function(s): %', v_leaks;
  end if;
end $$;
