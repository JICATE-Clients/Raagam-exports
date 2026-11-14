-- 0842 — moving a person's access onto an email that ALREADY has access set
--        up MERGES into it instead of refusing (user 2026-11-14).
--
-- THE BUG: MAHA.S's login was made under a typo (mahasanjal6382@…). The
-- operator then set units on the RIGHT address (mahasanjai6382@…, no login
-- yet) and corrected HR. The next invite brings the login onto the HR email
-- (`syncLoginEmailFromHr`) and calls this function — which refused outright:
--   "Access is already recorded under mahasanjai6382@gmail.com, so it cannot
--    be moved there."
-- The refusal protected nothing. The action has already checked that no OTHER
-- login holds the new address, so an access row under it can only be setup
-- done in advance for this same person (0661: access is keyed by email so it
-- can be set before the first sign-in). Two halves of one person's access,
-- and the way out was to delete one by hand.
--
-- THE MERGE — nothing is dropped:
--   - user_access: the target row stays; is_active and all_locations are OR-ed
--     (neither half widens the person past what one of them already had);
--   - units, module grants, screen grants, blocks: moved, a row the target
--     already has is kept as it is (same primary key = same fact);
--   - permission overrides (unique per email + module): moved where the target
--     has none for that module; where both have one, the target's stands and
--     the old one stays under the old email, unreachable but not destroyed —
--     a grant is an audited decision and is not merged by guesswork.
--
-- ALSO FIXED: 0687 predates user_screen_blocks (0840). Its final delete of the
-- old parent CASCADED the person's blocks away instead of moving them.
--
-- Same grants as 0687: service role only.

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

  if exists (select 1 from public.user_access where user_email = v_old) then
    if exists (select 1 from public.user_access where user_email = v_new) then
      update public.user_access n
         set is_active     = n.is_active or o.is_active,
             all_locations = n.all_locations or o.all_locations,
             note          = coalesce(n.note, o.note)
        from public.user_access o
       where n.user_email = v_new and o.user_email = v_old;
    else
      insert into public.user_access
      select (jsonb_populate_record(null::public.user_access, to_jsonb(ua) || jsonb_build_object('user_email', v_new))).*
        from public.user_access ua
       where ua.user_email = v_old;
    end if;

    -- Children: copy what the target lacks; the old parent's delete cascades the rest away.
    insert into public.user_access_locations
    select (jsonb_populate_record(null::public.user_access_locations, to_jsonb(c) || jsonb_build_object('user_email', v_new))).*
      from public.user_access_locations c where c.user_email = v_old
    on conflict do nothing;

    insert into public.user_permissions
    select (jsonb_populate_record(null::public.user_permissions, to_jsonb(c) || jsonb_build_object('user_email', v_new))).*
      from public.user_permissions c where c.user_email = v_old
    on conflict do nothing;

    insert into public.user_screen_permissions
    select (jsonb_populate_record(null::public.user_screen_permissions, to_jsonb(c) || jsonb_build_object('user_email', v_new))).*
      from public.user_screen_permissions c where c.user_email = v_old
    on conflict do nothing;

    insert into public.user_screen_blocks
    select (jsonb_populate_record(null::public.user_screen_blocks, to_jsonb(c) || jsonb_build_object('user_email', v_new))).*
      from public.user_screen_blocks c where c.user_email = v_old
    on conflict do nothing;

    delete from public.user_access where user_email = v_old;
  end if;

  update public.user_email_permission_overrides o
     set user_email = v_new
   where lower(o.user_email) = v_old
     and not exists (
       select 1 from public.user_email_permission_overrides t
        where lower(t.user_email) = v_new and t.module_key = o.module_key
     );
end;
$$;

comment on function public.rekey_user_email(text, text) is
  'Moves a person''s personal access (user_access + units, grants, screen grants, blocks, and permission overrides) '
  'from one email to another in one transaction; MERGES into access already set up under the new email (0842, was a '
  'refusal in 0687). History tables are untouched. Service role only.';

revoke all on function public.rekey_user_email(text, text) from public, anon, authenticated;
grant execute on function public.rekey_user_email(text, text) to service_role;

do $$
begin
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'rekey_user_email'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception '0842: rekey_user_email is executable by a session role';
  end if;
end $$;
