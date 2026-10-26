-- ============================================================================
-- 0746 — Resolve Hub stage 2: complaints — visibility, routing, RPCs, sweep,
--        outbox.
--
-- Contract: doc/resolve/resolve-hub-plan.md §10. Schema in 0745.
--
-- ANONYMITY (§10.2) is enforced here, in the one place a complaint is born:
-- for an anonymous complaint rh_submit_complaint writes reporter_id NULL,
-- created_by NULL, the 'created' activity with actor_id NULL, and a ledger row
-- with ticket_id NULL and created_at truncated to the hour. The reporter's uid
-- is used inside the transaction for exactly two things — the rate limit and
-- choosing a handler outside their management chain — and is stored nowhere
-- the complaint can be traced from. 0745's rh_tickets_anonymous_unlinked check
-- refuses any later write that would re-link it.
--
-- WHO SEES A COMPLAINT (§10.3) is rh__complaint_staff(): the handler
-- (owner / assignee), the category's committee + oversight members, and —
-- NON-sensitive only — triage. Membership is a table lookup, never
-- has_permission(), so a super admin who is not a member sees nothing
-- sensitive. "About my superior" narrows it further (deviation, plan §10.3):
-- only the handler chosen outside the chain — committee lists are not checked
-- against the chain, and an anonymous reporter's chain cannot be recomputed
-- later, so the only people who can be PROVEN outside it are the handler.
-- ============================================================================

-- ─── 1. Management chain (cycle-safe, depth-capped) ─────────────────────────

create or replace function public.rh__chain_of(p_profile_id uuid)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  with recursive up(staff_id, depth, path) as (
    select s.manager_id, 1, array[s.id]
      from public.staff s
     where s.id = public.rh_staff_of(p_profile_id) and s.manager_id is not null
    union all
    select s.manager_id, u.depth + 1, u.path || u.staff_id
      from up u join public.staff s on s.id = u.staff_id
     where s.manager_id is not null
       and u.depth < 20
       and not (s.manager_id = any (u.path || u.staff_id))
  )
  select coalesce(array_agg(distinct e.profile_id) filter (where e.profile_id is not null), '{}'::uuid[])
    from (select array_agg(distinct u.staff_id) as ids from up u) x
    cross join lateral public.employee_login_ids(coalesce(x.ids, '{}'::uuid[])) e
$$;

-- ─── 2. Complaint routing (§10.4) ───────────────────────────────────────────

create or replace function public.rh__route_complaint(
  p_location_id uuid, p_category_id uuid, p_about_superior boolean, p_reporter_id uuid)
returns table (owner_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s      public.rh_unit_settings := public.rh_settings(p_location_id);
  v_excl uuid[] := array[p_reporter_id] || public.rh__chain_of(p_reporter_id);
  c_ids  uuid[] := '{}';
  c_why  text[] := '{}';
  v_id   uuid;
  i      int;
begin
  if coalesce(p_about_superior, false) then
    c_ids := c_ids || s.superior_handler_id;  c_why := c_why || 'Independent handler'::text;
    c_ids := c_ids || s.unit_head_id;         c_why := c_why || 'Unit head'::text;
    foreach v_id in array coalesce(s.director_ids, '{}'::uuid[]) loop
      c_ids := c_ids || v_id;                 c_why := c_why || 'Director'::text;
    end loop;
  else
    c_ids := c_ids || (select c.handler_id from public.rh_complaint_categories c where c.id = p_category_id);
    c_why := c_why || 'Category handler'::text;
    for v_id in
      select m.profile_id from public.rh_category_members m
       where m.category_id = p_category_id and m.role = 'committee'
       order by m.created_at, m.id
    loop
      c_ids := c_ids || v_id;                 c_why := c_why || 'Committee member'::text;
    end loop;
    c_ids := c_ids || s.estate_owner_id;      c_why := c_why || 'Estate office'::text;
    c_ids := c_ids || s.unit_head_id;         c_why := c_why || 'Unit head'::text;
  end if;

  for i in 1 .. coalesce(array_length(c_ids, 1), 0) loop
    continue when c_ids[i] is null or c_ids[i] = any (v_excl);
    continue when not exists (select 1 from public.profiles p where p.id = c_ids[i] and p.is_active);
    owner_id := c_ids[i]; reason := c_why[i];
    return next; return;
  end loop;
  owner_id := null; reason := null;
  return next;
end;
$$;

-- ─── 3. Visibility: the complaint branch ────────────────────────────────────

create or replace function public.rh__complaint_staff(p_ticket_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_uid is not null and exists (
    select 1
      from public.rh_tickets t
      join public.rh_complaint_categories c on c.id = t.category_id
     where t.id = p_ticket_id and t.kind = 'complaint'
       and public.is_current_location(t.location_id, p_uid)
       and (   t.owner_id = p_uid
            or t.assignee_id = p_uid
            or (not t.about_superior
                and (   public.rh__cat_member(t.category_id, p_uid, array['committee', 'oversight'])
                     or (not c.is_sensitive and public.has_permission('resolve', 'approve', p_uid))))))
$$;

create or replace function public.rh__can_see(p_ticket_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.rh_tickets t
     where t.id = p_ticket_id
       and case when t.kind = 'complaint'
             then (   (not t.is_anonymous and p_uid is not null and t.reporter_id = p_uid)
                   or public.rh__complaint_staff(t.id, p_uid))
             else (   (p_uid is not null and t.reporter_id = p_uid)
                   or public.rh__is_joiner(t.id, p_uid)
                   or public.rh__staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid))
           end)
$$;

create or replace function public.rh__is_staff_on(p_ticket_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rh_tickets t
                  where t.id = p_ticket_id
                    and case when t.kind = 'complaint'
                          then public.rh__complaint_staff(t.id, p_uid)
                          else public.rh__staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid)
                        end)
