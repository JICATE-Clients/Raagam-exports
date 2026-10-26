-- ============================================================================
-- 0740 — Resolve Hub: routing, SLA, lifecycle RPCs, outbox, sweeps, reports
--
-- Contract: doc/resolve/resolve-hub-plan.md §4–§8.
--
-- ONE RULE FOR "MAY I": `rh_actions_of(ticket, uid)` is the list the
-- next-action panel renders (`rh_ticket_actions`), and EVERY transition RPC
-- asks the same function through `rh_require` before it writes. The screen
-- and the guard cannot disagree because there is only one of them.
--
-- Every RPC: SECURITY DEFINER, search_path '', schema-qualified, the ticket
-- locked `for update`, one activity row per transition, errors are
-- `P0001` with a sentence an operator can read. The activity row's AFTER
-- INSERT trigger fills `rh_outbox` (§8), so every write path notifies the
-- same way.
--
-- Internal helpers (settings, routing, due, leave, lock, log) are revoked
-- from every client role; only the RPCs and the service-role drain are
-- granted.
-- ============================================================================

-- ─── 1. Settings (insert-on-read) ───────────────────────────────────────────

create or replace function public.rh_settings(p_location_id uuid)
returns public.rh_unit_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.rh_unit_settings;
begin
  select * into s from public.rh_unit_settings where location_id = p_location_id;
  if not found and exists (select 1 from public.locations l where l.id = p_location_id) then
    insert into public.rh_unit_settings (location_id) values (p_location_id)
      on conflict (location_id) do nothing;
    select * into s from public.rh_unit_settings where location_id = p_location_id;
  end if;
  return s;
end;
$$;

