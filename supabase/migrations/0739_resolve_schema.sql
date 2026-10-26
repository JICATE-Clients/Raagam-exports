-- ============================================================================
-- 0739 — Resolve Hub: schema + RLS
--
-- Contract: doc/resolve/resolve-hub-plan.md §2 / §3. Functions and RPCs are in
-- 0740, seeds (permissions, unit settings, trades, events, bucket) in 0741.
--
-- Every LIFECYCLE write (tickets, activity, notes, ratings, joiners, photos,
-- ledger, outbox, escalations, counters) goes through a SECURITY DEFINER RPC
-- in 0740 — so those tables carry SELECT policies only, and the write
-- privileges are revoked outright as well. Configuration (trades, places,
-- teams, members, routing overrides, unit settings) is ordinary RLS on
-- `resolve:create`, because it is configuration, not lifecycle.
--
-- ROW VISIBILITY (§3) is stated by helper predicates that are SECURITY
-- DEFINER sql functions, so a policy calling them never re-enters RLS on the
-- table it guards (the 0682 lv_* cycle). They are defined HERE, ahead of the
-- policies that call them; plpgsql bodies are not validated against tables
-- until run, sql bodies are, so each one is created after its tables.
-- ============================================================================

-- ─── 1. Tables ──────────────────────────────────────────────────────────────

create table public.rh_unit_settings (
  location_id            uuid primary key references public.locations(id) on delete cascade,
  unit_head_id           uuid references public.profiles(id) on delete set null,
  estate_owner_id        uuid references public.profiles(id) on delete set null,
  director_ids           uuid[] not null default '{}',
  timezone               text not null default 'Asia/Kolkata',
  escalation_hour        int  not null default 8  check (escalation_hour between 0 and 23),
  ordinary_days          int  not null default 2  check (ordinary_days between 0 and 365),
  routine_days           int  not null default 7  check (routine_days between 0 and 365),
  purchase_days          int  not null default 7  check (purchase_days between 0 and 365),
  dup_window_days        int  not null default 14 check (dup_window_days between 0 and 365),
  dispute_window_days    int  not null default 7  check (dispute_window_days between 0 and 365),
  report_limit_24h       int  not null default 10 check (report_limit_24h between 1 and 1000),
  spot_check_one_in      int  not null default 10 check (spot_check_one_in between 0 and 1000),
  page_cap_per_day       int  not null default 20 check (page_cap_per_day between 0 and 10000),
  suppress_notifications boolean not null default false,
  triage_weights         jsonb not null default '{
    "severity": {"critical": 100, "high": 60, "medium": 30, "low": 10},
    "priority": {"urgent": 80, "high": 50, "medium": 20, "low": 5},
    "per_day_open": 2, "age_cap": 60, "reopened": 70, "disputed": 90,
    "repeated": 25, "unassigned": 15
  }'::jsonb,
  updated_at             timestamptz not null default now()
);
comment on table public.rh_unit_settings is
  'Resolve Hub per-unit settings. spot_check_one_in: 0 = never spot-check, 1 = always, N = one in N.';

create table public.rh_trades (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null unique,
  description text,
  inactive    boolean not null default false,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
comment on table public.rh_trades is
  'Resolve Hub trades — shared master data (no unit).';

create table public.rh_places (
  id               uuid primary key default gen_random_uuid(),
  location_id      uuid not null default public.current_location() references public.locations(id),
  code             text not null,
  name             text not null,
  kind             text not null default 'room'
                   check (kind in ('building','floor','room','area','machine','asset')),
  parent_id        uuid references public.rh_places(id) on delete set null,
  asset_id         uuid references public.assets(id) on delete set null,
  caretaker_id     uuid references public.profiles(id) on delete set null,
  default_trade_id uuid references public.rh_trades(id) on delete set null,
  qr_token         text unique,
  qr_printed_at    timestamptz,
  inactive         boolean not null default false,
  created_by       uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (location_id, code)
);

create table public.rh_teams (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null default public.current_location() references public.locations(id),
  trade_id    uuid not null references public.rh_trades(id),
  name        text not null,
  lead_id     uuid references public.profiles(id) on delete set null,
  inactive    boolean not null default false,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (location_id, name)
);

create table public.rh_team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.rh_teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (team_id, profile_id)
);

