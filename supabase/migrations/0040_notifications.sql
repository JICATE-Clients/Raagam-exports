-- ============================================================================
-- Raagam ERP — 0040 Notifications (in-app + web push)
-- User-owned notification rows (live via Supabase Realtime) + per-device web
-- push subscriptions. Notifications are inserted server-side (service role /
-- notify()); users can only read + mark-read their OWN rows. Fan-out helpers
-- resolve a role or a permission to the set of recipient user_ids.
-- ADD-ONLY: introduces new tables/functions; touches nothing existing.
-- ============================================================================

-- ---------- notifications ---------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  body       text,
  href       text,
  type       text not null default 'info'
             check (type in ('info', 'success', 'warning', 'danger')),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Read + mark-read your own notifications only. No INSERT policy: rows are
-- created server-side via the service-role client (see lib/notifications/notify.ts).
create policy notifications_select_own on public.notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy notifications_update_own on public.notifications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Enable Realtime so open tabs receive INSERT/UPDATE for their own rows
-- (Realtime enforces the select policy above → users only get their own rows).
alter publication supabase_realtime add table public.notifications;

-- ---------- push_subscriptions ---------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------- recipient resolution (for notify() fan-out) ---------------------
-- All user_ids that hold a given role by name.
create or replace function public.users_with_role(p_name text)
returns table(user_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where r.name = p_name;
$$;
revoke execute on function public.users_with_role(text) from public, anon;
grant  execute on function public.users_with_role(text) to authenticated;

-- All user_ids that can perform module:action (role-granted OR super admin).
create or replace function public.users_with_permission(p_module text, p_action text)
returns table(user_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where p.module = p_module and p.action = p_action
  union
  select id from public.profiles where is_super_admin = true;
$$;
revoke execute on function public.users_with_permission(text, text) from public, anon;
grant  execute on function public.users_with_permission(text, text) to authenticated;
