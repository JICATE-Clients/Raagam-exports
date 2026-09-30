-- ============================================================================
-- 0658 · SCREEN-LEVEL PERMISSIONS — roles AND email-based access
-- ============================================================================
--
-- User 2026-09-30 (screenshots 3141/3142, MyJKKN's Create Role ▸ Permissions):
-- permissions as a tree Module → Sub-module → Screen, toggled per screen,
-- enforced at menu / page / button level; and ONE Access Control screen that
-- gives access two ways over the same tree — BY ROLE and BY USER (email-based,
-- "the role based system also will work like same without any issue").
--
-- DATABASE RULES STAY PER MODULE (the user's choice). RLS on the ~450 tables
-- is untouched; `has_permission()` gains exactly one OR clause — active email
-- access — so a person granted a module by email can reach its data, just as a
-- role holder can. Nothing any role can do today changes.
--
-- ── THE MEANING, the same for a role and for a person's email access ────────
--   No screen row for a module  → MODULE MODE: every screen follows the module
--                                 grant, exactly as roles work today. Every role
--                                 that exists has no screen row, so every role
--                                 behaves exactly as it did.
--   Screen rows for a module    → SCREEN MODE: only granted screen / action
--                                 pairs are allowed there. Its module rows are
--                                 kept = "any screen grants this action", so RLS
--                                 (module grain) still lets the data through.
--
-- ── EMAIL ACCESS IS A PERSONAL ROLE ─────────────────────────────────────────
--   user_access            (user_email, is_active) — NO DATES: an Active /
--                          Inactive switch per person (user: "for user active
--                          inactive stat no date"). Inactive = none of it counts.
--   user_permissions       (user_email, module, action)      ≈ role_permissions
--   user_screen_permissions(user_email, module, screen, action) ≈ role_screen_permissions
--   user_access_history    append-only: every save and every switch, with the
--                          tree as saved and who did it.
--   Emails are stored lower-cased and trimmed; a deactivated login holds nothing.
--
-- The screen catalog (lib/permissions/screen-catalog.ts) is TypeScript — it is
-- derived from the app's registries — so every screen row carries its
-- `module`, and the SQL never needs the catalog. The TypeScript save actions
-- validate screen keys against the catalog before these functions see them.
-- ============================================================================

-- ─── 1. Role screen rows ────────────────────────────────────────────────────

create table if not exists public.role_screen_permissions (
  role_id    uuid not null references public.roles(id) on delete cascade,
  module     text not null,
  screen_key text not null check (screen_key like '/%'),
  action     text not null check (action in ('view', 'create', 'edit', 'delete', 'approve', 'export')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (role_id, screen_key, action)
);
create index if not exists idx_rsp_role_module on public.role_screen_permissions (role_id, module);

-- ─── 2. Email access ────────────────────────────────────────────────────────

create table if not exists public.user_access (
  user_email text primary key check (user_email <> '' and user_email = lower(btrim(user_email))),
  is_active  boolean not null default true,
  note       text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_permissions (
  user_email text not null references public.user_access(user_email) on delete cascade,
  module     text not null,
  action     text not null check (action in ('view', 'create', 'edit', 'delete', 'approve', 'export')),
  primary key (user_email, module, action)
);
create index if not exists idx_up_module_action on public.user_permissions (module, action);

create table if not exists public.user_screen_permissions (
  user_email text not null references public.user_access(user_email) on delete cascade,
  module     text not null,
  screen_key text not null check (screen_key like '/%'),
  action     text not null check (action in ('view', 'create', 'edit', 'delete', 'approve', 'export')),
  primary key (user_email, screen_key, action)
);
create index if not exists idx_usp_email_module on public.user_screen_permissions (user_email, module);

create table if not exists public.user_access_history (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null,
  action      text not null check (action in ('SAVE', 'ACTIVATE', 'DEACTIVATE')),
  is_active   boolean not null,
  tree        jsonb,
  actor_id    uuid,
  actor_email text,
  at          timestamptz not null default clock_timestamp()
);
create index if not exists idx_uah_email on public.user_access_history (user_email, at);

create or replace function public.user_access_history_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'user_access_history is an audit log — rows cannot be changed or removed' using errcode = 'P0001';
end;
$$;
drop trigger if exists trg_uah_immutable on public.user_access_history;
create trigger trg_uah_immutable before update or delete on public.user_access_history
  for each row execute function public.user_access_history_immutable();

-- The caller's own email as these tables store it; NULL for an inactive login.
-- (0650's my_override_email() says the same; this name reads right here too.)
create or replace function public.my_access_email()
returns text language sql stable security definer set search_path = '' as $$
  select lower(btrim(p.email)) from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

-- ─── 3. RLS: read by admins (and your own), write by nobody directly ────────

alter table public.role_screen_permissions enable row level security;
alter table public.user_access              enable row level security;
alter table public.user_permissions         enable row level security;
alter table public.user_screen_permissions  enable row level security;
alter table public.user_access_history      enable row level security;

drop policy if exists rsp_read on public.role_screen_permissions;
create policy rsp_read on public.role_screen_permissions for select
  using (public.has_permission('system_admin', 'view'));
drop policy if exists ua_read on public.user_access;
create policy ua_read on public.user_access for select
  using (public.has_permission('system_admin', 'view') or user_email = public.my_access_email());
drop policy if exists up_read on public.user_permissions;
create policy up_read on public.user_permissions for select
  using (public.has_permission('system_admin', 'view') or user_email = public.my_access_email());
drop policy if exists usp_read on public.user_screen_permissions;
create policy usp_read on public.user_screen_permissions for select
  using (public.has_permission('system_admin', 'view') or user_email = public.my_access_email());
drop policy if exists uah_read on public.user_access_history;
create policy uah_read on public.user_access_history for select
  using (public.has_permission('system_admin', 'view'));

do $$
declare t text;
begin
  foreach t in array array['role_screen_permissions', 'user_access', 'user_permissions',
                           'user_screen_permissions', 'user_access_history'] loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ─── 4. The three readers, now counting active email access ─────────────────

-- has_permission: 0001's body, verbatim, plus active email access. This is the
-- function every RLS policy calls, so a person granted a module by email
-- reaches its data exactly as a role holder does. Strictly additive.
create or replace function public.has_permission(
  p_module text, p_action text, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin(uid) or exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = uid and p.module = p_module and p.action = p_action
  ) or exists (
    select 1
    from public.profiles pr
    join public.user_access ua on ua.user_email = lower(btrim(pr.email)) and ua.is_active
    join public.user_permissions up on up.user_email = ua.user_email
    where pr.id = uid and pr.is_active and up.module = p_module and up.action = p_action
  );
$$;

-- my_permissions: 0003's body, verbatim, plus active email access — the
-- module-grain ceiling `getAppUser()` loads.
create or replace function public.my_permissions()
returns table(module text, action text)
language sql stable security definer set search_path = '' as $$
  select distinct p.module, p.action
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where ur.user_id = auth.uid()
  union
  select up.module, up.action
  from public.user_access ua
  join public.user_permissions up on up.user_email = ua.user_email
  where ua.is_active and ua.user_email = public.my_access_email();
$$;

-- The caller's screen facts, from BOTH sources, in the shapes the app needs:
--   kind 'module'  key 'module:action'     — granted module-wide by a source
--                                            (a role, or the email access) in
--                                            MODULE MODE for that module
--   kind 'screen'  key 'screen_key|action' — granted to one screen by a source
--                                            in SCREEN MODE for its module
create or replace function public.my_screen_permissions()
returns table (kind text, key text)
language sql stable security definer set search_path = '' as $$
  with my_roles as (
    select distinct ur.role_id from public.user_roles ur where ur.user_id = auth.uid()
  ),
  me as (
    select ua.user_email from public.user_access ua
     where ua.is_active and ua.user_email = public.my_access_email()
  )
  select 'module'::text, p.module || ':' || p.action
    from my_roles r
    join public.role_permissions rp on rp.role_id = r.role_id
    join public.permissions p on p.id = rp.permission_id
   where not exists (select 1 from public.role_screen_permissions s
                      where s.role_id = r.role_id and s.module = p.module)
  union
  select 'screen'::text, s.screen_key || '|' || s.action
    from my_roles r
    join public.role_screen_permissions s on s.role_id = r.role_id
  union
  select 'module'::text, up.module || ':' || up.action
    from me
    join public.user_permissions up on up.user_email = me.user_email
   where not exists (select 1 from public.user_screen_permissions s
                      where s.user_email = me.user_email and s.module = up.module)
  union
  select 'screen'::text, s.screen_key || '|' || s.action
    from me
    join public.user_screen_permissions s on s.user_email = me.user_email;
$$;

-- ─── 5. The saves — a whole tree, in ONE transaction ────────────────────────
--
-- `p_tree` is an array, one element per module held (a module absent = nothing):
--   { "module": "materials_purchase", "mode": "module", "actions": ["view","create"] }
--   { "module": "orders", "mode": "screen",
--     "grants": [ { "screen": "/orders/budgets", "action": "view" }, … ] }
-- Module rows are written only for (module, action) pairs the permission
-- catalog has; a screen-mode module's module rows = the distinct actions its
-- grants use (the kept OR, so RLS lets the data through).

create or replace function public.save_role_permissions(p_role uuid, p_tree jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb;
  v_module text;
begin
  if not public.has_permission('system_admin', 'edit') then
    raise exception 'Only an administrator can change role permissions.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.roles where id = p_role) then
    raise exception 'That role no longer exists.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_tree, '[]'::jsonb)) <> 'array' then
    raise exception 'The permission tree must be a list of modules.' using errcode = 'P0001';
  end if;

  delete from public.role_screen_permissions where role_id = p_role;
  delete from public.role_permissions where role_id = p_role;

  for m in select * from jsonb_array_elements(coalesce(p_tree, '[]'::jsonb)) loop
    v_module := m ->> 'module';
    if v_module is null then continue; end if;
    if m ->> 'mode' = 'screen' then
      insert into public.role_screen_permissions (role_id, module, screen_key, action)
      select distinct p_role, v_module, g ->> 'screen', g ->> 'action'
        from jsonb_array_elements(coalesce(m -> 'grants', '[]'::jsonb)) g
       where (g ->> 'screen') like '/%'
         and (g ->> 'action') in ('view', 'create', 'edit', 'delete', 'approve', 'export')
      on conflict do nothing;
      insert into public.role_permissions (role_id, permission_id)
      select p_role, p.id from public.permissions p
       where p.module = v_module
         and p.action in (select distinct g ->> 'action' from jsonb_array_elements(coalesce(m -> 'grants', '[]'::jsonb)) g)
      on conflict do nothing;
    else
      insert into public.role_permissions (role_id, permission_id)
      select p_role, p.id from public.permissions p
       where p.module = v_module
         and p.action in (select jsonb_array_elements_text(coalesce(m -> 'actions', '[]'::jsonb)))
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

-- A person's email access: the tree, the Active switch, one history row.
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
  select count(*), (array_agg(p.id))[1] into v_n, v_target
    from public.profiles p where lower(btrim(p.email)) = v_email;
  if v_n = 0 then
    raise exception 'No user has the email %.', v_email using errcode = 'P0001';
  elsif v_n > 1 then
    raise exception 'More than one user has the email % — correct the user list first.', v_email using errcode = 'P0001';
  end if;
  -- Your own access is set by another administrator, never by yourself.
  if v_target = auth.uid() then
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

-- ─── Grants (STANDING: always `from public, anon`) ──────────────────────────
revoke all on function public.user_access_history_immutable()                  from public, anon, authenticated;
revoke all on function public.my_access_email()                                from public, anon;
revoke all on function public.has_permission(text, text, uuid)                 from public, anon;
revoke all on function public.my_permissions()                                 from public, anon;
revoke all on function public.my_screen_permissions()                          from public, anon;
revoke all on function public.save_role_permissions(uuid, jsonb)               from public, anon;
revoke all on function public.save_user_permissions(text, jsonb, boolean, text) from public, anon;

grant execute on function public.my_access_email()                                to authenticated;
grant execute on function public.has_permission(text, text, uuid)                 to authenticated;
grant execute on function public.my_permissions()                                 to authenticated;
grant execute on function public.my_screen_permissions()                          to authenticated;
grant execute on function public.save_role_permissions(uuid, jsonb)               to authenticated;
grant execute on function public.save_user_permissions(text, jsonb, boolean, text) to authenticated;

-- ─── Self-check: nobody's answer changed ────────────────────────────────────
-- No email access exists yet and no role has screen rows, so for EVERY user
-- and EVERY (module, action), has_permission must answer as 0001's body did.
do $$
declare v_diff int;
begin
  select count(*) into v_diff
    from public.profiles pr
    cross join public.permissions p
   where public.has_permission(p.module, p.action, pr.id)
         is distinct from (public.is_super_admin(pr.id) or exists (
           select 1 from public.user_roles ur
             join public.role_permissions rp on rp.role_id = ur.role_id
             join public.permissions p2 on p2.id = rp.permission_id
            where ur.user_id = pr.id and p2.module = p.module and p2.action = p.action));
  if v_diff > 0 then
    raise exception '0658: has_permission changed its answer for % (user, permission) pairs', v_diff;
  end if;
end $$;