create table public.rh_routing_overrides (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null default public.current_location() references public.locations(id),
  trade_id    uuid references public.rh_trades(id) on delete cascade,
  place_id    uuid references public.rh_places(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  note        text,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (trade_id is not null or place_id is not null)
);

create table public.rh_tickets (
  id                  uuid primary key default gen_random_uuid(),
  location_id         uuid not null default public.current_location() references public.locations(id),
  kind                text not null default 'broken' check (kind in ('broken','complaint','requirement')),
  ref_no              text not null unique,
  status              text not null default 'open'
                      check (status in ('open','in_progress','blocked','fixed','closed','cancelled','withdrawn')),
  reporter_id         uuid references public.profiles(id),
  place_id            uuid references public.rh_places(id),
  trade_id            uuid references public.rh_trades(id),
  title               text not null check (btrim(title) <> ''),
  description         text,
  is_dangerous        boolean not null default false,
  severity            text not null default 'medium' check (severity in ('critical','high','medium','low')),
  priority            text not null default 'medium' check (priority in ('urgent','high','medium','low')),
  is_routine          boolean not null default false,
  source              text not null default 'form' check (source in ('form','qr','ai')),
  gps_lat             numeric(9,4),
  gps_lng             numeric(9,4),
  owner_id            uuid references public.profiles(id),
  owner_reason        text,
  team_id             uuid references public.rh_teams(id),
  assignee_id         uuid references public.profiles(id),
  due_at              timestamptz,
  paused_at           timestamptz,
  paused_seconds      int not null default 0 check (paused_seconds >= 0),
  blocked_reason      text,
  fix_round           int not null default 1 check (fix_round >= 1),
  dispute_count       int not null default 0 check (dispute_count >= 0),
  reopen_count        int not null default 0 check (reopen_count >= 0),
  fixed_at            timestamptz,
  closed_at           timestamptz,
  closure_kind        text check (closure_kind in ('auto_photo','spot_checked','owner_confirmed')),
  spot_check_pending  boolean not null default false,
  cancel_reason       text,
  needs_sorting       boolean not null default false,
  -- complaint columns: no RPC writes them in this release
  category_id         uuid,
  is_anonymous        boolean not null default false,
  about_superior      boolean not null default false,
  tracking_token_hash text,
  created_by          uuid default auth.uid() references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (reporter_id is not null or (kind = 'complaint' and is_anonymous)),
  check ((status = 'blocked') = (paused_at is not null))
);
comment on table public.rh_tickets is
  'Resolve Hub tickets. FOUR FKs to profiles (reporter_id, owner_id, assignee_id, created_by): '
  'every PostgREST embed must name its column, e.g. profiles!owner_id(full_name). '
  'No insert/update/delete policy — every write is a guarded RPC (0740).';

create table public.rh_ticket_photos (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.rh_tickets(id),
  kind        text not null check (kind in ('report','fix')),
  fix_round   int  not null default 1,
  path        text not null check (path like 'tickets/%' and path not like '%..%'),
  uploaded_by uuid default auth.uid() references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.rh_ticket_joiners (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.rh_tickets(id),
  profile_id uuid not null references public.profiles(id),
  joined_at  timestamptz not null default now(),
  unique (ticket_id, profile_id)
);

-- ticket_id is NULL only for a director digest (it lists many tickets).
create table public.rh_ticket_activity (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid references public.rh_tickets(id),
  actor_id    uuid references public.profiles(id),
  action      text not null,
  from_status text,
  to_status   text,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  check (ticket_id is not null or action = 'digest')
);

create table public.rh_ticket_notes (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.rh_tickets(id),
  author_id  uuid default auth.uid() references public.profiles(id),
  body       text not null check (btrim(body) <> ''),
  visibility text not null default 'internal' check (visibility in ('internal','reporter')),
  created_at timestamptz not null default now()
);

create table public.rh_ratings (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.rh_tickets(id),
  fix_round  int  not null,
  rater_id   uuid not null references public.profiles(id),
  stars      int  not null check (stars between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  unique (ticket_id, fix_round)
);

create table public.rh_report_ledger (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  ticket_id  uuid references public.rh_tickets(id),
  kind       text not null,
  created_at timestamptz not null default now()
);

create table public.rh_ref_counters (
  prefix  text not null check (prefix in ('BRK','CMP','REQ')),
  year    int  not null,
  last_no int  not null default 0,
  primary key (prefix, year)
);

create table public.rh_outbox (
  id              uuid primary key default gen_random_uuid(),
  activity_id     uuid not null references public.rh_ticket_activity(id),
  ticket_id       uuid references public.rh_tickets(id),
  location_id     uuid references public.locations(id),
  event_key       text not null,
  recipient_id    uuid not null references public.profiles(id),
  channel         text not null check (channel in ('in_app','sms')),
  dedupe_key      text not null unique,
  status          text not null default 'pending'
                  check (status in ('pending','sent','failed','skipped','suppressed')),
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
comment on table public.rh_outbox is
  'Resolve Hub notification outbox. location-scope: exempt -- no client policy at all; '
  'written by the activity trigger and drained by the service role through '
  'rh_outbox_claim / rh_outbox_mark.';

create table public.rh_escalations (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.rh_tickets(id),
  level      int  not null check (level in (1,3,7)),
  fix_round  int  not null,
  created_at timestamptz not null default now(),
  unique (ticket_id, level, fix_round)
);

-- ─── 2. Indexes ─────────────────────────────────────────────────────────────

create index rh_places_location_idx        on public.rh_places (location_id);
create index rh_teams_location_trade_idx   on public.rh_teams (location_id, trade_id);
create index rh_team_members_profile_idx   on public.rh_team_members (profile_id);
create index rh_overrides_location_idx     on public.rh_routing_overrides (location_id);
create index rh_tickets_location_status_idx on public.rh_tickets (location_id, status);
create index rh_tickets_owner_idx          on public.rh_tickets (owner_id);
create index rh_tickets_assignee_idx       on public.rh_tickets (assignee_id);
create index rh_tickets_team_idx           on public.rh_tickets (team_id);
create index rh_tickets_reporter_idx       on public.rh_tickets (reporter_id);
create index rh_tickets_place_created_idx  on public.rh_tickets (place_id, created_at);
create index rh_tickets_due_active_idx     on public.rh_tickets (due_at)
  where status in ('open','in_progress','blocked','fixed');
create index rh_photos_ticket_idx          on public.rh_ticket_photos (ticket_id);
create index rh_joiners_profile_idx        on public.rh_ticket_joiners (profile_id);
create index rh_activity_ticket_idx        on public.rh_ticket_activity (ticket_id, created_at);
create index rh_notes_ticket_idx           on public.rh_ticket_notes (ticket_id);
create index rh_ledger_profile_idx         on public.rh_report_ledger (profile_id, created_at);
create index rh_outbox_pending_idx         on public.rh_outbox (next_attempt_at) where status = 'pending';
create index rh_outbox_sms_day_idx         on public.rh_outbox (location_id, created_at) where channel = 'sms';

-- ─── 3. updated_at ──────────────────────────────────────────────────────────

create trigger rh_unit_settings_updated_at before update on public.rh_unit_settings
  for each row execute function public.set_updated_at();
create trigger rh_tickets_updated_at before update on public.rh_tickets
  for each row execute function public.set_updated_at();

-- ─── 4. Activity is append-only ─────────────────────────────────────────────

create or replace function public.rh_activity_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Ticket activity is a permanent record and cannot be changed or deleted.'
    using errcode = 'P0001';
end;
$$;
revoke all on function public.rh_activity_immutable() from public, anon, authenticated;

create trigger rh_ticket_activity_immutable
  before update or delete on public.rh_ticket_activity
  for each row execute function public.rh_activity_immutable();

-- ─── 5. Visibility predicates (SECURITY DEFINER, so policies never recurse) ─

-- Is this profile an ACTIVE member of that team?
create or replace function public.rh_is_team_member(p_team_id uuid, p_uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_team_id is not null and p_uid is not null and exists (
    select 1 from public.rh_team_members m
     where m.team_id = p_team_id and m.profile_id = p_uid and m.active)
$$;

-- Staff on a ticket: in the ticket's CURRENT unit, and owner / assignee /
-- worker on its team / triage / analytics / the unit's head or estate owner.
create or replace function public.rh_staff_row(
  p_location_id uuid, p_owner_id uuid, p_assignee_id uuid, p_team_id uuid,
  p_uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_uid is not null
     and public.is_current_location(p_location_id, p_uid)
     and (
          p_owner_id = p_uid
       or p_assignee_id = p_uid
       or (public.has_permission('resolve', 'edit', p_uid) and public.rh_is_team_member(p_team_id, p_uid))
       or public.has_permission('resolve', 'approve', p_uid)
       or public.has_permission('resolve', 'export', p_uid)
       or exists (select 1 from public.rh_unit_settings s
                   where s.location_id = p_location_id
                     and (s.unit_head_id = p_uid or s.estate_owner_id = p_uid))
     )
$$;

create or replace function public.rh_is_joiner(p_ticket_id uuid, p_uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rh_ticket_joiners j
                  where j.ticket_id = p_ticket_id and j.profile_id = p_uid)
$$;

create or replace function public.rh_is_staff_on(p_ticket_id uuid, p_uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rh_tickets t
                  where t.id = p_ticket_id
                    and public.rh_staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid))
$$;

-- Reporter or joiner (any unit), or staff on it (current unit).
create or replace function public.rh_can_see(p_ticket_id uuid, p_uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.rh_tickets t
     where t.id = p_ticket_id
       and (   (p_uid is not null and t.reporter_id = p_uid)
            or public.rh_is_joiner(t.id, p_uid)
            or public.rh_staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid)))
$$;

-- The child-table predicate CHECK 7 of check-location-scope.sql looks for.
-- Unlike the generated lv_* predicates, NULL is FALSE: the only NULL ticket_id
-- is a director digest, which no client reads.
create or replace function public.lv_rh_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select p_ticket_id is not null and public.rh_can_see(p_ticket_id) $$;

create or replace function public.lv_rh_team(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select p_team_id is null or exists (
  select 1 from public.rh_teams x where x.id = p_team_id and public.is_current_location(x.location_id)) $$;

revoke all on function public.rh_is_team_member(uuid, uuid) from public, anon;
revoke all on function public.rh_staff_row(uuid, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.rh_is_joiner(uuid, uuid) from public, anon;
revoke all on function public.rh_is_staff_on(uuid, uuid) from public, anon;
revoke all on function public.rh_can_see(uuid, uuid) from public, anon;
revoke all on function public.lv_rh_ticket(uuid) from public, anon;
revoke all on function public.lv_rh_team(uuid) from public, anon;
grant execute on function public.rh_is_team_member(uuid, uuid) to authenticated;
grant execute on function public.rh_staff_row(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.rh_is_joiner(uuid, uuid) to authenticated;
grant execute on function public.rh_is_staff_on(uuid, uuid) to authenticated;
grant execute on function public.rh_can_see(uuid, uuid) to authenticated;
grant execute on function public.lv_rh_ticket(uuid) to authenticated;
grant execute on function public.lv_rh_team(uuid) to authenticated;

-- ─── 6. RLS ─────────────────────────────────────────────────────────────────

alter table public.rh_unit_settings     enable row level security;
alter table public.rh_trades            enable row level security;
alter table public.rh_places            enable row level security;
alter table public.rh_teams             enable row level security;
alter table public.rh_team_members      enable row level security;
alter table public.rh_routing_overrides enable row level security;
alter table public.rh_tickets           enable row level security;
alter table public.rh_ticket_photos     enable row level security;
alter table public.rh_ticket_joiners    enable row level security;
alter table public.rh_ticket_activity   enable row level security;
alter table public.rh_ticket_notes      enable row level security;
alter table public.rh_ratings           enable row level security;
alter table public.rh_report_ledger     enable row level security;
alter table public.rh_ref_counters      enable row level security;
alter table public.rh_outbox            enable row level security;
alter table public.rh_escalations       enable row level security;

revoke all on public.rh_unit_settings, public.rh_trades, public.rh_places, public.rh_teams,
  public.rh_team_members, public.rh_routing_overrides, public.rh_tickets, public.rh_ticket_photos,
  public.rh_ticket_joiners, public.rh_ticket_activity, public.rh_ticket_notes, public.rh_ratings,
  public.rh_report_ledger, public.rh_ref_counters, public.rh_outbox, public.rh_escalations
  from anon;

-- Lifecycle tables: read-only to clients. The RPCs (owner postgres) write.
revoke insert, update, delete, truncate on public.rh_tickets, public.rh_ticket_photos,
  public.rh_ticket_joiners, public.rh_ticket_activity, public.rh_ticket_notes, public.rh_ratings
  from authenticated;
revoke all on public.rh_report_ledger, public.rh_ref_counters, public.rh_outbox, public.rh_escalations
  from authenticated;

-- Configuration ------------------------------------------------------------

create policy rh_unit_settings_select on public.rh_unit_settings for select to authenticated
  using (public.has_permission('resolve', 'view') and public.is_current_location(location_id));
create policy rh_unit_settings_insert on public.rh_unit_settings for insert to authenticated
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_unit_settings_update on public.rh_unit_settings for update to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id))
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));

create policy rh_trades_select on public.rh_trades for select to authenticated
  using (public.has_permission('resolve', 'view'));
create policy rh_trades_insert on public.rh_trades for insert to authenticated
  with check (public.has_permission('resolve', 'create'));
create policy rh_trades_update on public.rh_trades for update to authenticated
  using (public.has_permission('resolve', 'create'))
  with check (public.has_permission('resolve', 'create'));
create policy rh_trades_delete on public.rh_trades for delete to authenticated
  using (public.has_permission('resolve', 'create'));

create policy rh_places_select on public.rh_places for select to authenticated
  using (public.has_permission('resolve', 'view') and public.is_current_location(location_id));
create policy rh_places_insert on public.rh_places for insert to authenticated
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_places_update on public.rh_places for update to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id))
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_places_delete on public.rh_places for delete to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id));

