-- ============================================================================
-- Raagam ERP — 0009 Security hardening
-- Addresses Supabase security advisors after the initial schema load:
--   • pin search_path on the two remaining trigger functions
--   • make handle_new_user trigger-only (not a public RPC endpoint)
--   • block anon from the RLS/auth helper functions (keep authenticated)
--   • tighten the audit_log INSERT policy (was WITH CHECK true)
-- Applied to project xcidbfgujrxginrgvbjw via MCP execute_sql.
-- ============================================================================

-- 1. search_path hygiene on trigger functions
alter function public.set_updated_at() set search_path = '';
alter function public.assign_code() set search_path = '';

-- 2. handle_new_user is invoked only by the on_auth_user_created trigger;
--    it must not be callable via /rest/v1/rpc. (Triggers don't need EXECUTE.)
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 3. RLS/auth helpers: revoke the implicit PUBLIC grant (blocks anon), then
--    re-grant only authenticated (needed by RLS evaluation + app RPC calls).
revoke execute on function public.has_permission(text, text, uuid) from public;
grant  execute on function public.has_permission(text, text, uuid) to authenticated;

revoke execute on function public.is_super_admin(uuid) from public;
grant  execute on function public.is_super_admin(uuid) to authenticated;

revoke execute on function public.my_permissions() from public;
grant  execute on function public.my_permissions() to authenticated;

revoke execute on function public.my_roles() from public;
grant  execute on function public.my_roles() to authenticated;

-- 4. audit_log: a user may only append rows attributed to themselves
--    (or system rows with null user_id) — replaces the permissive WITH CHECK true.
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check ((select auth.uid()) = user_id or user_id is null);

-- ----------------------------------------------------------------------------
-- ACCEPTED RESIDUAL ADVISORIES (intentional):
--   • 0029 authenticated-executable on my_permissions / my_roles — these ARE
--     deliberate authenticated RPC endpoints; each returns only the caller's
--     own rows (where user_id = auth.uid()).
--   • 0029 authenticated-executable on has_permission / is_super_admin — RLS
--     helpers; authenticated must execute them for policy evaluation. They only
--     reveal the caller's own authorization booleans.
--   • auth_leaked_password_protection — enable in Dashboard → Auth → Password
--     settings (HaveIBeenPwned check); not configurable via SQL.
-- ============================================================================
