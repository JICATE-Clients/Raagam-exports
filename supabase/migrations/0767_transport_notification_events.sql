-- ============================================================================
-- Raagam ERP — 0767 Vehicle & Transport: the two trip alerts
--
-- doc/vehicle program/plan.md ("Telematics"). Seeds the policy rows for the
-- two events declared in lib/notifications/events.ts, so Administration ▸
-- System ▸ Notifications can switch them (AGENTS.md "Every alert has a name").
--
--   transport.trip_dispatched — dispatchTrip, to whoever booked a request on it
--   transport.trip_completed  — completeTrip, to the same people
--
-- Neither is mandatory: no document waits in a queue on them. Neither falls
-- back to the administrators: a request booked by nobody we can resolve is
-- nothing to report.
--
-- Depends on nothing in the transport schema; only on 0673's table.
-- ============================================================================

insert into public.notification_event_settings (event_key, mandatory, push, fallback_to_admins) values
  ('transport.trip_dispatched', false, true, false),
  ('transport.trip_completed',  false, true, false)
on conflict (event_key) do nothing;

do $assert$
begin
  if (select count(*) from public.notification_event_settings
       where event_key in ('transport.trip_dispatched', 'transport.trip_completed')) <> 2 then
    raise exception '0767: the transport notification events are not seeded';
  end if;
end $assert$;