$$;

-- ─── 4. Complaint actions (the one "may I") ─────────────────────────────────

create or replace function public.rh__complaint_actions(t public.rh_tickets, p_uid uuid)
returns text[]
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  a           text[] := '{}';
  v_unit      boolean;
  v_oa        boolean;
  v_committee boolean;
  v_triage    boolean;
  v_sensitive boolean;
  v_reporter  boolean;
  v_live      boolean := t.status in ('open', 'assigned', 'in_progress', 'escalated');
begin
  if p_uid is null or t.id is null or t.kind <> 'complaint' or not public.rh__can_see(t.id, p_uid) then
    return a;
  end if;
  select c.is_sensitive into v_sensitive from public.rh_complaint_categories c where c.id = t.category_id;
  v_unit      := public.is_current_location(t.location_id, p_uid);
  v_oa        := v_unit and (t.owner_id = p_uid or t.assignee_id = p_uid);
  v_committee := v_unit and not t.about_superior
                 and public.rh__cat_member(t.category_id, p_uid, array['committee']);
  v_triage    := v_unit and not coalesce(v_sensitive, true) and not t.about_superior
                 and public.has_permission('resolve', 'approve', p_uid);
  v_reporter  := not t.is_anonymous and t.reporter_id = p_uid;

  if not t.about_superior and t.status in ('open', 'assigned', 'escalated')
     and (v_oa or v_committee or v_triage) then
    a := a || 'c_assign'::text;
  end if;
  if v_oa and t.status in ('open', 'assigned', 'escalated') then a := a || 'c_start'::text; end if;
  if (v_oa or v_committee) and v_live then a := a || 'c_resolve'::text; end if;
  if v_reporter and v_live then a := a || 'c_withdraw'::text; end if;
  if public.rh__complaint_staff(t.id, p_uid) then a := a || 'note_internal'::text; end if;
  a := a || 'note_reporter'::text;
  return a;
end;
$$;

-- rh_actions_of as of 0744, with the complaint branch first.
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

-- ─── 5. Reporting a complaint ───────────────────────────────────────────────

create or replace function public.rh_complaint_categories_open()
returns table (id uuid, name text, description text, is_sensitive boolean, anonymous_allowed boolean)
language sql stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.description, c.is_sensitive, c.anonymous_allowed
    from public.rh_complaint_categories c
   where public.has_permission('resolve', 'view')
     and c.location_id = public.current_location()
     and not c.inactive
   order by c.name
$$;

