-- =====================================================================
-- 0734 — Remember how far each device has uploaded.
--
-- 0733 answered every handshake with `Stamp=0`, which means "I have nothing,
-- send me everything you hold". That is the right answer ONCE. On every
-- reconnect after that it makes the device re-upload its entire stored log —
-- a device that keeps months of punches re-sends all of them each time it
-- boots, and our only defence is the unique key quietly dropping thousands of
-- rows it should never have been asked for.
--
-- The ADMS stamp is a WATERMARK: "I already have records up to here." Keeping
-- the device's last one and handing it back is the whole protocol — the device
-- then sends only what is new.
--
-- A NEW DEVICE STILL GETS '0', which is why the default is '0' and not NULL:
-- a device we have never heard from genuinely does hold punches we have never
-- seen, and the first handshake is the one chance to ask for them.
--
-- Idempotent: safe to run twice.
-- =====================================================================

alter table public.biometric_devices
  add column if not exists last_attlog_stamp text not null default '0';

-- TEXT, NOT A NUMBER. The stamp is an opaque token the device chose, echoed
-- back verbatim; firmware differs on its width and meaning, and a value we
-- parse, round or overflow is a value that silently asks for the wrong range.
-- The route compares it numerically and refuses anything that is not digits,
-- so a junk stamp cannot move the watermark.
comment on column public.biometric_devices.last_attlog_stamp is
  'The ATTLOG watermark last ACCEPTED from this device, returned in the next '
  'handshake so it uploads only newer punches. ''0'' = never heard from, send '
  'everything. Advanced only when a batch was accepted, and only forwards — '
  'see app/iclock/[...path]/route.ts.';
