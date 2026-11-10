-- ════════════════════════════════════════════════════════════════════════════
-- 0823 — HR ▸ Events: real Google Calendar invitations
-- ════════════════════════════════════════════════════════════════════════════
--
-- HR creates an event, picks staff / workers by their code (Employee ID), and
-- the app creates the event in the HR user's OWN Google Calendar with those
-- people's emails as guests. Google itself sends the invitation emails
-- (sendUpdates=all), so the event and the invites are real, not a copy.
--
-- Three tables:
--   hr_google_connections   — one row per app login that pressed "Connect
--                             Google Calendar": the Google account and its
--                             OAuth refresh token. SERVER-ONLY: RLS on, no
--                             policy, every grant revoked. Only the service
--                             role (createAdminClient) ever reads it, so a
--                             refresh token can never reach a browser.
--   hr_calendar_events      — the event, per unit, with the Google event id
--                             that lets an edit / cancel reach the same event.
--   hr_calendar_event_guests— who was invited, the email used, and the reply
--                             Google last reported (needsAction / accepted …).
--
-- Every table enables RLS straight after it is created.

-- ─── 1. Google connections (server-only) ────────────────────────────────────

create table if not exists public.hr_google_connections (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  google_email   text not null,
  refresh_token  text not null,
  access_token   text,
  expires_at     timestamptz,
  scope          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.hr_google_connections enable row level security;
-- No policy on purpose: nobody but the service role reads or writes a token.
revoke all on public.hr_google_connections from anon, authenticated;
comment on table public.hr_google_connections is
  'HR ▸ Events — the Google account each login connected, with its OAuth refresh token. Service role only. 0823.';
drop trigger if exists trg_hr_google_conn_updated on public.hr_google_connections;
create trigger trg_hr_google_conn_updated before update on public.hr_google_connections
  for each row execute function public.set_updated_at();

-- ─── 2. Events ──────────────────────────────────────────────────────────────

create sequence if not exists public.seq_hr_calendar_event;

create table if not exists public.hr_calendar_events (
  id                 uuid primary key default gen_random_uuid(),
  code               text,
  location_id        uuid not null default public.current_location() references public.locations(id),
  title              text not null check (btrim(title) <> ''),
  description        text,
  venue              text,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  add_meet           boolean not null default false,
  status             text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  cancel_reason      text,
  -- Google's side. Null only between the insert and Google's answer: the
  -- action deletes a row Google refused, so a saved event always has an id.
  organizer_user_id  uuid references auth.users(id),
  organizer_email    text,
  google_event_id    text,
  google_html_link   text,
  google_meet_link   text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint hr_cal_event_times check (ends_at > starts_at)
);
alter table public.hr_calendar_events enable row level security;
comment on table public.hr_calendar_events is 'HR ▸ Events — events sent as Google Calendar invitations, per unit. 0823.';
create index if not exists idx_hr_cal_event_loc on public.hr_calendar_events (location_id, starts_at desc);
drop trigger if exists trg_hr_cal_event_code on public.hr_calendar_events;
create trigger trg_hr_cal_event_code before insert on public.hr_calendar_events
  for each row execute function public.assign_code('EVT', 'public.seq_hr_calendar_event');
drop trigger if exists trg_hr_cal_event_updated on public.hr_calendar_events;
create trigger trg_hr_cal_event_updated before update on public.hr_calendar_events
  for each row execute function public.set_updated_at();

-- ─── 3. Guests ──────────────────────────────────────────────────────────────

create table if not exists public.hr_calendar_event_guests (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.hr_calendar_events(id) on delete cascade,
  location_id      uuid not null references public.locations(id),
  staff_id         uuid references public.staff(id),
  worker_id        uuid references public.workers(id),
  email            text not null,
  response_status  text not null default 'needsAction'
                   check (response_status in ('needsAction', 'accepted', 'declined', 'tentative')),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint hr_cal_guest_person check (num_nonnulls(staff_id, worker_id) = 1)
);
alter table public.hr_calendar_event_guests enable row level security;
comment on table public.hr_calendar_event_guests is 'HR ▸ Events — who was invited to an event and their Google reply. 0823.';
create unique index if not exists uq_hr_cal_guest_staff  on public.hr_calendar_event_guests (event_id, staff_id)  where staff_id is not null;
create unique index if not exists uq_hr_cal_guest_worker on public.hr_calendar_event_guests (event_id, worker_id) where worker_id is not null;
create index if not exists idx_hr_cal_guest_event on public.hr_calendar_event_guests (event_id);

-- ─── 4. Policies — HR in the unit (same shape as 0773's trainings) ──────────

drop policy if exists hr_cal_event_read on public.hr_calendar_events;
drop policy if exists hr_cal_event_ins  on public.hr_calendar_events;
drop policy if exists hr_cal_event_upd  on public.hr_calendar_events;
drop policy if exists hr_cal_event_del  on public.hr_calendar_events;
create policy hr_cal_event_read on public.hr_calendar_events for select
  using (public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id));
create policy hr_cal_event_ins on public.hr_calendar_events for insert
  with check (public.has_permission('hr_payroll', 'create') and public.is_current_location(location_id));
create policy hr_cal_event_upd on public.hr_calendar_events for update
  using (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id));
-- A delete is only the action undoing its own insert when Google refused it;
-- an event Google holds is CANCELLED (so the guests are told), never deleted.
create policy hr_cal_event_del on public.hr_calendar_events for delete
  using (public.has_permission('hr_payroll', 'create') and public.is_current_location(location_id)
         and google_event_id is null);

drop policy if exists hr_cal_guest_read on public.hr_calendar_event_guests;
drop policy if exists hr_cal_guest_ins  on public.hr_calendar_event_guests;
drop policy if exists hr_cal_guest_upd  on public.hr_calendar_event_guests;
drop policy if exists hr_cal_guest_del  on public.hr_calendar_event_guests;
create policy hr_cal_guest_read on public.hr_calendar_event_guests for select
  using (public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id));
create policy hr_cal_guest_ins on public.hr_calendar_event_guests for insert
  with check ((public.has_permission('hr_payroll', 'create') or public.has_permission('hr_payroll', 'edit'))
              and public.is_current_location(location_id));
create policy hr_cal_guest_upd on public.hr_calendar_event_guests for update
  using (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id));
-- A line of the document: deletable by edit (AGENTS.md, 0678's lesson).
create policy hr_cal_guest_del on public.hr_calendar_event_guests for delete
  using ((public.has_permission('hr_payroll', 'edit') or public.has_permission('hr_payroll', 'delete'))
         and public.is_current_location(location_id));

-- ─── 5. The chat's 📎 Event (0776) can be sent to Google Calendar too ───────
--
-- Same connection table: whoever sends an event in a chat may tick "Also send
-- a Google Calendar invite", and every member of that chat is invited from the
-- sender's own calendar. These columns remember which Google event it became,
-- so a retry of the same send never creates a second one. Written only by the
-- server (service role) after Google answers; members still read the row
-- through 0776's existing policies. NEEDS 0776 APPLIED FIRST.
alter table public.comm_events
  add column if not exists google_event_id   text,
  add column if not exists google_html_link  text,
  add column if not exists google_sent_by    uuid references public.profiles(id) on delete set null;