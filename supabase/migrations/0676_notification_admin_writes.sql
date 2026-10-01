-- ============================================================================
-- Raagam ERP — 0676 Notification management, Phase 2: what an administrator
-- may CHANGE (doc/admin/notification-management-plan.md §4, §5).
--
--   notification_save_event     an alert's switches + its CC list, in ONE
--                               transaction: a save that wrote the switches and
--                               then failed on the CC would leave an alert half
--                               re-routed, and a delete-then-insert from the
--                               browser is exactly that, two requests apart.
--   notification_recall         take an announcement / test back out of every
--                               bell. Push cannot be recalled — the screen says so.
--   notification_revoke_device  remove a lost or retired phone.
--
-- Each checks its own permission (edit, or delete for a recall). The rules from
-- §4 are enforced HERE, not only on screen:
--   - a mandatory alert cannot be disabled (0673's check constraint);
--   - CC is additive: the code's own recipient is never part of what is saved;
--   - only an administrator's OWN sends (admin.test / admin.broadcast) can be
--     recalled. Taking an approval alert back out of an approver's bell would
--     strand the document the same way switching the alert off would.
-- ============================================================================

alter table public.notification_dispatches
  add column if not exists recalled_at timestamptz,
  add column if not exists recalled_by uuid references public.profiles(id) on delete set null;

-- ─── Save an alert's settings and CC ────────────────────────────────────────
create or replace function public.notification_save_event(
  p_key       text,
  p_enabled   boolean,
  p_push      boolean,
  p_fallback  boolean,
  p_cc_roles  uuid[],
  p_cc_users  uuid[]
) returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_mandatory boolean;
begin
  if not public.has_permission('system_admin', 'edit') then
    raise exception 'Not allowed: Administration ▸ Edit is required' using errcode = '42501';
  end if;

  select mandatory into v_mandatory
    from public.notification_event_settings where event_key = p_key for update;
  if not found then
    raise exception 'Unknown alert: %', p_key using errcode = 'P0002';
  end if;
  if v_mandatory and not coalesce(p_enabled, true) then
    raise exception 'This alert cannot be switched off — it is how a document leaves an approval queue.'
      using errcode = '23514';
  end if;

  update public.notification_event_settings
     set enabled            = coalesce(p_enabled, enabled),
         push               = coalesce(p_push, push),
         fallback_to_admins = coalesce(p_fallback, fallback_to_admins),
         updated_by         = auth.uid(),
         updated_at         = now()
   where event_key = p_key;

  -- Role and person CC are replaced as a set; a permission CC (not offered on
  -- screen) is left exactly as it was.
  delete from public.notification_event_cc
   where event_key = p_key and kind in ('role', 'user');

  insert into public.notification_event_cc (event_key, kind, role_id, created_by)
  select p_key, 'role', r.id, auth.uid()
    from public.roles r
   where r.id = any(coalesce(p_cc_roles, '{}'));

  insert into public.notification_event_cc (event_key, kind, user_id, created_by)
  select p_key, 'user', p.id, auth.uid()
    from public.profiles p
   where p.id = any(coalesce(p_cc_users, '{}'));
end;
$$;

-- ─── Take an administrator's own send back ──────────────────────────────────
create or replace function public.notification_recall(p_dispatch uuid)
returns int
language plpgsql security definer set search_path to ''
as $$
declare
  v_event    text;
  v_recalled timestamptz;
  v_count    int;
begin
  if not public.has_permission('system_admin', 'delete') then
    raise exception 'Not allowed: Administration ▸ Delete is required' using errcode = '42501';
  end if;

  select event_key, recalled_at into v_event, v_recalled
    from public.notification_dispatches where id = p_dispatch for update;
  if not found then
    raise exception 'That alert is not in the log.' using errcode = 'P0002';
  end if;
  if v_event not in ('admin.broadcast', 'admin.test') then
    raise exception 'Only an announcement or a test can be taken back. An alert the app raised is how someone learns their work is waiting.'
      using errcode = '42501';
  end if;
  if v_recalled is not null then
    return 0;
  end if;

  delete from public.notifications where dispatch_id = p_dispatch;
  get diagnostics v_count = row_count;

  update public.notification_dispatches
     set recalled_at = now(), recalled_by = auth.uid()
   where id = p_dispatch;
  return v_count;
end;
$$;

-- ─── Remove a device ────────────────────────────────────────────────────────
create or replace function public.notification_revoke_device(p_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
begin
  if not public.has_permission('system_admin', 'edit') then
    raise exception 'Not allowed: Administration ▸ Edit is required' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where id = p_id;
end;
$$;

revoke all on function public.notification_save_event(text, boolean, boolean, boolean, uuid[], uuid[]) from public, anon;
revoke all on function public.notification_recall(uuid)                                               from public, anon;
revoke all on function public.notification_revoke_device(uuid)                                        from public, anon;
grant execute on function public.notification_save_event(text, boolean, boolean, boolean, uuid[], uuid[]) to authenticated;
grant execute on function public.notification_recall(uuid)                                               to authenticated;
grant execute on function public.notification_revoke_device(uuid)                                        to authenticated;
