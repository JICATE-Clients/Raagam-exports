-- ============================================================================
-- 0660 · WHO AN ALERT REACHES (notification audit, 2026-09-30)
-- ============================================================================
--
-- The audit found the push pipeline itself sound and its ROUTING failing in
-- three quiet ways. This migration fixes the SQL half of each; the app half is
-- in lib/notifications/notify.ts and lib/orders/work-flow/sweep.ts.
--
-- 1. AN EMPLOYEE REACHED A LOGIN ONLY BY `employee_code`, AND NO LOGIN HAD ONE.
--    Orders name their merchandiser as an EMPLOYEE (0478); an alert needs a
--    PROFILE. 0654 and the Work Flow sweep joined the two on
--    `profiles.employee_code = employees.code` alone — 0 of 2 profiles carried a
--    code on 2026-09-30, so every merchandiser alert went nowhere. Logins are
--    now made from HR ▸ Staff (Users screen), whose code need not equal the old
--    Employee master's. `employee_login_ids()` is the ONE resolver: code first,
--    then the email both records carry — the same person under either master.
--
-- 2. `users_with_permission` READ ROLES ONLY. 0658 added email-based access
--    (a person's own grants, Active/Inactive) and every screen honours it, but
--    "tell everyone who can approve X" still skipped them. It also counted
--    deactivated logins, as did `users_with_role`. Both now answer only for
--    ACTIVE profiles, and the permission one unions ACTIVE email access.
--
-- 3. AN ALERT WITH NO RECIPIENT VANISHED. `notify()` returned on an empty list,
--    so "New order → CAD Technician" with nobody holding that role told no one,
--    and the sweep counted such alerts as `unrouted` and dropped them.
--    `notification_fallback_recipients()` names who hears about an alert that
--    would otherwise reach nobody: holders of the Administrator role and super
--    admins (user 2026-09-30, "respective user … admin, super admin"). Only the
--    UNROUTED ones — copying admins on every alert is the fastest way to teach
--    them to ignore the buzz.
--
-- All four are SECURITY DEFINER because they read `profiles`, which a user may
-- only read for themselves; each returns ids and nothing else. Called by the
-- service role from notify(); execute revoked from public, anon (STANDING).
-- ============================================================================

create or replace function public.employee_login_ids(p_employees uuid[])
returns table(employee_id uuid, profile_id uuid)
language sql
stable
security definer
set search_path to ''
as $$
  select distinct on (e.id) e.id, p.id
    from public.employees e
    join public.profiles p
      on coalesce(p.is_active, true)
     and (
          (nullif(btrim(p.employee_code), '') is not null
           and lower(btrim(p.employee_code)) = lower(btrim(e.code)))
       or (nullif(btrim(p.email), '') is not null
           and lower(btrim(p.email)) = lower(btrim(e.email)))
     )
   where e.id = any(p_employees)
   -- a code match outranks an email match when both find someone
   order by e.id,
            (lower(btrim(coalesce(p.employee_code, ''))) = lower(btrim(coalesce(e.code, '')))) desc;
$$;

comment on function public.employee_login_ids(uuid[]) is
  '0660: employee → active login profile, by employee code then by email. The one resolver every alert to a named employee (merchandiser, milestone owner) goes through.';

revoke all on function public.employee_login_ids(uuid[]) from public, anon;
grant execute on function public.employee_login_ids(uuid[]) to authenticated, service_role;

-- 0654 re-stated over the resolver, so a merchandiser whose login was made
-- from HR ▸ Staff (matching by email) is reached as well.
create or replace function public.order_budget_merchandiser_profiles(p_budget uuid)
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $$
  select distinct l.profile_id
    from public.order_budget_orders o
    join public.garment_order_amendments a on a.id = o.garment_order_id
    cross join lateral public.employee_login_ids(array[a.merchandiser_id]) l
   where o.budget_id = p_budget
     and a.merchandiser_id is not null;
$$;

comment on function public.order_budget_merchandiser_profiles(uuid) is
  '0654 / 0660: the active login profiles of the merchandisers of a budget''s orders (employee_login_ids: code, then email). Ids only; used to send the MD''s decision to the merchandiser.';

revoke all on function public.order_budget_merchandiser_profiles(uuid) from public, anon;
grant execute on function public.order_budget_merchandiser_profiles(uuid) to authenticated, service_role;

-- 0040 re-stated: active logins only.
create or replace function public.users_with_role(p_name text)
returns table(user_id uuid)
language sql
stable
security definer
set search_path to ''
as $$
  select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id and coalesce(p.is_active, true)
   where r.name = p_name;
$$;

revoke all on function public.users_with_role(text) from public, anon;
grant execute on function public.users_with_role(text) to authenticated, service_role;

-- 0040 re-stated: active logins only, and ACTIVE email access (0658) counts.
create or replace function public.users_with_permission(p_module text, p_action text)
returns table(user_id uuid)
language sql
stable
security definer
set search_path to ''
as $$
  select ur.user_id
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions pm on pm.id = rp.permission_id
    join public.profiles p on p.id = ur.user_id and coalesce(p.is_active, true)
   where pm.module = p_module and pm.action = p_action
  union
  select p.id
    from public.user_permissions up
    join public.user_access ua on ua.user_email = up.user_email and ua.is_active
    join public.profiles p on lower(btrim(p.email)) = up.user_email and coalesce(p.is_active, true)
   where up.module = p_module and up.action = p_action
  union
  select p.id from public.profiles p where p.is_super_admin and coalesce(p.is_active, true);
$$;

revoke all on function public.users_with_permission(text, text) from public, anon;
grant execute on function public.users_with_permission(text, text) to authenticated, service_role;

create or replace function public.notification_fallback_recipients()
returns table(user_id uuid)
language sql
stable
security definer
set search_path to ''
as $$
  select ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.name = 'Administrator'
    join public.profiles p on p.id = ur.user_id and coalesce(p.is_active, true)
  union
  select p.id from public.profiles p where p.is_super_admin and coalesce(p.is_active, true);
$$;

comment on function public.notification_fallback_recipients() is
  '0660: who is told about an alert that would otherwise reach nobody — Administrator role holders and super admins (active only).';

revoke all on function public.notification_fallback_recipients() from public, anon;
grant execute on function public.notification_fallback_recipients() to service_role;
