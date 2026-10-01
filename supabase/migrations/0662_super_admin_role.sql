-- ============================================================================
-- 0662 · SUPER ADMIN IS A ROLE YOU CAN SEE AND ASSIGN
-- ============================================================================
--
-- User 2026-09-30: "create a super admin role — now it's not listing in role".
-- Super admin was only ever a flag on the login (`profiles.is_super_admin`,
-- 0001), set by hand in the database: invisible on Access Control ▸ By Role,
-- invisible on the Users screen, and impossible to give or take away from the
-- app. This makes it a role — and keeps the flag, because the flag is what
-- every guard reads (`has_permission`, RLS, `permissionAllows`, role preview).
--
-- ONE FACT, TWO SPELLINGS, KEPT IN STEP BY A TRIGGER. Holding the "Super Admin"
-- role ⇔ `is_super_admin = true`. Assigning the role sets the flag; removing
-- it clears the flag. The role also carries every permission, so a screen that
-- reads role permissions (rather than the flag) answers the same way.
--
-- TWO GUARDS, because this role is the one that can do everything:
--   - ONLY A SUPER ADMIN may give or remove it. `assignRole` needs just
--     system_admin:edit, which the Administrator role holds — without this, any
--     administrator could promote themselves past every lock in the app. A
--     statement with no signed-in user (migrations, the service role) is
--     trusted, as everywhere else.
--   - THE LAST SUPER ADMIN CANNOT BE REMOVED, or nobody could ever assign it
--     again from the app.
--
-- Backfill: every profile already flagged gets the role, so the list tells
-- the truth on day one.
-- ============================================================================

insert into public.roles (name, description, is_system)
select 'Super Admin', 'Full access to every module and screen, including Access Control. Only a super admin can give or remove this role.', true
where not exists (select 1 from public.roles where name = 'Super Admin');

-- Every permission (the flag already bypasses checks; this keeps role-based
-- readers — e.g. users_with_permission's role branch — consistent).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r cross join public.permissions p
 where r.name = 'Super Admin'
on conflict do nothing;

create or replace function public.super_admin_role_id()
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select id from public.roles where name = 'Super Admin' limit 1;
$$;

revoke all on function public.super_admin_role_id() from public, anon;
grant execute on function public.super_admin_role_id() to authenticated, service_role;

-- Guard: who may touch a Super Admin assignment, and never the last one.
create or replace function public.guard_super_admin_role()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role uuid := public.super_admin_role_id();
  v_user uuid;
  v_left int;
begin
  if coalesce(new.role_id, old.role_id) is distinct from v_role then
    return coalesce(new, old);
  end if;
  if auth.uid() is not null
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_super_admin) then
    raise exception 'Only a super admin can give or remove the Super Admin role.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    v_user := old.user_id;
    select count(distinct p.id) into v_left
      from public.profiles p
     where p.is_super_admin and p.id <> v_user and coalesce(p.is_active, true);
    if v_left = 0 then
      raise exception 'This is the last super admin — give the role to someone else first.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- Sync: the role and the flag are the same fact.
create or replace function public.sync_super_admin_flag()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role uuid := public.super_admin_role_id();
begin
  if tg_op = 'INSERT' and new.role_id = v_role then
    update public.profiles set is_super_admin = true where id = new.user_id and not is_super_admin;
  elsif tg_op = 'DELETE' and old.role_id = v_role then
    -- Cleared only when no other Super Admin assignment (another location) remains.
    if not exists (select 1 from public.user_roles ur where ur.user_id = old.user_id and ur.role_id = v_role) then
      update public.profiles set is_super_admin = false where id = old.user_id and is_super_admin;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.guard_super_admin_role() from public, anon, authenticated;
revoke all on function public.sync_super_admin_flag() from public, anon, authenticated;

drop trigger if exists trg_user_roles_super_admin_guard on public.user_roles;
create trigger trg_user_roles_super_admin_guard
  before insert or update or delete on public.user_roles
  for each row execute function public.guard_super_admin_role();

drop trigger if exists trg_user_roles_super_admin_sync on public.user_roles;
create trigger trg_user_roles_super_admin_sync
  after insert or delete on public.user_roles
  for each row execute function public.sync_super_admin_flag();

-- Backfill: the flagged logins hold the role.
insert into public.user_roles (user_id, role_id, location_id)
select p.id, public.super_admin_role_id(), null
  from public.profiles p
 where p.is_super_admin
   and not exists (
     select 1 from public.user_roles ur where ur.user_id = p.id and ur.role_id = public.super_admin_role_id()
   );
