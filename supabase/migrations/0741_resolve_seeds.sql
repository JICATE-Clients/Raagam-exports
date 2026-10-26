-- ============================================================================
-- 0741 — Resolve Hub: permissions, role grants, unit settings, trades,
--        notification events, photo bucket.
--
-- Contract: doc/resolve/resolve-hub-plan.md §3 / §8.
-- ============================================================================

-- ─── 1. Permissions (module `resolve`) ──────────────────────────────────────
-- The DB action names are fixed app-wide; the spec's keys map onto them here
-- and in lib/resolve/permissions.ts, nowhere else.

insert into public.permissions (module, action, description) values
  ('resolve', 'view',    'Resolve Hub: report a problem and see your own reports'),
  ('resolve', 'edit',    'Resolve Hub: work tickets (claim, start, block, fix)'),
  ('resolve', 'approve', 'Resolve Hub: triage — assign, reclassify, cancel, spot-check'),
  ('resolve', 'export',  'Resolve Hub: analytics and workload across the unit'),
  ('resolve', 'create',  'Resolve Hub: administer trades, places & QR, teams, routing and unit settings')
on conflict (module, action) do update set description = excluded.description;

-- Reporting is for everyone: every role gets view.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.module = 'resolve' and p.action = 'view'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from (values
    ('Supervisor', 'edit'), ('Manager', 'edit'), ('Store Keeper', 'edit'),
    ('Factory Manager', 'edit'), ('Administrator', 'edit'),
    ('Administrator', 'approve'), ('Factory Manager', 'approve'), ('Managing Director', 'approve'),
    ('Administrator', 'export'), ('Managing Director', 'export'), ('Factory Manager', 'export'),
    ('Administrator', 'create')
  ) as g(role_name, action)
  join public.roles r on r.name = g.role_name
  join public.permissions p on p.module = 'resolve' and p.action = g.action
on conflict do nothing;

-- ─── 2. One settings row per unit (rh_settings() also inserts on read) ──────

insert into public.rh_unit_settings (location_id)
select l.id from public.locations l
on conflict (location_id) do nothing;

-- ─── 3. Starter trades (shared master, CAPITALS) ────────────────────────────

insert into public.rh_trades (code, name, created_by) values
  ('ELEC',  'ELECTRICAL',          null),
  ('PLMB',  'PLUMBING',            null),
  ('CARP',  'CARPENTRY',           null),
  ('CIVIL', 'CIVIL',               null),
  ('MECH',  'MACHINE MAINTENANCE', null),
  ('IT',    'IT',                  null),
  ('HSKP',  'HOUSEKEEPING',        null),
  ('ACR',   'AC & REFRIGERATION',  null)
on conflict (code) do nothing;

-- ─── 4. Notification events ─────────────────────────────────────────────────
-- A dangerous report is the one that moves work urgently, so it is mandatory.

insert into public.notification_event_settings (event_key, mandatory, push, fallback_to_admins) values
  ('resolve.ticket_routed', false, true, true),
  ('resolve.dangerous',     true,  true, true),
  ('resolve.assigned',      false, true, false),
  ('resolve.joined',        false, true, false),
  ('resolve.fixed',         false, true, false),
  ('resolve.closed',        false, true, false),
  ('resolve.disputed',      false, true, true),
  ('resolve.rated',         false, true, false),
  ('resolve.overdue',       false, true, true),
  ('resolve.digest',        false, true, false)
on conflict (event_key) do nothing;

-- ─── 5. Photo bucket ────────────────────────────────────────────────────────
-- Private. No storage.objects policy at all for authenticated: the server
-- action (service role) writes after stripping EXIF, and reads are signed
-- URLs minted by the service role after an RLS-checked ticket read.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resolve-photos', 'resolve-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];
