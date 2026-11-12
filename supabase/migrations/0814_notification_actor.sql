-- ============================================================================
-- Raagam ERP — 0814 Who raised a notification (user 2026-11-06)
--
-- "The notification now carries the common Raagam logo — make it the person's
-- own profile." Until now a row knew its title, text and link, and nothing about
-- WHO caused it, so every alert on the bell and on the Windows/phone pop-up wore
-- the same logo. The mockup the user approved (artifact SUCwJ7gGfDYS2Gk9u6o6EE)
-- shows the sender's HR photo, or their initials, with the module as a badge.
--
-- WHY THE NAME AND PHOTO ARE COPIED ONTO THE ROW, NOT JOINED. The bell reads
-- `notifications` with the user's own session, and `profiles_read_own` lets a
-- user read only THEIR OWN profile row — so an embed of the sender's profile
-- resolves to null for every alert someone else raised (the trap AGENTS.md
-- "Created Date / Created User" records). The staff photo is behind
-- hr_payroll:view as well. `notify()` runs as the service role, so it resolves
-- both once, at send time, and writes them here: the bell needs no second read,
-- and a row keeps the face it was sent with.
--
-- NULL actor = nobody caused it (an SLA sweep, a nightly job): the bell and the
-- pop-up then show the module's own icon. Rows written before 0814 are all NULL
-- and render that way; nothing is back-filled, since inventing a sender for an
-- old alert would be a lie.
--
-- ADD-ONLY. Column grants from 0746 are untouched: the browser may still write
-- only `read_at`; these three are written by the service role alone.
-- ============================================================================

alter table public.notifications
  add column if not exists actor_id    uuid references public.profiles(id) on delete set null,
  add column if not exists actor_name  text,
  add column if not exists actor_photo text;

comment on column public.notifications.actor_id is
  '0814: the login whose action raised this alert (the signed-in user at notify() time). NULL for a sweep or job.';
comment on column public.notifications.actor_name is
  '0814: the sender''s display name, copied at send time — profiles RLS lets a recipient read only their own profile.';
comment on column public.notifications.actor_photo is
  '0814: the sender''s HR staff photo URL (employee-photos bucket) at send time; NULL draws initials.';
