-- ============================================================================
-- Raagam ERP — 0746 Communication Hub, phase 4: notifications that cannot
-- double, and the two messaging alerts
--
-- doc/slack.md/slack §6. REUSES the existing system — `public.notifications`
-- (0040), `notify()` and its event registry (0673) — rather than a second
-- notifications table beside it (spec §6: "Integrate with existing
-- notification infrastructure rather than creating duplicate notifications").
--
--
-- ## A STABLE EVENT ID PER ALERT, ENFORCED HERE
--
-- `notifications.dedupe_key` is "<event>:<stable id>" — for a message alert,
-- the message id. `unique (user_id, dedupe_key)` means the same event can reach
-- the same person once, however many times the code path runs: a retried send
-- (the RPC already returns created = false, but belt and braces), an edit that
-- re-mentions someone, two server instances racing. NULL keys stay distinct
-- under a unique constraint, so every existing caller that passes no key is
-- unaffected.
--
-- A FULL unique constraint, not a partial index: PostgREST's upsert
-- (`on_conflict=user_id,dedupe_key`) can only infer a constraint whose
-- predicate it does not have to repeat.
--
--
-- ## OWNERS MAY MARK READ — AND NOTHING ELSE
--
-- `notifications_update_own` (0040) lets a user update their own rows, with no
-- column limit, so the browser could rewrite a notification's title, link or
-- (now) its dedupe key. The only column the app ever writes from the browser is
-- `read_at` (use-notifications.ts, actions.ts). Column grants make that the
-- only one it CAN write. Inserts and the admin "take back" run as the service
-- role, which these grants do not touch.
--
-- ADD-ONLY apart from that tightening.
-- ============================================================================

alter table public.notifications add column if not exists dedupe_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_user_dedupe_key') then
    alter table public.notifications
      add constraint notifications_user_dedupe_key unique (user_id, dedupe_key);
  end if;
end $$;

comment on column public.notifications.dedupe_key is
  '0746: "<event_key>:<stable event id>". Unique per user, so one event reaches one person once. NULL for alerts raised without a key.';

-- The bell and the Notifications page count UNREAD rows per person.
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, created_at desc) where read_at is null;

revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;


-- ---------- the messaging alerts (registry: lib/notifications/events.ts) ------
-- Neither is mandatory: a chat alert moves no work through a queue, so an
-- admin may switch it off. Neither falls back to the administrators: a message
-- with nobody to tell is nothing to report.
insert into public.notification_event_settings (event_key, mandatory, push, fallback_to_admins) values
  ('comms.direct_message', false, true, false),
  ('comms.mention',        false, true, false)
on conflict (event_key) do nothing;


-- ---------- assertions ----------------------------------------------------------
do $assert$
declare
  u uuid;
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_user_dedupe_key') then
    raise exception '0746: notifications_user_dedupe_key was not created';
  end if;
  if has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE') then
    raise exception '0746: authenticated can still rewrite a notification''s title';
  end if;
  if not has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE') then
    raise exception '0746: authenticated can no longer mark notifications read';
  end if;
  if (select count(*) from public.notification_event_settings
       where event_key in ('comms.direct_message', 'comms.mention')) <> 2 then
    raise exception '0746: the comms notification events are not seeded';
  end if;

  -- One event, one person, once — proved by attempting the second.
  select id into u from public.profiles limit 1;
  if u is not null then
    insert into public.notifications (user_id, title, dedupe_key) values (u, '0746 probe', '0746:probe');
    begin
      insert into public.notifications (user_id, title, dedupe_key) values (u, '0746 probe', '0746:probe');
      raise exception '0746: a second notification with the same dedupe key was accepted';
    exception when unique_violation then
      null;
    end;
    delete from public.notifications where user_id = u and dedupe_key = '0746:probe';
  end if;
end $assert$;