-- ─── 2. People: staff link, leave, manager (0674's login rule) ──────────────

create or replace function public.rh_staff_of(p_profile_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
    from public.profiles pr
    join public.staff s
      on (nullif(btrim(pr.employee_code), '') is not null
          and lower(btrim(s.code)) = lower(btrim(pr.employee_code)))
      or (nullif(btrim(pr.email), '') is not null
          and lower(btrim(s.email)) = lower(btrim(pr.email)))
   where pr.id = p_profile_id
   order by (lower(btrim(coalesce(s.code, ''))) = lower(btrim(coalesce(pr.employee_code, '')))) desc,
            s.is_active desc
   limit 1
$$;

-- Approved, non-encashment staff leave covering TODAY in IST.
create or replace function public.rh_on_leave(p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_profile_id is not null and exists (
    select 1 from public.hr_leaves l
     where l.employee_type = 'staff'
       and l.employee_id = public.rh_staff_of(p_profile_id)
       and l.status = 'approved'
       and not l.is_encashment
       and (now() at time zone 'Asia/Kolkata')::date
           between l.from_date and coalesce(l.to_date, l.from_date))
$$;

-- staff.manager_id → that staff member's login.
create or replace function public.rh_manager_of(p_profile_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select e.profile_id
    from public.staff s
    cross join lateral public.employee_login_ids(array[s.manager_id]) e
   where s.id = public.rh_staff_of(p_profile_id)
     and s.manager_id is not null
   limit 1
$$;

-- ─── 3. Routing (§5) ────────────────────────────────────────────────────────

create or replace function public.rh_route(
  p_location_id uuid, p_place_id uuid, p_trade_id uuid, p_source text)
returns table (owner_id uuid, team_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s         public.rh_unit_settings;
  v_place   public.rh_places;
  v_team    uuid;
  v_lead    uuid;
  v_member  uuid;
  c_ids     uuid[] := '{}';
  c_why     text[] := '{}';
  v_cand    uuid;
  v_mgr     uuid;
  i         int;
begin
  s := public.rh_settings(p_location_id);
  if p_place_id is not null then
    select * into v_place from public.rh_places p where p.id = p_place_id;
  end if;

  if p_trade_id is not null then
    select t.id, t.lead_id into v_team, v_lead
      from public.rh_teams t
     where t.location_id = p_location_id and t.trade_id = p_trade_id and not t.inactive
     order by t.created_at
     limit 1;
    if v_team is not null then
      select m.profile_id into v_member
        from public.rh_team_members m
       where m.team_id = v_team and m.active
       order by m.created_at, m.id
       limit 1;
    end if;
  end if;

  -- 1. explicit overrides: place + trade, then place, then trade
  if p_place_id is not null and p_trade_id is not null then
    c_ids := c_ids || (select o.owner_id from public.rh_routing_overrides o
                        where o.location_id = p_location_id and o.place_id = p_place_id
                          and o.trade_id = p_trade_id order by o.created_at desc limit 1);
    c_why := c_why || 'Routing rule (place + trade)'::text;
  end if;
  if p_place_id is not null then
    c_ids := c_ids || (select o.owner_id from public.rh_routing_overrides o
                        where o.location_id = p_location_id and o.place_id = p_place_id
                          and o.trade_id is null order by o.created_at desc limit 1);
    c_why := c_why || 'Routing rule (place)'::text;
  end if;
  if p_trade_id is not null then
    c_ids := c_ids || (select o.owner_id from public.rh_routing_overrides o
                        where o.location_id = p_location_id and o.trade_id = p_trade_id
                          and o.place_id is null order by o.created_at desc limit 1);
    c_why := c_why || 'Routing rule (trade)'::text;
  end if;
  -- 2. QR scan → the place's caretaker
  if p_source = 'qr' then
    c_ids := c_ids || v_place.caretaker_id;
    c_why := c_why || 'Caretaker of the place (QR scan)'::text;
  end if;
  -- 3. trade team: lead, else first active member
  c_ids := c_ids || v_lead;    c_why := c_why || 'Team lead'::text;
  c_ids := c_ids || v_member;  c_why := c_why || 'Team member'::text;
  -- 4 / 5. unit fallbacks
  c_ids := c_ids || s.estate_owner_id;  c_why := c_why || 'Estate office'::text;
  c_ids := c_ids || s.unit_head_id;     c_why := c_why || 'Unit head'::text;

  for i in 1 .. coalesce(array_length(c_ids, 1), 0) loop
    v_cand := c_ids[i];
    continue when v_cand is null;
    continue when not exists (select 1 from public.profiles p where p.id = v_cand and p.is_active);
    if not public.rh_on_leave(v_cand) then
      owner_id := v_cand; team_id := v_team; reason := c_why[i];
      return next; return;
    end if;
    v_mgr := public.rh_manager_of(v_cand);
    if v_mgr is not null and not public.rh_on_leave(v_mgr)
       and exists (select 1 from public.profiles p where p.id = v_mgr and p.is_active) then
      owner_id := v_mgr; team_id := v_team; reason := c_why[i] || ' on leave → manager';
      return next; return;
    end if;
  end loop;

  owner_id := null; team_id := v_team; reason := 'Nobody to route to — waiting for triage';
  return next;
end;
$$;

-- ─── 4. Due date (§5) ───────────────────────────────────────────────────────

create or replace function public.rh_due_at(
  p_location_id uuid, p_dangerous boolean, p_routine boolean, p_from timestamptz default now())
returns timestamptz
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_ord   int;
  v_rout  int;
  v_local timestamp;
  v_eod   timestamptz;
begin
  select s.timezone, s.ordinary_days, s.routine_days into v_tz, v_ord, v_rout
    from public.rh_unit_settings s where s.location_id = p_location_id;
  v_tz   := coalesce(v_tz, 'Asia/Kolkata');
  v_ord  := coalesce(v_ord, 2);
  v_rout := coalesce(v_rout, 7);
  if coalesce(p_dangerous, false) then
    v_local := p_from at time zone v_tz;
    v_eod   := (date_trunc('day', v_local) + interval '1 day' - interval '1 second') at time zone v_tz;
    if v_local::time >= time '18:00' then
      return greatest(v_eod, p_from + interval '4 hours');
    end if;
    return v_eod;
  elsif coalesce(p_routine, false) then
    return p_from + make_interval(days => v_rout);
  end if;
  return p_from + make_interval(days => v_ord);
end;
$$;

-- ─── 5. Lock, log, the one "may I" ──────────────────────────────────────────

create or replace function public.rh_lock(p_ticket_id uuid, p_check_visible boolean default true)
returns public.rh_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tickets;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = 'P0001';
  end if;
  select * into t from public.rh_tickets where id = p_ticket_id for update;
  if not found or (p_check_visible and not public.rh_can_see(t.id)) then
    raise exception 'That ticket does not exist or you do not have access to it.' using errcode = 'P0001';
  end if;
  return t;
end;
$$;

create or replace function public.rh_log(
  p_ticket_id uuid, p_action text, p_from text, p_to text, p_note text, p_meta jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, note, meta)
  values (p_ticket_id, auth.uid(), p_action, p_from, p_to, nullif(btrim(p_note), ''), coalesce(p_meta, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rh_actions_of(t public.rh_tickets, p_uid uuid default auth.uid())
returns text[]
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  a          text[] := '{}';
  v_unit     boolean;
  v_oa       boolean;
  v_triage   boolean;
  v_reporter boolean;
  v_active   boolean := t.status in ('open', 'in_progress', 'blocked');
  v_window   int;
begin
  if p_uid is null or t.id is null then
    return a;
  end if;
  v_unit     := public.is_current_location(t.location_id, p_uid);
  v_reporter := t.reporter_id = p_uid;

  if not public.rh_can_see(t.id, p_uid) then
    -- Somebody who found it through rh_similar_open: joining is the one thing.
    if v_unit and v_active and t.kind = 'broken'
       and public.has_permission('resolve', 'view', p_uid) then
      a := a || 'join'::text;
    end if;
    return a;
  end if;

  v_oa     := v_unit and (t.owner_id = p_uid or t.assignee_id = p_uid);
  v_triage := v_unit and public.has_permission('resolve', 'approve', p_uid);
  select coalesce((select s.dispute_window_days from public.rh_unit_settings s
                    where s.location_id = t.location_id), 7) into v_window;

  if v_unit and t.assignee_id is null and t.status in ('open', 'in_progress')
     and public.has_permission('resolve', 'edit', p_uid)
     and public.rh_is_team_member(t.team_id, p_uid) then
    a := a || 'claim'::text;
  end if;
  if v_triage and v_active then a := a || 'assign'::text; end if;
  if v_oa and t.status = 'open' then a := a || 'start'::text; end if;
  if v_oa and t.status in ('open', 'in_progress') then a := a || 'block'::text; end if;
  if (v_oa or v_triage) and t.status = 'blocked' then a := a || 'unblock'::text; end if;
  if v_oa and t.status = 'in_progress' then a := a || 'fix'::text; end if;
  if v_triage and t.status = 'fixed' and t.spot_check_pending then a := a || 'spot_check'::text; end if;
  if ((v_unit and t.owner_id = p_uid) or v_triage) and t.status = 'fixed' then
    a := a || 'owner_confirm'::text;
  end if;
  if v_reporter and t.status = 'closed' and t.closed_at is not null
     and t.closed_at >= now() - make_interval(days => v_window) then
    a := a || 'dispute'::text;
  end if;
  if v_triage and t.status = 'open' then a := a || 'cancel'::text; end if;
  if v_reporter and t.status = 'open' then a := a || 'withdraw'::text; end if;
  if v_reporter and t.status = 'open' then a := a || 'edit_report'::text; end if;
  if v_triage and t.status in ('open', 'in_progress', 'blocked', 'fixed') then
    a := a || 'reclassify'::text;
  end if;
  if public.rh_staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid) then
    a := a || 'note_internal'::text;
  end if;
  a := a || 'note_reporter'::text;
  if v_reporter and t.status = 'closed'
     and not exists (select 1 from public.rh_ratings r
                      where r.ticket_id = t.id and r.fix_round = t.fix_round) then
    a := a || 'rate'::text;
  end if;
  if not v_reporter and v_unit and v_active and t.kind = 'broken'
     and not public.rh_is_joiner(t.id, p_uid)
     and public.has_permission('resolve', 'view', p_uid) then
    a := a || 'join'::text;
  end if;
  return a;
end;
$$;

create or replace function public.rh_require(t public.rh_tickets, p_action text, p_what text)
returns void
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not (p_action = any (public.rh_actions_of(t))) then
    raise exception '%', format('You can''t %s %s — it is %s, or this step is not yours to take.',
                                p_what, t.ref_no, replace(t.status, '_', ' '))
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.rh_ticket_actions(p_ticket_id uuid)
returns text[]
language sql stable
security definer
set search_path = ''
as $$
  select coalesce((select public.rh_actions_of(t) from public.rh_tickets t where t.id = p_ticket_id), '{}')
$$;

-- ─── 6. Reporting ───────────────────────────────────────────────────────────

create or replace function public.rh_submit_broken(
  p_place_id     uuid    default null,
  p_trade_id     uuid    default null,
  p_title        text    default null,
  p_description  text    default null,
  p_is_dangerous boolean default false,
  p_photo_path   text    default null,
  p_gps_lat      numeric default null,
  p_gps_lng      numeric default null,
  p_source       text    default 'form')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_loc       uuid;
  s           public.rh_unit_settings;
  v_place     public.rh_places;
  v_trade     uuid := p_trade_id;
  v_source    text := coalesce(nullif(btrim(p_source), ''), 'form');
  v_danger    boolean := coalesce(p_is_dangerous, false);
  v_n         int;
  v_no        int;
  v_year      int;
  v_ref       text;
  v_owner     uuid;
  v_team      uuid;
  v_reason    text;
  v_sort      boolean;
  v_due       timestamptz;
  v_id        uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again to report a problem.' using errcode = 'P0001';
  end if;
  if not public.has_permission('resolve', 'view') then
    raise exception 'You do not have access to Resolve Hub.' using errcode = 'P0001';
  end if;
  v_loc := public.current_location();
  if v_loc is null then
    raise exception 'Choose a unit before reporting a problem.' using errcode = 'P0001';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Say in a few words what is broken.' using errcode = 'P0001';
  end if;
  if v_source not in ('form', 'qr', 'ai') then
    raise exception 'Unknown report source "%".', v_source using errcode = 'P0001';
  end if;
  if p_photo_path is not null
     and (btrim(p_photo_path) = '' or p_photo_path not like 'tickets/%' or p_photo_path like '%..%') then
    raise exception 'The photo upload is not valid — please attach it again.' using errcode = 'P0001';
  end if;
  if (p_gps_lat is not null and abs(p_gps_lat) > 90) or (p_gps_lng is not null and abs(p_gps_lng) > 180) then
    raise exception 'The location reading is not valid.' using errcode = 'P0001';
  end if;
  if p_place_id is not null then
    select * into v_place from public.rh_places p where p.id = p_place_id;
    if not found or v_place.location_id <> v_loc or v_place.inactive then
      raise exception 'That place is not in your current unit.' using errcode = 'P0001';
    end if;
    v_trade := coalesce(v_trade, v_place.default_trade_id);
  elsif v_source = 'qr' then
    raise exception 'A sticker report needs its place.' using errcode = 'P0001';
  end if;
  if v_trade is not null and not exists (select 1 from public.rh_trades x where x.id = v_trade and not x.inactive) then
    raise exception 'That trade is not available.' using errcode = 'P0001';
  end if;

  -- Rate limit: one submit at a time per person, counted in the same tx.
  perform pg_advisory_xact_lock(hashtextextended('rh_report:' || v_uid::text, 0));
  s := public.rh_settings(v_loc);
  select count(*) into v_n from public.rh_report_ledger l
   where l.profile_id = v_uid and l.created_at > now() - interval '24 hours';
  if v_n >= s.report_limit_24h then
    raise exception '%', format('You have sent %s reports in the last 24 hours, which is the limit. '
                                'Please try again later, or ask your supervisor to report it.', v_n)
      using errcode = 'P0001';
  end if;

  v_year := extract(year from (now() at time zone s.timezone))::int;
  insert into public.rh_ref_counters as c (prefix, year, last_no) values ('BRK', v_year, 1)
    on conflict (prefix, year) do update set last_no = c.last_no + 1
    returning c.last_no into v_no;
  v_ref := 'BRK-' || v_year || '-' || lpad(v_no::text, 6, '0');

  select r.owner_id, r.team_id, r.reason into v_owner, v_team, v_reason
    from public.rh_route(v_loc, p_place_id, v_trade, v_source) r;
  v_sort := v_trade is null or v_owner is null;
  v_due  := public.rh_due_at(v_loc, v_danger, false, now());

  insert into public.rh_tickets (
    location_id, kind, ref_no, status, reporter_id, place_id, trade_id, title, description,
    is_dangerous, severity, priority, is_routine, source, gps_lat, gps_lng,
    owner_id, owner_reason, team_id, due_at, needs_sorting, created_by)
  values (
    v_loc, 'broken', v_ref, 'open', v_uid, p_place_id, v_trade, btrim(p_title), nullif(btrim(p_description), ''),
    v_danger, case when v_danger then 'critical' else 'medium' end,
    case when v_danger then 'urgent' else 'medium' end, false, v_source,
    round(p_gps_lat, 4), round(p_gps_lng, 4),
    v_owner, v_reason, v_team, v_due, v_sort, v_uid)
  returning id into v_id;

  if p_photo_path is not null then
    insert into public.rh_ticket_photos (ticket_id, kind, fix_round, path, uploaded_by)
    values (v_id, 'report', 1, p_photo_path, v_uid);
  end if;
  insert into public.rh_report_ledger (profile_id, ticket_id, kind) values (v_uid, v_id, 'broken');
  perform public.rh_log(v_id, 'created', null, 'open', null,
    jsonb_build_object('dangerous', v_danger, 'owner_reason', v_reason, 'needs_sorting', v_sort));

  return jsonb_build_object(
    'ticket_id', v_id, 'ref_no', v_ref, 'owner_id', v_owner,
    'owner_name', (select p.full_name from public.profiles p where p.id = v_owner),
    'owner_reason', v_reason, 'due_at', v_due, 'needs_sorting', v_sort);
end;
$$;

create or replace function public.rh_similar_open(p_place_id uuid)
returns table (id uuid, ref_no text, title text, status text, is_dangerous boolean,
               created_at timestamptz, joiners int)
language sql stable
security definer
set search_path = ''
as $$
  select t.id, t.ref_no, t.title, t.status, t.is_dangerous, t.created_at,
         (select count(*)::int from public.rh_ticket_joiners j where j.ticket_id = t.id)
    from public.rh_tickets t
   where public.has_permission('resolve', 'view')
     and t.location_id = public.current_location()
     and t.place_id = p_place_id
     and t.kind = 'broken'
     and t.status in ('open', 'in_progress', 'blocked', 'fixed')
     and t.created_at >= now() - make_interval(days => coalesce(
           (select s.dup_window_days from public.rh_unit_settings s where s.location_id = t.location_id), 14))
   order by t.created_at desc
$$;

create or replace function public.rh_place_by_token(p_token text)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  p public.rh_places;
begin
  if not public.has_permission('resolve', 'view') then
    raise exception 'You do not have access to Resolve Hub.' using errcode = 'P0001';
  end if;
  select * into p from public.rh_places x
   where x.qr_token = p_token and p_token is not null and length(p_token) >= 16 and not x.inactive;
  if not found then
    raise exception 'This sticker is not recognised — it may have been replaced.' using errcode = 'P0001';
  end if;
  if not public.has_location_access(p.location_id) then
    raise exception 'This sticker belongs to a unit you do not have access to.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'place_id', p.id, 'name', p.name, 'location_id', p.location_id,
    'location_name', (select l.name from public.locations l where l.id = p.location_id),
    'caretaker_name', (select pr.full_name from public.profiles pr where pr.id = p.caretaker_id),
    'recent_90d', (select count(*)::int from public.rh_tickets t
                    where t.place_id = p.id and t.created_at >= now() - interval '90 days'));
end;
$$;

create or replace function public.rh_join(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id, false);
begin
  if t.reporter_id = auth.uid() then
    raise exception 'This is your own report — you are already on it.' using errcode = 'P0001';
  end if;
  if public.rh_is_joiner(t.id) then
    raise exception 'You have already joined this report.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'join', 'join');
  insert into public.rh_ticket_joiners (ticket_id, profile_id) values (t.id, auth.uid());
  perform public.rh_log(t.id, 'joined', t.status, t.status, null);
  return jsonb_build_object('ticket_id', t.id, 'ref_no', t.ref_no, 'joined', true);
end;
$$;

-- ─── 7. Work ────────────────────────────────────────────────────────────────

create or replace function public.rh_claim(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'claim', 'claim');
  update public.rh_tickets set assignee_id = auth.uid() where id = t.id;
  perform public.rh_log(t.id, 'claimed', t.status, t.status, null,
                        jsonb_build_object('assignee_id', auth.uid()));
  return jsonb_build_object('status', t.status, 'assignee_id', auth.uid());
end;
$$;

create or replace function public.rh_assign(p_ticket_id uuid, p_assignee_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'assign', 'assign');
  if p_assignee_id is null
     or not exists (select 1 from public.profiles p where p.id = p_assignee_id and p.is_active) then
    raise exception 'Choose an active person to assign.' using errcode = 'P0001';
  end if;
  if p_assignee_id is distinct from t.owner_id and not exists (
       select 1 from public.rh_team_members m join public.rh_teams tm on tm.id = m.team_id
        where m.profile_id = p_assignee_id and m.active and not tm.inactive
          and tm.location_id = t.location_id) then
    raise exception 'That person is not on a team at this unit. Add them to a team first.' using errcode = 'P0001';
  end if;
  update public.rh_tickets
     set assignee_id   = p_assignee_id,
         owner_id      = coalesce(owner_id, p_assignee_id),
         owner_reason  = case when owner_id is null then 'Assigned by triage' else owner_reason end,
         needs_sorting = false
   where id = t.id;
  perform public.rh_log(t.id, 'assigned', t.status, t.status, null,
    jsonb_build_object('assignee_id', p_assignee_id, 'previous_assignee_id', t.assignee_id));
  return jsonb_build_object('status', t.status, 'assignee_id', p_assignee_id);
end;
$$;

create or replace function public.rh_start(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'start', 'start');
  update public.rh_tickets
     set status = 'in_progress', assignee_id = coalesce(assignee_id, auth.uid())
   where id = t.id;
  perform public.rh_log(t.id, 'started', t.status, 'in_progress', null);
  return jsonb_build_object('status', 'in_progress');
end;
$$;

create or replace function public.rh_block(p_ticket_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the work is blocked.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'block', 'block');
  update public.rh_tickets
     set status = 'blocked', paused_at = now(), blocked_reason = btrim(p_reason)
   where id = t.id;
  perform public.rh_log(t.id, 'blocked', t.status, 'blocked', p_reason);
  return jsonb_build_object('status', 'blocked');
end;
$$;

create or replace function public.rh_unblock(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t      public.rh_tickets := public.rh_lock(p_ticket_id);
  v_span interval;
  v_secs int;
begin
  perform public.rh_require(t, 'unblock', 'unblock');
  v_span := greatest(now() - t.paused_at, interval '0');
  v_secs := ceil(extract(epoch from v_span))::int;
  update public.rh_tickets
     set status = 'in_progress', paused_at = null, blocked_reason = null,
         paused_seconds = paused_seconds + v_secs,
         due_at = due_at + make_interval(secs => v_secs)
   where id = t.id;
  perform public.rh_log(t.id, 'unblocked', 'blocked', 'in_progress', null,
                        jsonb_build_object('paused_seconds', v_secs));
  return jsonb_build_object('status', 'in_progress', 'paused_seconds', v_secs);
end;
$$;

create or replace function public.rh_fix(p_ticket_id uuid, p_photo_path text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t        public.rh_tickets := public.rh_lock(p_ticket_id);
  s        public.rh_unit_settings;
  v_spot   boolean;
  v_status text;
begin
  if p_photo_path is null or btrim(p_photo_path) = '' then
    raise exception 'A photo of the finished work is required to mark it fixed.' using errcode = 'P0001';
  end if;
  if p_photo_path not like 'tickets/%' or p_photo_path like '%..%' then
    raise exception 'The photo upload is not valid — please attach it again.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'fix', 'mark fixed');
  s := public.rh_settings(t.location_id);
  v_spot := s.spot_check_one_in = 1
         or (s.spot_check_one_in > 1 and random() < 1.0 / s.spot_check_one_in);
  v_status := case when v_spot then 'fixed' else 'closed' end;

  insert into public.rh_ticket_photos (ticket_id, kind, fix_round, path, uploaded_by)
  values (t.id, 'fix', t.fix_round, p_photo_path, auth.uid());
  update public.rh_tickets
     set status = v_status, fixed_at = now(),
         spot_check_pending = v_spot,
         closed_at    = case when v_spot then null else now() end,
         closure_kind = case when v_spot then null else 'auto_photo' end
   where id = t.id;
  perform public.rh_log(t.id, 'fixed', t.status, v_status, p_note,
    jsonb_build_object('spot_check', v_spot, 'fix_round', t.fix_round));
  return jsonb_build_object('status', v_status, 'spot_check', v_spot);
end;
$$;

create or replace function public.rh_spot_check(p_ticket_id uuid, p_pass boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  if p_pass is null then
    raise exception 'Say whether the fix passed the check.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'spot_check', 'spot-check');
  if p_pass then
    update public.rh_tickets
       set status = 'closed', closed_at = now(), closure_kind = 'spot_checked', spot_check_pending = false
     where id = t.id;
    perform public.rh_log(t.id, 'spot_check_passed', 'fixed', 'closed', p_note);
    return jsonb_build_object('status', 'closed');
  end if;
  update public.rh_tickets
     set status = 'in_progress', spot_check_pending = false, fixed_at = null,
         fix_round = fix_round + 1,
         due_at = public.rh_due_at(location_id, is_dangerous, is_routine, now())
   where id = t.id;
  perform public.rh_log(t.id, 'spot_check_failed', 'fixed', 'in_progress', p_note,
                        jsonb_build_object('fix_round', t.fix_round + 1));
  return jsonb_build_object('status', 'in_progress');
end;
$$;

create or replace function public.rh_owner_confirm(p_ticket_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'owner_confirm', 'confirm');
  update public.rh_tickets
     set status = 'closed', closed_at = now(), closure_kind = 'owner_confirmed', spot_check_pending = false
   where id = t.id;
  perform public.rh_log(t.id, 'owner_confirmed', 'fixed', 'closed', p_note);
  return jsonb_build_object('status', 'closed');
end;
$$;

-- ─── 8. Reporter actions ────────────────────────────────────────────────────

create or replace function public.rh_dispute(p_ticket_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t        public.rh_tickets := public.rh_lock(p_ticket_id);
  v_window int;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say what is still not fixed.' using errcode = 'P0001';
  end if;
  v_window := (public.rh_settings(t.location_id)).dispute_window_days;
  if t.reporter_id = auth.uid() and t.status = 'closed'
     and t.closed_at < now() - make_interval(days => v_window) then
    raise exception '%', format('The %s-day window to say this was not fixed has passed. Please report it again.', v_window)
      using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'dispute', 'dispute');
  update public.rh_tickets
     set status = 'in_progress', dispute_count = dispute_count + 1, reopen_count = reopen_count + 1,
         fix_round = fix_round + 1, closed_at = null, closure_kind = null, fixed_at = null,
         spot_check_pending = false,
         due_at = public.rh_due_at(location_id, is_dangerous, is_routine, now())
   where id = t.id;
  perform public.rh_log(t.id, 'disputed', 'closed', 'in_progress', p_reason,
    jsonb_build_object('dispute_count', t.dispute_count + 1, 'fix_round', t.fix_round + 1));
  return jsonb_build_object('status', 'in_progress', 'fix_round', t.fix_round + 1);
end;
$$;

create or replace function public.rh_cancel(p_ticket_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why this ticket is being cancelled.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'cancel', 'cancel');
  update public.rh_tickets set status = 'cancelled', cancel_reason = btrim(p_reason) where id = t.id;
  perform public.rh_log(t.id, 'cancelled', t.status, 'cancelled', p_reason);
  return jsonb_build_object('status', 'cancelled');
end;
$$;

create or replace function public.rh_withdraw(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'withdraw', 'withdraw');
  update public.rh_tickets set status = 'withdrawn' where id = t.id;
  perform public.rh_log(t.id, 'withdrawn', t.status, 'withdrawn', null);
  return jsonb_build_object('status', 'withdrawn');
end;
$$;

create or replace function public.rh_edit_report(p_ticket_id uuid, p_title text, p_description text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Say in a few words what is broken.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'edit_report', 'edit');
  update public.rh_tickets
     set title = btrim(p_title), description = nullif(btrim(p_description), '')
   where id = t.id;
  perform public.rh_log(t.id, 'edited', t.status, t.status, null,
    jsonb_build_object('previous_title', t.title));
  return jsonb_build_object('status', t.status);
end;
$$;

create or replace function public.rh_rate(p_ticket_id uuid, p_stars int, p_comment text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception 'Choose between 1 and 5 stars.' using errcode = 'P0001';
  end if;
  if t.reporter_id = auth.uid() and exists (select 1 from public.rh_ratings r
       where r.ticket_id = t.id and r.fix_round = t.fix_round) then
    raise exception 'You have already rated this fix.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'rate', 'rate');
  insert into public.rh_ratings (ticket_id, fix_round, rater_id, stars, comment)
  values (t.id, t.fix_round, auth.uid(), p_stars, nullif(btrim(p_comment), ''));
  perform public.rh_log(t.id, 'rated', t.status, t.status, p_comment,
    jsonb_build_object('stars', p_stars, 'fix_round', t.fix_round));
  return jsonb_build_object('stars', p_stars, 'fix_round', t.fix_round);
end;
$$;

-- ─── 9. Triage ──────────────────────────────────────────────────────────────

create or replace function public.rh_reclassify(
  p_ticket_id uuid, p_trade_id uuid default null, p_severity text default null,
  p_priority text default null, p_is_routine boolean default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t         public.rh_tickets := public.rh_lock(p_ticket_id);
  v_trade   uuid := coalesce(p_trade_id, t.trade_id);
  v_sev     text := coalesce(p_severity, t.severity);
  v_pri     text := coalesce(p_priority, t.priority);
  v_rout    boolean := coalesce(p_is_routine, t.is_routine);
  v_reroute boolean;
  v_owner   uuid := t.owner_id;
  v_team    uuid := t.team_id;
  v_reason  text := t.owner_reason;
  v_assign  uuid := t.assignee_id;
  v_due     timestamptz := t.due_at;
begin
  perform public.rh_require(t, 'reclassify', 'reclassify');
  if v_sev not in ('critical', 'high', 'medium', 'low') then
    raise exception 'Unknown severity "%".', v_sev using errcode = 'P0001';
  end if;
  if v_pri not in ('urgent', 'high', 'medium', 'low') then
    raise exception 'Unknown priority "%".', v_pri using errcode = 'P0001';
  end if;
  if p_trade_id is not null and not exists (select 1 from public.rh_trades x where x.id = p_trade_id and not x.inactive) then
    raise exception 'That trade is not available.' using errcode = 'P0001';
  end if;
  v_reroute := v_trade is distinct from t.trade_id;
  if v_reroute then
    select r.owner_id, r.team_id, r.reason into v_owner, v_team, v_reason
      from public.rh_route(t.location_id, t.place_id, v_trade, t.source) r;
    if v_team is distinct from t.team_id then v_assign := null; end if;
  end if;
  if v_rout is distinct from t.is_routine and not t.is_dangerous then
    v_due := public.rh_due_at(t.location_id, false, v_rout, t.created_at)
             + make_interval(secs => t.paused_seconds);
  end if;
  update public.rh_tickets
     set trade_id = v_trade, severity = v_sev, priority = v_pri, is_routine = v_rout,
         owner_id = v_owner, team_id = v_team, owner_reason = v_reason, assignee_id = v_assign,
         due_at = v_due, needs_sorting = (v_trade is null or v_owner is null)
   where id = t.id;
  perform public.rh_log(t.id, 'reclassified', t.status, t.status, null,
    jsonb_build_object('rerouted', v_reroute, 'from_trade_id', t.trade_id, 'to_trade_id', v_trade,
                       'severity', v_sev, 'priority', v_pri, 'is_routine', v_rout));
  return jsonb_build_object('status', t.status, 'rerouted', v_reroute, 'owner_id', v_owner, 'due_at', v_due);
end;
$$;

create or replace function public.rh_add_note(p_ticket_id uuid, p_body text, p_visibility text default 'internal')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t    public.rh_tickets := public.rh_lock(p_ticket_id);
  v_id uuid;
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'The note is empty.' using errcode = 'P0001';
  end if;
  if p_visibility not in ('internal', 'reporter') then
    raise exception 'A note is either internal or for the reporter.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'note_' || p_visibility,
    case p_visibility when 'internal' then 'add an internal note to' else 'add a note to' end);
  insert into public.rh_ticket_notes (ticket_id, author_id, body, visibility)
  values (t.id, auth.uid(), btrim(p_body), p_visibility)
  returning id into v_id;
  return jsonb_build_object('note_id', v_id);
end;
$$;

-- Ticket columns + names + score. One shape for the queue (TriageRow).
create or replace function public.rh_triage_queue(p_tab text default 'decide')
returns table (
  id uuid, location_id uuid, kind text, ref_no text, status text, reporter_id uuid,
  place_id uuid, trade_id uuid, title text, description text, is_dangerous boolean,
  severity text, priority text, is_routine boolean, source text, gps_lat numeric, gps_lng numeric,
  owner_id uuid, owner_reason text, team_id uuid, assignee_id uuid, due_at timestamptz,
  paused_at timestamptz, paused_seconds int, blocked_reason text, fix_round int,
  dispute_count int, reopen_count int, fixed_at timestamptz, closed_at timestamptz,
  closure_kind text, spot_check_pending boolean, cancel_reason text, needs_sorting boolean,
  created_by uuid, created_at timestamptz, updated_at timestamptz,
  place_name text, trade_name text, owner_name text, assignee_name text, reporter_name text,
  team_name text, is_late boolean, joiners int, score int, score_parts jsonb)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_loc uuid := public.current_location();
  w     jsonb;
begin
  if not public.has_permission('resolve', 'approve') then
    raise exception 'You do not have access to the triage queue.' using errcode = 'P0001';
  end if;
  if coalesce(p_tab, '') not in ('decide', 'open', 'all') then
    raise exception 'Unknown triage tab "%".', p_tab using errcode = 'P0001';
  end if;
  if v_loc is null then
    return;  -- no unit → no rows
  end if;
  select s.triage_weights into w from public.rh_unit_settings s where s.location_id = v_loc;
  w := coalesce(w, '{"severity":{"critical":100,"high":60,"medium":30,"low":10},
                     "priority":{"urgent":80,"high":50,"medium":20,"low":5},
                     "per_day_open":2,"age_cap":60,"reopened":70,"disputed":90,
                     "repeated":25,"unassigned":15}'::jsonb);

  return query
  with b as (
    select t.*,
           (t.status in ('open', 'in_progress', 'blocked', 'fixed')) as live,
           greatest(0, floor(extract(epoch from (now() - t.created_at)
                     - make_interval(secs => t.paused_seconds)
                     - coalesce(now() - t.paused_at, interval '0')) / 86400))::int as days_open,
           exists (select 1 from public.rh_tickets o
                    where o.id <> t.id and o.location_id = t.location_id
                      and o.place_id = t.place_id and o.trade_id = t.trade_id
                      and o.created_at between t.created_at - interval '30 days'
                                           and t.created_at + interval '30 days') as repeated
      from public.rh_tickets t
     where t.location_id = v_loc and t.kind = 'broken'
       and case p_tab
             when 'decide' then t.status in ('open', 'in_progress', 'blocked', 'fixed')
                                and (t.assignee_id is null or t.needs_sorting or t.spot_check_pending
                                     or (t.dispute_count > 0 and t.status = 'in_progress'))
             when 'open'   then t.status in ('open', 'in_progress', 'blocked', 'fixed')
             else true
           end
  ),
  p as (
    select b.id as tid,
           coalesce(jsonb_agg(jsonb_build_object('label', v.label, 'points', v.pts) order by v.ord)
                      filter (where v.pts > 0), '[]'::jsonb) as parts,
           coalesce(sum(v.pts) filter (where v.pts > 0), 0)::int as total
      from b
      cross join lateral (values
        (1, 'Severity: ' || b.severity, coalesce((w -> 'severity' ->> b.severity)::int, 0)),
        (2, 'Priority: ' || b.priority, coalesce((w -> 'priority' ->> b.priority)::int, 0)),
        (3, 'Open ' || b.days_open || ' day' || case when b.days_open = 1 then '' else 's' end,
            least(coalesce((w ->> 'age_cap')::int, 60), coalesce((w ->> 'per_day_open')::int, 2) * b.days_open)),
        (4, 'Reopened', case when b.reopen_count > 0 then coalesce((w ->> 'reopened')::int, 0) else 0 end),
        (5, 'Reporter says not fixed', case when b.dispute_count > 0 then coalesce((w ->> 'disputed')::int, 0) else 0 end),
        (6, 'Same place and trade within 30 days', case when b.repeated then coalesce((w ->> 'repeated')::int, 0) else 0 end),
        (7, 'Unassigned', case when b.assignee_id is null then coalesce((w ->> 'unassigned')::int, 0) else 0 end)
      ) as v(ord, label, pts)
     where b.live
     group by b.id
  )
  select b.id, b.location_id, b.kind, b.ref_no, b.status, b.reporter_id, b.place_id, b.trade_id,
         b.title, b.description, b.is_dangerous, b.severity, b.priority, b.is_routine, b.source,
         b.gps_lat, b.gps_lng, b.owner_id, b.owner_reason, b.team_id, b.assignee_id, b.due_at,
         b.paused_at, b.paused_seconds, b.blocked_reason, b.fix_round, b.dispute_count, b.reopen_count,
         b.fixed_at, b.closed_at, b.closure_kind, b.spot_check_pending, b.cancel_reason, b.needs_sorting,
         b.created_by, b.created_at, b.updated_at,
         pl.name, tr.name, po.full_name, pa.full_name, pr.full_name, tm.name,
         (b.status in ('open', 'in_progress') and b.due_at is not null and now() > b.due_at),
         (select count(*)::int from public.rh_ticket_joiners j where j.ticket_id = b.id),
         coalesce(p.total, 0), coalesce(p.parts, '[]'::jsonb)
    from b
    left join p on p.tid = b.id
    left join public.rh_places   pl on pl.id = b.place_id
    left join public.rh_trades   tr on tr.id = b.trade_id
    left join public.profiles    po on po.id = b.owner_id
    left join public.profiles    pa on pa.id = b.assignee_id
    left join public.profiles    pr on pr.id = b.reporter_id
    left join public.rh_teams    tm on tm.id = b.team_id
   order by coalesce(p.total, 0) desc, b.created_at;
end;
$$;

create or replace function public.rh_workload()
returns table (team_id uuid, team_name text, profile_id uuid, name text,
               open int, in_progress int, blocked int, overdue int)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_loc uuid := public.current_location();
  v_all boolean;
begin
  if not (public.has_permission('resolve', 'edit') or public.has_permission('resolve', 'approve')
          or public.has_permission('resolve', 'export')) then
    raise exception 'You do not have access to workload.' using errcode = 'P0001';
  end if;
  if v_loc is null then
    return;
  end if;
  v_all := public.has_permission('resolve', 'approve') or public.has_permission('resolve', 'export');

  return query
  with tk as (
    select t.team_id as tid, coalesce(t.assignee_id, t.owner_id) as person, t.status as st,
           (t.status in ('open', 'in_progress') and t.due_at is not null and now() > t.due_at) as late
      from public.rh_tickets t
     where t.location_id = v_loc and t.status in ('open', 'in_progress', 'blocked')
  ),
  people as (
    select m.team_id as tid, m.profile_id as person
      from public.rh_team_members m join public.rh_teams x on x.id = m.team_id
     where x.location_id = v_loc and m.active and not x.inactive
    union
    select tk.tid, tk.person from tk
  )
  select pe.tid, tm.name, pe.person, pr.full_name,
         count(*) filter (where tk.st = 'open')::int,
         count(*) filter (where tk.st = 'in_progress')::int,
         count(*) filter (where tk.st = 'blocked')::int,
         count(*) filter (where tk.late)::int
    from people pe
    left join tk on tk.tid is not distinct from pe.tid and tk.person is not distinct from pe.person
    left join public.rh_teams tm on tm.id = pe.tid
    left join public.profiles pr on pr.id = pe.person
   where v_all
      or pe.person = v_uid
      or public.rh_is_team_member(pe.tid, v_uid)
   group by pe.tid, tm.name, pe.person, pr.full_name
   order by tm.name nulls last, pr.full_name nulls last;
end;
$$;

-- ─── 10. Analytics (§7) ─────────────────────────────────────────────────────

create or replace function public.rh_analytics(p_weeks int default 12)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_loc   uuid := public.current_location();
  v_weeks int  := greatest(1, least(coalesce(p_weeks, 12), 104));
  v_from  timestamptz;
  v_tz    text;
  v_out   jsonb;
begin
  if not public.has_permission('resolve', 'export') then
    raise exception 'You do not have access to Resolve Hub analytics.' using errcode = 'P0001';
  end if;
  if v_loc is null then
    return jsonb_build_object(
      'totals', jsonb_build_object('total', 0, 'open', 0, 'late', 0, 'blocked', 0, 'fixed', 0,
                                   'closed', 0, 'reopened', 0, 'disputed', 0),
      'verified_fix_rate', null, 'reopen_rate', null, 'median_days_to_fix', null,
      'avg_resolution_days', null, 'weekly', '[]'::jsonb, 'late_by_place', '[]'::jsonb,
      'repeats', '[]'::jsonb, 'top_closers', '[]'::jsonb, 'top_overdue', '[]'::jsonb,
      'by_source', '[]'::jsonb);
  end if;
  v_tz   := coalesce((select s.timezone from public.rh_unit_settings s where s.location_id = v_loc), 'Asia/Kolkata');
  v_from := (date_trunc('week', now() at time zone v_tz) - make_interval(weeks => v_weeks - 1)) at time zone v_tz;

  with r as (
    select t.* from public.rh_tickets t
     where t.location_id = v_loc and t.kind = 'broken' and t.created_at >= v_from
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
       'total',    (select count(*) from r),
       'open',     (select count(*) from r where r.status in ('open', 'in_progress')),
       'late',     (select count(*) from r where r.status in ('open', 'in_progress') and now() > r.due_at),
       'blocked',  (select count(*) from r where r.status = 'blocked'),
       'fixed',    (select count(*) from r where r.status = 'fixed'),
       'closed',   (select count(*) from r where r.status = 'closed'),
       'reopened', (select count(*) from r where r.reopen_count > 0),
       'disputed', (select count(*) from r where r.dispute_count > 0)),
    -- verified closures that held (never reopened) ÷ verified closures
    'verified_fix_rate', (select round(count(*) filter (where r.reopen_count = 0)::numeric
                                       / nullif(count(*), 0), 4)
                            from r where r.status = 'closed'
                                     and r.closure_kind in ('auto_photo', 'spot_checked')),
    'reopen_rate', (select round(count(*) filter (where r.reopen_count > 0)::numeric
                                 / nullif(count(*) filter (where r.status = 'closed'), 0), 4) from r),
    'median_days_to_fix', (select round((percentile_cont(0.5) within group (order by
                              (extract(epoch from r.fixed_at - r.created_at) - r.paused_seconds) / 86400.0))::numeric, 2)
                             from r where r.fixed_at is not null),
    'avg_resolution_days', (select round(avg((extract(epoch from r.closed_at - r.created_at) - r.paused_seconds) / 86400.0)::numeric, 2)
                              from r where r.status = 'closed' and r.closed_at is not null),
    'weekly', (select coalesce(jsonb_agg(jsonb_build_object('week_start', wk.d, 'created', wk.c, 'fixed', wk.f)
                                         order by wk.d), '[]'::jsonb)
                 from (select g::date as d,
                              (select count(*) from r where (r.created_at at time zone v_tz) >= g
                                                        and (r.created_at at time zone v_tz) < g + interval '7 days')::int as c,
                              (select count(*) from public.rh_ticket_activity a
                                 join public.rh_tickets t2 on t2.id = a.ticket_id
                                where t2.location_id = v_loc and a.action = 'fixed'
                                  and (a.created_at at time zone v_tz) >= g
                                  and (a.created_at at time zone v_tz) < g + interval '7 days')::int as f
                         from generate_series(date_trunc('week', now() at time zone v_tz) - make_interval(weeks => v_weeks - 1),
                                              date_trunc('week', now() at time zone v_tz), interval '7 days') g) wk),
    'late_by_place', (select coalesce(jsonb_agg(jsonb_build_object('place_id', x.place_id, 'place_name', x.name, 'late', x.n)
                                                order by x.n desc, x.name), '[]'::jsonb)
                        from (select t.place_id, pl.name, count(*)::int as n
                                from public.rh_tickets t join public.rh_places pl on pl.id = t.place_id
                               where t.location_id = v_loc and t.status in ('open', 'in_progress') and now() > t.due_at
                               group by t.place_id, pl.name) x),
    'repeats', (select coalesce(jsonb_agg(jsonb_build_object('place_name', x.pn, 'trade_name', x.tn, 'count', x.n)
                                          order by x.n desc, x.pn), '[]'::jsonb)
                  from (select pl.name as pn, tr.name as tn, count(*)::int as n
                          from r join public.rh_places pl on pl.id = r.place_id
                                 join public.rh_trades tr on tr.id = r.trade_id
                         group by pl.name, tr.name having count(*) >= 2
                         order by count(*) desc limit 20) x),
    'top_closers', (select coalesce(jsonb_agg(jsonb_build_object('profile_id', x.pid, 'name', x.nm, 'closed', x.n)
                                              order by x.n desc), '[]'::jsonb)
                      from (select coalesce(r.assignee_id, r.owner_id) as pid, pr.full_name as nm, count(*)::int as n
                              from r join public.profiles pr on pr.id = coalesce(r.assignee_id, r.owner_id)
                             where r.status = 'closed'
                             group by 1, 2 order by 3 desc limit 5) x),
    'top_overdue', (select coalesce(jsonb_agg(jsonb_build_object('profile_id', x.pid, 'name', x.nm, 'overdue', x.n)
                                              order by x.n desc), '[]'::jsonb)
                      from (select coalesce(t.assignee_id, t.owner_id) as pid, pr.full_name as nm, count(*)::int as n
                              from public.rh_tickets t join public.profiles pr on pr.id = coalesce(t.assignee_id, t.owner_id)
                             where t.location_id = v_loc and t.status in ('open', 'in_progress') and now() > t.due_at
                             group by 1, 2 order by 3 desc limit 5) x),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', x.source, 'count', x.n) order by x.n desc), '[]'::jsonb)
                    from (select r.source, count(*)::int as n from r group by r.source) x)
  ) into v_out;
  return v_out;
end;
$$;

-- ─── 11. Places & QR ────────────────────────────────────────────────────────

create or replace function public.rh_issue_qr(p_place_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_loc   uuid;
  v_token text;
begin
  if not public.has_permission('resolve', 'create') then
    raise exception 'Only a Resolve Hub administrator can issue stickers.' using errcode = 'P0001';
  end if;
  select p.location_id into v_loc from public.rh_places p where p.id = p_place_id for update;
  if v_loc is null or not public.is_current_location(v_loc) then
    raise exception 'That place is not in your current unit.' using errcode = 'P0001';
  end if;
  -- 18 random bytes = 144 bits, base64url without padding (24 chars)
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  update public.rh_places set qr_token = v_token, qr_printed_at = null where id = p_place_id;
  return v_token;
end;
$$;

create or replace function public.rh_mark_qr_printed(p_place_ids uuid[])
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.has_permission('resolve', 'create') then
    raise exception 'Only a Resolve Hub administrator can record printed stickers.' using errcode = 'P0001';
  end if;
  update public.rh_places p set qr_printed_at = now()
   where p.id = any (p_place_ids) and p.qr_token is not null and public.is_current_location(p.location_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ─── 12. Activity → outbox (§8) ─────────────────────────────────────────────

create or replace function public.rh_activity_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t        public.rh_tickets;
  s        public.rh_unit_settings;
  v_loc    uuid;
  v_event  text;
  v_rec    uuid[] := '{}';
  v_sms    boolean := false;
  v_status text;
  v_r      uuid;
  v_cnt    int;
begin
  if new.ticket_id is not null then
    select * into t from public.rh_tickets x where x.id = new.ticket_id;
    v_loc := t.location_id;
  else
    v_loc := nullif(new.meta ->> 'location_id', '')::uuid;
  end if;
  if v_loc is not null then
    s := public.rh_settings(v_loc);
  end if;

  case new.action
    when 'created' then
      if t.is_dangerous then v_event := 'resolve.dangerous'; v_sms := true;
      else v_event := 'resolve.ticket_routed'; end if;
      if t.owner_id is not null then
        v_rec := array[t.owner_id];
      elsif t.team_id is not null then
        v_rec := array(select m.profile_id from public.rh_team_members m where m.team_id = t.team_id and m.active);
      end if;
      if t.is_dangerous and t.owner_id is null then
        v_rec := v_rec || s.unit_head_id;
      end if;
    when 'reclassified' then
      if new.meta ->> 'rerouted' = 'true' then
        v_event := 'resolve.ticket_routed'; v_rec := array[t.owner_id];
      end if;
    when 'claimed', 'assigned' then
      v_event := 'resolve.assigned'; v_rec := array[t.assignee_id, t.owner_id];
    when 'joined' then
      v_event := 'resolve.joined'; v_rec := array[t.owner_id];
    when 'fixed' then
      v_event := case when new.to_status = 'closed' then 'resolve.closed' else 'resolve.fixed' end;
      v_rec := t.reporter_id || array(select j.profile_id from public.rh_ticket_joiners j where j.ticket_id = t.id);
    when 'spot_check_passed', 'owner_confirmed' then
      v_event := 'resolve.closed';
      v_rec := t.reporter_id || array(select j.profile_id from public.rh_ticket_joiners j where j.ticket_id = t.id);
    when 'disputed' then
      -- the owner is told WHAT, never WHO (the payload carries no reporter)
      v_event := 'resolve.disputed'; v_rec := array[t.owner_id, t.assignee_id];
      if t.dispute_count >= 2 then v_rec := v_rec || s.unit_head_id; end if;
    when 'rated' then
      v_event := 'resolve.rated'; v_rec := array[coalesce(t.assignee_id, t.owner_id)];
    when 'escalated' then
      v_event := 'resolve.overdue';
      v_rec := array(select x::uuid from jsonb_array_elements_text(coalesce(new.meta -> 'recipients', '[]'::jsonb)) x);
    when 'digest' then
      v_event := 'resolve.digest'; v_rec := array[nullif(new.meta ->> 'director_id', '')::uuid];
    else
      null;
  end case;

  if v_event is null then
    return new;
  end if;
  v_status := case when coalesce(s.suppress_notifications, false) or new.meta ->> 'suppress' = 'true'
                   then 'suppressed' else 'pending' end;

  for v_r in
    select distinct x from unnest(v_rec) x
     where x is not null and x is distinct from new.actor_id
       and exists (select 1 from public.profiles p where p.id = x)
  loop
    insert into public.rh_outbox (activity_id, ticket_id, location_id, event_key, recipient_id, channel, dedupe_key, status)
    values (new.id, new.ticket_id, v_loc, v_event, v_r, 'in_app', new.id || ':' || v_r || ':in_app', v_status)
    on conflict (dedupe_key) do nothing;

    if v_sms then
      begin
        select count(*) into strict v_cnt from public.rh_outbox o
         where o.location_id = v_loc and o.channel = 'sms'
           and o.created_at >= ((now() at time zone s.timezone)::date::timestamp at time zone s.timezone);
        if v_cnt < s.page_cap_per_day then
          insert into public.rh_outbox (activity_id, ticket_id, location_id, event_key, recipient_id, channel, dedupe_key, status)
          values (new.id, new.ticket_id, v_loc, v_event, v_r, 'sms', new.id || ':' || v_r || ':sms', v_status)
          on conflict (dedupe_key) do nothing;
        end if;
      exception when others then
        null;  -- the cap could not be read safely: no page; the in-app row stands
      end;
    end if;
  end loop;
  return new;
end;
$$;

create trigger rh_ticket_activity_outbox
  after insert on public.rh_ticket_activity
  for each row execute function public.rh_activity_outbox();

-- ─── 13. Service-role jobs ──────────────────────────────────────────────────

create or replace function public.rh_escalation_sweep()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      record;
  s      public.rh_unit_settings;
  v_days int;
  v_lvl  int;
  v_ins  uuid;
  v_rec  uuid[];
  v_l1   int := 0;
  v_l3   int := 0;
  v_l7   int := 0;
  v_dig  int := 0;
  v_day  date;
  v_list jsonb;
  v_dir  uuid;
begin
  for r in
    select t.* from public.rh_tickets t
     where t.status in ('open', 'in_progress') and t.due_at is not null
       and now() - t.due_at >= interval '1 day'
  loop
    v_days := floor(extract(epoch from now() - r.due_at) / 86400)::int;
    s := public.rh_settings(r.location_id);
    foreach v_lvl in array array[1, 3, 7] loop
      exit when v_days < v_lvl;
      insert into public.rh_escalations (ticket_id, level, fix_round)
      values (r.id, v_lvl, r.fix_round)
      on conflict (ticket_id, level, fix_round) do nothing
      returning id into v_ins;
      continue when v_ins is null;
      if v_lvl = 1 then
        v_l1 := v_l1 + 1;
        v_rec := array_remove(array[coalesce(public.rh_manager_of(r.owner_id), s.estate_owner_id)], null);
      elsif v_lvl = 3 then
        v_l3 := v_l3 + 1;
        v_rec := array_remove(array[s.unit_head_id], null);
      else
        v_l7 := v_l7 + 1;   -- level 7 goes out in the directors' digest below
        continue;
      end if;
      insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, meta)
      values (r.id, null, 'escalated', r.status, r.status,
              jsonb_build_object('level', v_lvl, 'days_late', v_days, 'recipients', to_jsonb(v_rec)));
    end loop;
  end loop;

  for s in select * from public.rh_unit_settings x where cardinality(x.director_ids) > 0 loop
    v_day := (now() at time zone s.timezone)::date;
    select jsonb_agg(jsonb_build_object('ticket_id', t.id, 'ref_no', t.ref_no, 'title', t.title,
                     'days_late', floor(extract(epoch from now() - t.due_at) / 86400)::int)
                     order by t.due_at)
      into v_list
      from public.rh_tickets t
     where t.location_id = s.location_id and t.status in ('open', 'in_progress')
       and t.due_at is not null and now() - t.due_at >= interval '7 days';
    continue when v_list is null;
    foreach v_dir in array s.director_ids loop
      if not exists (select 1 from public.rh_ticket_activity a
                      where a.action = 'digest' and a.meta ->> 'director_id' = v_dir::text
                        and a.meta ->> 'day' = v_day::text
                        and a.meta ->> 'location_id' = s.location_id::text) then
        insert into public.rh_ticket_activity (ticket_id, actor_id, action, meta)
        values (null, null, 'digest',
                jsonb_build_object('director_id', v_dir, 'day', v_day, 'location_id', s.location_id,
                                   'tickets', v_list));
        v_dig := v_dig + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('level1', v_l1, 'level3', v_l3, 'level7', v_l7, 'digests', v_dig);
end;
$$;

-- Claims a batch and leases it for 5 minutes (next_attempt_at), so a second
-- drain running concurrently never sends the same row.
create or replace function public.rh_outbox_claim(p_limit int default 50)
returns table (id uuid, activity_id uuid, ticket_id uuid, location_id uuid, event_key text,
               recipient_id uuid, channel text, attempts int, ref_no text, title text,
               location_name text, action text, note text, meta jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with c as (
    select o.id from public.rh_outbox o
     where o.status = 'pending' and o.next_attempt_at <= now()
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update skip locked
  ), u as (
    update public.rh_outbox o set next_attempt_at = now() + interval '5 minutes'
      from c where o.id = c.id
    returning o.*
  )
  select u.id, u.activity_id, u.ticket_id, u.location_id, u.event_key, u.recipient_id, u.channel,
         u.attempts, t.ref_no, t.title, l.name, a.action, a.note, a.meta
    from u
    join public.rh_ticket_activity a on a.id = u.activity_id
    left join public.rh_tickets t on t.id = u.ticket_id
    left join public.locations l on l.id = u.location_id
   order by u.created_at;
end;
$$;

create or replace function public.rh_outbox_mark(p_id uuid, p_status text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o     public.rh_outbox;
  v_att int;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Outbox status must be sent, failed or skipped.' using errcode = 'P0001';
  end if;
  select * into o from public.rh_outbox x where x.id = p_id for update;
  if not found then
    raise exception 'Outbox row % not found.', p_id using errcode = 'P0001';
  end if;
  if p_status = 'sent' then
    update public.rh_outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
    return jsonb_build_object('status', 'sent', 'attempts', o.attempts);
  elsif p_status = 'skipped' then
    update public.rh_outbox set status = 'skipped', last_error = p_error where id = p_id;
    return jsonb_build_object('status', 'skipped', 'attempts', o.attempts);
  end if;
  v_att := o.attempts + 1;
  if v_att >= 5 then
    update public.rh_outbox set status = 'failed', attempts = v_att, last_error = p_error where id = p_id;
    return jsonb_build_object('status', 'failed', 'attempts', v_att);
  end if;
  update public.rh_outbox
     set status = 'pending', attempts = v_att, last_error = p_error,
         next_attempt_at = now() + make_interval(mins => power(2, v_att)::int)
   where id = p_id;
  return jsonb_build_object('status', 'pending', 'attempts', v_att);
end;
$$;

-- ─── 14. Grants ─────────────────────────────────────────────────────────────

-- internal helpers: nobody calls these directly
revoke all on function public.rh_settings(uuid) from public, anon, authenticated;
revoke all on function public.rh_staff_of(uuid) from public, anon, authenticated;
revoke all on function public.rh_on_leave(uuid) from public, anon, authenticated;
revoke all on function public.rh_manager_of(uuid) from public, anon, authenticated;
revoke all on function public.rh_route(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.rh_due_at(uuid, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.rh_lock(uuid, boolean) from public, anon, authenticated;
revoke all on function public.rh_log(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rh_actions_of(public.rh_tickets, uuid) from public, anon, authenticated;
revoke all on function public.rh_require(public.rh_tickets, text, text) from public, anon, authenticated;
revoke all on function public.rh_activity_outbox() from public, anon, authenticated;

-- service role only
revoke all on function public.rh_escalation_sweep() from public, anon, authenticated;
revoke all on function public.rh_outbox_claim(int) from public, anon, authenticated;
revoke all on function public.rh_outbox_mark(uuid, text, text) from public, anon, authenticated;
grant execute on function public.rh_escalation_sweep() to service_role;
grant execute on function public.rh_outbox_claim(int) to service_role;
grant execute on function public.rh_outbox_mark(uuid, text, text) to service_role;

-- the RPCs
revoke all on function public.rh_submit_broken(uuid, uuid, text, text, boolean, text, numeric, numeric, text) from public, anon;
revoke all on function public.rh_similar_open(uuid) from public, anon;
revoke all on function public.rh_place_by_token(text) from public, anon;
revoke all on function public.rh_join(uuid) from public, anon;
revoke all on function public.rh_claim(uuid) from public, anon;
revoke all on function public.rh_assign(uuid, uuid) from public, anon;
revoke all on function public.rh_start(uuid) from public, anon;
revoke all on function public.rh_block(uuid, text) from public, anon;
revoke all on function public.rh_unblock(uuid) from public, anon;
revoke all on function public.rh_fix(uuid, text, text) from public, anon;
revoke all on function public.rh_spot_check(uuid, boolean, text) from public, anon;
revoke all on function public.rh_owner_confirm(uuid, text) from public, anon;
revoke all on function public.rh_dispute(uuid, text) from public, anon;
revoke all on function public.rh_cancel(uuid, text) from public, anon;
revoke all on function public.rh_withdraw(uuid) from public, anon;
revoke all on function public.rh_edit_report(uuid, text, text) from public, anon;
revoke all on function public.rh_reclassify(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.rh_add_note(uuid, text, text) from public, anon;
revoke all on function public.rh_rate(uuid, int, text) from public, anon;
revoke all on function public.rh_ticket_actions(uuid) from public, anon;
revoke all on function public.rh_triage_queue(text) from public, anon;
revoke all on function public.rh_workload() from public, anon;
revoke all on function public.rh_analytics(int) from public, anon;
revoke all on function public.rh_issue_qr(uuid) from public, anon;
revoke all on function public.rh_mark_qr_printed(uuid[]) from public, anon;

grant execute on function public.rh_submit_broken(uuid, uuid, text, text, boolean, text, numeric, numeric, text) to authenticated;
grant execute on function public.rh_similar_open(uuid) to authenticated;
grant execute on function public.rh_place_by_token(text) to authenticated;
grant execute on function public.rh_join(uuid) to authenticated;
grant execute on function public.rh_claim(uuid) to authenticated;
grant execute on function public.rh_assign(uuid, uuid) to authenticated;
grant execute on function public.rh_start(uuid) to authenticated;
grant execute on function public.rh_block(uuid, text) to authenticated;
grant execute on function public.rh_unblock(uuid) to authenticated;
grant execute on function public.rh_fix(uuid, text, text) to authenticated;
grant execute on function public.rh_spot_check(uuid, boolean, text) to authenticated;
grant execute on function public.rh_owner_confirm(uuid, text) to authenticated;
grant execute on function public.rh_dispute(uuid, text) to authenticated;
grant execute on function public.rh_cancel(uuid, text) to authenticated;
grant execute on function public.rh_withdraw(uuid) to authenticated;
grant execute on function public.rh_edit_report(uuid, text, text) to authenticated;
grant execute on function public.rh_reclassify(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.rh_add_note(uuid, text, text) to authenticated;
grant execute on function public.rh_rate(uuid, int, text) to authenticated;
grant execute on function public.rh_ticket_actions(uuid) to authenticated;
grant execute on function public.rh_triage_queue(text) to authenticated;
grant execute on function public.rh_workload() to authenticated;
grant execute on function public.rh_analytics(int) to authenticated;
grant execute on function public.rh_issue_qr(uuid) to authenticated;
grant execute on function public.rh_mark_qr_printed(uuid[]) to authenticated;
