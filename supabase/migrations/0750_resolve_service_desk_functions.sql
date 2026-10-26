-- ============================================================================
-- 0750 — Resolve Hub stage 3: Service Desk — functions, RPCs, sweep.
--
-- Contract: doc/resolve/service-desk-plan.md §3–§4. Schema in 0749.
--
-- Same discipline as 0740/0746: every transition locks the row (rh_lock),
-- asks the ONE "may I" (rh_require → rh_actions_of, whose service branch is
-- rh__desk_actions), updates, and writes ONE activity row. The panel the UI
-- renders and the guard the RPC applies are the same function.
--
-- Re-created from their LATEST bodies (0746): rh_actions_of (service branch
-- added first) and rh_activity_outbox (service branch added first). Every
-- other line of both is unchanged.
--
-- TWO CLOCKS. response_due_at (first technician acknowledgment) is never
-- paused; due_at (resolution) is shifted by the On Hold span on resume, the
-- stage-1 unblock rule. Both are wall-clock minutes from rh_sd_sla.
--
-- THE STALE CLOCK counts people only. last_activity_at is bumped by a trigger
-- for activity rows with an actor and for notes; the sweep's own rows carry
-- actor_id NULL, so a reminder never silences the next reminder.
-- ============================================================================

-- ─── 1. Small helpers ───────────────────────────────────────────────────────

create or replace function public.rh__pri_rank(p_priority text)
returns int
language sql immutable set search_path = ''
as $$ select case p_priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end $$;

-- The SLA row for a unit + priority, with the seeded defaults as the floor so
-- a unit whose row was deleted still has a clock.
create or replace function public.rh__sd_minutes(p_location_id uuid, p_priority text,
  out response_minutes int, out resolution_minutes int)
language sql stable security definer set search_path = ''
as $$
  select coalesce(s.response_minutes, d.r), coalesce(s.resolution_minutes, d.x)
    from (select case p_priority when 'urgent' then 10 when 'high' then 20 when 'medium' then 30 else 60 end as r,
                 case p_priority when 'urgent' then 30 when 'high' then 60 when 'medium' then 120 else 240 end as x) d
    left join public.rh_sd_sla s on s.location_id = p_location_id and s.priority = p_priority
$$;

