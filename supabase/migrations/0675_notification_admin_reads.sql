-- ============================================================================
-- Raagam ERP — 0675 Notification management, Phase 1: what an administrator
-- may READ (doc/admin/notification-management-plan.md §3, §5).
--
-- THE ADMIN READS THROUGH THESE FUNCTIONS, NEVER THROUGH A WIDER POLICY.
-- `notifications` is published to Realtime, and Realtime enforces its SELECT
-- policy row by row: a policy that let an admin select everyone's rows would
-- stream every alert in the company into every open admin tab. `profiles` and
-- `push_subscriptions` are own-row tables for the same kind of reason. So each
-- read below is SECURITY DEFINER, checks `system_admin:view` itself, and
-- returns only the columns the screen draws.
--
-- `notification_dispatches` needs none of this: 0673 already gives it a
-- `system_admin:view` select policy and it is not in the Realtime publication.
--
-- ADD-ONLY. Grants: revoke from public, anon (Function grants rule).
-- ============================================================================

-- ─── People: who can be reached, and on how many devices ────────────────────
create or replace function public.notification_admin_people()
returns table(
  user_id         uuid,
  full_name       text,
  email           text,
  is_active       boolean,
  roles           text,
  device_count    int,
  last_push_ok_at timestamptz
)
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not public.has_permission('system_admin', 'view') then
    raise exception 'Not allowed: Administration ▸ View is required' using errcode = '42501';
  end if;
  return query
    select p.id,
           p.full_name,
           p.email,
           coalesce(p.is_active, true),
           (select string_agg(r.name, ', ' order by r.name)
              from public.user_roles ur join public.roles r on r.id = ur.role_id
             where ur.user_id = p.id),
           (select count(*)::int from public.push_subscriptions s where s.user_id = p.id),
           (select max(s.last_success_at) from public.push_subscriptions s where s.user_id = p.id)
      from public.profiles p
     order by coalesce(p.is_active, true) desc, p.full_name nulls last, p.email;
end;
$$;

-- ─── Devices: every registered push endpoint ────────────────────────────────
create or replace function public.notification_admin_devices()
returns table(
  id              uuid,
  user_id         uuid,
  full_name       text,
  email           text,
  user_agent      text,
  created_at      timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   int,
  last_error      text
)
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not public.has_permission('system_admin', 'view') then
    raise exception 'Not allowed: Administration ▸ View is required' using errcode = '42501';
  end if;
  return query
    select s.id, s.user_id, p.full_name, p.email, s.user_agent, s.created_at,
           s.last_success_at, s.last_failure_at, s.failure_count, s.last_error
      from public.push_subscriptions s
      join public.profiles p on p.id = s.user_id
     -- Failing devices first: they are the reason anyone opens this list.
     order by s.failure_count desc, s.created_at;
end;
$$;

-- ─── Per-event counts since a moment ────────────────────────────────────────
create or replace function public.notification_event_stats(p_since timestamptz)
returns table(
  event_key     text,
  dispatches    int,
  delivered     int,   -- reached someone (incl. by fallback)
  recipients    int,
  fell_back     int,
  no_recipients int,
  disabled      int,
  push_failed   int,
  last_sent_at  timestamptz
)
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not public.has_permission('system_admin', 'view') then
    raise exception 'Not allowed: Administration ▸ View is required' using errcode = '42501';
  end if;
  return query
    select d.event_key,
           count(*)::int,
           count(*) filter (where d.suppressed is null and d.recipient_count > 0)::int,
           coalesce(sum(d.recipient_count), 0)::int,
           count(*) filter (where d.fallback_used)::int,
           count(*) filter (where d.suppressed = 'no_recipients')::int,
           count(*) filter (where d.suppressed = 'disabled')::int,
           coalesce(sum(d.push_failed), 0)::int,
           max(d.created_at) filter (where d.suppressed is null and d.recipient_count > 0)
      from public.notification_dispatches d
     where d.created_at >= p_since
     group by d.event_key;
end;
$$;

-- ─── One dispatch's recipients, and whether each has read it ────────────────
create or replace function public.notification_dispatch_recipients(p_dispatch uuid)
returns table(user_id uuid, full_name text, email text, read_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not public.has_permission('system_admin', 'view') then
    raise exception 'Not allowed: Administration ▸ View is required' using errcode = '42501';
  end if;
  return query
    select n.user_id, p.full_name, p.email, n.read_at
      from public.notifications n
      left join public.profiles p on p.id = n.user_id
     where n.dispatch_id = p_dispatch
     order by p.full_name nulls last;
end;
$$;

revoke all on function public.notification_admin_people()                   from public, anon;
revoke all on function public.notification_admin_devices()                  from public, anon;
revoke all on function public.notification_event_stats(timestamptz)         from public, anon;
revoke all on function public.notification_dispatch_recipients(uuid)        from public, anon;
grant execute on function public.notification_admin_people()                to authenticated;
grant execute on function public.notification_admin_devices()               to authenticated;
grant execute on function public.notification_event_stats(timestamptz)      to authenticated;
grant execute on function public.notification_dispatch_recipients(uuid)     to authenticated;
