-- ============================================================================
-- 0659 · A NEW LOGIN MUST SET ITS OWN PASSWORD
-- ============================================================================
--
-- User 2026-09-30: when a user is created (picked from the HR Employee master)
-- the application link, their email and a password go out by email. A
-- password in an inbox is tolerable only if it cannot outlive the first login,
-- so the password emailed is a TEMPORARY one the system generates (the admin
-- never types or sees it when the mail goes out), and this flag sends the user
-- to /set-password on their first page load until they choose their own.
--
-- Set true by the create-user and resend-welcome actions (service role);
-- cleared by the set-password action once the new password is saved. Existing
-- logins default to false — nobody already working is interrupted.
-- ============================================================================

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  '0659: true while the login still holds the temporary password emailed at creation (or on a resend); the app layout sends the user to /set-password until they choose their own.';
