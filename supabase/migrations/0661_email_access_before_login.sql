-- ============================================================================
-- 0661 · EMAIL ACCESS CAN BE GIVEN BEFORE THE LOGIN EXISTS
-- ============================================================================
--
-- User 2026-09-30 (screenshot 3158): Access Control ▸ By User had no way to
-- ALLOCATE email access — it listed only people who already had a login, and
-- `save_user_permissions` (0658) refused any email no profile carried ("No
-- user has the email …"). Staff now come from HR ▸ Staff (78 imported the same
-- day), most with no login yet, so the admin could not set up what a person
-- may do until after they had signed in with nothing.
--
-- Email access is keyed by EMAIL on purpose (0658), and every reader —
-- `my_access_email()`, `has_permission`, `my_permissions`,
-- `my_screen_permissions`, `users_with_permission` (0660) — joins it to a
-- profile by that email at READ time. So a row saved ahead of the login simply
-- starts counting the first time a profile with that email exists: nothing to
-- migrate, nothing to re-link.
--
-- What changes: no profile is now allowed (the email must at least look like
-- one). What does not: more than one profile on an email is still refused, and
-- nobody may change their own access. Body otherwise identical to 0658.
-- ============================================================================

create or replace function public.save_user_permissions(
  p_email text, p_tree jsonb, p_active boolean, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_n      int;
  v_target uuid;
  v_was    boolean;
  m        jsonb;
  v_module text;
begin
  if not public.has_permission('system_admin', 'edit') then
    raise exception 'Only an administrator can change a person''s access.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_tree, '[]'::jsonb)) <> 'array' then
    raise exception 'The permission tree must be a list of modules.' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '% is not an email address.', coalesce(nullif(v_email, ''), 'That') using errcode = 'P0001';
  end if;
  select count(*), (array_agg(p.id))[1] into v_n, v_target
    from public.profiles p where lower(btrim(p.email)) = v_email;
  -- 0661: no login yet is fine — the access counts from the first sign-in.
  if v_n > 1 then
    raise exception 'More than one user has the email % — correct the user list first.', v_email using errcode = 'P0001';
  end if;
  -- Your own access is set by another administrator, never by yourself.
  if v_target is not null and v_target = auth.uid() then
    raise exception 'You cannot change your own access.' using errcode = 'P0001';
  end if;

  select ua.is_active into v_was from public.user_access ua where ua.user_email = v_email;
  insert into public.user_access (user_email, is_active, note, updated_by, updated_at)
  values (v_email, coalesce(p_active, true), nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (user_email) do update
     set is_active = excluded.is_active, note = excluded.note,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  delete from public.user_screen_permissions where user_email = v_email;
  delete from public.user_permissions where user_email = v_email;

  for m in select * from jsonb_array_elements(coalesce(p_tree, '[]'::jsonb)) loop
    v_module := m ->> 'module';
    if v_module is null then continue; end if;
    if m ->> 'mode' = 'screen' then
      insert into public.user_screen_permissions (user_email, module, screen_key, action)
      select distinct v_email, v_module, g ->> 'screen', g ->> 'action'
        from jsonb_array_elements(coalesce(m -> 'grants', '[]'::jsonb)) g
       where (g ->> 'screen') like '/%'
         and (g ->> 'action') in ('view', 'create', 'edit', 'delete', 'approve', 'export')
      on conflict do nothing;
      insert into public.user_permissions (user_email, module, action)
      select distinct v_email, p.module, p.action from public.permissions p
       where p.module = v_module
         and p.action in (select distinct g ->> 'action' from jsonb_array_elements(coalesce(m -> 'grants', '[]'::jsonb)) g)
      on conflict do nothing;
    else
      insert into public.user_permissions (user_email, module, action)
      select distinct v_email, p.module, p.action from public.permissions p
       where p.module = v_module
         and p.action in (select jsonb_array_elements_text(coalesce(m -> 'actions', '[]'::jsonb)))
      on conflict do nothing;
    end if;
  end loop;

  insert into public.user_access_history (user_email, action, is_active, tree, actor_id, actor_email)
  values (v_email,
          case when v_was is null or v_was = coalesce(p_active, true) then 'SAVE'
               when coalesce(p_active, true) then 'ACTIVATE' else 'DEACTIVATE' end,
          coalesce(p_active, true), coalesce(p_tree, '[]'::jsonb), auth.uid(),
          (select lower(btrim(p.email)) from public.profiles p where p.id = auth.uid()));
end;
$$;

revoke all on function public.save_user_permissions(text, jsonb, boolean, text) from public, anon;
grant execute on function public.save_user_permissions(text, jsonb, boolean, text) to authenticated;
