-- =====================================================================
-- 0736 — Tell the device what time it is.
--
-- WE CAUSED THIS, AND THE CURE IS THE SAME MECHANISM AS THE CAUSE.
--
-- The uFace 302 sat on `0.0.0.0` for years keeping its own time — drifted
-- about 30 minutes fast, as an unattended clock does. The moment it began
-- reporting to the ERP it started taking its time FROM the server, and every
-- HTTP response carries a `Date:` header that the standard requires to be in
-- GMT. So the device moved to exactly UTC: measured at +05h 30m 01-03s across
-- seven consecutive punches, which is the IST offset to the second and
-- therefore a time ZONE, not a mistyped clock (2026-10-23, live).
--
-- Attendance is derived from `punch_time`, the device's own clock, so a device
-- 5½ hours out produces plausible, wrong hours and plausible, wrong wages.
--
-- The device trusts our time. So we give it the right one: the heartbeat it
-- sends every ~30 seconds can carry a command back, and this column records
-- when we last sent one so it goes out periodically rather than on every beat.
--
-- NULL means never synced — the first heartbeat after this lands sets it.
-- =====================================================================

alter table public.biometric_devices
  add column if not exists time_synced_at timestamptz;

comment on column public.biometric_devices.time_synced_at is
  'When we last sent this device a SET OPTION DateTime command. NULL = never. '
  'Re-sent hourly; see the heartbeat branch in app/iclock/[...path]/route.ts. '
  'Added 0736 after the device adopted UTC from our HTTP Date header.';
