-- ============================================================================
-- 0749 — Resolve Hub stage 3: Service Desk (IT ticketing) — schema, RLS, seeds.
--
-- Contract: doc/resolve/service-desk-plan.md §2. Functions/RPCs are in 0750.
--
-- A service request is an rh_tickets row with kind = 'service'. Its statuses
-- are its own (open = "New", assigned, in_progress, on_hold, resolved, closed,
-- cancelled, withdrawn); the status check stays PER KIND (0745's shape), so a
-- Broken ticket still cannot be 'on_hold' and a service request cannot be
-- 'fixed'. Visibility needs no new branch: rh__can_see's non-complaint branch
-- (reporter, joiner, staff on the unit/team) is exactly the desk's rule.
--
-- rh_tickets joins the supabase_realtime publication, so every Resolve Hub
-- screen can refresh itself when a ticket changes. Realtime evaluates
-- rh_tickets_select per subscriber, and current_location() reads profiles,
-- so a live update reaches exactly the people who could already read the row.
-- ============================================================================

-- ─── 1. Service categories, SLA matrix, knowledge base ─────────────────────

create table public.rh_sd_categories (
  id               uuid primary key default gen_random_uuid(),
  location_id      uuid not null default public.current_location() references public.locations(id),
  code             text not null,
  name             text not null,
  description      text,
  ticket_type      text not null default 'incident' check (ticket_type in ('incident', 'service', 'change')),
  team_id          uuid references public.rh_teams(id) on delete set null,
  default_priority text not null default 'low' check (default_priority in ('high', 'medium', 'low')),
  inactive         boolean not null default false,
  created_by       uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (location_id, code),
  unique (location_id, name)
);
create index rh_sd_categories_location_idx on public.rh_sd_categories (location_id);
comment on table public.rh_sd_categories is
  'Resolve Hub service-desk categories (per unit). team_id is the skill-based route; '
  'default_priority is the FLOOR under the requester''s stated impact — urgent is never a default.';

create table public.rh_sd_sla (
  location_id        uuid not null references public.locations(id) on delete cascade,
  priority           text not null check (priority in ('urgent', 'high', 'medium', 'low')),
  response_minutes   int  not null check (response_minutes between 1 and 43200),
  resolution_minutes int  not null check (resolution_minutes between 1 and 525600),
  updated_at         timestamptz not null default now(),
  primary key (location_id, priority),
  check (resolution_minutes >= response_minutes)
);
comment on table public.rh_sd_sla is
  'Resolve Hub service-desk SLA matrix, wall-clock minutes. On Hold pauses resolution only.';

-- array_to_string is only STABLE, which a generated column refuses; joining
-- text with a space depends on nothing but its input, so this wrapper is
-- honestly immutable.
create or replace function public.rh__kb_join(p text[])
returns text
language sql immutable parallel safe set search_path = ''
as $$ select coalesce(array_to_string(p, ' '), '') $$;
revoke all on function public.rh__kb_join(text[]) from public, anon;
grant execute on function public.rh__kb_join(text[]) to authenticated;

create table public.rh_kb_articles (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  title             text not null check (btrim(title) <> ''),
  problem           text not null check (btrim(problem) <> ''),
  steps             text[] not null check (cardinality(steps) >= 1),
  tags              text[] not null default '{}',
  category_code     text,
  status            text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  source_ticket_id  uuid references public.rh_tickets(id) on delete set null,
  author_id         uuid default auth.uid() references public.profiles(id) on delete set null,
  published_at      timestamptz,
  used_count        int not null default 0 check (used_count >= 0),
  helpful_count     int not null default 0 check (helpful_count >= 0),
  not_helpful_count int not null default 0 check (not_helpful_count >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search            tsvector generated always as (
                      setweight(to_tsvector('simple', coalesce(title, '')), 'A')
                   || setweight(to_tsvector('simple', coalesce(problem, '') || ' '
                                 || public.rh__kb_join(tags)), 'B')
                   || setweight(to_tsvector('simple', public.rh__kb_join(steps)), 'C')
                    ) stored
);
create index rh_kb_articles_search_idx on public.rh_kb_articles using gin (search);
create index rh_kb_articles_status_idx on public.rh_kb_articles (status);
comment on table public.rh_kb_articles is
  'Resolve Hub knowledge base. location-scope: exempt -- shared knowledge, like master data; '
  'keyed to categories by CODE because category rows are per unit. Writes only through rh_kb_* RPCs (0750).';

create table public.rh_kb_feedback (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.rh_kb_articles(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  helpful    boolean not null,
  ticket_id  uuid references public.rh_tickets(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (article_id, profile_id)
);
comment on table public.rh_kb_feedback is
  'One helpful / not-helpful vote per person per article. location-scope: exempt -- no client policy; '
  'written by rh_kb_feedback only. ticket_id NULL + helpful = a request the article deflected.';

-- ─── 2. Settings + ticket columns ───────────────────────────────────────────

alter table public.rh_unit_settings
  add column desk_manager_id        uuid references public.profiles(id) on delete set null,
  add column sd_auto_close_days     int not null default 3 check (sd_auto_close_days between 1 and 90),
  add column sd_stale_remind_days   int not null default 3 check (sd_stale_remind_days between 1 and 90),
  add column sd_stale_escalate_days int not null default 4 check (sd_stale_escalate_days between 1 and 90),
  add column sd_reopen_days         int not null default 7 check (sd_reopen_days between 0 and 90);

alter table public.rh_tickets
  add column ticket_type            text check (ticket_type in ('incident', 'service', 'change')),
  add column impact                 text check (impact in ('cannot_work', 'degraded', 'request')),
  add column sd_category_id         uuid references public.rh_sd_categories(id),
  add column root_cause             text,
  add column kb_article_id          uuid references public.rh_kb_articles(id) on delete set null,
  add column override_kind          text check (override_kind in ('financial_risk', 'executive_directive')),
  add column override_note          text,
  add column overridden_at          timestamptz,
  add column overridden_by          uuid references public.profiles(id),
  add column preempted_by           uuid references public.rh_tickets(id) on delete set null,
  add column last_activity_at       timestamptz not null default now(),
  add column stale_reminded_at      timestamptz,
  add column stale_escalated_at     timestamptz,
  add column sla_warned_at          timestamptz,
  add column response_breached_at   timestamptz,
  add column resolution_breached_at timestamptz;

comment on column public.rh_tickets.overridden_by is
  'FIFTH FK to profiles — every PostgREST embed on rh_tickets must name its column.';
comment on column public.rh_tickets.last_activity_at is
  'Last PERSON activity (actor_id not null) or note. The stale clock reads it; system rows never reset it.';

-- Constraint names are read from the catalog, not guessed: the pause check was
-- declared unnamed in 0739.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.rh_tickets'::regclass and c.contype = 'c'
       and (c.conname in ('rh_tickets_kind_check', 'rh_tickets_source_check',
                          'rh_tickets_closure_kind_check', 'rh_tickets_status_check',
                          'rh_tickets_complaint_shape')
            or pg_get_constraintdef(c.oid) like '%paused_at IS NOT NULL%')
  loop
    execute format('alter table public.rh_tickets drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.rh_tickets
  add constraint rh_tickets_kind_check
    check (kind in ('broken', 'complaint', 'requirement', 'service')),
  add constraint rh_tickets_source_check
    check (source in ('form', 'qr', 'ai', 'phone', 'email', 'chat', 'whatsapp')),
  add constraint rh_tickets_closure_kind_check
    check (closure_kind in ('auto_photo', 'spot_checked', 'owner_confirmed',
                            'requester_confirmed', 'auto_timeout')),
  add constraint rh_tickets_status_check check (
       (kind in ('broken', 'requirement')
        and status in ('open', 'in_progress', 'blocked', 'fixed', 'closed', 'cancelled', 'withdrawn'))
    or (kind = 'complaint'
        and status in ('open', 'assigned', 'in_progress', 'escalated', 'resolved', 'withdrawn'))
    or (kind = 'service'
        and status in ('open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed',
                       'cancelled', 'withdrawn'))),
  add constraint rh_tickets_paused_check
    check ((status in ('blocked', 'on_hold')) = (paused_at is not null)),
  add constraint rh_tickets_complaint_shape check (
    kind <> 'complaint' or (category_id is not null and place_id is null and trade_id is null)),
  add constraint rh_tickets_service_shape check (
    kind <> 'service' or (sd_category_id is not null and ticket_type is not null and impact is not null
                          and trade_id is null and category_id is null)),
  add constraint rh_tickets_override_shape check (
    (override_kind is null) = (overridden_at is null));

create index rh_tickets_sd_category_idx on public.rh_tickets (sd_category_id) where sd_category_id is not null;
create index rh_tickets_service_live_idx on public.rh_tickets (location_id, status, priority, created_at)
  where kind = 'service';
create index rh_tickets_overridden_by_idx on public.rh_tickets (overridden_by) where overridden_by is not null;

alter table public.rh_ref_counters drop constraint rh_ref_counters_prefix_check;
alter table public.rh_ref_counters add constraint rh_ref_counters_prefix_check
  check (prefix in ('BRK', 'CMP', 'REQ', 'SD', 'KB'));

-- ─── 3. updated_at ──────────────────────────────────────────────────────────

create trigger rh_sd_sla_updated_at before update on public.rh_sd_sla
  for each row execute function public.set_updated_at();
create trigger rh_kb_articles_updated_at before update on public.rh_kb_articles
  for each row execute function public.set_updated_at();

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────

alter table public.rh_sd_categories enable row level security;
alter table public.rh_sd_sla        enable row level security;
alter table public.rh_kb_articles   enable row level security;
alter table public.rh_kb_feedback   enable row level security;
revoke all on public.rh_sd_categories, public.rh_sd_sla, public.rh_kb_articles, public.rh_kb_feedback
  from anon;

-- Configuration (resolve:create, current unit) — the 0739 shape.
create policy rh_sd_categories_select on public.rh_sd_categories for select to authenticated
  using (public.has_permission('resolve', 'view') and public.is_current_location(location_id));
create policy rh_sd_categories_insert on public.rh_sd_categories for insert to authenticated
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_sd_categories_update on public.rh_sd_categories for update to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id))
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_sd_categories_delete on public.rh_sd_categories for delete to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id));

create policy rh_sd_sla_select on public.rh_sd_sla for select to authenticated
  using (public.has_permission('resolve', 'view') and public.is_current_location(location_id));
create policy rh_sd_sla_insert on public.rh_sd_sla for insert to authenticated
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_sd_sla_update on public.rh_sd_sla for update to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id))
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));