create or replace function public.rh_submit_complaint(
  p_category_id    uuid    default null,
  p_subject        text    default null,
  p_description    text    default null,
  p_is_anonymous   boolean default false,
  p_about_superior boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_anon   boolean := coalesce(p_is_anonymous, false);
  v_sup    boolean := coalesce(p_about_superior, false);
  v_loc    uuid;
  s        public.rh_unit_settings;
  c        public.rh_complaint_categories;
  v_n      int;
  v_year   int;
  v_no     int;
  v_ref    text;
  v_owner  uuid;
  v_reason text;
  v_due    timestamptz;
  v_token  text;
  v_hash   text;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again to raise a complaint.' using errcode = 'P0001';
  end if;
  if not public.has_permission('resolve', 'view') then
    raise exception 'You do not have access to Resolve Hub.' using errcode = 'P0001';
  end if;
  v_loc := public.current_location();
  if v_loc is null then
    raise exception 'Choose a unit before raising a complaint.' using errcode = 'P0001';
  end if;
  select * into c from public.rh_complaint_categories x
   where x.id = p_category_id and x.location_id = v_loc and not x.inactive;
  if not found then
    raise exception 'That complaint category is not available in your current unit.' using errcode = 'P0001';
  end if;
  if p_subject is null or btrim(p_subject) = '' then
    raise exception 'Give your complaint a short subject.' using errcode = 'P0001';
  end if;
  if v_anon and not c.anonymous_allowed then
    raise exception 'This category does not accept anonymous complaints.' using errcode = 'P0001';
  end if;

  -- Same 10-in-24h limit as Broken reports, counted in the same ledger.
  perform pg_advisory_xact_lock(hashtextextended('rh_report:' || v_uid::text, 0));
  s := public.rh_settings(v_loc);
  select count(*) into v_n from public.rh_report_ledger l
   where l.profile_id = v_uid and l.created_at > now() - interval '24 hours';
  if v_n >= s.report_limit_24h then
    raise exception '%', format('You have sent %s reports in the last 24 hours, which is the limit. '
                                'Please try again later.', v_n)
      using errcode = 'P0001';
  end if;

  select r.owner_id, r.reason into v_owner, v_reason
    from public.rh__route_complaint(v_loc, c.id, v_sup, v_uid) r;
  if v_owner is null then
    raise exception 'No independent handler is configured for this complaint — ask the administrator '
                    'to set one in Resolve Hub ▸ Administration ▸ Unit Settings.'
      using errcode = 'P0001';
  end if;

  v_due  := now() + make_interval(hours => coalesce(c.response_hours, s.complaint_response_hours, 72));
  v_year := extract(year from (now() at time zone s.timezone))::int;
  insert into public.rh_ref_counters as rc (prefix, year, last_no) values ('CMP', v_year, 1)
    on conflict (prefix, year) do update set last_no = rc.last_no + 1
    returning rc.last_no into v_no;
  v_ref := 'CMP-' || v_year || '-' || lpad(v_no::text, 6, '0');

  if v_anon then
    -- 32 random bytes = 256 bits → base64url, no padding = 43 chars.
    v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    v_hash  := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  end if;

  insert into public.rh_tickets (
    location_id, kind, ref_no, status, reporter_id, title, description,
    is_dangerous, severity, priority, is_routine, source,
    owner_id, owner_reason, due_at, response_due_at, needs_sorting,
    category_id, is_anonymous, about_superior, tracking_token_hash, created_by)
  values (
    v_loc, 'complaint', v_ref, 'open', case when v_anon then null else v_uid end,
    btrim(p_subject), nullif(btrim(p_description), ''),
    false, 'medium', 'medium', false, 'form',
    v_owner, v_reason, v_due, v_due, false,
    c.id, v_anon, v_sup, v_hash, case when v_anon then null else v_uid end)
  returning id into v_id;

  insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, meta)
  values (v_id, case when v_anon then null else v_uid end, 'created', null, 'open',
          jsonb_build_object('kind', 'complaint'));

  insert into public.rh_report_ledger (profile_id, ticket_id, kind, created_at)
  values (v_uid, case when v_anon then null else v_id end, 'complaint',
          case when v_anon then date_trunc('hour', now()) else now() end);

  return jsonb_build_object(
    'ticket_id', case when v_anon then null else v_id end,
    'ref_no', v_ref,
    'tracking_token', v_token,
    'handler_name', (select p.full_name from public.profiles p where p.id = v_owner),
    'response_due_at', v_due);
end;
$$;

-- ─── 6. Handling ────────────────────────────────────────────────────────────

