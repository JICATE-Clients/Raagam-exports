-- 0812a · Favourites on Home (user 2026-11-05, mock-up https://claude.ai/artifact/SMQnEeCU1GonRHYCHcVvLd).
--
-- One tap on a Home tile opens the entry form itself — Leave Request, Trip Request, Help &
-- Repair, Raise PO … — instead of three levels of menu. Two layers decide what a person sees:
--
--   favorite_defaults  — set by an admin (Administration ▸ Users & Access ▸ Home Favourites).
--                        role_id NULL = EVERYONE. That row is not a nicety: a regular staff
--                        member signs in with email access and NO role (lib/auth/self-service.ts),
--                        so defaults that hang off roles alone would never reach the very people
--                        the client named first (General Staff: Leave, Help & Repair, Trip).
--   user_favorites     — the person's own: a pin, a hidden default, and their order.
--
-- What shows = everyone + their roles' defaults + their pins − what they hid − what they may
-- not open, worked out at read time (lib/favorites/service.ts), so a tile an admin adds later
-- reaches people who have already arranged their own bar.
--
-- KEYS, NEVER HREFS OR LABELS. `item_key` is either an action declared in
-- lib/favorites/registry.ts (`a:leave-request`) or a pinned screen (`screen:/hr/payslip`).
-- The registry owns the label, icon, link and permission, so renaming or moving a screen is a
-- code change that cannot strand a stored tile. An unknown key is skipped on read, never shown.
--
-- Not unit-scoped: a tile is a preference about the PERSON, not a document of a unit.
-- location-scope: exempt -- per-user / per-role preference, holds no unit data

create table if not exists public.favorite_defaults (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid references public.roles(id) on delete cascade,   -- null = everyone
  item_key    text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  constraint chk_favorite_defaults_key check (item_key ~ '^(a:[a-z0-9-]+|screen:/[a-z0-9/_-]*)$')
);
comment on table public.favorite_defaults is
  '0812: Home Favourites an admin starts people with. role_id NULL = every login (self-service staff hold no role).';

-- One row per (scope, key). NULL is not equal to NULL in a plain unique index, so the
-- everyone-scope would accept duplicates without the coalesce.
create unique index if not exists favorite_defaults_scope_key
  on public.favorite_defaults (coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid), item_key);

create table if not exists public.user_favorites (
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  item_key    text not null,
  -- The person's order. NULL = never arranged: the tile falls in after the arranged ones.
  position    integer,
  -- TRUE on a default the person switched off. A default cannot be deleted from their bar
  -- (the admin's row would bring it back on the next read), so it is hidden instead.
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  primary key (user_id, item_key),
  constraint chk_user_favorites_key check (item_key ~ '^(a:[a-z0-9-]+|screen:/[a-z0-9/_-]*)$')
);
comment on table public.user_favorites is
  '0812: one person''s Home Favourites — a pin, a hidden default, and their order. Own rows only.';

alter table public.favorite_defaults enable row level security;
alter table public.user_favorites    enable row level security;

-- Every login reads the defaults (they name screens, not data); only an admin changes them —
-- the same grant that edits roles (roles_admin_all).
drop policy if exists favorite_defaults_read on public.favorite_defaults;
create policy favorite_defaults_read on public.favorite_defaults
  for select to authenticated using (true);
drop policy if exists favorite_defaults_write on public.favorite_defaults;
create policy favorite_defaults_write on public.favorite_defaults
  for all to authenticated
  using (public.has_permission('system_admin', 'edit'))
  with check (public.has_permission('system_admin', 'edit'));

-- A person's own rows and nobody else's — not even an admin's, who has no reason to read them.
drop policy if exists user_favorites_own on public.user_favorites;
create policy user_favorites_own on public.user_favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No anon access at all (the app has no logged-out surface).
revoke all on public.favorite_defaults from anon;
revoke all on public.user_favorites    from anon;

-- ── Starting defaults ─────────────────────────────────────────────────────────────────────
-- The tiles the mock-up showed. Each is filtered by permission on read, so a default someone
-- cannot open is simply absent for them. The admin screen changes all of this.
insert into public.favorite_defaults (role_id, item_key, position)
values
  (null, 'a:leave-request', 1),
  (null, 'a:help-repair',   2),
  (null, 'a:trip-request',  3),
  (null, 'a:my-approvals',  4)
on conflict do nothing;

insert into public.favorite_defaults (role_id, item_key, position)
select r.id, k.key, k.pos
from public.roles r
join (values
  ('Store Keeper', 'a:raise-po',         1),
  ('Store Keeper', 'a:stock-transfer',   2),
  ('Store Keeper', 'a:grn',              3),
  ('Store Keeper', 'a:vehicle-dispatch', 4),
  ('MERCHANDISING', 'a:order-entry',     1),
  ('MERCHANDISING', 'a:raise-po',        2)
) k(role_name, key, pos) on k.role_name = r.name
on conflict do nothing;
