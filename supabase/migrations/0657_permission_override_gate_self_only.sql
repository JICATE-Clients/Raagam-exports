-- ============================================================================
-- 0657 · PERMISSION OVERRIDES — the two gate functions answer about YOU only
-- ============================================================================
--
-- Found by the Supabase security advisor after Phase 6 (2026-09-30).
-- `can_manage_permission_overrides(uid)` and `can_view_permission_overrides(uid)`
-- (0650) are granted to `authenticated` — the RLS policies call them as the
-- querying user, and the screens ask them — and they took ANY uid. So any
-- logged-in user could ask "is person X an administrator or the MD?" through
-- /rest/v1/rpc. A small disclosure, and free to close.
--
-- Now a uid other than the caller's own answers FALSE, unless the caller is a
-- super admin. Every real call passes nothing (the default is auth.uid()): the
-- RLS policies, the grant / revoke / candidate RPCs, the page gates. Nothing
-- that works today asks about someone else, so nothing changes for it.
-- ============================================================================

create or replace function public.can_manage_permission_overrides(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select (uid = auth.uid() or public.is_super_admin(auth.uid()))
     and (public.has_permission('system_admin', 'edit', uid)
          or exists (select 1
                       from public.user_roles ur
                       join public.roles r on r.id = ur.role_id
                      where ur.user_id = uid and r.name = 'Managing Director'));
$$;

create or replace function public.can_view_permission_overrides(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select (uid = auth.uid() or public.is_super_admin(auth.uid()))
     and (public.can_manage_permission_overrides(uid)
          or public.has_permission('system_admin', 'view', uid));
$$;

revoke all on function public.can_manage_permission_overrides(uuid) from public, anon;
revoke all on function public.can_view_permission_overrides(uuid)   from public, anon;
grant execute on function public.can_manage_permission_overrides(uuid) to authenticated;
grant execute on function public.can_view_permission_overrides(uuid)   to authenticated;