create policy rh_teams_select on public.rh_teams for select to authenticated
  using (public.has_permission('resolve', 'view') and public.is_current_location(location_id));
create policy rh_teams_insert on public.rh_teams for insert to authenticated
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_teams_update on public.rh_teams for update to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id))
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_teams_delete on public.rh_teams for delete to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id));

create policy rh_team_members_select on public.rh_team_members for select to authenticated
  using (public.has_permission('resolve', 'view') and public.lv_rh_team(team_id));
create policy rh_team_members_insert on public.rh_team_members for insert to authenticated
  with check (public.has_permission('resolve', 'create') and public.lv_rh_team(team_id));
create policy rh_team_members_update on public.rh_team_members for update to authenticated
  using (public.has_permission('resolve', 'create') and public.lv_rh_team(team_id))
  with check (public.has_permission('resolve', 'create') and public.lv_rh_team(team_id));
create policy rh_team_members_delete on public.rh_team_members for delete to authenticated
  using (public.has_permission('resolve', 'create') and public.lv_rh_team(team_id));

create policy rh_routing_overrides_select on public.rh_routing_overrides for select to authenticated
  using (public.has_permission('resolve', 'view') and public.is_current_location(location_id));
create policy rh_routing_overrides_insert on public.rh_routing_overrides for insert to authenticated
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_routing_overrides_update on public.rh_routing_overrides for update to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id))
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_routing_overrides_delete on public.rh_routing_overrides for delete to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id));

