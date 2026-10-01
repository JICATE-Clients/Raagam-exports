-- ============================================================================
-- Raagam ERP — 0673 Notification management, Phase 0: every alert gets a NAME
--
-- doc/admin/notification-management-plan.md. Until now an alert's only
-- identity was its title text, so nothing about it could be configured or
-- counted. This adds:
--
--   notification_event_settings  POLICY per event key (on/off, push, CC,
--                                fallback). MEANING lives in
--                                lib/notifications/events.ts; seeded from it
--                                and held to it by check:notification-events.
--   notification_event_cc        people an administrator ADDS to an event.
--                                Additive only: the code's own recipient (the
--                                order's merchandiser…) is never removable.
--   notification_dispatches      ONE row per notify() call — what the code
--                                asked for, who it reached, whether it fell
--                                back, was suppressed, and how push went.
--   notifications.event_key / dispatch_id
--   push_subscriptions.*         per-device success / failure stats.
--
-- ADD-ONLY. Every function: revoke from public, anon (Function grants rule).
-- ============================================================================

-- ─── 1. Event settings ──────────────────────────────────────────────────────
create table if not exists public.notification_event_settings (
  event_key          text primary key,
  -- Copied from the registry, NOT editable (column grants below). It exists
  -- here so the database itself refuses "mandatory and disabled".
  mandatory          boolean not null default false,
  enabled            boolean not null default true,
  push               boolean not null default true,
  email              boolean not null default false,  -- Phase 4; read by nothing yet
  fallback_to_admins boolean not null default true,
  updated_by         uuid references public.profiles(id) on delete set null,
  updated_at         timestamptz not null default now(),
  constraint notification_event_mandatory_enabled check (not mandatory or enabled)
);

comment on table public.notification_event_settings is
  '0673: admin policy per notification event key. Meaning (label, audience, mandatory) is declared in lib/notifications/events.ts; check:notification-events holds the two together.';

alter table public.notification_event_settings enable row level security;

create policy notification_event_settings_select on public.notification_event_settings
  for select to authenticated using (public.has_permission('system_admin', 'view'));
create policy notification_event_settings_update on public.notification_event_settings
  for update to authenticated
  using (public.has_permission('system_admin', 'edit'))
  with check (public.has_permission('system_admin', 'edit'));

-- Rows are created by migrations only; an admin may change the four switches
-- and nothing else — `mandatory` in particular.
revoke all on public.notification_event_settings from anon;
revoke insert, update, delete, truncate on public.notification_event_settings from authenticated;
grant update (enabled, push, email, fallback_to_admins, updated_by, updated_at)
  on public.notification_event_settings to authenticated;

insert into public.notification_event_settings (event_key, mandatory, push, fallback_to_admins) values
  ('approval.pending',              true,  true, true),
  ('approval.revision_pending',     true,  true, true),
  ('approval.decided',              true,  true, true),
  ('approval.sla_reminder',         false, true, true),
  ('approval.sla_escalated',        true,  true, false),
  ('approval.sla_missed',           false, true, false),
  ('cad.new_order',                 false, true, true),
  ('cad.weights_ready',             false, true, true),
  ('cad.pattern_ready',             false, true, true),
  ('order.community_message',       false, true, false),
  ('order.risk',                    false, true, true),
  ('workflow.milestone_overdue',    false, true, true),
  ('workflow.milestones_escalated', false, true, true),
  ('ta.buyer_link',                 false, true, true),
  ('admin.test',                    false, true, false),
  ('admin.broadcast',               false, true, false)
on conflict (event_key) do nothing;