create or replace function public.rh_c_assign(p_ticket_id uuid, p_assignee_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t      public.rh_tickets := public.rh_lock(p_ticket_id);
  v_sens boolean;
begin
  perform public.rh_require(t, 'c_assign', 'assign');
  select c.is_sensitive into v_sens from public.rh_complaint_categories c where c.id = t.category_id;
  if p_assignee_id is null
     or not exists (select 1 from public.profiles p where p.id = p_assignee_id and p.is_active)
     or not public.has_location_access(t.location_id, p_assignee_id) then
    raise exception 'Choose an active person in this unit to handle the complaint.' using errcode = 'P0001';
  end if;
  if p_assignee_id = t.reporter_id then
    raise exception 'A complaint cannot be assigned to the person who raised it.' using errcode = 'P0001';
  end if;
  if v_sens and not public.rh__cat_member(t.category_id, p_assignee_id, array['committee']) then
    raise exception 'A sensitive complaint can only be assigned to a member of its committee.' using errcode = 'P0001';
  end if;
  if not v_sens and p_assignee_id is distinct from t.owner_id
     and not public.rh__cat_member(t.category_id, p_assignee_id, array['committee'])
     and not public.has_permission('resolve', 'edit', p_assignee_id) then
    raise exception 'That person cannot handle complaints. Add them to the category committee first.' using errcode = 'P0001';
  end if;
  update public.rh_tickets set status = 'assigned', assignee_id = p_assignee_id where id = t.id;
  perform public.rh_log(t.id, 'assigned', t.status, 'assigned', null,
    jsonb_build_object('assignee_id', p_assignee_id, 'previous_assignee_id', t.assignee_id));
  return jsonb_build_object('status', 'assigned', 'assignee_id', p_assignee_id);
end;
$$;

create or replace function public.rh_c_start(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'c_start', 'start work on');
  update public.rh_tickets
     set status = 'in_progress', assignee_id = coalesce(assignee_id, auth.uid()),
         first_response_at = coalesce(first_response_at, now())
   where id = t.id;
  perform public.rh_log(t.id, 'started', t.status, 'in_progress', null);
  return jsonb_build_object('status', 'in_progress');
end;
$$;

create or replace function public.rh_c_resolve(p_ticket_id uuid, p_resolution_message text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  if p_resolution_message is null or btrim(p_resolution_message) = '' then
    raise exception 'Write the resolution message — it is what the person who complained will read.'
      using errcode = 'P0001';
  end if;
  perform public.rh_require(t, 'c_resolve', 'resolve');
  update public.rh_tickets
     set status = 'resolved', resolved_at = now(), resolution_message = btrim(p_resolution_message),
         first_response_at = coalesce(first_response_at, now())
   where id = t.id;
  perform public.rh_log(t.id, 'resolved', t.status, 'resolved', null);
  return jsonb_build_object('status', 'resolved');
end;
$$;

create or replace function public.rh_c_withdraw(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'c_withdraw', 'withdraw');
  update public.rh_tickets set status = 'withdrawn', withdrawn_at = now() where id = t.id;
  perform public.rh_log(t.id, 'withdrawn', t.status, 'withdrawn', null);
  return jsonb_build_object('status', 'withdrawn');
end;
$$;

-- ─── 7. Anonymous tracking (service role only) ──────────────────────────────

create or replace function public.rh_track_complaint(p_token text)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  t public.rh_tickets;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select * into t from public.rh_tickets x
   where x.tracking_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and x.kind = 'complaint';
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'ref_no', t.ref_no, 'subject', t.title, 'status', t.status, 'created_at', t.created_at,
    'first_response_at', t.first_response_at, 'resolved_at', t.resolved_at,
    'withdrawn_at', t.withdrawn_at, 'resolution_message', t.resolution_message);
end;
$$;

create or replace function public.rh_track_withdraw(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tickets;
begin
  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43}$' then
    select * into t from public.rh_tickets x
     where x.tracking_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       and x.kind = 'complaint'
     for update;
  end if;
  if t.id is null then
    raise exception 'This tracking link is not recognised.' using errcode = 'P0001';
  end if;
  if t.status not in ('open', 'assigned', 'in_progress', 'escalated') then
    raise exception 'This complaint is already % and can no longer be withdrawn.', t.status using errcode = 'P0001';
  end if;
  update public.rh_tickets set status = 'withdrawn', withdrawn_at = now() where id = t.id;
  insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status)
  values (t.id, null, 'withdrawn', t.status, 'withdrawn');
  return jsonb_build_object('status', 'withdrawn');
end;
$$;

-- ─── 8. Workload: Broken only ───────────────────────────────────────────────

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
     where t.location_id = v_loc and t.kind = 'broken'
       and t.status in ('open', 'in_progress', 'blocked')
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
      or public.rh__is_team_member(pe.tid, v_uid)
   group by pe.tid, tm.name, pe.person, pr.full_name
   order by tm.name nulls last, pr.full_name nulls last;
