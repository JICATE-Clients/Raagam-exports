-- 0687 — move a person's access to a corrected email (user 2026-10-06).
--
-- THE BUG: a login created from HR ▸ Staff while the staff email was mistyped
-- keeps that email. Correcting it in HR changed only `staff.email`; "resend
-- welcome mail" read the LOGIN's email and kept mailing the wrong address
-- (ST-71906: seven sends to the typo). The fix in lib/users/actions.ts brings
-- the login onto the HR email before sending — and this function is the half
-- that keeps the person's ACCESS with them.
--
-- Personal access is keyed by EMAIL, not by the login: user_access (PK) with
-- user_permissions / user_screen_permissions / user_access_locations hanging
-- off it by FK (no ON UPDATE CASCADE), and user_email_permission_overrides.
-- Renaming the login without these would sign the person in with no units and
-- no permissions. The FKs refuse an in-place PK update, so: copy the parent
-- under the new key, re-point the children, drop the old parent — one
-- transaction, all or nothing.
--
-- History stays as written: user_access_history, override_grant_history,
-- override_commits and override_audit_trail record who held what AT THE TIME,
-- and rewriting an audit column is the lie 0383 refuses.
--
-- Service role only — the server action checks system_admin:edit first. Not
-- executable by anon OR authenticated: moving someone's permissions to an
-- address of the caller's choosing is not a thing a session may do directly.

create or replace function public.rekey_user_email(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old text := lower(trim(p_old));
  v_new text := lower(trim(p_new));
begin
  if v_old = '' or v_new = '' or v_old = v_new then
    return;
  end if;
  if exists (select 1 from public.user_access where lower(user_email) = v_new)
     or exists (select 1 from public.user_email_permission_overrides where lower(user_email) = v_new) then
    raise exception 'Access is already recorded under %, so it cannot be moved there.', v_new
      using errcode = '23505';
  end if;

  insert into public.user_access
  select (jsonb_populate_record(null::public.user_access, to_jsonb(ua) || jsonb_build_object('user_email', v_new))).*
    from public.user_access ua
   where lower(ua.user_email) = v_old;

  update public.user_permissions        set user_email = v_new where lower(user_email) = v_old;
  update public.user_screen_permissions set user_email = v_new where lower(user_email) = v_old;
  update public.user_access_locations   set user_email = v_new where lower(user_email) = v_old;

  delete from public.user_access where lower(user_email) = v_old;

  update public.user_email_permission_overrides set user_email = v_new where lower(user_email) = v_old;
end;
$$;

comment on function public.rekey_user_email(text, text) is
  'Moves a person''s personal access (user_access + its three children, and permission overrides) from one email to '
  'another in one transaction (0687). History tables are untouched. Service role only.';

revoke all on function public.rekey_user_email(text, text) from public, anon, authenticated;
grant execute on function public.rekey_user_email(text, text) to service_role;

do $$
begin
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'rekey_user_email'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception '0687: rekey_user_email is executable by a session role';
  end if;
end $$;