-- Both clocks of a service ticket, answered in SQL (never Date.now() in a render).
create or replace function public.rh__sd_clock(t public.rh_tickets,
  out response_state text, out resolution_state text, out minutes_left int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_resol int;
begin
  response_state := case
    when t.first_response_at is not null then
      case when t.response_due_at is null or t.first_response_at <= t.response_due_at then 'met' else 'breached' end
    when t.status in ('cancelled', 'withdrawn') then 'met'
    when t.response_due_at is not null and now() > t.response_due_at then 'breached'
    else 'pending' end;

  if t.status in ('resolved', 'closed', 'cancelled', 'withdrawn') then
    resolution_state := 'done';
    minutes_left := null;
    return;
  end if;
  if t.status = 'on_hold' then
    resolution_state := 'paused';
    minutes_left := floor(extract(epoch from (t.due_at - t.paused_at)) / 60)::int;
    return;
  end if;
  minutes_left := floor(extract(epoch from (t.due_at - now())) / 60)::int;
  select m.resolution_minutes into v_resol from public.rh__sd_minutes(t.location_id, t.priority) m;
  resolution_state := case
    when now() > t.due_at then 'breached'
    when extract(epoch from (t.due_at - now())) <= 0.2 * v_resol * 60 then 'at_risk'
    else 'on_track' end;
end;
$$;

-- First technician acknowledgment (plan §1.5). Assignment by a manager is not one.
create or replace function public.rh__sd_ack(p_ticket_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.rh_tickets set first_response_at = now()
   where id = p_ticket_id and first_response_at is null
$$;

-- ─── 2. Routing (skill-based: category → team) ──────────────────────────────

create or replace function public.rh__sd_route(p_location_id uuid, p_category_id uuid)
returns table (owner_id uuid, team_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s        public.rh_unit_settings;
  v_team   uuid;
  v_lead   uuid;
  v_member uuid;
  c_ids    uuid[] := '{}';
  c_why    text[] := '{}';
  v_cand   uuid;
  v_mgr    uuid;
  i        int;
begin
  s := public.rh_settings(p_location_id);
  select tm.id, tm.lead_id into v_team, v_lead
    from public.rh_sd_categories c
    join public.rh_teams tm on tm.id = c.team_id and not tm.inactive and tm.location_id = p_location_id
   where c.id = p_category_id;
  if v_team is not null then
    select m.profile_id into v_member
      from public.rh_team_members m
     where m.team_id = v_team and m.active
     order by m.created_at, m.id
     limit 1;
  end if;

  c_ids := c_ids || v_lead;              c_why := c_why || 'Desk team lead'::text;
  c_ids := c_ids || v_member;            c_why := c_why || 'Desk team member'::text;
  c_ids := c_ids || s.desk_manager_id;   c_why := c_why || 'Desk manager'::text;
  c_ids := c_ids || s.unit_head_id;      c_why := c_why || 'Unit head'::text;

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

  owner_id := null; team_id := v_team; reason := 'Nobody to route to — waiting for the desk manager';
  return next;
end;
$$;

-- ─── 3. The desk's "may I" ──────────────────────────────────────────────────

create or replace function public.rh__desk_actions(t public.rh_tickets, p_uid uuid)
returns text[]
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  a          text[] := '{}';
  v_unit     boolean;
  v_oa       boolean;
  v_owner    boolean;
  v_triage   boolean;
  v_member   boolean;
  v_staff    boolean;
  v_reporter boolean;
  v_live     boolean := t.status in ('open', 'assigned', 'in_progress', 'on_hold');
  v_reopen   int;
begin
  if p_uid is null or t.id is null or t.kind <> 'service' or not public.rh__can_see(t.id, p_uid) then
    return a;
  end if;
  v_unit     := public.is_current_location(t.location_id, p_uid);
  v_oa       := v_unit and (t.owner_id = p_uid or t.assignee_id = p_uid);
  v_owner    := v_unit and t.owner_id = p_uid;
  v_triage   := v_unit and public.has_permission('resolve', 'approve', p_uid);
  v_member   := v_unit and public.has_permission('resolve', 'edit', p_uid)
                and public.rh__is_team_member(t.team_id, p_uid);
  v_staff    := public.rh__staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid);
  v_reporter := t.reporter_id = p_uid;
  select coalesce((select s.sd_reopen_days from public.rh_unit_settings s
                    where s.location_id = t.location_id), 7) into v_reopen;

  if v_member and t.assignee_id is null and t.status = 'open' then a := a || 'sd_claim'::text; end if;
  if (v_triage or v_owner) and v_live then a := a || 'sd_assign'::text; end if;
  if v_oa and t.status in ('open', 'assigned') then a := a || 'sd_start'::text; end if;
  if v_oa and t.status in ('open', 'assigned', 'in_progress') then a := a || 'sd_hold'::text; end if;
  if (v_oa or v_triage) and t.status = 'on_hold' then a := a || 'sd_resume'::text; end if;
  if v_oa and t.status = 'in_progress' then a := a || 'sd_resolve'::text; end if;
  if v_reporter and t.status = 'resolved' then a := a || 'sd_confirm'::text; end if;
  if v_reporter and (t.status = 'resolved'
       or (t.status = 'closed' and t.closed_at is not null
           and t.closed_at >= now() - make_interval(days => v_reopen))) then
    a := a || 'sd_reopen'::text;
  end if;
  if v_triage and v_live and t.override_kind is null then a := a || 'sd_override'::text; end if;
  if (v_triage or v_owner) and v_live then a := a || 'sd_reclassify'::text; end if;
  if v_triage and t.status in ('open', 'assigned') then a := a || 'sd_cancel'::text; end if;
  if v_reporter and t.status in ('open', 'assigned') then a := a || 'sd_withdraw'::text; end if;
  if v_staff then a := a || 'note_internal'::text; end if;
  a := a || 'note_reporter'::text;
  if v_reporter and t.status = 'closed'
     and not exists (select 1 from public.rh_ratings r
                      where r.ticket_id = t.id and r.fix_round = t.fix_round) then
    a := a || 'rate'::text;
  end if;
  if v_staff and public.has_permission('resolve', 'edit', p_uid)
     and t.status in ('resolved', 'closed') then
    a := a || 'kb_draft'::text;
  end if;
  return a;
end;
$$;

-- rh_actions_of as of 0746, with the service branch beside the complaint one.
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
  if t.kind = 'complaint' then
    return public.rh__complaint_actions(t, p_uid);
  end if;
  if t.kind = 'service' then
    return public.rh__desk_actions(t, p_uid);
  end if;
  v_unit     := public.is_current_location(t.location_id, p_uid);
  v_reporter := t.reporter_id = p_uid;

  if not public.rh__can_see(t.id, p_uid) then
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
     and public.rh__is_team_member(t.team_id, p_uid) then
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
  if public.rh__staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid) then
    a := a || 'note_internal'::text;
  end if;
  a := a || 'note_reporter'::text;
  if v_reporter and t.status = 'closed'
     and not exists (select 1 from public.rh_ratings r
                      where r.ticket_id = t.id and r.fix_round = t.fix_round) then
    a := a || 'rate'::text;
  end if;
  if not v_reporter and v_unit and v_active and t.kind = 'broken'
     and not public.rh__is_joiner(t.id, p_uid)
     and public.has_permission('resolve', 'view', p_uid) then
    a := a || 'join'::text;
  end if;
  return a;
end;
$$;

-- ─── 4. Raising a request ───────────────────────────────────────────────────

create or replace function public.rh_sd_categories_open()
returns table (id uuid, code text, name text, description text, ticket_type text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.code, c.name, c.description, c.ticket_type
    from public.rh_sd_categories c
   where public.has_permission('resolve', 'view')
     and c.location_id = public.current_location() and not c.inactive
   order by c.name
$$;

create or replace function public.rh_sd_submit(
  p_category_id  uuid,
  p_title        text,
  p_description  text,
  p_impact       text,
  p_photo_path   text default null,
  p_source       text default 'form',
  p_requester_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid := coalesce(p_requester_id, auth.uid());
  v_behalf  boolean := p_requester_id is not null and p_requester_id is distinct from auth.uid();
  v_source  text := coalesce(nullif(btrim(p_source), ''), 'form');
  v_loc     uuid;
  s         public.rh_unit_settings;
  c         public.rh_sd_categories;
  v_pri     text;
  v_n       int;
  v_no      int;
  v_year    int;
  v_ref     text;
  v_owner   uuid;
  v_team    uuid;
  v_reason  text;
  v_resp    int;
  v_resol   int;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again to ask for help.' using errcode = 'P0001';
  end if;
  if not public.has_permission('resolve', 'view') then
    raise exception 'You do not have access to Resolve Hub.' using errcode = 'P0001';
  end if;
  v_loc := public.current_location();
  if v_loc is null then
    raise exception 'Choose a unit before raising a request.' using errcode = 'P0001';
  end if;
  if v_behalf then
    if not public.has_permission('resolve', 'edit') then
      raise exception 'Only the service desk can log a request for somebody else.' using errcode = 'P0001';
    end if;
    if v_source not in ('phone', 'email', 'chat', 'whatsapp') then
      raise exception 'Say how the request reached you — phone, email, chat or WhatsApp.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.profiles p where p.id = v_req and p.is_active) then
      raise exception 'Choose an active person as the requester.' using errcode = 'P0001';
    end if;
  elsif v_source <> 'form' then
    raise exception 'Unknown request source "%".', v_source using errcode = 'P0001';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Say in a few words what you need help with.' using errcode = 'P0001';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'Describe the problem or what you need, so the desk can start without asking.' using errcode = 'P0001';
  end if;
  if p_impact is null or p_impact not in ('cannot_work', 'degraded', 'request') then
    raise exception 'Say how this affects your work.' using errcode = 'P0001';
  end if;
  if p_photo_path is not null
     and (btrim(p_photo_path) = '' or p_photo_path not like 'tickets/%' or p_photo_path like '%..%') then
    raise exception 'The screenshot upload is not valid — please attach it again.' using errcode = 'P0001';
  end if;
  select * into c from public.rh_sd_categories x where x.id = p_category_id;
  if not found or c.location_id <> v_loc or c.inactive then
    raise exception 'That category is not available in your current unit.' using errcode = 'P0001';
  end if;

  s := public.rh_settings(v_loc);
  -- The rate limit guards self-service; a desk taking calls is not spam (plan §1.8).
  if not v_behalf then
    perform pg_advisory_xact_lock(hashtextextended('rh_report:' || v_uid::text, 0));
    select count(*) into v_n from public.rh_report_ledger l
     where l.profile_id = v_uid and l.created_at > now() - interval '24 hours';
    if v_n >= s.report_limit_24h then
      raise exception '%', format('You have sent %s requests in the last 24 hours, which is the limit. '
                                  'Please call the service desk instead.', v_n)
        using errcode = 'P0001';
    end if;
  end if;

  -- Impact, never priority (plan §1.3); the category's default is the floor.
  v_pri := case p_impact when 'cannot_work' then 'high' when 'degraded' then 'medium' else 'low' end;
  if public.rh__pri_rank(c.default_priority) < public.rh__pri_rank(v_pri) then
    v_pri := c.default_priority;
  end if;
  select m.response_minutes, m.resolution_minutes into v_resp, v_resol
    from public.rh__sd_minutes(v_loc, v_pri) m;

  v_year := extract(year from (now() at time zone s.timezone))::int;
  insert into public.rh_ref_counters as k (prefix, year, last_no) values ('SD', v_year, 1)
    on conflict (prefix, year) do update set last_no = k.last_no + 1
    returning k.last_no into v_no;
  v_ref := 'SD-' || v_year || '-' || lpad(v_no::text, 6, '0');

  select r.owner_id, r.team_id, r.reason into v_owner, v_team, v_reason
    from public.rh__sd_route(v_loc, c.id) r;

  insert into public.rh_tickets (
    location_id, kind, ref_no, status, reporter_id, title, description,
    severity, priority, source, ticket_type, impact, sd_category_id,
    owner_id, owner_reason, team_id, response_due_at, due_at, needs_sorting, created_by)
  values (
    v_loc, 'service', v_ref, 'open', v_req, btrim(p_title), btrim(p_description),
    v_pri, v_pri, v_source, c.ticket_type, p_impact, c.id,
    v_owner, v_reason, v_team, now() + make_interval(mins => v_resp), now() + make_interval(mins => v_resol),
    v_owner is null, v_uid)
  returning id into v_id;

  if p_photo_path is not null then
    insert into public.rh_ticket_photos (ticket_id, kind, fix_round, path, uploaded_by)
    values (v_id, 'report', 1, p_photo_path, v_uid);
  end if;
  if not v_behalf then
    insert into public.rh_report_ledger (profile_id, ticket_id, kind) values (v_uid, v_id, 'service');
  end if;
  perform public.rh_log(v_id, 'created', null, 'open', null,
    jsonb_build_object('source', v_source, 'on_behalf_by', case when v_behalf then v_uid end,
                       'owner_reason', v_reason, 'priority', v_pri, 'impact', p_impact));

  return jsonb_build_object(
    'ticket_id', v_id, 'ref_no', v_ref, 'priority', v_pri,
    'owner_name', (select p.full_name from public.profiles p where p.id = v_owner),
    'team_name', (select tm.name from public.rh_teams tm where tm.id = v_team),
    'response_due_at', now() + make_interval(mins => v_resp),
    'due_at', now() + make_interval(mins => v_resol),
    'needs_sorting', v_owner is null);
end;
$$;

-- ─── 5. Transitions ─────────────────────────────────────────────────────────

create or replace function public.rh_sd_claim(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'sd_claim', 'take');
  update public.rh_tickets set assignee_id = auth.uid(), status = 'assigned', needs_sorting = false
   where id = t.id;
  perform public.rh__sd_ack(t.id);
  perform public.rh_log(t.id, 'claimed', t.status, 'assigned', null,
                        jsonb_build_object('assignee_id', auth.uid()));
  return jsonb_build_object('status', 'assigned', 'assignee_id', auth.uid());
end;
$$;

create or replace function public.rh_sd_assign(p_ticket_id uuid, p_assignee_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t        public.rh_tickets := public.rh_lock(p_ticket_id);
  v_status text;
begin
  perform public.rh_require(t, 'sd_assign', 'assign');
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
  v_status := case when t.status = 'open' then 'assigned' else t.status end;
  update public.rh_tickets
     set assignee_id   = p_assignee_id,
         status        = v_status,
         owner_id      = coalesce(owner_id, p_assignee_id),
         owner_reason  = case when owner_id is null then 'Assigned by the desk manager' else owner_reason end,
         needs_sorting = false
   where id = t.id;
  perform public.rh_log(t.id, 'assigned', t.status, v_status, null,
    jsonb_build_object('assignee_id', p_assignee_id, 'previous_assignee_id', t.assignee_id));
  return jsonb_build_object('status', v_status, 'assignee_id', p_assignee_id);
end;
$$;

-- Starting an urgent ticket may pause the technician's current one, with a
-- courteous message to that requester (spec §3.2). The message is a NOTE the
-- requester reads, written quietly (no second 'replied' notification — the
-- 'held' row already tells them).
create or replace function public.rh_sd_start(
  p_ticket_id uuid, p_pause_ticket_id uuid default null, p_pause_message text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
  p public.rh_tickets;
begin
  perform public.rh_require(t, 'sd_start', 'start');
  if p_pause_ticket_id is not null then
    if p_pause_ticket_id = t.id then
      raise exception 'A ticket cannot pause itself.' using errcode = 'P0001';
    end if;
    p := public.rh_lock(p_pause_ticket_id);
    if p.kind <> 'service' or p.status <> 'in_progress' or p.assignee_id is distinct from auth.uid() then
      raise exception '%', format('%s is not a request you are working on now, so it cannot be paused.', p.ref_no)
        using errcode = 'P0001';
    end if;
    if p_pause_message is null or btrim(p_pause_message) = '' then
      raise exception 'Write a short message to the requester whose work you are pausing.' using errcode = 'P0001';
    end if;
    update public.rh_tickets
       set status = 'on_hold', paused_at = now(), preempted_by = t.id,
           blocked_reason = 'Paused for an urgent issue (' || t.ref_no || ')'
     where id = p.id;
    perform set_config('rh.quiet_note', 'on', true);
    insert into public.rh_ticket_notes (ticket_id, author_id, body, visibility)
    values (p.id, auth.uid(), btrim(p_pause_message), 'reporter');
    perform set_config('rh.quiet_note', 'off', true);
    perform public.rh_log(p.id, 'held', p.status, 'on_hold', p_pause_message,
      jsonb_build_object('preempted_by', t.id, 'preempted_by_ref', t.ref_no));
  end if;
  update public.rh_tickets
     set status = 'in_progress', assignee_id = coalesce(assignee_id, auth.uid()), needs_sorting = false
   where id = t.id;
  perform public.rh__sd_ack(t.id);
  perform public.rh_log(t.id, 'started', t.status, 'in_progress', null,
    jsonb_build_object('paused_ticket_id', p_pause_ticket_id));
  return jsonb_build_object('status', 'in_progress', 'paused_ticket_id', p_pause_ticket_id);
end;
$$;

create or replace function public.rh_sd_hold(p_ticket_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the request is on hold — the requester will read it.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'sd_hold', 'put on hold');
  update public.rh_tickets
     set status = 'on_hold', paused_at = now(), blocked_reason = btrim(p_reason)
   where id = t.id;
  perform public.rh__sd_ack(t.id);
  perform public.rh_log(t.id, 'held', t.status, 'on_hold', p_reason);
  return jsonb_build_object('status', 'on_hold');
end;
$$;

create or replace function public.rh_sd_resume(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t      public.rh_tickets := public.rh_lock(p_ticket_id);
  v_secs int;
begin
  perform public.rh_require(t, 'sd_resume', 'resume');
  v_secs := ceil(extract(epoch from greatest(now() - t.paused_at, interval '0')))::int;
  update public.rh_tickets
     set status = 'in_progress', paused_at = null, blocked_reason = null, preempted_by = null,
         paused_seconds = paused_seconds + v_secs,
         due_at = due_at + make_interval(secs => v_secs)
   where id = t.id;
  perform public.rh_log(t.id, 'resumed', 'on_hold', 'in_progress', null,
                        jsonb_build_object('paused_seconds', v_secs));
  return jsonb_build_object('status', 'in_progress', 'paused_seconds', v_secs);
end;
$$;

-- Resolution logging is mandatory (spec §7.1): what caused it, and what fixed it.
create or replace function public.rh_sd_resolve(
  p_ticket_id uuid, p_root_cause text, p_resolution text, p_kb_article_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t       public.rh_tickets := public.rh_lock(p_ticket_id);
  v_held  jsonb;
begin
  if p_root_cause is null or length(btrim(p_root_cause)) < 10 then
    raise exception 'Write what caused the problem (at least 10 characters).' using errcode = 'P0001';
  end if;
  if p_resolution is null or length(btrim(p_resolution)) < 10 then
    raise exception 'Write the steps that fixed it (at least 10 characters) — the next technician will read them.'
      using errcode = 'P0001';
  end if;
  if p_kb_article_id is not null and not exists (
       select 1 from public.rh_kb_articles k where k.id = p_kb_article_id and k.status = 'published') then
    raise exception 'That knowledge-base article is not published.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'sd_resolve', 'resolve');
  update public.rh_tickets
     set status = 'resolved', resolved_at = now(), fixed_at = now(),
         assignee_id = coalesce(assignee_id, auth.uid()),
         root_cause = btrim(p_root_cause), resolution_message = btrim(p_resolution),
         kb_article_id = p_kb_article_id
   where id = t.id;
  if p_kb_article_id is not null then
    update public.rh_kb_articles set used_count = used_count + 1 where id = p_kb_article_id;
  end if;
  perform public.rh__sd_ack(t.id);
  perform public.rh_log(t.id, 'resolved', t.status, 'resolved', p_resolution,
    jsonb_build_object('kb_article_id', p_kb_article_id, 'fix_round', t.fix_round));
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'ref_no', x.ref_no, 'title', x.title)), '[]'::jsonb)
    into v_held
    from public.rh_tickets x
   where x.preempted_by = t.id and x.status = 'on_hold';
  return jsonb_build_object('status', 'resolved', 'preempted', v_held);
end;
$$;

create or replace function public.rh_sd_confirm(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'sd_confirm', 'confirm');
  update public.rh_tickets
     set status = 'closed', closed_at = now(), closure_kind = 'requester_confirmed'
   where id = t.id;
  perform public.rh_log(t.id, 'confirmed', 'resolved', 'closed', null);
  return jsonb_build_object('status', 'closed');
end;
$$;

create or replace function public.rh_sd_reopen(p_ticket_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t       public.rh_tickets := public.rh_lock(p_ticket_id);
  v_resol int;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say what is still not working.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'sd_reopen', 'reopen');
  select m.resolution_minutes into v_resol from public.rh__sd_minutes(t.location_id, t.priority) m;
  update public.rh_tickets
     set status = 'in_progress', fix_round = fix_round + 1, reopen_count = reopen_count + 1,
         resolved_at = null, fixed_at = null, closed_at = null, closure_kind = null,
         due_at = now() + make_interval(mins => v_resol),
         resolution_breached_at = null, sla_warned_at = null,
         assignee_id = coalesce(assignee_id, owner_id)
   where id = t.id;
  perform public.rh_log(t.id, 'reopened', t.status, 'in_progress', p_reason,
    jsonb_build_object('fix_round', t.fix_round + 1));
  return jsonb_build_object('status', 'in_progress', 'fix_round', t.fix_round + 1);
end;
$$;

-- Priority override (spec §3.2): financial risk or an executive directive puts
-- a ticket ahead of the queue, with the reason on record.
create or replace function public.rh_sd_override(p_ticket_id uuid, p_kind text, p_note text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t       public.rh_tickets := public.rh_lock(p_ticket_id);
  v_resp  int;
  v_resol int;
begin
  if p_kind is null or p_kind not in ('financial_risk', 'executive_directive') then
    raise exception 'Choose why this jumps the queue — financial risk or an executive directive.' using errcode = 'P0001';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'Write a line on the business impact — it stays on the ticket.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'sd_override', 'raise to urgent');
  select m.response_minutes, m.resolution_minutes into v_resp, v_resol
    from public.rh__sd_minutes(t.location_id, 'urgent') m;
  update public.rh_tickets
     set priority = 'urgent', severity = 'critical',
         override_kind = p_kind, override_note = btrim(p_note),
         overridden_at = now(), overridden_by = auth.uid(),
         response_due_at = case when first_response_at is null
                                then least(response_due_at, now() + make_interval(mins => v_resp))
                                else response_due_at end,
         due_at = least(due_at, now() + make_interval(mins => v_resol)),
         response_breached_at = case when first_response_at is null then null else response_breached_at end,
         resolution_breached_at = null, sla_warned_at = null
   where id = t.id;
  perform public.rh_log(t.id, 'overridden', t.status, t.status, p_note,
    jsonb_build_object('kind', p_kind, 'from_priority', t.priority));
  return jsonb_build_object('status', t.status, 'priority', 'urgent');
end;
$$;

create or replace function public.rh_sd_reclassify(
  p_ticket_id uuid, p_category_id uuid default null, p_ticket_type text default null,
  p_priority text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t         public.rh_tickets := public.rh_lock(p_ticket_id);
  c         public.rh_sd_categories;
  v_cat     uuid := coalesce(p_category_id, t.sd_category_id);
  v_type    text;
  v_pri     text := coalesce(p_priority, t.priority);
  v_reroute boolean := p_category_id is not null and p_category_id is distinct from t.sd_category_id;
  v_owner   uuid := t.owner_id;
  v_team    uuid := t.team_id;
  v_reason  text := t.owner_reason;
  v_assign  uuid := t.assignee_id;
  v_status  text := t.status;
  v_resp    int;
  v_resol   int;
  v_rdue    timestamptz := t.response_due_at;
  v_due     timestamptz := t.due_at;
begin
  perform public.rh_require(t, 'sd_reclassify', 'reclassify');
  if v_pri not in ('urgent', 'high', 'medium', 'low') then
    raise exception 'Unknown priority "%".', v_pri using errcode = 'P0001';
  end if;
  if v_pri is distinct from t.priority then
    if v_pri = 'urgent' then
      raise exception 'Urgent is set only by an override, with its reason.' using errcode = 'P0001';
    end if;
    if t.override_kind is not null then
      raise exception 'This request was raised to Urgent by an override; its priority stays.' using errcode = 'P0001';
    end if;
  end if;
  select * into c from public.rh_sd_categories x where x.id = v_cat;
  if not found or c.location_id <> t.location_id or (v_reroute and c.inactive) then
    raise exception 'That category is not available at this unit.' using errcode = 'P0001';
  end if;
  v_type := coalesce(p_ticket_type, case when v_reroute then c.ticket_type else t.ticket_type end);
  if v_type not in ('incident', 'service', 'change') then
    raise exception 'Unknown request type "%".', v_type using errcode = 'P0001';
  end if;
  if v_reroute then
    select r.owner_id, r.team_id, r.reason into v_owner, v_team, v_reason
      from public.rh__sd_route(t.location_id, c.id) r;
    if v_team is distinct from t.team_id then
      v_assign := null;
      if t.status = 'assigned' then v_status := 'open'; end if;
    end if;
  end if;
  if v_pri is distinct from t.priority then
    select m.response_minutes, m.resolution_minutes into v_resp, v_resol
      from public.rh__sd_minutes(t.location_id, v_pri) m;
    if t.first_response_at is null then
      v_rdue := t.created_at + make_interval(mins => v_resp);
    end if;
    v_due := t.created_at + make_interval(mins => v_resol) + make_interval(secs => t.paused_seconds);
  end if;
  update public.rh_tickets
     set sd_category_id = v_cat, ticket_type = v_type, priority = v_pri,
         severity = case when v_pri = 'urgent' then 'critical' else v_pri end,
         owner_id = v_owner, team_id = v_team, owner_reason = v_reason, assignee_id = v_assign,
         status = v_status, response_due_at = v_rdue, due_at = v_due,
         needs_sorting = v_owner is null,
         resolution_breached_at = case when v_due is distinct from t.due_at then null else resolution_breached_at end,
         sla_warned_at = case when v_due is distinct from t.due_at then null else sla_warned_at end
   where id = t.id;
  perform public.rh_log(t.id, 'reclassified', t.status, v_status, null,
    jsonb_build_object('rerouted', v_reroute, 'from_category_id', t.sd_category_id, 'to_category_id', v_cat,
                       'ticket_type', v_type, 'priority', v_pri, 'from_priority', t.priority));
  return jsonb_build_object('status', v_status, 'rerouted', v_reroute, 'owner_id', v_owner,
                            'priority', v_pri, 'due_at', v_due);
end;
$$;

create or replace function public.rh_sd_cancel(p_ticket_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the request is cancelled — the requester will read it.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'sd_cancel', 'cancel');
  update public.rh_tickets set status = 'cancelled', cancel_reason = btrim(p_reason) where id = t.id;
  perform public.rh_log(t.id, 'cancelled', t.status, 'cancelled', p_reason);
  return jsonb_build_object('status', 'cancelled');
end;
$$;

create or replace function public.rh_sd_withdraw(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'sd_withdraw', 'withdraw');
  update public.rh_tickets set status = 'withdrawn', withdrawn_at = now() where id = t.id;
  perform public.rh_log(t.id, 'withdrawn', t.status, 'withdrawn', null);
  return jsonb_build_object('status', 'withdrawn');
end;
$$;

-- ─── 6. Activity + notes keep the stale clock and the response clock ───────

create or replace function public.rh_sd_activity_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.actor_id is not null and new.ticket_id is not null then
    update public.rh_tickets set last_activity_at = now()
     where id = new.ticket_id and kind = 'service';
  end if;
  return new;
end;
$$;

create trigger rh_ticket_activity_sd_touch
  after insert on public.rh_ticket_activity
  for each row execute function public.rh_sd_activity_touch();

-- A requester-visible note IS the conversation: it writes a 'replied' row (so
-- the other side is told) and, from a technician, counts as the first response.
create or replace function public.rh_sd_note_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  t        public.rh_tickets;
  v_staff  boolean;
begin
  select * into t from public.rh_tickets x where x.id = new.ticket_id;
  if not found or t.kind <> 'service' then
    return new;
  end if;
  v_staff := new.author_id is not null and new.author_id is distinct from t.reporter_id
             and public.rh__is_staff_on(t.id, new.author_id);
  update public.rh_tickets
     set last_activity_at = now(),
         first_response_at = case when v_staff and new.visibility = 'reporter'
                                  then coalesce(first_response_at, now()) else first_response_at end
   where id = t.id;
  if new.visibility = 'reporter' and coalesce(current_setting('rh.quiet_note', true), '') <> 'on' then
    insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, note, meta)
    values (t.id, new.author_id, 'replied', t.status, t.status, new.body,
            jsonb_build_object('note_id', new.id, 'by_staff', v_staff));
  end if;
  return new;
end;
$$;

create trigger rh_ticket_notes_sd_touch
  after insert on public.rh_ticket_notes
  for each row execute function public.rh_sd_note_touch();

-- ─── 7. Queues, shift summary, dashboard, performance ──────────────────────

create or replace function public.rh_sd_queue(p_tab text default 'all')
returns table (
  id uuid, ref_no text, status text, ticket_type text, title text, priority text,
  category_name text, team_name text, reporter_name text, assignee_id uuid, assignee_name text,
  owner_name text, source text, created_at timestamptz, response_due_at timestamptz,
  first_response_at timestamptz, due_at timestamptz, paused_at timestamptz,
  last_activity_at timestamptz, overridden boolean, override_kind text,
  response_state text, resolution_state text, minutes_left int, stale_days int)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_loc uuid := public.current_location();
  v_tab text := coalesce(p_tab, 'all');
begin
  if not (public.has_permission('resolve', 'edit') or public.has_permission('resolve', 'approve')
          or public.has_permission('resolve', 'export')) then
    raise exception 'You do not have access to the service desk queue.' using errcode = 'P0001';
  end if;
  if v_tab not in ('unassigned', 'mine', 'team', 'breaching', 'all', 'done') then
    raise exception 'Unknown queue tab "%".', v_tab using errcode = 'P0001';
  end if;
  if v_loc is null then
    return;
  end if;

  return query
  with base as (
    select t.*, k.*
      from public.rh_tickets t
      cross join lateral public.rh__sd_clock(t) k
     where t.kind = 'service' and t.location_id = v_loc
       and public.rh__staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, v_uid)
       and case v_tab
             when 'done' then t.status in ('resolved', 'closed', 'cancelled', 'withdrawn')
                              and t.updated_at > now() - interval '30 days'
             else t.status in ('open', 'assigned', 'in_progress', 'on_hold')
           end
  )
  select b.id, b.ref_no, b.status, b.ticket_type, b.title, b.priority,
         c.name, tm.name, rp.full_name, b.assignee_id, ap.full_name, op.full_name, b.source,
         b.created_at, b.response_due_at, b.first_response_at, b.due_at, b.paused_at,
         b.last_activity_at, b.override_kind is not null, b.override_kind,
         b.response_state, b.resolution_state, b.minutes_left,
         floor(extract(epoch from now() - b.last_activity_at) / 86400)::int
    from base b
    left join public.rh_sd_categories c on c.id = b.sd_category_id
    left join public.rh_teams tm on tm.id = b.team_id
    left join public.profiles rp on rp.id = b.reporter_id
    left join public.profiles ap on ap.id = b.assignee_id
    left join public.profiles op on op.id = b.owner_id
   where case v_tab
           when 'unassigned' then b.assignee_id is null
           when 'mine'       then b.assignee_id = v_uid or (b.assignee_id is null and b.owner_id = v_uid)
           when 'team'       then public.rh__is_team_member(b.team_id, v_uid)
           when 'breaching'  then b.response_state = 'breached' and b.first_response_at is null
                                  or b.resolution_state in ('breached', 'at_risk')
           else true
         end
   -- FIFO inside priority; an override jumps the line (spec §3.2).
   order by case when v_tab = 'done' then 0 else (b.override_kind is null)::int end,
            case when v_tab = 'done' then 0 else public.rh__pri_rank(b.priority) end,
            case when v_tab = 'done' then b.updated_at end desc nulls last,
            b.created_at;
end;
$$;

-- Spec §7.2 shift-commencement review: what is waiting on me as I sit down.
create or replace function public.rh_sd_shift_summary()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_loc    uuid := public.current_location();
  v_tz     text;
  v_remind int;
  v_today  timestamptz;
  v_since  timestamptz;
  v_out    jsonb;
begin
  if v_uid is null or v_loc is null then
    return jsonb_build_object('carried_over', 0, 'stale', 0, 'breaching', 0, 'new_since_last_shift', 0);
  end if;
  select coalesce(s.timezone, 'Asia/Kolkata'), coalesce(s.sd_stale_remind_days, 3) into v_tz, v_remind
    from (select 1) one left join public.rh_unit_settings s on s.location_id = v_loc;
  v_today := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  select max(a.created_at) into v_since
    from public.rh_ticket_activity a where a.actor_id = v_uid and a.created_at < v_today;
  v_since := coalesce(v_since, now() - interval '24 hours');

  with mine as (
    select t.*, k.*
      from public.rh_tickets t
      cross join lateral public.rh__sd_clock(t) k
     where t.kind = 'service' and t.location_id = v_loc
       and t.status in ('open', 'assigned', 'in_progress', 'on_hold')
       and (t.assignee_id = v_uid or (t.assignee_id is null and t.owner_id = v_uid)
            or (t.assignee_id is null and public.rh__is_team_member(t.team_id, v_uid)))
  )
  select jsonb_build_object(
    'carried_over', count(*) filter (where m.created_at < v_today),
    'stale', count(*) filter (where m.last_activity_at < now() - make_interval(days => v_remind)),
    'breaching', count(*) filter (where m.resolution_state in ('breached', 'at_risk')
                                     or (m.response_state = 'breached' and m.first_response_at is null)),
    'new_since_last_shift', count(*) filter (where m.created_at > v_since),
    'since', v_since)
    into v_out
    from mine m;
  return v_out;
end;
$$;

create or replace function public.rh_sd_dashboard()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_loc   uuid := public.current_location();
  v_tz    text;
  v_today timestamptz;
  v_out   jsonb;
begin
  if not (public.has_permission('resolve', 'edit') or public.has_permission('resolve', 'approve')
          or public.has_permission('resolve', 'export')) then
    raise exception 'You do not have access to the service desk dashboard.' using errcode = 'P0001';
  end if;
  if v_loc is null then
    return null;
  end if;
  select coalesce((select s.timezone from public.rh_unit_settings s where s.location_id = v_loc), 'Asia/Kolkata')
    into v_tz;
  v_today := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  with live as (
    select t.*, k.*
      from public.rh_tickets t
      cross join lateral public.rh__sd_clock(t) k
     where t.kind = 'service' and t.location_id = v_loc
       and t.status in ('open', 'assigned', 'in_progress', 'on_hold')
  ),
  svc as (
    select t.created_at, t.resolved_at from public.rh_tickets t
     where t.kind = 'service' and t.location_id = v_loc
       and (t.created_at > now() - interval '13 months' or t.resolved_at > now() - interval '13 months')
  ),
  people as (
    select m.profile_id as pid
      from public.rh_team_members m
      join public.rh_teams tm on tm.id = m.team_id
     where m.active and not tm.inactive and tm.location_id = v_loc
       and exists (select 1 from public.rh_sd_categories c where c.team_id = tm.id and not c.inactive)
    union
    select l.assignee_id from live l where l.assignee_id is not null
  )
  select jsonb_build_object(
    'open',                (select count(*) from live),
    'unassigned',          (select count(*) from live where assignee_id is null),
    'on_hold',             (select count(*) from live where status = 'on_hold'),
    'at_risk',             (select count(*) from live where resolution_state = 'at_risk'),
    'breached_response',   (select count(*) from live where response_state = 'breached' and first_response_at is null),
    'breached_resolution', (select count(*) from live where resolution_state = 'breached'),
    'resolved_today',      (select count(*) from public.rh_tickets t
                             where t.kind = 'service' and t.location_id = v_loc and t.resolved_at >= v_today),
    'escalations',         (select count(*) from live
                             where stale_escalated_at is not null or resolution_breached_at is not null
                                or response_breached_at is not null),
    'escalation_list', coalesce((
       select jsonb_agg(e.j order by e.at desc) from (
         select jsonb_build_object('id', l.id, 'ref_no', l.ref_no, 'title', l.title, 'priority', l.priority,
                  'reason', case when l.stale_escalated_at is not null then 'stale'
                                 when l.resolution_breached_at is not null then 'resolution'
                                 else 'response' end,
                  'at', greatest(l.stale_escalated_at, l.resolution_breached_at, l.response_breached_at),
                  'assignee_name', (select p.full_name from public.profiles p where p.id = l.assignee_id)) as j,
                greatest(l.stale_escalated_at, l.resolution_breached_at, l.response_breached_at) as at
           from live l
          where l.stale_escalated_at is not null or l.resolution_breached_at is not null
             or l.response_breached_at is not null
          order by 2 desc limit 10) e), '[]'::jsonb),
    'by_technician', coalesce((
       select jsonb_agg(jsonb_build_object(
                'profile_id', pe.pid, 'name', pr.full_name,
                'assigned',    (select count(*) from live l where l.assignee_id = pe.pid and l.status in ('open', 'assigned')),
                'in_progress', (select count(*) from live l where l.assignee_id = pe.pid and l.status = 'in_progress'),
                'on_hold',     (select count(*) from live l where l.assignee_id = pe.pid and l.status = 'on_hold'),
                'breached',    (select count(*) from live l where l.assignee_id = pe.pid
                                  and (l.resolution_state = 'breached'
                                       or (l.response_state = 'breached' and l.first_response_at is null))))
                order by pr.full_name)
         from people pe join public.profiles pr on pr.id = pe.pid), '[]'::jsonb),
    'by_priority', coalesce((
       select jsonb_agg(jsonb_build_object('priority', p.priority, 'open',
                (select count(*) from live l where l.priority = p.priority)) order by p.r)
         from (values ('urgent', 0), ('high', 1), ('medium', 2), ('low', 3)) p(priority, r)), '[]'::jsonb),
    'by_type', coalesce((
       select jsonb_agg(jsonb_build_object('ticket_type', p.ty, 'open',
                (select count(*) from live l where l.ticket_type = p.ty)) order by p.r)
         from (values ('incident', 0), ('service', 1), ('change', 2)) p(ty, r)), '[]'::jsonb),
    'trend', jsonb_build_object(
      'daily', (select jsonb_agg(jsonb_build_object('d', d::date,
                  'created',  (select count(*) from svc where (created_at at time zone v_tz)::date = d::date),
                  'resolved', (select count(*) from svc where (resolved_at at time zone v_tz)::date = d::date))
                  order by d)
                  from generate_series((now() at time zone v_tz)::date - 13, (now() at time zone v_tz)::date,
                                       interval '1 day') d),
      'weekly', (select jsonb_agg(jsonb_build_object('d', d::date,
                  'created',  (select count(*) from svc
                                where date_trunc('week', created_at at time zone v_tz) = d),
                  'resolved', (select count(*) from svc
                                where date_trunc('week', resolved_at at time zone v_tz) = d))
                  order by d)
                  from generate_series(date_trunc('week', now() at time zone v_tz) - interval '11 weeks',
                                       date_trunc('week', now() at time zone v_tz), interval '1 week') d),
      'monthly', (select jsonb_agg(jsonb_build_object('d', d::date,
                  'created',  (select count(*) from svc
                                where date_trunc('month', created_at at time zone v_tz) = d),
                  'resolved', (select count(*) from svc
                                where date_trunc('month', resolved_at at time zone v_tz) = d))
                  order by d)
                  from generate_series(date_trunc('month', now() at time zone v_tz) - interval '11 months',
                                       date_trunc('month', now() at time zone v_tz), interval '1 month') d)))
    into v_out;
  return v_out;
end;
$$;

-- Spec §1.2 / §6.2: the record a performance review reads. One row per
-- technician (the assignee at resolution) + a desk total (profile_id NULL).
create or replace function public.rh_sd_performance(p_from date, p_to date)
returns table (
  profile_id uuid, name text, resolved int, avg_first_response_min numeric,
  avg_resolution_min numeric, response_met_pct numeric, resolution_met_pct numeric,
  csat_avg numeric, csat_count int, reopened int, kb_authored int)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_loc  uuid := public.current_location();
  v_tz   text;
  v_from timestamptz;
  v_to   timestamptz;
begin
  if not public.has_permission('resolve', 'export') then
    raise exception 'You do not have access to desk performance.' using errcode = 'P0001';
  end if;
  if v_loc is null or p_from is null or p_to is null then
    return;
  end if;
  if p_to < p_from then
    raise exception 'The end date is before the start date.' using errcode = 'P0001';
  end if;
  select coalesce((select s.timezone from public.rh_unit_settings s where s.location_id = v_loc), 'Asia/Kolkata')
    into v_tz;
  v_from := p_from::timestamp at time zone v_tz;
  v_to   := (p_to + 1)::timestamp at time zone v_tz;

  return query
  with done as (
    select t.id, t.assignee_id as pid, t.created_at, t.first_response_at, t.response_due_at,
           t.resolved_at, t.due_at, t.paused_seconds, t.reopen_count,
           rt.stars_sum, rt.stars_n
      from public.rh_tickets t
      cross join lateral (select coalesce(sum(r.stars), 0) as stars_sum, count(*) as stars_n
                            from public.rh_ratings r where r.ticket_id = t.id) rt
     where t.kind = 'service' and t.location_id = v_loc
       and t.resolved_at >= v_from and t.resolved_at < v_to
  ),
  agg as (
    select d.pid, grouping(d.pid) = 1 as is_total,
           count(*)::int as resolved,
           round(avg(extract(epoch from d.first_response_at - d.created_at) / 60)
                 filter (where d.first_response_at is not null), 1) as frt,
           round(avg(greatest(extract(epoch from d.resolved_at - d.created_at) - d.paused_seconds, 0) / 60), 1) as art,
           round(100.0 * count(*) filter (where d.first_response_at <= d.response_due_at)
                 / nullif(count(*) filter (where d.response_due_at is not null), 0), 1) as rmet,
           round(100.0 * count(*) filter (where d.resolved_at <= d.due_at) / nullif(count(*), 0), 1) as xmet,
           round(sum(d.stars_sum)::numeric / nullif(sum(d.stars_n), 0), 2) as csat,
           sum(d.stars_n)::int as ccount,
           count(*) filter (where d.reopen_count > 0)::int as reopened
      from done d
     group by grouping sets ((d.pid), ())
  )
  select g.pid, case when g.is_total then 'DESK TOTAL' else p.full_name end,
         g.resolved, g.frt, g.art, g.rmet, g.xmet, g.csat, g.ccount, g.reopened,
         (select count(*) from public.rh_kb_articles k
           where k.created_at >= v_from and k.created_at < v_to
             and (g.is_total or k.author_id = g.pid))::int
    from agg g
    left join public.profiles p on p.id = g.pid
   where g.is_total or g.pid is not null
   order by g.is_total, g.resolved desc, p.full_name;
end;
$$;

-- ─── 8. Knowledge base ──────────────────────────────────────────────────────

create or replace function public.rh_kb_search(
  p_q text, p_category_code text default null, p_limit int default 5)
returns table (id uuid, code text, title text, problem text, steps text[], category_code text, rank real)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q  text := btrim(coalesce(p_q, ''));
  v_ts tsquery;
begin
  if not public.has_permission('resolve', 'view') or length(v_q) < 3 then
    return;
  end if;
  v_ts := websearch_to_tsquery('simple', v_q);
  return query
  select k.id, k.code, k.title, k.problem, k.steps, k.category_code,
         (ts_rank(k.search, v_ts) + case when k.title ilike '%' || v_q || '%' then 1 else 0 end)::real
    from public.rh_kb_articles k
   where k.status = 'published'
     and (k.search @@ v_ts or k.title ilike '%' || v_q || '%')
   order by (k.category_code is not distinct from p_category_code and p_category_code is not null) desc,
            7 desc, k.used_count desc
   limit greatest(1, least(coalesce(p_limit, 5), 20));
end;
$$;

create or replace function public.rh_kb_list(p_status text default 'published', p_q text default null)
returns table (
  id uuid, code text, title text, problem text, status text, category_code text, tags text[],
  created_by uuid, author_name text, published_at timestamptz, used_count int, helpful_count int,
  not_helpful_count int, created_at timestamptz, updated_at timestamptz)
language plpgsql stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status text := coalesce(p_status, 'published');
  v_q      text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if v_status not in ('draft', 'published', 'retired') then
    raise exception 'Unknown article status "%".', v_status using errcode = 'P0001';
  end if;
  if not (public.has_permission('resolve', 'edit')
          or (v_status = 'published' and public.has_permission('resolve', 'view'))) then
    return;
  end if;
  return query
  select k.id, k.code, k.title, k.problem, k.status, k.category_code, k.tags,
         k.author_id, p.full_name, k.published_at, k.used_count, k.helpful_count, k.not_helpful_count,
         k.created_at, k.updated_at
    from public.rh_kb_articles k
    left join public.profiles p on p.id = k.author_id
   where k.status = v_status
     and (v_q is null or k.search @@ websearch_to_tsquery('simple', v_q) or k.title ilike '%' || v_q || '%')
   order by k.created_at;
end;
$$;

create or replace function public.rh_kb_get(p_id uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  k public.rh_kb_articles;
begin
  select * into k from public.rh_kb_articles x where x.id = p_id;
  if not found or not (public.has_permission('resolve', 'edit')
                       or (k.status = 'published' and public.has_permission('resolve', 'view'))) then
    return null;
  end if;
  return to_jsonb(k) - 'search' || jsonb_build_object(
    'author_name', (select p.full_name from public.profiles p where p.id = k.author_id),
    'source_ticket_ref', (select t.ref_no from public.rh_tickets t
                           where t.id = k.source_ticket_id and public.rh_can_see(t.id)),
    'my_vote', (select f.helpful from public.rh_kb_feedback f
                 where f.article_id = k.id and f.profile_id = auth.uid()));
end;
$$;

create or replace function public.rh_kb_save(
  p_id uuid, p_title text, p_problem text, p_steps text[], p_tags text[] default '{}',
  p_category_code text default null, p_source_ticket_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_steps text[];
  v_tags  text[];
  v_no    int;
  v_id    uuid;
begin
  if not public.has_permission('resolve', 'edit') then
    raise exception 'Only the service desk can write knowledge-base articles.' using errcode = 'P0001';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Give the article a title.' using errcode = 'P0001';
  end if;
  if p_problem is null or btrim(p_problem) = '' then
    raise exception 'Describe the problem the article solves.' using errcode = 'P0001';
  end if;
  v_steps := array(select btrim(s) from unnest(coalesce(p_steps, '{}')) with ordinality u(s, n)
                    where btrim(s) <> '' order by n);
  if cardinality(v_steps) = 0 then
    raise exception 'Write at least one step.' using errcode = 'P0001';
  end if;
  v_tags := array(select distinct upper(btrim(x)) from unnest(coalesce(p_tags, '{}')) x where btrim(x) <> '');
  if p_source_ticket_id is not null and not public.rh_can_see(p_source_ticket_id) then
    raise exception 'That ticket does not exist or you do not have access to it.' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.rh_ref_counters as k (prefix, year, last_no) values ('KB', 0, 1)
      on conflict (prefix, year) do update set last_no = k.last_no + 1
      returning k.last_no into v_no;
    insert into public.rh_kb_articles (code, title, problem, steps, tags, category_code, source_ticket_id, author_id)
    values ('KB-' || lpad(v_no::text, 6, '0'), btrim(p_title), btrim(p_problem), v_steps, v_tags,
            nullif(btrim(p_category_code), ''), p_source_ticket_id, auth.uid())
    returning id into v_id;
    if p_source_ticket_id is not null then
      perform public.rh_log(p_source_ticket_id, 'kb_written', null, null, btrim(p_title),
                            jsonb_build_object('kb_article_id', v_id));
    end if;
  else
    update public.rh_kb_articles
       set title = btrim(p_title), problem = btrim(p_problem), steps = v_steps, tags = v_tags,
           category_code = nullif(btrim(p_category_code), '')
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'That article no longer exists.' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.rh_kb_set_status(p_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if not public.has_permission('resolve', 'edit') then
    raise exception 'Only the service desk can publish or retire articles.' using errcode = 'P0001';
  end if;
  if p_status not in ('published', 'retired') then
    raise exception 'An article is published or retired.' using errcode = 'P0001';
  end if;
  select k.status into v_old from public.rh_kb_articles k where k.id = p_id for update;
  if not found then
    raise exception 'That article no longer exists.' using errcode = 'P0001';
  end if;
  update public.rh_kb_articles
     set status = p_status,
         published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end
   where id = p_id;
  return p_status;
end;
$$;

create or replace function public.rh_kb_publish(p_id uuid)
returns text language sql security definer set search_path = ''
as $$ select public.rh_kb_set_status(p_id, 'published') $$;

create or replace function public.rh_kb_retire(p_id uuid)
returns text language sql security definer set search_path = ''
as $$ select public.rh_kb_set_status(p_id, 'retired') $$;

-- One vote per person; changing it moves the counters, it never double-counts.
create or replace function public.rh_kb_feedback(p_id uuid, p_helpful boolean, p_ticket_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean;
begin
  if auth.uid() is null or not public.has_permission('resolve', 'view') then
    raise exception 'Please sign in again.' using errcode = 'P0001';
  end if;
  if p_helpful is null then
    raise exception 'Say whether the article helped.' using errcode = 'P0001';
  end if;
  perform 1 from public.rh_kb_articles k where k.id = p_id and k.status = 'published' for update;
  if not found then
    raise exception 'That article is not published.' using errcode = 'P0001';
  end if;
  if p_ticket_id is not null and not public.rh_can_see(p_ticket_id) then
    raise exception 'That ticket does not exist or you do not have access to it.' using errcode = 'P0001';
  end if;
  select f.helpful into v_old from public.rh_kb_feedback f
   where f.article_id = p_id and f.profile_id = auth.uid();
  insert into public.rh_kb_feedback (article_id, profile_id, helpful, ticket_id)
  values (p_id, auth.uid(), p_helpful, p_ticket_id)
  on conflict (article_id, profile_id) do update set helpful = excluded.helpful, ticket_id = excluded.ticket_id,
                                                     created_at = now();
  update public.rh_kb_articles
     set helpful_count     = helpful_count + (case when p_helpful then 1 else 0 end)
                                           - (case when v_old is true then 1 else 0 end),
         not_helpful_count = not_helpful_count + (case when p_helpful then 0 else 1 end)
                                               - (case when v_old is false then 1 else 0 end)
   where id = p_id;
  return jsonb_build_object('helpful', p_helpful);
end;
$$;

-- ─── 9. Sweep (every 5 min, service role) ──────────────────────────────────

create or replace function public.rh_sd_sweep()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r     record;
  s     public.rh_unit_settings;
  v_rec uuid[];
  v_mgr uuid;
  v_rb  int := 0;
  v_xb  int := 0;
  v_w   int := 0;
  v_sr  int := 0;
  v_se  int := 0;
  v_ac  int := 0;
begin
  for r in
    select t.*, k.*
      from public.rh_tickets t
      cross join lateral public.rh__sd_clock(t) k
     where t.kind = 'service' and t.status in ('open', 'assigned', 'in_progress', 'on_hold', 'resolved')
     for update of t skip locked
  loop
    s := public.rh_settings(r.location_id);
    v_mgr := coalesce(s.desk_manager_id, s.unit_head_id);

    if r.status = 'resolved' then
      if r.resolved_at < now() - make_interval(days => s.sd_auto_close_days) then
        update public.rh_tickets set status = 'closed', closed_at = now(), closure_kind = 'auto_timeout'
         where id = r.id;
        insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, meta)
        values (r.id, null, 'auto_closed', 'resolved', 'closed',
                jsonb_build_object('days', s.sd_auto_close_days));
        v_ac := v_ac + 1;
      end if;
      continue;
    end if;

    -- Response clock: nobody has acknowledged it in time.
    if r.first_response_at is null and r.response_due_at < now() and r.response_breached_at is null then
      v_rec := array_remove(array[r.assignee_id, r.owner_id, v_mgr], null);
      update public.rh_tickets set response_breached_at = now() where id = r.id;
      insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, meta)
      values (r.id, null, 'sla_breached', r.status, r.status,
              jsonb_build_object('clock', 'response', 'recipients', to_jsonb(v_rec)));
      v_rb := v_rb + 1;
    end if;

    -- Resolution clock (On Hold is paused, so never warned or breached).
    if r.status <> 'on_hold' then
      if r.resolution_state = 'breached' and r.resolution_breached_at is null then
        v_rec := array_remove(array[r.assignee_id, r.owner_id, v_mgr], null);
        update public.rh_tickets set resolution_breached_at = now() where id = r.id;
        insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, meta)
        values (r.id, null, 'sla_breached', r.status, r.status,
                jsonb_build_object('clock', 'resolution', 'recipients', to_jsonb(v_rec)));
        v_xb := v_xb + 1;
      elsif r.resolution_state = 'at_risk' and r.sla_warned_at is null then
        v_rec := array_remove(array[coalesce(r.assignee_id, r.owner_id)], null);
        update public.rh_tickets set sla_warned_at = now() where id = r.id;
        insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, meta)
        values (r.id, null, 'sla_warning', r.status, r.status,
                jsonb_build_object('clock', 'resolution', 'minutes_left', r.minutes_left,
                                   'recipients', to_jsonb(v_rec)));
        v_w := v_w + 1;
      end if;
    end if;

    -- Stale clock (spec §1.2 / §5.2): nothing from a person for N days.
    if r.last_activity_at < now() - make_interval(days => s.sd_stale_escalate_days)
       and (r.stale_escalated_at is null or r.stale_escalated_at < r.last_activity_at) then
      v_rec := array_remove(array[v_mgr], null);
      update public.rh_tickets set stale_escalated_at = now(), stale_reminded_at = coalesce(stale_reminded_at, now())
       where id = r.id;
      insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, meta)
      values (r.id, null, 'stale', r.status, r.status,
              jsonb_build_object('level', 'escalate', 'days',
                                 floor(extract(epoch from now() - r.last_activity_at) / 86400)::int,
                                 'recipients', to_jsonb(v_rec)));
      v_se := v_se + 1;
    elsif r.last_activity_at < now() - make_interval(days => s.sd_stale_remind_days)
       and (r.stale_reminded_at is null or r.stale_reminded_at < r.last_activity_at) then
      v_rec := case
        when r.assignee_id is not null then array[r.assignee_id]
        when r.owner_id is not null then array[r.owner_id]
        else array(select m.profile_id from public.rh_team_members m where m.team_id = r.team_id and m.active)
      end;
      update public.rh_tickets set stale_reminded_at = now() where id = r.id;
      insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, meta)
      values (r.id, null, 'stale', r.status, r.status,
              jsonb_build_object('level', 'remind', 'days',
                                 floor(extract(epoch from now() - r.last_activity_at) / 86400)::int,
                                 'recipients', to_jsonb(v_rec)));
      v_sr := v_sr + 1;
    end if;
  end loop;

  return jsonb_build_object('response_breached', v_rb, 'resolution_breached', v_xb, 'warned', v_w,
                            'stale_reminded', v_sr, 'stale_escalated', v_se, 'auto_closed', v_ac);
end;
$$;

-- ─── 10. Activity → outbox: service events ─────────────────────────────────
-- rh_activity_outbox as of 0746, with the service branch beside the complaint one.

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

  if t.kind = 'service' then
    case new.action
      when 'created' then
        v_event := 'resolve.sd_new';
        v_rec := array[t.owner_id]
              || array(select m.profile_id from public.rh_team_members m where m.team_id = t.team_id and m.active);
        if t.owner_id is null and t.team_id is null then
          v_rec := v_rec || coalesce(s.desk_manager_id, s.unit_head_id);
        end if;
      when 'reclassified' then
        if new.meta ->> 'rerouted' = 'true' then
          v_event := 'resolve.sd_new';
          v_rec := array[t.owner_id]
                || array(select m.profile_id from public.rh_team_members m where m.team_id = t.team_id and m.active);
        end if;
      when 'claimed', 'assigned' then
        v_event := 'resolve.assigned'; v_rec := array[t.assignee_id, t.owner_id];
      when 'held', 'resumed', 'cancelled' then
        v_event := 'resolve.sd_update'; v_rec := array[t.reporter_id];
      when 'replied' then
        v_event := 'resolve.sd_reply';
        v_rec := case when new.actor_id = t.reporter_id
                      then array[coalesce(t.assignee_id, t.owner_id)]
                      else array[t.reporter_id] end;
      when 'resolved' then
        v_event := 'resolve.sd_resolved'; v_rec := array[t.reporter_id];
      when 'confirmed' then
        v_event := 'resolve.closed'; v_rec := array[t.assignee_id, t.owner_id];
      when 'auto_closed' then
        v_event := 'resolve.closed'; v_rec := array[t.reporter_id, t.assignee_id];
      when 'reopened' then
        v_event := 'resolve.sd_reopened'; v_rec := array[t.assignee_id, t.owner_id];
      when 'overridden' then
        v_event := 'resolve.sd_urgent';
        v_rec := array[t.assignee_id, t.owner_id]
              || array(select m.profile_id from public.rh_team_members m where m.team_id = t.team_id and m.active);
      when 'sla_breached' then
        v_event := 'resolve.sd_breach';
        v_rec := array(select x::uuid from jsonb_array_elements_text(coalesce(new.meta -> 'recipients', '[]'::jsonb)) x);
      when 'sla_warning' then
        v_event := 'resolve.sd_warning';
        v_rec := array(select x::uuid from jsonb_array_elements_text(coalesce(new.meta -> 'recipients', '[]'::jsonb)) x);
      when 'stale' then
        v_event := 'resolve.sd_stale';
        v_rec := array(select x::uuid from jsonb_array_elements_text(coalesce(new.meta -> 'recipients', '[]'::jsonb)) x);
      when 'rated' then
        v_event := 'resolve.rated'; v_rec := array[coalesce(t.assignee_id, t.owner_id)];
      else
        null;
    end case;
  elsif t.kind = 'complaint' then
    -- The complainant is never a recipient: an anonymous one is not known,
    -- and the handler was chosen to be someone else.
    case new.action
      when 'created' then
        v_event := 'resolve.complaint_new'; v_rec := array[t.owner_id];
      when 'assigned' then
        v_event := 'resolve.assigned'; v_rec := array[t.assignee_id, t.owner_id];
      when 'escalated' then
        v_event := 'resolve.complaint_escalated';
        v_rec := array(select x::uuid from jsonb_array_elements_text(coalesce(new.meta -> 'recipients', '[]'::jsonb)) x);
      when 'resolved' then
        if not t.is_anonymous then
          v_event := 'resolve.complaint_resolved'; v_rec := array[t.reporter_id];
        end if;
      else
        null;
    end case;
  else
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
  end if;

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

-- ─── 11. Grants ─────────────────────────────────────────────────────────────

-- Internal: definer code only.
revoke all on function public.rh__pri_rank(text) from public, anon, authenticated;
revoke all on function public.rh__sd_minutes(uuid, text) from public, anon, authenticated;
revoke all on function public.rh__sd_clock(public.rh_tickets) from public, anon, authenticated;
revoke all on function public.rh__sd_ack(uuid) from public, anon, authenticated;
revoke all on function public.rh__sd_route(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rh__desk_actions(public.rh_tickets, uuid) from public, anon, authenticated;
revoke all on function public.rh_actions_of(public.rh_tickets, uuid) from public, anon, authenticated;
revoke all on function public.rh_activity_outbox() from public, anon, authenticated;
revoke all on function public.rh_sd_activity_touch() from public, anon, authenticated;
revoke all on function public.rh_sd_note_touch() from public, anon, authenticated;
revoke all on function public.rh_kb_set_status(uuid, text) from public, anon, authenticated;

revoke all on function public.rh_sd_sweep() from public, anon, authenticated;
grant execute on function public.rh_sd_sweep() to service_role;

-- Client RPCs: signed-in only.
revoke all on function public.rh_sd_categories_open() from public, anon;
revoke all on function public.rh_sd_submit(uuid, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.rh_sd_claim(uuid) from public, anon;
revoke all on function public.rh_sd_assign(uuid, uuid) from public, anon;
revoke all on function public.rh_sd_start(uuid, uuid, text) from public, anon;
revoke all on function public.rh_sd_hold(uuid, text) from public, anon;
revoke all on function public.rh_sd_resume(uuid) from public, anon;
revoke all on function public.rh_sd_resolve(uuid, text, text, uuid) from public, anon;
revoke all on function public.rh_sd_confirm(uuid) from public, anon;
revoke all on function public.rh_sd_reopen(uuid, text) from public, anon;
revoke all on function public.rh_sd_override(uuid, text, text) from public, anon;
revoke all on function public.rh_sd_reclassify(uuid, uuid, text, text) from public, anon;
revoke all on function public.rh_sd_cancel(uuid, text) from public, anon;
revoke all on function public.rh_sd_withdraw(uuid) from public, anon;
revoke all on function public.rh_sd_queue(text) from public, anon;
revoke all on function public.rh_sd_shift_summary() from public, anon;
revoke all on function public.rh_sd_dashboard() from public, anon;
revoke all on function public.rh_sd_performance(date, date) from public, anon;
revoke all on function public.rh_kb_search(text, text, int) from public, anon;
revoke all on function public.rh_kb_list(text, text) from public, anon;
revoke all on function public.rh_kb_get(uuid) from public, anon;
revoke all on function public.rh_kb_save(uuid, text, text, text[], text[], text, uuid) from public, anon;
revoke all on function public.rh_kb_publish(uuid) from public, anon;
revoke all on function public.rh_kb_retire(uuid) from public, anon;
revoke all on function public.rh_kb_feedback(uuid, boolean, uuid) from public, anon;

grant execute on function public.rh_sd_categories_open() to authenticated;
grant execute on function public.rh_sd_submit(uuid, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.rh_sd_claim(uuid) to authenticated;
grant execute on function public.rh_sd_assign(uuid, uuid) to authenticated;
grant execute on function public.rh_sd_start(uuid, uuid, text) to authenticated;
grant execute on function public.rh_sd_hold(uuid, text) to authenticated;
grant execute on function public.rh_sd_resume(uuid) to authenticated;
grant execute on function public.rh_sd_resolve(uuid, text, text, uuid) to authenticated;
grant execute on function public.rh_sd_confirm(uuid) to authenticated;
grant execute on function public.rh_sd_reopen(uuid, text) to authenticated;
grant execute on function public.rh_sd_override(uuid, text, text) to authenticated;
grant execute on function public.rh_sd_reclassify(uuid, uuid, text, text) to authenticated;
grant execute on function public.rh_sd_cancel(uuid, text) to authenticated;
grant execute on function public.rh_sd_withdraw(uuid) to authenticated;
grant execute on function public.rh_sd_queue(text) to authenticated;
grant execute on function public.rh_sd_shift_summary() to authenticated;
grant execute on function public.rh_sd_dashboard() to authenticated;
grant execute on function public.rh_sd_performance(date, date) to authenticated;
grant execute on function public.rh_kb_search(text, text, int) to authenticated;
grant execute on function public.rh_kb_list(text, text) to authenticated;
grant execute on function public.rh_kb_get(uuid) to authenticated;
grant execute on function public.rh_kb_save(uuid, text, text, text[], text[], text, uuid) to authenticated;
grant execute on function public.rh_kb_publish(uuid) to authenticated;
grant execute on function public.rh_kb_retire(uuid) to authenticated;
grant execute on function public.rh_kb_feedback(uuid, boolean, uuid) to authenticated;