-- Knowledge: published to every reporter, every status to technicians.
-- Writes are RPC-only (numbering, author, publish state).
revoke insert, update, delete, truncate on public.rh_kb_articles from authenticated;
revoke all on public.rh_kb_feedback from authenticated;
create policy rh_kb_articles_select on public.rh_kb_articles for select to authenticated
  using (   (status = 'published' and public.has_permission('resolve', 'view'))
         or public.has_permission('resolve', 'edit'));

-- ─── 5. Realtime ────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'rh_tickets') then
    execute 'alter publication supabase_realtime add table public.rh_tickets';
  end if;
end;
$$;

-- ─── 6. Seeds ───────────────────────────────────────────────────────────────

-- The desk team, one per unit, on the shared IT trade (0741 seeded it).
insert into public.rh_teams (location_id, trade_id, name, created_by)
select l.id, t.id, 'IT SERVICE DESK', null
  from public.locations l
  cross join public.rh_trades t
 where t.code = 'IT'
on conflict (location_id, name) do nothing;

insert into public.rh_sd_categories
  (location_id, code, name, description, ticket_type, team_id, default_priority, created_by)
select l.id, c.code, c.name, c.description, c.ticket_type,
       (select tm.id from public.rh_teams tm where tm.location_id = l.id and tm.name = 'IT SERVICE DESK'),
       c.pri, null
  from public.locations l
  cross join (values
    ('HW',  'HARDWARE',                  'Computer, monitor, keyboard, mouse, UPS not working', 'incident', 'medium'),
    ('SW',  'SOFTWARE',                  'An application will not open, crashes or needs repair', 'incident', 'low'),
    ('NET', 'NETWORK & INTERNET',        'No internet, slow network, Wi-Fi or LAN problems', 'incident', 'medium'),
    ('PRN', 'PRINTER & SCANNER',         'Printing, scanning or driver problems', 'incident', 'low'),
    ('ERP', 'ERP ERRORS',                'An error or wrong behaviour in this ERP', 'incident', 'medium'),
    ('ACC', 'EMAIL & ACCOUNTS',          'New email account, password reset, distribution lists', 'service', 'low'),
    ('PRM', 'ERP ACCESS & PERMISSIONS',  'Access to a screen, a unit or a role in this ERP', 'service', 'low'),
    ('DEV', 'NEW DEVICE / INSTALLATION', 'Set up a new computer, phone or software', 'service', 'low'),
    ('MOV', 'WORKSTATION MOVE',          'Move a computer or desk to another place', 'change', 'low'),
    ('SRV', 'SERVER CHANGE',             'Server upgrade, storage or partition change', 'change', 'low')
  ) as c(code, name, description, ticket_type, pri)
on conflict (location_id, code) do nothing;

-- The spec's own ranges (§6.1): response 10 min – 1 h, resolution 30 min – 4 h.
insert into public.rh_sd_sla (location_id, priority, response_minutes, resolution_minutes)
select l.id, m.priority, m.resp, m.resol
  from public.locations l
  cross join (values ('urgent', 10, 30), ('high', 20, 60), ('medium', 30, 120), ('low', 60, 240))
       as m(priority, resp, resol)
on conflict (location_id, priority) do nothing;

insert into public.notification_event_settings (event_key, mandatory, push, fallback_to_admins) values
  ('resolve.sd_new',      true,  true, true),
  ('resolve.sd_reply',    false, true, false),
  ('resolve.sd_update',   false, true, false),
  ('resolve.sd_resolved', false, true, false),
  ('resolve.sd_reopened', false, true, false),
  ('resolve.sd_urgent',   true,  true, true),
  ('resolve.sd_breach',   true,  true, true),
  ('resolve.sd_warning',  false, true, false),
  ('resolve.sd_stale',    false, true, false)
on conflict (event_key) do nothing;