-- ─── 2. CC — people an administrator adds ───────────────────────────────────
create table if not exists public.notification_event_cc (
  id          uuid primary key default gen_random_uuid(),
  event_key   text not null references public.notification_event_settings(event_key) on delete cascade,
  kind        text not null check (kind in ('role', 'user', 'permission')),
  role_id     uuid references public.roles(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  perm_module text,
  perm_action text,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint notification_event_cc_shape check (
    (kind = 'role'       and role_id is not null and user_id is null and perm_module is null) or
    (kind = 'user'       and user_id is not null and role_id is null and perm_module is null) or
    (kind = 'permission' and perm_module is not null and perm_action is not null
                         and role_id is null and user_id is null)
  )
);

create index if not exists idx_notification_event_cc_event on public.notification_event_cc (event_key);

alter table public.notification_event_cc enable row level security;
create policy notification_event_cc_select on public.notification_event_cc
  for select to authenticated using (public.has_permission('system_admin', 'view'));
create policy notification_event_cc_insert on public.notification_event_cc
  for insert to authenticated with check (public.has_permission('system_admin', 'edit'));
create policy notification_event_cc_delete on public.notification_event_cc
  for delete to authenticated using (public.has_permission('system_admin', 'edit'));
revoke all on public.notification_event_cc from anon;
revoke update, truncate on public.notification_event_cc from authenticated;

-- ─── 3. Dispatch log ────────────────────────────────────────────────────────
create table if not exists public.notification_dispatches (
  id              uuid primary key default gen_random_uuid(),
  -- No FK to the settings: the log must outlive an event the registry drops.
  event_key       text not null,
  title           text not null,
  body            text,
  href            text,
  type            text not null default 'info',
  target          jsonb,                       -- what the CODE asked for
  primary_count   int not null default 0,      -- resolved from `target`
  cc_count        int not null default 0,      -- added by notification_event_cc
  recipient_count int not null default 0,      -- rows actually written
  fallback_used   boolean not null default false,
  suppressed      text check (suppressed in ('disabled', 'no_recipients')),
  push_attempted  int not null default 0,
  push_sent       int not null default 0,
  push_failed     int not null default 0,
  push_pruned     int not null default 0,
  error           text,
  source          text not null default 'action' check (source in ('action', 'cron', 'admin')),
  actor_id        uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_notification_dispatches_created on public.notification_dispatches (created_at desc);
create index if not exists idx_notification_dispatches_event   on public.notification_dispatches (event_key, created_at desc);

alter table public.notification_dispatches enable row level security;
create policy notification_dispatches_select on public.notification_dispatches
  for select to authenticated using (public.has_permission('system_admin', 'view'));
-- Written by notify() through the service role only.
revoke all on public.notification_dispatches from anon;
revoke insert, update, delete, truncate on public.notification_dispatches from authenticated;

-- ─── 4. Rows and devices learn where they came from ─────────────────────────
alter table public.notifications
  add column if not exists event_key   text,
  add column if not exists dispatch_id uuid references public.notification_dispatches(id) on delete set null;
create index if not exists idx_notifications_dispatch on public.notifications (dispatch_id);

alter table public.push_subscriptions
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists failure_count   int not null default 0,
  add column if not exists last_error      text;

-- ─── 5. Push outcome — one round trip for every device of a dispatch ────────
create or replace function public.notification_record_push(
  p_dispatch uuid,
  p_ok       uuid[],
  p_failed   uuid[],
  p_pruned   uuid[],
  p_error    text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.push_subscriptions
     set last_success_at = now(), failure_count = 0, last_error = null
   where id = any(coalesce(p_ok, '{}'));

  update public.push_subscriptions
     set last_failure_at = now(), failure_count = failure_count + 1, last_error = p_error
   where id = any(coalesce(p_failed, '{}'));

  -- 404 / 410: the browser dropped the subscription. Same prune notify() did.
  delete from public.push_subscriptions where id = any(coalesce(p_pruned, '{}'));

  if p_dispatch is not null then
    update public.notification_dispatches
       set push_attempted = coalesce(array_length(p_ok, 1), 0) + coalesce(array_length(p_failed, 1), 0)
                          + coalesce(array_length(p_pruned, 1), 0),
           push_sent      = coalesce(array_length(p_ok, 1), 0),
           push_failed    = coalesce(array_length(p_failed, 1), 0),
           push_pruned    = coalesce(array_length(p_pruned, 1), 0)
     where id = p_dispatch;
  end if;
end;
$$;

comment on function public.notification_record_push(uuid, uuid[], uuid[], uuid[], text) is
  '0673: records one dispatch''s web-push outcome — device stats, the 404/410 prune, and the dispatch''s counts — in one call. service_role only.';

revoke all on function public.notification_record_push(uuid, uuid[], uuid[], uuid[], text) from public, anon, authenticated;
grant execute on function public.notification_record_push(uuid, uuid[], uuid[], uuid[], text) to service_role;
