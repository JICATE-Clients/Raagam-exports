-- =====================================================================
-- 0733 — Biometric punches: the raw record of what a device saw.
--
-- STEP ONE OF THE LIVE-ATTENDANCE WORK, AND DELIBERATELY ONLY THAT.
-- Two tables, both new. Nothing here touches `workers`, `staff`,
-- `worker_attendance` or anything payroll reads, and no punch is linked to a
-- person yet.
--
-- That is the point: whether attendance hangs off `workers`/`staff` or the
-- masters `employees`, and whether a day's attendance keeps living in
-- `worker_attendance` or gains a second home, are decisions nobody has made.
-- Storing the raw punch needs none of them, so it can be proved working first
-- and the rest decided afterwards without unpicking anything.
--
-- A PUNCH IS THE RECORD OF FACT AND IS NEVER EDITED. Everything downstream —
-- linking it to a person, turning a day's punches into hours, an HR correction
-- — is derived or recorded on top. That is what makes a wage dispute answerable
-- a year later: the punch says what the device saw, and the correction says
-- what somebody decided about it.
--
-- Idempotent: safe to run twice.
-- =====================================================================


-- 1. DEVICES -----------------------------------------------------------
--
-- A row appears the first time a device dials in (the route upserts the serial
-- on every handshake and heartbeat), so the serial is the key — it is the only
-- thing the device knows about itself. Everything else is filled in by HR
-- afterwards, which is why `location_id` and `direction` are nullable: a device
-- that has just connected is a device nobody has told us about yet, and it must
-- still be visible so it can be assigned.
create table if not exists public.biometric_devices (
  serial_no    text primary key,
  name         text,                                   -- "GATE-1 IN"
  location_id  uuid references public.locations(id),   -- which unit it stands in

  -- WHICH WAY A PUNCH ON THIS DEVICE COUNTS. The device's own punch-state byte
  -- is unreliable across firmware, and asking the worker to press IN or OUT is
  -- how a movement register fills up with wrong rows. So direction is a
  -- property of the DEVICE: one at the way in, one at the way out.
  -- 'both' is for a point where only presence matters (a canteen counter).
  direction    text not null default 'both'
               check (direction in ('in', 'out', 'both')),

  -- A canteen or visitor punch must never become attendance.
  purpose      text not null default 'attendance'
               check (purpose in ('attendance', 'canteen', 'visitor')),

  is_active    boolean not null default true,
  last_seen    timestamptz,                            -- every heartbeat (~30 s)
  last_ip      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists biometric_devices_location_idx
  on public.biometric_devices (location_id);


-- 2. PUNCHES -----------------------------------------------------------
create table if not exists public.punches (
  id           bigint generated always as identity primary key,
  device_sn    text not null references public.biometric_devices(serial_no)
                 on delete restrict,

  -- The user id as ENROLLED ON THE DEVICE, exactly as sent. It is matched to a
  -- person later (`workers.biometric_id` today); the raw value is kept whatever
  -- happens, because a punch from someone not yet mapped is still the fact that
  -- a human stood at the gate. Throwing it away loses the thing that gets
  -- argued about.
  user_id      text not null,

  punch_time   timestamptz not null,                   -- the device's clock
  received_at  timestamptz not null default now(),     -- when we got it

  -- COPIED FROM THE DEVICE AT PUNCH TIME, never joined at read time: if a device
  -- is later moved from the way in to the way out, last month's punches must not
  -- silently change meaning.
  direction    text not null default 'both'
               check (direction in ('in', 'out', 'both')),

  status       smallint,                               -- device punch state (not trusted)
  verify_mode  smallint,                               -- face / finger / card
  raw          text,                                   -- the line as received

  -- A DEVICE RESENDS EVERYTHING IT IS NOT SURE REACHED US — after an outage,
  -- after a restart, on first connect. Idempotency belongs in the constraint,
  -- not in application code a retry can slip past.
  unique (device_sn, user_id, punch_time)
);

create index if not exists punches_time_idx
  on public.punches (punch_time desc);
create index if not exists punches_user_time_idx
  on public.punches (user_id, punch_time);


-- 3. `punch_time` AND `received_at` ARE BOTH KEPT, AND THE GAP IS EVIDENCE.
-- A device whose clock has drifted produces plausible-looking attendance that
-- is simply wrong, and the only way to notice is that its punches keep arriving
-- minutes away from the time they claim.
comment on column public.punches.punch_time is
  'The device''s own clock, as sent. Compare against received_at to spot a '
  'device whose time has drifted — wrong device time produces wrong wages and '
  'nothing else reveals it.';


-- 4. UNIT SCOPING ------------------------------------------------------
-- "Locations: allocated units only" (AGENTS.md). A device belongs to a unit; a
-- punch follows its device. An UNASSIGNED device is visible to everyone who can
-- see HR, because somebody has to be able to give it a unit in the first place.
create or replace function public.lv_biometric_devices(p_serial text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select p_serial is null or exists (
    select 1 from public.biometric_devices d
    where d.serial_no = p_serial
      and (d.location_id is null
           or public.has_location_access(d.location_id))
  )
$f$;

comment on function public.lv_biometric_devices(text) is
  'Is this device in a unit the caller may see? NULL location = not yet '
  'assigned, and stays visible so it can be. Generated for 0733.';

revoke all on function public.lv_biometric_devices(text) from public, anon;


-- 5. SECURITY ----------------------------------------------------------
-- The device route writes with the service-role key and bypasses RLS entirely;
-- these policies are for people reading in the ERP.
--
-- NOBODY INSERTS OR UPDATES A PUNCH BY HAND. There is no insert, update or
-- delete policy on `punches` deliberately — a raw punch is what the device saw,
-- and an HR correction belongs on the derived attendance row with a reason and
-- an author, not on the evidence.
alter table public.biometric_devices enable row level security;
alter table public.punches           enable row level security;

drop policy if exists biometric_devices_read   on public.biometric_devices;
drop policy if exists biometric_devices_update on public.biometric_devices;
drop policy if exists punches_read             on public.punches;

create policy biometric_devices_read on public.biometric_devices
  for select to authenticated
  using (
    public.has_permission('hr_payroll', 'view')
    and (location_id is null or public.has_location_access(location_id))
  );

-- HR names a device and says which unit and direction it is. They never create
-- or delete one: a device exists because it dialled in, and removing the row
-- while the device is still on the wall would only make it reappear.
create policy biometric_devices_update on public.biometric_devices
  for update to authenticated
  using (
    public.has_permission('hr_payroll', 'edit')
    and (location_id is null or public.has_location_access(location_id))
  )
  with check (
    public.has_permission('hr_payroll', 'edit')
    and (location_id is null or public.has_location_access(location_id))
  );

create policy punches_read on public.punches
  for select to authenticated
  using (
    public.has_permission('hr_payroll', 'view')
    and public.lv_biometric_devices(device_sn)
  );


-- 6. LIVE UPDATES ------------------------------------------------------
-- The live screen subscribes to inserts rather than polling. Realtime still
-- enforces the SELECT policy above row by row, so a user only ever receives
-- punches from a unit they are allocated to.
do $$
begin
  begin
    alter publication supabase_realtime add table public.punches;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.biometric_devices;
  exception when duplicate_object then null;
  end;
end;
$$;


-- 7. HOUSEKEEPING ------------------------------------------------------
drop trigger if exists trg_biometric_devices_updated on public.biometric_devices;
create trigger trg_biometric_devices_updated
  before update on public.biometric_devices
  for each row execute function public.set_updated_at();

-- created-by: exempt -- a punch has no creator. It is an event a device
-- recorded, not a row a person entered, and `created_by` on it would always be
-- empty. The device is named by `device_sn`; who it belonged to is a question
-- about the PERSON, answered once punches are linked.
