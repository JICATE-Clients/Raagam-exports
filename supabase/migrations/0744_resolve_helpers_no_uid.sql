-- ============================================================================
-- 0744 — Resolve Hub: the visibility helpers stop answering about OTHER people.
--
-- 0739 granted rh_can_see / rh_is_staff_on / rh_is_joiner / rh_is_team_member /
-- rh_staff_row to `authenticated` WITH a `p_uid` argument, so any login could
-- ask /rest/v1/rpc "can profile X see ticket Y?" or "did X join Y?" — learning
-- who reported or joined a ticket. With anonymous complaints next, that is an
-- anonymity break, not a curiosity.
--
-- The shape now:
--   rh__*(…, p_uid)  the uid-taking bodies. INTERNAL: no grant to public,
--                    anon or authenticated. Only definer code calls them
--                    (rh_actions_of evaluates the actions for a given uid).
--   rh_*(…)          the policy-facing versions. NO uid argument — they only
--                    ever answer for auth.uid(), so the most a caller learns is
--                    their own access. They keep EXECUTE for authenticated
--                    because RLS policies call them as the querying role.
-- The old uid-taking public signatures are DROPPED (not just revoked), so
-- nothing can bind to them by name again.
--
-- lv_rh_ticket(ticket) and lv_rh_team(team) already took no uid and answer only
-- for the caller; lv_rh_ticket is re-created over the new rh_can_see(ticket).
--
-- Callers found in the catalog before this change (pg_proc.prosrc + pg_policy):
--   policies  rh_tickets_select (rh_is_joiner, rh_staff_row),
--             rh_ticket_notes_select (rh_is_staff_on)
--   functions rh_actions_of (all four, with p_uid) → rh__*, re-created here
--             rh_workload   (rh_is_team_member(tid, v_uid), v_uid = auth.uid())
--             rh_lock, rh_join, lv_rh_ticket — already called without a uid
--   the outbox trigger, sweep and routing call none of them.
-- ============================================================================

-- ─── 1. Internal, uid-taking bodies ─────────────────────────────────────────

create or replace function public.rh__is_team_member(p_team_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_team_id is not null and p_uid is not null and exists (
    select 1 from public.rh_team_members m
     where m.team_id = p_team_id and m.profile_id = p_uid and m.active)
$$;

create or replace function public.rh__staff_row(
  p_location_id uuid, p_owner_id uuid, p_assignee_id uuid, p_team_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_uid is not null
     and public.is_current_location(p_location_id, p_uid)
     and (
          p_owner_id = p_uid
       or p_assignee_id = p_uid
       or (public.has_permission('resolve', 'edit', p_uid) and public.rh__is_team_member(p_team_id, p_uid))
       or public.has_permission('resolve', 'approve', p_uid)
       or public.has_permission('resolve', 'export', p_uid)
       or exists (select 1 from public.rh_unit_settings s
                   where s.location_id = p_location_id
                     and (s.unit_head_id = p_uid or s.estate_owner_id = p_uid))
     )
$$;

create or replace function public.rh__is_joiner(p_ticket_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_uid is not null and exists (select 1 from public.rh_ticket_joiners j
                  where j.ticket_id = p_ticket_id and j.profile_id = p_uid)
$$;

create or replace function public.rh__is_staff_on(p_ticket_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rh_tickets t
                  where t.id = p_ticket_id
                    and public.rh__staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid))
$$;

create or replace function public.rh__can_see(p_ticket_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.rh_tickets t
     where t.id = p_ticket_id
       and (   (p_uid is not null and t.reporter_id = p_uid)
            or public.rh__is_joiner(t.id, p_uid)
            or public.rh__staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid)))
$$;

revoke all on function public.rh__is_team_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rh__staff_row(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rh__is_joiner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rh__is_staff_on(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rh__can_see(uuid, uuid) from public, anon, authenticated;

-- ─── 2. Drop the policies that bind to the old signatures ───────────────────

drop policy if exists rh_tickets_select on public.rh_tickets;
drop policy if exists rh_ticket_notes_select on public.rh_ticket_notes;

-- ─── 3. Drop the uid-taking public signatures ───────────────────────────────

drop function public.rh_can_see(uuid, uuid);
drop function public.rh_is_staff_on(uuid, uuid);
drop function public.rh_is_joiner(uuid, uuid);
drop function public.rh_staff_row(uuid, uuid, uuid, uuid, uuid);
drop function public.rh_is_team_member(uuid, uuid);

-- ─── 4. Caller-only public versions (policy-facing) ─────────────────────────

create function public.rh_is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.rh__is_team_member(p_team_id, auth.uid()) $$;

create function public.rh_staff_row(
  p_location_id uuid, p_owner_id uuid, p_assignee_id uuid, p_team_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.rh__staff_row(p_location_id, p_owner_id, p_assignee_id, p_team_id, auth.uid()) $$;

create function public.rh_is_joiner(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.rh__is_joiner(p_ticket_id, auth.uid()) $$;

create function public.rh_is_staff_on(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.rh__is_staff_on(p_ticket_id, auth.uid()) $$;

create function public.rh_can_see(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.rh__can_see(p_ticket_id, auth.uid()) $$;

create or replace function public.lv_rh_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select p_ticket_id is not null and public.rh__can_see(p_ticket_id, auth.uid()) $$;

revoke all on function public.rh_is_team_member(uuid) from public, anon;
revoke all on function public.rh_staff_row(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.rh_is_joiner(uuid) from public, anon;
revoke all on function public.rh_is_staff_on(uuid) from public, anon;
revoke all on function public.rh_can_see(uuid) from public, anon;
revoke all on function public.lv_rh_ticket(uuid) from public, anon;
grant execute on function public.rh_is_team_member(uuid) to authenticated;
grant execute on function public.rh_staff_row(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.rh_is_joiner(uuid) to authenticated;
grant execute on function public.rh_is_staff_on(uuid) to authenticated;
grant execute on function public.rh_can_see(uuid) to authenticated;
grant execute on function public.lv_rh_ticket(uuid) to authenticated;

-- ─── 5. Policies back, over the caller-only helpers ─────────────────────────

create policy rh_tickets_select on public.rh_tickets for select to authenticated
  using (
       reporter_id = auth.uid()
    or public.rh_is_joiner(id)
    or (public.is_current_location(location_id)
        and public.rh_staff_row(location_id, owner_id, assignee_id, team_id))
  );

create policy rh_ticket_notes_select on public.rh_ticket_notes for select to authenticated
  using (public.lv_rh_ticket(ticket_id)
         and (visibility = 'reporter' or public.rh_is_staff_on(ticket_id)));

-- ─── 6. Definer callers that pass a uid move to the internal bodies ─────────

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
revoke all on function public.rh_actions_of(public.rh_tickets, uuid) from public, anon, authenticated;

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
      or public.rh__is_team_member(pe.tid, v_uid)
   group by pe.tid, tm.name, pe.person, pr.full_name
   order by tm.name nulls last, pr.full_name nulls last;
end;
$$;
revoke all on function public.rh_workload() from public, anon;
grant execute on function public.rh_workload() to authenticated;
