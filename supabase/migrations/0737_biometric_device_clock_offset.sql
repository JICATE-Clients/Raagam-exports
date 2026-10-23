-- =====================================================================
-- 0737 — Which zone is the device's clock actually in?
--
-- 0733 appended `+05:30` to every timestamp, because the uFace 302 sends a
-- local time with no zone and the factory is in India. That was true until the
-- device started reporting to a server.
--
-- It now keeps its time as UTC and will not hold anything else: set it by hand
-- on the device and the next screen shows the old value again, because the
-- clock is recalculated from a UTC base rather than stored as typed
-- (2026-10-23, observed at the client). Our own SET OPTION DateTime command
-- (0736) loses the same argument.
--
-- SO WE STOP ARGUING AND READ IT CORRECTLY. The device sends 14:09:47 and
-- means 14:09:47 UTC; appending `+05:30` recorded that as 14:09 IST — a punch
-- five and a half hours early, which is wrong hours and wrong wages.
--
-- THIS IS AN INTERPRETATION, NOT A CORRECTION. We do not shift, round or
-- adjust the value the device reported: we read it in the zone the device is
-- actually keeping. `punch_time` still says exactly what the reader said.
--
-- IT IS PER DEVICE because it is a fact about one reader's configuration, not
-- about this installation — a second device on the same wall may be in IST.
-- Default stays `+05:30`, so every device added from here behaves as 0733
-- described and this column only exists for the ones that do not.
--
-- THE TRAP, STATED: if someone later gets this device back onto IST, its
-- punches would land five and a half hours LATE and nothing would say why.
-- The clock-gap column on the Live screen is the guard — a healthy device
-- reads 1-3 seconds, and this one reading -5h30m means the offset below is now
-- wrong and must go back to '+05:30'.
-- =====================================================================

alter table public.biometric_devices
  add column if not exists clock_offset text not null default '+05:30';

alter table public.biometric_devices
  add constraint biometric_devices_clock_offset_shape
  check (clock_offset ~ '^[+-][0-9]{2}:[0-9]{2}$') not valid;

comment on column public.biometric_devices.clock_offset is
  'The zone this device''s clock is actually keeping, appended to the naive '
  'timestamp it sends. ''+05:30'' (IST) is the default and was hard-coded '
  'until 0737; a device that adopted UTC from the server is ''+00:00''. '
  'Watch the Live screen''s clock gap: 1-3s means this is right.';
