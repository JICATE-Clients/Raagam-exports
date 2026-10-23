-- =====================================================================
-- 0735 — Getting ready for a real device: a start date, an approval flag,
--        and a way to put a NAME against a punch.
--
-- Everything 0733/0734 did was about receiving punches correctly. This is
-- about the first time a device with YEARS of stored history dials in, and
-- about an admin being able to approve or block one without a deploy.
--
-- Still no attendance calculation and still nothing written to
-- `worker_attendance` — a punch is matched to a person for DISPLAY only.
-- =====================================================================


-- 1. WHERE TO START READING A DEVICE'S HISTORY ---------------------------
--
-- A device that has been running for two years holds two years of punches,
-- and the first handshake asks for all of them (`Stamp=0`, 0734). Loading
-- them is not harmless: it is attendance for months nobody has reconciled,
-- against shift rules that did not exist, for workers who may have left —
-- and it would arrive looking exactly like today's data.
--
-- So each device carries the date its history is ACCEPTED from. Older lines
-- are acknowledged with OK — the device must stop offering them, or it will
-- re-send forever — and simply not stored.
--
-- DEFAULT `now()`, so a device registers itself as "from this moment on",
-- which is the only safe thing to assume about a reader nobody has told us
-- about. An admin who DOES want the history sets it back; the punches are
-- still on the device until it is told they have been received.
alter table public.biometric_devices
  add column if not exists accept_from timestamptz not null default now();

comment on column public.biometric_devices.accept_from is
  'Punches older than this are acknowledged but NOT stored. Defaults to the '
  'moment the device first dialled in, because a new device''s stored history '
  'is months of unreconciled attendance. Set it back to import that history.';


-- 2. APPROVE OR BLOCK A DEVICE FROM THE ERP -----------------------------
--
-- `ALLOWED_SN` on Vercel was the only answer to "is this reader ours?", and
-- changing it meant an environment variable and a redeploy. A flag here means
-- an admin approves a reader on the screen where they can see it.
--
-- A NEW DEVICE ARRIVES PENDING (`false`), and that is the point — a reader
-- nobody has approved should not be writing attendance. Its handshake and
-- heartbeat are still answered, so it APPEARS on the Live screen to be
-- approved; only its punches are refused.
--
-- REFUSED, NOT DISCARDED. A pending or blocked device gets a non-200 on its
-- punches, so it KEEPS them and offers them again once approved — nothing is
-- lost to a block that turns out to be a mistake. Answering OK and dropping
-- them would make a mis-click silent data loss.
--
-- The two-step default is the standard backfill trick: existing rows take
-- `true` (they were already trusted via ALLOWED_SN), and every row after this
-- takes `false`.
alter table public.biometric_devices
  add column if not exists enabled boolean not null default true;
alter table public.biometric_devices
  alter column enabled set default false;

comment on column public.biometric_devices.enabled is
  'Approved to record punches. A new device arrives false (pending) and is '
  'refused with a non-200 so it KEEPS its punches until an admin approves it. '
  'Blocking is reversible for the same reason.';


-- 3. A NAME AGAINST A PUNCH ---------------------------------------------
--
-- `workers.biometric_id` has existed since 0013. `staff` never had one, so
-- half of "show the worker or staff name" could not be answered at all — a
-- staff punch would read as an unknown id forever.
--
-- Nullable and no unique constraint, exactly like the workers column: the
-- device ids are assigned by whoever enrols people on the reader, and a
-- constraint added blind to existing data fails the migration. The SCREEN
-- reports a collision instead (two people on one id is an enrolment mistake
-- worth seeing, not something to hide behind a silent "first match wins").
alter table public.staff
  add column if not exists biometric_id text;

comment on column public.staff.biometric_id is
  'User ID enrolled on the biometric reader, matching workers.biometric_id. '
  'Added 0735 — display only; no attendance is derived from it yet.';

-- The lookup is "which person is device id 1001", on every punch rendered.
create index if not exists workers_biometric_id_idx
  on public.workers (biometric_id) where biometric_id is not null;
create index if not exists staff_biometric_id_idx
  on public.staff (biometric_id) where biometric_id is not null;
