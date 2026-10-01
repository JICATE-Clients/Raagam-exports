-- ============================================================================
-- Raagam ERP — 0677 Notification management, Phase 3: the clocks, and cleanup
-- (doc/admin/notification-management-plan.md §5–§6).
--
--   job_runs                    one row per run of a scheduled job — cron,
--                               a "Run now", or the /approvals net. Until now
--                               the only record of a sweep was a Vercel log
--                               line, so "the SLA sweep last ran three days
--                               ago" was unknowable from inside the app. That
--                               is the failure the SLA section of AGENTS.md
--                               names: nothing escalates and nothing looks
--                               wrong. A job is now LATE on screen.
--   notification_settings       singleton: how long alerts and the logs keep.
--   notification_purge()        the cleanup — run daily by the housekeeping
--                               job, and on demand (with a dry run first) by
--                               an administrator.
--
-- ADD-ONLY. Grants: revoke from public, anon (Function grants rule).
-- ============================================================================

-- ─── Job runs ───────────────────────────────────────────────────────────────
create table if not exists public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,                 -- lib/jobs/registry.ts key
  trigger     text not null check (trigger in ('cron', 'manual', 'opportunistic')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  summary     jsonb,
  error       text,
  actor_id    uuid references public.profiles(id) on delete set null
);

create index if not exists idx_job_runs_job_started on public.job_runs (job, started_at desc);
create index if not exists idx_job_runs_started     on public.job_runs (started_at desc);

alter table public.job_runs enable row level security;
create policy job_runs_select on public.job_runs
  for select to authenticated using (public.has_permission('system_admin', 'view'));
-- Written by the job wrapper through the service role only.
revoke all on public.job_runs from anon;
revoke insert, update, delete, truncate on public.job_runs from authenticated;

-- ─── Retention settings (one row) ───────────────────────────────────────────
create table if not exists public.notification_settings (
  id                      boolean primary key default true check (id),  -- singleton
  read_retention_days     int not null default 90  check (read_retention_days between 7 and 3650),
  unread_retention_days   int not null default 365 check (unread_retention_days between 30 and 3650),
  dispatch_retention_days int not null default 180 check (dispatch_retention_days between 30 and 3650),
  job_run_retention_days  int not null default 90  check (job_run_retention_days between 7 and 3650),
  updated_by              uuid references public.profiles(id) on delete set null,
  updated_at              timestamptz not null default now(),
  -- An unread alert is kept at least as long as a read one: deleting what
  -- someone has not seen yet before what they have is backwards.
  constraint notification_settings_unread_ge_read check (unread_retention_days >= read_retention_days)
);

insert into public.notification_settings (id) values (true) on conflict (id) do nothing;

alter table public.notification_settings enable row level security;
create policy notification_settings_select on public.notification_settings
  for select to authenticated using (public.has_permission('system_admin', 'view'));
create policy notification_settings_update on public.notification_settings
  for update to authenticated
  using (public.has_permission('system_admin', 'edit'))
  with check (public.has_permission('system_admin', 'edit'));
revoke all on public.notification_settings from anon;
revoke insert, update, delete, truncate on public.notification_settings from authenticated;
grant update (read_retention_days, unread_retention_days, dispatch_retention_days,
              job_run_retention_days, updated_by, updated_at)
  on public.notification_settings to authenticated;

-- ─── The cleanup ────────────────────────────────────────────────────────────
-- Called by the housekeeping job (service role) and by an administrator with
-- Administration ▸ Delete. `p_dry_run` counts without deleting, so the screen
-- can say what "Clean up now" would remove before anyone presses it.
create or replace function public.notification_purge(p_dry_run boolean default true)
returns table(read_rows int, unread_rows int, dispatch_rows int, job_run_rows int)
language plpgsql security definer set search_path to ''
as $$
declare
  s public.notification_settings%rowtype;
  v_read int; v_unread int; v_disp int; v_jobs int;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.has_permission('system_admin', 'delete') then
    raise exception 'Not allowed: Administration ▸ Delete is required' using errcode = '42501';
  end if;

  select * into s from public.notification_settings where id;

  if p_dry_run then
    select count(*) into v_read from public.notifications
     where read_at is not null and created_at < now() - make_interval(days => s.read_retention_days);
    select count(*) into v_unread from public.notifications
     where read_at is null and created_at < now() - make_interval(days => s.unread_retention_days);
    select count(*) into v_disp from public.notification_dispatches
     where created_at < now() - make_interval(days => s.dispatch_retention_days);
    select count(*) into v_jobs from public.job_runs
     where started_at < now() - make_interval(days => s.job_run_retention_days);
  else
    delete from public.notifications
     where read_at is not null and created_at < now() - make_interval(days => s.read_retention_days);
    get diagnostics v_read = row_count;
    delete from public.notifications
     where read_at is null and created_at < now() - make_interval(days => s.unread_retention_days);
    get diagnostics v_unread = row_count;
    delete from public.notification_dispatches
     where created_at < now() - make_interval(days => s.dispatch_retention_days);
    get diagnostics v_disp = row_count;
    delete from public.job_runs
     where started_at < now() - make_interval(days => s.job_run_retention_days);
    get diagnostics v_jobs = row_count;
  end if;

  return query select v_read, v_unread, v_disp, v_jobs;
end;
$$;

revoke all on function public.notification_purge(boolean) from public, anon;
grant execute on function public.notification_purge(boolean) to authenticated, service_role;