-- Lifecycle (SELECT only) ----------------------------------------------------

-- Written out rather than `rh_can_see(id)` so the cross-unit half (reporter,
-- joiner) and the current-unit half (staff) are both visible in the policy.
create policy rh_tickets_select on public.rh_tickets for select to authenticated
  using (
       reporter_id = auth.uid()
    or public.rh_is_joiner(id)
    or (public.is_current_location(location_id)
        and public.rh_staff_row(location_id, owner_id, assignee_id, team_id))
  );

create policy rh_ticket_photos_select on public.rh_ticket_photos for select to authenticated
  using (public.lv_rh_ticket(ticket_id));
create policy rh_ticket_joiners_select on public.rh_ticket_joiners for select to authenticated
  using (public.lv_rh_ticket(ticket_id));
create policy rh_ticket_activity_select on public.rh_ticket_activity for select to authenticated
  using (public.lv_rh_ticket(ticket_id));
create policy rh_ticket_notes_select on public.rh_ticket_notes for select to authenticated
  using (public.lv_rh_ticket(ticket_id)
         and (visibility = 'reporter' or public.rh_is_staff_on(ticket_id)));
create policy rh_ratings_select on public.rh_ratings for select to authenticated
  using (public.lv_rh_ticket(ticket_id));

-- rh_report_ledger, rh_ref_counters, rh_outbox, rh_escalations: RLS on, no
-- policy, no privilege — service role and the definer functions only.