end;
$$;

-- ─── 9. Escalation sweep: Broken as before + the complaint branch ───────────

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
  v_cmp  int := 0;
  v_day  date;
  v_list jsonb;
  v_dir  uuid;
begin
  for r in
    select t.* from public.rh_tickets t
     where t.kind = 'broken' and t.status in ('open', 'in_progress') and t.due_at is not null
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
     where t.location_id = s.location_id and t.kind = 'broken' and t.status in ('open', 'in_progress')
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

  -- Complaints: no first response by response_due_at → escalated, once.
  -- Recipients never include triage. About-my-superior goes back to its own
  -- (independent) handler only: anyone else may be in the reporter's chain.
  for r in
    select t.*, c.is_sensitive
      from public.rh_tickets t join public.rh_complaint_categories c on c.id = t.category_id
     where t.kind = 'complaint' and t.status in ('open', 'assigned')
       and t.first_response_at is null and t.response_due_at is not null
       and t.response_due_at < now()
  loop
    insert into public.rh_escalations (ticket_id, level, fix_round)
    values (r.id, 1, r.fix_round)
    on conflict (ticket_id, level, fix_round) do nothing
    returning id into v_ins;
    continue when v_ins is null;
    s := public.rh_settings(r.location_id);
    if r.about_superior then
      v_rec := array_remove(array[r.owner_id], null);
    elsif r.is_sensitive then
      v_rec := array(select m.profile_id from public.rh_category_members m
                      where m.category_id = r.category_id and m.role = 'oversight');
      if cardinality(v_rec) = 0 then
        v_rec := array(select m.profile_id from public.rh_category_members m
                        where m.category_id = r.category_id and m.role = 'committee');
      end if;
    else
      v_rec := array_remove(array[s.unit_head_id], null);
    end if;
    update public.rh_tickets set status = 'escalated' where id = r.id;
    insert into public.rh_ticket_activity (ticket_id, actor_id, action, from_status, to_status, meta)
    values (r.id, null, 'escalated', r.status, 'escalated',
            jsonb_build_object('level', 1, 'complaint', true, 'recipients', to_jsonb(v_rec)));
    v_cmp := v_cmp + 1;
  end loop;

  return jsonb_build_object('level1', v_l1, 'level3', v_l3, 'level7', v_l7,
                            'digests', v_dig, 'complaints', v_cmp);
end;
$$;

-- ─── 10. Activity → outbox: complaint events ────────────────────────────────

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

  if t.kind = 'complaint' then
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

revoke all on function public.rh__chain_of(uuid) from public, anon, authenticated;
revoke all on function public.rh__route_complaint(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.rh__complaint_staff(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rh__can_see(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rh__is_staff_on(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rh__complaint_actions(public.rh_tickets, uuid) from public, anon, authenticated;
revoke all on function public.rh_actions_of(public.rh_tickets, uuid) from public, anon, authenticated;
revoke all on function public.rh_activity_outbox() from public, anon, authenticated;

revoke all on function public.rh_escalation_sweep() from public, anon, authenticated;
revoke all on function public.rh_track_complaint(text) from public, anon, authenticated;
revoke all on function public.rh_track_withdraw(text) from public, anon, authenticated;
grant execute on function public.rh_escalation_sweep() to service_role;
grant execute on function public.rh_track_complaint(text) to service_role;
grant execute on function public.rh_track_withdraw(text) to service_role;

revoke all on function public.rh_complaint_categories_open() from public, anon;
revoke all on function public.rh_submit_complaint(uuid, text, text, boolean, boolean) from public, anon;
revoke all on function public.rh_c_assign(uuid, uuid) from public, anon;
revoke all on function public.rh_c_start(uuid) from public, anon;
revoke all on function public.rh_c_resolve(uuid, text) from public, anon;
revoke all on function public.rh_c_withdraw(uuid) from public, anon;
revoke all on function public.rh_workload() from public, anon;
grant execute on function public.rh_complaint_categories_open() to authenticated;
grant execute on function public.rh_submit_complaint(uuid, text, text, boolean, boolean) to authenticated;
grant execute on function public.rh_c_assign(uuid, uuid) to authenticated;
grant execute on function public.rh_c_start(uuid) to authenticated;
grant execute on function public.rh_c_resolve(uuid, text) to authenticated;
grant execute on function public.rh_c_withdraw(uuid) to authenticated;
grant execute on function public.rh_workload() to authenticated;
