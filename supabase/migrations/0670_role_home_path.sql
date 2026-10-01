-- 0670 — A ROLE'S HOME PAGE: where a person lands after signing in
-- (user 2026-10-01: "plan the dynamic routing … it should open as my profile").
--
-- Until now every login landed on the Dashboard (`/`). A role may now name a
-- page instead — Approvals for the MD, Orders for a merchandiser, Stores for a
-- store keeper — chosen on Admin ▸ Access Control ▸ the role. NULL = no
-- preference. `/start` (app/(app)/start) reads it at sign-in:
--   * the first of the person's roles, by role name, that names a page;
--   * else My Profile (`/me`) for someone whose roles open NO module, so a
--     staff login is not dropped on an empty dashboard;
--   * else the Dashboard, as before.
-- A link that already names a page (a notification, `?redirect=`) still wins.
--
-- The value is an app path, checked here so a typo cannot store a URL that
-- leaves the app (`//evil.example` or `https://…` would be an open redirect
-- the moment `/start` follows it).

alter table public.roles
  add column if not exists home_path text;

alter table public.roles
  drop constraint if exists chk_roles_home_path;
alter table public.roles
  add constraint chk_roles_home_path
  check (home_path is null or home_path ~ '^/([a-z0-9][a-z0-9/_-]*)?$');
