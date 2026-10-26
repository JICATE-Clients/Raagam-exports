-- ============================================================================
-- 0751 — Raagam Assist: the problem catalog, requirement tickets, tap-first
-- submit wrappers.
--
-- Plan: doc/resolve/assist-catalog-plan.md (approved 2026-10-26: "okay go").
--
-- THE CATALOG IS THE REPORTER'S VOCABULARY; the old lists are the ROUTING.
-- A reporter taps lane → area → problem → what happened; each catalog item
-- already names its trade (Fix), IT category (IT) or complaint category
-- (Concern) BY CODE, so the 25 internal words (8 trades, 10 IT categories,
-- 7 complaint categories) never reach the reporter's screen. Codes, not ids:
-- trades are shared but IT and complaint categories are per unit (0749 rule).
--
-- SUBMIT WRAPPERS, NOT RE-CREATED BODIES. rh_assist_broken / _service /
-- _complaint call the existing rh_submit_broken (0740) / rh_sd_submit (0750)
-- / rh_submit_complaint (0746) unchanged, then stamp `catalog_item_id` on the
-- row they made and count the use. Re-creating three long submit bodies to
-- add one argument is how a guard gets lost (AGENTS "start from the latest
-- body"); wrapping cannot lose one. An anonymous complaint returns no
-- ticket_id, so its row is found by the ref the same call returned — inside
-- the definer transaction, never exposed — and the stamp is a PROBLEM TYPE,
-- which names no one.
--
-- REQUIREMENTS (Buy). kind = 'requirement' and the REQ prefix exist since
-- 0739; this gives them their own statuses (open = Pending, approved,
-- rejected, fulfilled, withdrawn — the spec's §4 Purchase Need fallback),
-- routes them to the unit's Stores owner, and adds the handler's three steps.
-- Order materials never come here: they come from the BOM through Purchase ▸
-- Requirement PO.
-- ============================================================================

-- ─── 1. Catalog ─────────────────────────────────────────────────────────────

create table public.rh_catalog_areas (
  id         uuid primary key default gen_random_uuid(),
  lane       text not null check (lane in ('fix', 'it', 'buy', 'concern')),
  code       text not null unique,
  label      text not null,
  icon       text not null default 'circle',
  details    text[] not null default '{}',
  sort       int not null default 0,
  inactive   boolean not null default false,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.rh_catalog_areas is
  'Raagam Assist areas (level 1). details = the default "what happened" chips for its items. '
  'location-scope: exempt -- shared master data, the factory''s words.';

create table public.rh_catalog_items (
  id                      uuid primary key default gen_random_uuid(),
  area_id                 uuid not null references public.rh_catalog_areas(id) on delete cascade,
  code                    text not null unique,
  label                   text not null,
  synonyms                text[] not null default '{}',
  details                 text[],
  dangerous               boolean not null default false,
  trade_code              text,
  sd_category_code        text,
  complaint_category_code text,
  sort                    int not null default 0,
  inactive                boolean not null default false,
  used_count              int not null default 0 check (used_count >= 0),
  created_by              uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now()
);
create index rh_catalog_items_area_idx on public.rh_catalog_items (area_id, sort);
comment on table public.rh_catalog_items is
  'Raagam Assist problems (level 2). label = the ticket subject. details NULL = use the area''s. '
  'Routing by CODE: trade_code (fix), sd_category_code (it), complaint_category_code (concern). '
  'location-scope: exempt -- shared master data.';

alter table public.rh_catalog_areas enable row level security;
alter table public.rh_catalog_items enable row level security;
revoke all on public.rh_catalog_areas, public.rh_catalog_items from anon;
create policy rh_catalog_areas_select on public.rh_catalog_areas for select to authenticated
  using (public.has_permission('resolve', 'view'));
create policy rh_catalog_areas_write on public.rh_catalog_areas for all to authenticated
  using (public.has_permission('resolve', 'create')) with check (public.has_permission('resolve', 'create'));
create policy rh_catalog_items_select on public.rh_catalog_items for select to authenticated
  using (public.has_permission('resolve', 'view'));
create policy rh_catalog_items_write on public.rh_catalog_items for all to authenticated
  using (public.has_permission('resolve', 'create')) with check (public.has_permission('resolve', 'create'));

-- ─── 2. Tickets + settings ──────────────────────────────────────────────────

alter table public.rh_tickets
  add column catalog_item_id uuid references public.rh_catalog_items(id) on delete set null,
  add column rq_qty          numeric(12,2) check (rq_qty is null or rq_qty > 0),
  add column rq_needed_by    text check (rq_needed_by in ('today', 'week', 'month')),
  add column rq_reason       text check (rq_reason in ('ran_out', 'broken', 'new_joiner', 'new_work', 'other')),
  add column rq_decided_note text;
create index rh_tickets_catalog_item_idx on public.rh_tickets (catalog_item_id) where catalog_item_id is not null;

alter table public.rh_tickets drop constraint rh_tickets_status_check;
alter table public.rh_tickets add constraint rh_tickets_status_check check (
     (kind = 'broken'
      and status in ('open', 'in_progress', 'blocked', 'fixed', 'closed', 'cancelled', 'withdrawn'))
  or (kind = 'requirement'
      and status in ('open', 'approved', 'rejected', 'fulfilled', 'withdrawn'))
  or (kind = 'complaint'
      and status in ('open', 'assigned', 'in_progress', 'escalated', 'resolved', 'withdrawn'))
  or (kind = 'service'
      and status in ('open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed', 'cancelled', 'withdrawn')));

alter table public.rh_unit_settings
  add column requirement_owner_id uuid references public.profiles(id) on delete set null,
  add column emergency_contact    text;
comment on column public.rh_unit_settings.requirement_owner_id is
  'Stores / purchase person a Buy requirement goes to (fallback: unit head).';
comment on column public.rh_unit_settings.emergency_contact is
  'Shown by Raagam Assist before a dangerous gas / fire / shock item: who to call NOW.';

-- ─── 3. Requirement actions + the dispatch ─────────────────────────────────

create or replace function public.rh__rq_actions(t public.rh_tickets, p_uid uuid)
returns text[]
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  a        text[] := '{}';
  v_unit   boolean;
  v_handle boolean;
begin
  if p_uid is null or t.id is null or t.kind <> 'requirement' or not public.rh__can_see(t.id, p_uid) then
    return a;
  end if;
  v_unit   := public.is_current_location(t.location_id, p_uid);
  v_handle := v_unit and (t.owner_id = p_uid or t.assignee_id = p_uid
                          or public.has_permission('resolve', 'approve', p_uid));
  if v_handle and t.status = 'open' then a := a || array['rq_approve', 'rq_reject']; end if;
  if v_handle and t.status = 'approved' then a := a || 'rq_fulfil'::text; end if;
  if t.reporter_id = p_uid and t.status = 'open' then a := a || 'rq_withdraw'::text; end if;
  if public.rh__staff_row(t.location_id, t.owner_id, t.assignee_id, t.team_id, p_uid) then
    a := a || 'note_internal'::text;
  end if;
  a := a || 'note_reporter'::text;
  return a;
end;
$$;

-- rh_actions_of as of 0750, with the requirement branch beside the other two.
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
  if t.kind = 'requirement' then
    return public.rh__rq_actions(t, p_uid);
  end if;
  v_unit     := public.is_current_location(t.location_id, p_uid);
  v_reporter := t.reporter_id = p_uid;

  if not public.rh__can_see(t.id, p_uid) then
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

-- ─── 4. Catalog stamp (internal) ───────────────────────────────────────────

create or replace function public.rh__catalog_item(p_item_id uuid, p_lane text)
returns public.rh_catalog_items
language plpgsql stable security definer set search_path = ''
as $$
declare
  it public.rh_catalog_items;
begin
  if p_item_id is null then
    return null;
  end if;
  select i.* into it from public.rh_catalog_items i
    join public.rh_catalog_areas a on a.id = i.area_id
   where i.id = p_item_id and a.lane = p_lane and not i.inactive and not a.inactive;
  if not found then
    raise exception 'That problem is no longer in the list — pick it again.' using errcode = 'P0001';
  end if;
  return it;
end;
$$;

create or replace function public.rh__catalog_stamp(p_ticket_id uuid, p_item_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.rh_tickets set catalog_item_id = p_item_id where id = p_ticket_id and p_item_id is not null;
  update public.rh_catalog_items set used_count = used_count + 1 where id = p_item_id;
$$;

-- ─── 5. Tap-first submit wrappers ──────────────────────────────────────────

create or replace function public.rh_assist_broken(
  p_catalog_item_id uuid    default null,
  p_place_id        uuid    default null,
  p_title           text    default null,
  p_description     text    default null,
  p_is_dangerous    boolean default false,
  p_photo_path      text    default null,
  p_gps_lat         numeric default null,
  p_gps_lng         numeric default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  it      public.rh_catalog_items := public.rh__catalog_item(p_catalog_item_id, 'fix');
  v_trade uuid;
  v_out   jsonb;
begin
  if it.id is not null and it.trade_code is not null then
    select t.id into v_trade from public.rh_trades t where t.code = it.trade_code and not t.inactive;
  end if;
  v_out := public.rh_submit_broken(
    p_place_id     => p_place_id,
    p_trade_id     => v_trade,
    p_title        => coalesce(nullif(btrim(p_title), ''), it.label),
    p_description  => p_description,
    p_is_dangerous => coalesce(p_is_dangerous, false) or coalesce(it.dangerous, false),
    p_photo_path   => p_photo_path,
    p_gps_lat      => p_gps_lat,
    p_gps_lng      => p_gps_lng,
    p_source       => 'form');
  perform public.rh__catalog_stamp((v_out ->> 'ticket_id')::uuid, it.id);
  return v_out;
end;
$$;

create or replace function public.rh_assist_service(
  p_catalog_item_id uuid,
  p_title           text,
  p_description     text,
  p_impact          text,
  p_photo_path      text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  it    public.rh_catalog_items := public.rh__catalog_item(p_catalog_item_id, 'it');
  v_cat uuid;
  v_out jsonb;
begin
  select c.id into v_cat from public.rh_sd_categories c
   where c.location_id = public.current_location() and not c.inactive
     and c.code = coalesce(it.sd_category_code, 'HW');
  if v_cat is null then
    raise exception 'The IT desk is not set up for this problem in your unit yet — tell your IT team directly.'
      using errcode = 'P0001';
  end if;
  v_out := public.rh_sd_submit(v_cat, coalesce(nullif(btrim(p_title), ''), it.label), p_description, p_impact,
                               p_photo_path, 'form', null);
  perform public.rh__catalog_stamp((v_out ->> 'ticket_id')::uuid, it.id);
  return v_out;
end;
$$;

create or replace function public.rh_assist_complaint(
  p_catalog_item_id uuid,
  p_subject         text,
  p_description     text,
  p_is_anonymous    boolean default false,
  p_about_superior  boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  it    public.rh_catalog_items := public.rh__catalog_item(p_catalog_item_id, 'concern');
  v_cat uuid;
  v_out jsonb;
  v_id  uuid;
begin
  select c.id into v_cat from public.rh_complaint_categories c
   where c.location_id = public.current_location() and not c.inactive
     and c.code = coalesce(it.complaint_category_code, 'GEN');
  if v_cat is null then
    raise exception 'Complaints of this kind are not set up in your unit yet — speak to your department head or HR.'
      using errcode = 'P0001';
  end if;
  v_out := public.rh_submit_complaint(v_cat, coalesce(nullif(btrim(p_subject), ''), it.label), p_description,
                                      p_is_anonymous, p_about_superior);
  -- Anonymous → no ticket_id comes back; the ref this same call just issued finds the row.
  v_id := coalesce((v_out ->> 'ticket_id')::uuid,
                   (select t.id from public.rh_tickets t where t.ref_no = v_out ->> 'ref_no'));
  perform public.rh__catalog_stamp(v_id, it.id);
  return v_out;
end;
$$;

-- Buy → a REQ ticket to the unit's Stores owner (fallback: unit head).
create or replace function public.rh_assist_requirement(
  p_catalog_item_id uuid,
  p_title           text,
  p_description     text,
  p_qty             numeric,
  p_needed_by       text,
  p_reason          text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  it      public.rh_catalog_items := public.rh__catalog_item(p_catalog_item_id, 'buy');
  v_uid   uuid := auth.uid();
  v_loc   uuid := public.current_location();
  s       public.rh_unit_settings;
  v_n     int;
  v_year  int;
  v_no    int;
  v_ref   text;
  v_owner uuid;
  v_due   timestamptz;
  v_id    uuid;
  v_title text := coalesce(nullif(btrim(p_title), ''), it.label);
begin
  if v_uid is null then
    raise exception 'Please sign in again to ask for something.' using errcode = 'P0001';
  end if;
  if not public.has_permission('resolve', 'view') then
    raise exception 'You do not have access to Resolve Hub.' using errcode = 'P0001';
  end if;
  if v_loc is null then
    raise exception 'Choose a unit before asking for something.' using errcode = 'P0001';
  end if;
  if v_title is null then
    raise exception 'Say what you need.' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then
    raise exception 'Say how many you need.' using errcode = 'P0001';
  end if;
  if p_needed_by not in ('today', 'week', 'month') then
    raise exception 'Say when you need it.' using errcode = 'P0001';
  end if;
  if p_reason not in ('ran_out', 'broken', 'new_joiner', 'new_work', 'other') then
    raise exception 'Say why it is needed.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rh_report:' || v_uid::text, 0));
  s := public.rh_settings(v_loc);
  select count(*) into v_n from public.rh_report_ledger l
   where l.profile_id = v_uid and l.created_at > now() - interval '24 hours';
  if v_n >= s.report_limit_24h then
    raise exception '%', format('You have sent %s requests in the last 24 hours, which is the limit. '
                                'Please ask Stores directly.', v_n)
      using errcode = 'P0001';
  end if;

  v_owner := coalesce(
    (select p.id from public.profiles p where p.id = s.requirement_owner_id and p.is_active),
    (select p.id from public.profiles p where p.id = s.unit_head_id and p.is_active));
  v_due := case p_needed_by
             when 'today' then (date_trunc('day', now() at time zone s.timezone) + interval '1 day' - interval '1 second') at time zone s.timezone
             when 'week'  then now() + interval '7 days'
             else now() + make_interval(days => s.purchase_days + 23) end;

  v_year := extract(year from (now() at time zone s.timezone))::int;
  insert into public.rh_ref_counters as k (prefix, year, last_no) values ('REQ', v_year, 1)
    on conflict (prefix, year) do update set last_no = k.last_no + 1
    returning k.last_no into v_no;
  v_ref := 'REQ-' || v_year || '-' || lpad(v_no::text, 6, '0');

  insert into public.rh_tickets (
    location_id, kind, ref_no, status, reporter_id, title, description,
    severity, priority, source, owner_id, owner_reason, due_at, needs_sorting,
    rq_qty, rq_needed_by, rq_reason, created_by)
  values (
    v_loc, 'requirement', v_ref, 'open', v_uid, v_title, nullif(btrim(p_description), ''),
    case p_needed_by when 'today' then 'high' else 'medium' end,
    case p_needed_by when 'today' then 'high' else 'medium' end, 'form',
    v_owner, case when v_owner = s.requirement_owner_id then 'Stores' else 'Unit head' end,
    v_due, v_owner is null, p_qty, p_needed_by, p_reason, v_uid)
  returning id into v_id;

  insert into public.rh_report_ledger (profile_id, ticket_id, kind) values (v_uid, v_id, 'requirement');
  perform public.rh_log(v_id, 'created', null, 'open', null,
    jsonb_build_object('qty', p_qty, 'needed_by', p_needed_by, 'reason', p_reason));
  perform public.rh__catalog_stamp(v_id, it.id);

  return jsonb_build_object('ticket_id', v_id, 'ref_no', v_ref, 'due_at', v_due,
    'owner_name', (select p.full_name from public.profiles p where p.id = v_owner),
    'needs_sorting', v_owner is null);
end;
$$;

-- ─── 6. Requirement steps ──────────────────────────────────────────────────

create or replace function public.rh_rq_decide(p_ticket_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t        public.rh_tickets := public.rh_lock(p_ticket_id);
  v_status text := case when p_approve then 'approved' else 'rejected' end;
begin
  if p_approve is null then
    raise exception 'Approve or reject it.' using errcode = 'P0001';
  end if;
  if not coalesce(p_approve, true) and (p_note is null or btrim(p_note) = '') then
    raise exception 'Say why it is rejected — the person who asked will read it.' using errcode = 'P0001';
  end if;
  perform public.rh_require(t, case when p_approve then 'rq_approve' else 'rq_reject' end,
                            case when p_approve then 'approve' else 'reject' end);
  update public.rh_tickets
     set status = v_status, rq_decided_note = nullif(btrim(p_note), ''),
         assignee_id = coalesce(assignee_id, auth.uid()),
         closed_at = case when p_approve then null else now() end
   where id = t.id;
  perform public.rh_log(t.id, v_status, 'open', v_status, p_note);
  return jsonb_build_object('status', v_status);
end;
$$;

create or replace function public.rh_rq_fulfil(p_ticket_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'rq_fulfil', 'mark as given');
  update public.rh_tickets
     set status = 'fulfilled', fixed_at = now(), closed_at = now(),
         resolution_message = nullif(btrim(p_note), '')
   where id = t.id;
  perform public.rh_log(t.id, 'fulfilled', 'approved', 'fulfilled', p_note);
  return jsonb_build_object('status', 'fulfilled');
end;
$$;

create or replace function public.rh_rq_withdraw(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.rh_tickets := public.rh_lock(p_ticket_id);
begin
  perform public.rh_require(t, 'rq_withdraw', 'withdraw');
  update public.rh_tickets set status = 'withdrawn', withdrawn_at = now() where id = t.id;
  perform public.rh_log(t.id, 'withdrawn', 'open', 'withdrawn', null);
  return jsonb_build_object('status', 'withdrawn');
end;
$$;

-- Requirement alerts. A separate AFTER trigger rather than a fourth branch in
-- rh_activity_outbox: 'created' already reaches the owner through that
-- trigger's default branch (resolve.ticket_routed, worded per kind in
-- lib/resolve/messages.ts); only the three decisions are new, and they go to
-- the person who asked.
create or replace function public.rh_rq_outbox()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  t        public.rh_tickets;
  s        public.rh_unit_settings;
  v_status text;
begin
  if new.ticket_id is null or new.action not in ('approved', 'rejected', 'fulfilled') then
    return new;
  end if;
  select * into t from public.rh_tickets x where x.id = new.ticket_id;
  if not found or t.kind <> 'requirement' or t.reporter_id is null
     or t.reporter_id is not distinct from new.actor_id then
    return new;
  end if;
  s := public.rh_settings(t.location_id);
  v_status := case when coalesce(s.suppress_notifications, false) then 'suppressed' else 'pending' end;
  insert into public.rh_outbox (activity_id, ticket_id, location_id, event_key, recipient_id, channel, dedupe_key, status)
  values (new.id, t.id, t.location_id, 'resolve.rq_update', t.reporter_id, 'in_app',
          new.id || ':' || t.reporter_id || ':in_app', v_status)
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

create trigger rh_ticket_activity_rq_outbox
  after insert on public.rh_ticket_activity
  for each row execute function public.rh_rq_outbox();

-- ─── 7. Catalog read for the chat ──────────────────────────────────────────

-- One call: the areas and items of every lane, most-used first inside an area.
create or replace function public.rh_assist_catalog()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not public.has_permission('resolve', 'view') then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'lane', a.lane, 'code', a.code, 'label', a.label, 'icon', a.icon,
             'items', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', i.id, 'code', i.code, 'label', i.label, 'synonyms', i.synonyms,
                        'details', coalesce(i.details, a.details), 'dangerous', i.dangerous,
                        -- Concern: what the chat must say BEFORE asking — read from the
                        -- current unit's category the item routes to.
                        'anonymous_ok', coalesce(cc.anonymous_allowed, false),
                        'sensitive', coalesce(cc.is_sensitive, false))
                      order by i.used_count desc, i.sort, i.label)
                 from public.rh_catalog_items i
                 left join public.rh_complaint_categories cc
                   on a.lane = 'concern' and cc.location_id = public.current_location()
                  and cc.code = coalesce(i.complaint_category_code, 'GEN') and not cc.inactive
                where i.area_id = a.id and not i.inactive), '[]'::jsonb))
           order by a.lane, a.sort, a.label)
      from public.rh_catalog_areas a
     where not a.inactive), '[]'::jsonb) end
$$;

-- ─── 8. Grants ──────────────────────────────────────────────────────────────

revoke all on function public.rh__rq_actions(public.rh_tickets, uuid) from public, anon, authenticated;
revoke all on function public.rh_actions_of(public.rh_tickets, uuid) from public, anon, authenticated;
revoke all on function public.rh__catalog_item(uuid, text) from public, anon, authenticated;
revoke all on function public.rh__catalog_stamp(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rh_rq_outbox() from public, anon, authenticated;

revoke all on function public.rh_assist_broken(uuid, uuid, text, text, boolean, text, numeric, numeric) from public, anon;
revoke all on function public.rh_assist_service(uuid, text, text, text, text) from public, anon;
revoke all on function public.rh_assist_complaint(uuid, text, text, boolean, boolean) from public, anon;
revoke all on function public.rh_assist_requirement(uuid, text, text, numeric, text, text) from public, anon;
revoke all on function public.rh_rq_decide(uuid, boolean, text) from public, anon;
revoke all on function public.rh_rq_fulfil(uuid, text) from public, anon;
revoke all on function public.rh_rq_withdraw(uuid) from public, anon;
revoke all on function public.rh_assist_catalog() from public, anon;
grant execute on function public.rh_assist_broken(uuid, uuid, text, text, boolean, text, numeric, numeric) to authenticated;
grant execute on function public.rh_assist_service(uuid, text, text, text, text) to authenticated;
grant execute on function public.rh_assist_complaint(uuid, text, text, boolean, boolean) to authenticated;
grant execute on function public.rh_assist_requirement(uuid, text, text, numeric, text, text) to authenticated;
grant execute on function public.rh_rq_decide(uuid, boolean, text) to authenticated;
grant execute on function public.rh_rq_fulfil(uuid, text) to authenticated;
grant execute on function public.rh_rq_withdraw(uuid) to authenticated;
grant execute on function public.rh_assist_catalog() to authenticated;

-- ─── 9. Seeds ───────────────────────────────────────────────────────────────

insert into public.notification_event_settings (event_key, mandatory, push, fallback_to_admins) values
  ('resolve.rq_update', false, true, false)
on conflict (event_key) do nothing;

-- Two IT categories the catalog needs (biometric, CCTV), every unit, on the desk team.
insert into public.rh_sd_categories (location_id, code, name, description, ticket_type, team_id, default_priority, created_by)
select l.id, c.code, c.name, c.description, 'incident',
       (select tm.id from public.rh_teams tm where tm.location_id = l.id and tm.name = 'IT SERVICE DESK'), c.pri, null
  from public.locations l
  cross join (values
    ('BIO',  'BIOMETRIC / ATTENDANCE', 'Attendance machine not punching or not syncing', 'medium'),
    ('CCTV', 'CCTV',                   'Camera down or recording not available',         'low')
  ) as c(code, name, description, pri)
on conflict (location_id, code) do nothing;

insert into public.rh_catalog_areas (lane, code, label, icon, details, sort, created_by) values
  -- Fix something
  ('fix', 'F-SEW',  'Sewing machine',            'scissors',       array['Stopped completely', 'Running with a fault', 'Happens sometimes', 'Started after a needle change'], 1, null),
  ('fix', 'F-MAC',  'Other machines',            'cog',            array['Stopped completely', 'Wrong output', 'Leaking', 'Overheating'], 2, null),
  ('fix', 'F-ELE',  'Power & electrical',        'zap',            array['Whole area', 'Only one point', 'On and off', 'Since today'], 3, null),
  ('fix', 'F-WAT',  'Water & toilets',           'droplets',       array['Since today', 'Since some days', 'Getting worse'], 4, null),
  ('fix', 'F-BLD',  'Building, doors & furniture','armchair',      array['Can still be used', 'Cannot be used', 'Someone could get hurt'], 5, null),
  ('fix', 'F-SAF',  'Fire & safety',             'flame',          array['Right now', 'Since some days', 'Seen during a check'], 6, null),
  ('fix', 'F-CMF',  'Cooling, cleaning & canteen','fan',           array['Since today', 'Since some days', 'Every day'], 7, null),
  -- IT help
  ('it', 'I-PC',   'Computer',                   'monitor',        array['Since today', 'Since some days', 'Only my computer', 'Whole section'], 1, null),
  ('it', 'I-PRN',  'Printer & scanner',          'printer',        array['Since today', 'Since some days', 'Only my computer', 'Whole section'], 2, null),
  ('it', 'I-NET',  'Network & internet',         'wifi',           array['Since today', 'Since some days', 'Only my computer', 'Whole section'], 3, null),
  ('it', 'I-ERP',  'Raagam ERP',                 'layout-grid',    array['Since today', 'Since some days', 'Only me', 'Everyone in my section'], 4, null),
  ('it', 'I-COM',  'Email, phone & attendance',  'mail',           array['Since today', 'Since some days', 'Only me', 'Many people'], 5, null),
  ('it', 'I-NEW',  'New setup or move',          'package-plus',   array['For me', 'For a new joiner', 'For my section'], 6, null),
  -- Buy something
  ('buy', 'B-PRD', 'Production consumables',     'scissors',       '{}', 1, null),
  ('buy', 'B-PPE', 'Safety & PPE',               'hard-hat',       '{}', 2, null),
  ('buy', 'B-TLS', 'Tools & maintenance',        'wrench',         '{}', 3, null),
  ('buy', 'B-OFF', 'Office & stationery',        'pen-line',       '{}', 4, null),
  ('buy', 'B-HSK', 'Housekeeping & canteen',     'spray-can',      '{}', 5, null),
  ('buy', 'B-ITE', 'IT equipment',               'mouse',          '{}', 6, null),
  -- Raise a concern
  ('concern', 'C-PAY', 'Pay & attendance',       'wallet',         array['This month', 'For some months', 'Many workers affected'], 1, null),
  ('concern', 'C-BEH', 'Behaviour',              'shield-alert',   array['Happened once', 'Keeps happening', 'Others have seen it'], 2, null),
  ('concern', 'C-FAI', 'Fair treatment',         'scale',          array['Happened once', 'Keeps happening', 'Others are affected too'], 3, null),
  ('concern', 'C-WRK', 'Working conditions',     'factory',        array['Today', 'Every day', 'Many workers affected'], 4, null),
  ('concern', 'C-OTH', 'Something else',         'message-circle', array['Happened once', 'Keeps happening'], 5, null)
on conflict (code) do nothing;

insert into public.rh_catalog_items
  (area_id, code, label, synonyms, details, dangerous, trade_code, sd_category_code, complaint_category_code, sort, created_by)
select a.id, v.code, v.label, v.syn, v.det, v.dang, v.trade, v.sd, v.cmp, v.sort, null
  from (values
    -- F-SEW sewing machine → MACHINE MAINTENANCE
    ('F-SEW', 'F-SEW-NEEDLE', 'NEEDLE BREAKING',            array['needle','broken needle'],          null::text[], false, 'MECH', null, null, 1),
    ('F-SEW', 'F-SEW-SKIP',   'SKIPPING STITCHES',          array['skip','stitch','loose stitch'],     null, false, 'MECH', null, null, 2),
    ('F-SEW', 'F-SEW-THREAD', 'THREAD BREAKING',            array['thread cut','thread'],              null, false, 'MECH', null, null, 3),
    ('F-SEW', 'F-SEW-MOTOR',  'MACHINE NOT RUNNING',        array['motor','not starting','dead'],      null, false, 'MECH', null, null, 4),
    ('F-SEW', 'F-SEW-OIL',    'OIL LEAKING',                array['oil','leak','stain'],               null, false, 'MECH', null, null, 5),
    ('F-SEW', 'F-SEW-NOISE',  'STRANGE NOISE',              array['sound','noise','vibration'],        null, false, 'MECH', null, null, 6),
    ('F-SEW', 'F-SEW-TRIM',   'THREAD TRIMMER NOT CUTTING', array['trimmer','cutter','auto cut'],      null, false, 'MECH', null, null, 7),
    ('F-SEW', 'F-SEW-PEDAL',  'PEDAL OR SENSOR NOT RESPONDING', array['pedal','sensor','foot'],        null, false, 'MECH', null, null, 8),
    -- F-MAC other machines
    ('F-MAC', 'F-MAC-CUT',    'CUTTING MACHINE PROBLEM',    array['cutting','band knife','straight knife','blade'], null, false, 'MECH', null, null, 1),
    ('F-MAC', 'F-MAC-FUSE',   'FUSING MACHINE PROBLEM',     array['fusing','temperature','interlining'], null, false, 'MECH', null, null, 2),
    ('F-MAC', 'F-MAC-IRON',   'STEAM IRON NOT HEATING OR LEAKING', array['iron','press','steam'],       null, false, 'MECH', null, null, 3),
    ('F-MAC', 'F-MAC-SNAP',   'BUTTON / SNAP / RIVET MACHINE', array['button','snap','rivet','kaja'],   null, false, 'MECH', null, null, 4),
    ('F-MAC', 'F-MAC-EMB',    'EMBROIDERY OR PRINTING MACHINE', array['embroidery','printing','print'], null, false, 'MECH', null, null, 5),
    ('F-MAC', 'F-MAC-GUN',    'THREAD SUCKER / SPOT GUN',   array['sucker','spot gun','cleaning gun'], null, false, 'MECH', null, null, 6),
    ('F-MAC', 'F-MAC-NDET',   'NEEDLE DETECTOR NOT DETECTING', array['needle detector','metal detector'], null, true, 'MECH', null, null, 7),
    ('F-MAC', 'F-MAC-BOIL',   'BOILER / STEAM PRESSURE',    array['boiler','steam pressure'],          null, true,  'MECH', null, null, 8),
    ('F-MAC', 'F-MAC-COMP',   'COMPRESSOR — LOW AIR',       array['compressor','air pressure'],        null, false, 'MECH', null, null, 9),
    -- F-ELE electrical
    ('F-ELE', 'F-ELE-NOPWR',  'NO POWER IN MY AREA',        array['power','current','eb'],             null, false, 'ELEC', null, null, 1),
    ('F-ELE', 'F-ELE-LIGHT',  'LIGHT NOT WORKING',          array['light','tube','bulb'],              null, false, 'ELEC', null, null, 2),
    ('F-ELE', 'F-ELE-FAN',    'FAN NOT WORKING',            array['fan'],                               null, false, 'ELEC', null, null, 3),
    ('F-ELE', 'F-ELE-SOCK',   'SOCKET OR SWITCH BROKEN',    array['socket','plug','switch'],           null, false, 'ELEC', null, null, 4),
    ('F-ELE', 'F-ELE-SPARK',  'SPARKING OR BURNING SMELL',  array['spark','burning','smoke','shock'],  null, true,  'ELEC', null, null, 5),
    ('F-ELE', 'F-ELE-WIRE',   'EXPOSED WIRE',               array['wire','cable','naked wire'],        null, true,  'ELEC', null, null, 6),
    ('F-ELE', 'F-ELE-GEN',    'GENERATOR PROBLEM',          array['generator','dg','genset'],          null, false, 'ELEC', null, null, 7),
    ('F-ELE', 'F-ELE-TRIP',   'MACHINE TRIPPING THE BREAKER', array['trip','mcb','breaker'],           null, false, 'ELEC', null, null, 8),
    -- F-WAT water & toilets
    ('F-WAT', 'F-WAT-NONE',   'NO WATER',                   array['water'],                             null, false, 'PLMB', null, null, 1),
    ('F-WAT', 'F-WAT-LEAK',   'LEAK OR PIPE BURST',         array['leak','pipe','burst'],              null, false, 'PLMB', null, null, 2),
    ('F-WAT', 'F-WAT-BLOCK',  'TOILET BLOCKED',             array['toilet','blocked','drain'],         null, false, 'PLMB', null, null, 3),
    ('F-WAT', 'F-WAT-TAP',    'TAP OR FLUSH BROKEN',        array['tap','flush'],                       null, false, 'PLMB', null, null, 4),
    ('F-WAT', 'F-WAT-RO',     'DRINKING WATER / RO NOT WORKING', array['ro','drinking water','purifier'], null, false, 'PLMB', null, null, 5),
    ('F-WAT', 'F-WAT-CLEAN',  'WASHROOM NEEDS CLEANING',    array['dirty','smell','washroom'],         null, false, 'HSKP', null, null, 6),
    -- F-BLD building & furniture
    ('F-BLD', 'F-BLD-CHAIR',  'CHAIR OR STOOL BROKEN',      array['chair','stool','seat'],             null, false, 'CARP', null, null, 1),
    ('F-BLD', 'F-BLD-TABLE',  'WORK TABLE BROKEN',          array['table','bench'],                     null, false, 'CARP', null, null, 2),
    ('F-BLD', 'F-BLD-RACK',   'RACK OR SHELF LOOSE',        array['rack','shelf','cupboard'],          null, true,  'CARP', null, null, 3),
    ('F-BLD', 'F-BLD-DOOR',   'DOOR, LOCK OR WINDOW',       array['door','lock','window','key'],       null, false, 'CARP', null, null, 4),
    ('F-BLD', 'F-BLD-ROOF',   'ROOF LEAKING',               array['roof','ceiling','rain'],            null, false, 'CIVIL', null, null, 5),
    ('F-BLD', 'F-BLD-FLOOR',  'FLOOR BROKEN OR SLIPPERY',   array['floor','slippery','tile'],          null, true,  'CIVIL', null, null, 6),
    -- F-SAF fire & safety
    ('F-SAF', 'F-SAF-GAS',    'GAS SMELL OR SMOKE',         array['gas','smoke','fire'],               null, true,  'ELEC', null, null, 1),
    ('F-SAF', 'F-SAF-EXT',    'FIRE EXTINGUISHER MISSING OR EXPIRED', array['extinguisher','fire'],    null, false, null,   null, null, 2),
    ('F-SAF', 'F-SAF-EXIT',   'EMERGENCY EXIT BLOCKED OR LOCKED', array['exit','emergency door'],      null, true,  null,   null, null, 3),
    ('F-SAF', 'F-SAF-ALARM',  'FIRE ALARM NOT WORKING',     array['alarm','siren'],                    null, true,  'ELEC', null, null, 4),
    ('F-SAF', 'F-SAF-FAID',   'FIRST-AID BOX EMPTY',        array['first aid','medicine'],             null, false, null,   null, null, 5),
    ('F-SAF', 'F-SAF-GUARD',  'MACHINE GUARD MISSING',      array['guard','finger guard','eye guard'], null, true,  'MECH', null, null, 6),
    -- F-CMF cooling, cleaning, canteen
    ('F-CMF', 'F-CMF-AC',     'AC NOT COOLING',             array['ac','air condition','cooling'],     null, false, 'ACR',  null, null, 1),
    ('F-CMF', 'F-CMF-HOT',    'TOO HOT / NO VENTILATION',   array['hot','heat','ventilation','air'],   null, false, 'ACR',  null, null, 2),
    ('F-CMF', 'F-CMF-EXH',    'EXHAUST FAN NOT WORKING',    array['exhaust'],                           null, false, 'ELEC', null, null, 3),
    ('F-CMF', 'F-CMF-CLEAN',  'AREA NEEDS CLEANING',        array['dirty','clean','waste','dust'],     null, false, 'HSKP', null, null, 4),
    ('F-CMF', 'F-CMF-PEST',   'PESTS (RATS, INSECTS)',      array['rat','insect','mosquito','pest'],   null, false, 'HSKP', null, null, 5),
    ('F-CMF', 'F-CMF-CANT',   'CANTEEN EQUIPMENT BROKEN',   array['canteen','stove','kitchen'],        null, false, 'HSKP', null, null, 6),
    -- I-PC computer
    ('I-PC',  'I-PC-POWER',   'COMPUTER WON''T SWITCH ON',  array['pc','computer','laptop','not starting'], null, false, null, 'HW', null, 1),
    ('I-PC',  'I-PC-SLOW',    'VERY SLOW OR HANGING',       array['slow','hang','stuck'],              null, false, null, 'HW', null, 2),
    ('I-PC',  'I-PC-DISP',    'NO DISPLAY',                 array['monitor','screen','display'],       null, false, null, 'HW', null, 3),
    ('I-PC',  'I-PC-KBM',     'KEYBOARD OR MOUSE',          array['keyboard','mouse'],                 null, false, null, 'HW', null, 4),
    ('I-PC',  'I-PC-UPS',     'UPS BEEPING / NO BACKUP',    array['ups','battery','beep'],             null, false, null, 'HW', null, 5),
    -- I-PRN printer
    ('I-PRN', 'I-PRN-NOPRT',  'NOT PRINTING',               array['print','printer','offline'],        null, false, null, 'PRN', null, 1),
    ('I-PRN', 'I-PRN-JAM',    'PAPER JAM',                  array['jam','paper'],                      null, false, null, 'PRN', null, 2),
    ('I-PRN', 'I-PRN-INK',    'TONER OR INK LOW',           array['toner','ink','cartridge'],          null, false, null, 'PRN', null, 3),
    ('I-PRN', 'I-PRN-SCAN',   'SCANNER NOT WORKING',        array['scan','scanner'],                   null, false, null, 'PRN', null, 4),
    ('I-PRN', 'I-PRN-LABEL',  'BARCODE / LABEL PRINTER',    array['barcode','label','sticker','zebra'], null, false, null, 'PRN', null, 5),
    -- I-NET network
    ('I-NET', 'I-NET-NONE',   'NO INTERNET',                array['internet','net'],                   null, false, null, 'NET', null, 1),
    ('I-NET', 'I-NET-WIFI',   'WI-FI WON''T CONNECT',       array['wifi','wi-fi','wireless'],          null, false, null, 'NET', null, 2),
    ('I-NET', 'I-NET-SLOW',   'VERY SLOW NETWORK',          array['slow net','slow internet'],         null, false, null, 'NET', null, 3),
    ('I-NET', 'I-NET-SHARE',  'SHARED FOLDER NOT OPENING',  array['shared','drive','folder','network drive'], null, false, null, 'NET', null, 4),
    -- I-ERP
    ('I-ERP', 'I-ERP-ERROR',  'ERP SHOWS AN ERROR',         array['error','raagam','erp'],             null, false, null, 'ERP', null, 1),
    ('I-ERP', 'I-ERP-SAVE',   'CAN''T SAVE',                 array['save','not saving'],                null, false, null, 'ERP', null, 2),
    ('I-ERP', 'I-ERP-WRONG',  'REPORT OR FIGURES LOOK WRONG', array['report','wrong','figures','total'], null, false, null, 'ERP', null, 3),
    ('I-ERP', 'I-ERP-ACCESS', 'NEED ACCESS TO A SCREEN',    array['access','permission','role','cannot see'], null, false, null, 'PRM', null, 4),
    ('I-ERP', 'I-ERP-PASS',   'FORGOT PASSWORD / LOCKED OUT', array['password','login','locked'],      null, false, null, 'ACC', null, 5),
    -- I-COM email, phone, attendance
    ('I-COM', 'I-COM-MAIL',   'EMAIL NOT WORKING',          array['email','mail','outlook'],           null, false, null, 'ACC', null, 1),
    ('I-COM', 'I-COM-NEWID',  'NEW EMAIL ID',               array['new email','email id'],             null, false, null, 'ACC', null, 2),
    ('I-COM', 'I-COM-SIM',    'MOBILE OR SIM PROBLEM',      array['mobile','sim','phone'],             null, false, null, 'ACC', null, 3),
    ('I-COM', 'I-COM-BIO',    'BIOMETRIC NOT PUNCHING',     array['biometric','punch','attendance','thumb'], null, false, null, 'BIO', null, 4),
    ('I-COM', 'I-COM-CCTV',   'CCTV CAMERA DOWN',           array['cctv','camera'],                    null, false, null, 'CCTV', null, 5),
    -- I-NEW setup
    ('I-NEW', 'I-NEW-PC',     'NEW COMPUTER OR LAPTOP',     array['new computer','new laptop','new pc'], null, false, null, 'DEV', null, 1),
    ('I-NEW', 'I-NEW-SW',     'INSTALL SOFTWARE',           array['install','software','tally','excel'], null, false, null, 'DEV', null, 2),
    ('I-NEW', 'I-NEW-JOIN',   'NEW JOINER SETUP',           array['new joiner','onboarding'],          null, false, null, 'DEV', null, 3),
    ('I-NEW', 'I-NEW-MOVE',   'MOVE MY COMPUTER',           array['move','shift','relocate'],          null, false, null, 'MOV', null, 4),
    ('I-NEW', 'I-NEW-SRV',    'SERVER OR STORAGE REQUEST',  array['server','storage','backup'],        null, false, null, 'SRV', null, 5),
    -- B-PRD production consumables
    ('B-PRD', 'B-PRD-NEEDLE', 'MACHINE NEEDLES',            array['needle'],                            null, false, null, null, null, 1),
    ('B-PRD', 'B-PRD-OIL',    'MACHINE OIL',                array['oil'],                               null, false, null, null, null, 2),
    ('B-PRD', 'B-PRD-SPARE',  'MACHINE SPARE PARTS',        array['spare','part','bobbin','hook'],     null, false, null, null, null, 3),
    ('B-PRD', 'B-PRD-SCIS',   'SCISSORS / THREAD CLIPPERS', array['scissors','clipper','cutter'],      null, false, null, null, null, 4),
    ('B-PRD', 'B-PRD-CHALK',  'CHALK / MARKERS',            array['chalk','marker','pencil'],          null, false, null, null, null, 5),
    ('B-PRD', 'B-PRD-TAGGUN', 'TAG GUN / PINS',             array['tag gun','pins','tagging'],         null, false, null, null, null, 6),
    -- B-PPE
    ('B-PPE', 'B-PPE-MESH',   'METAL-MESH GLOVES (CUTTING)', array['glove','mesh'],                    null, false, null, null, null, 1),
    ('B-PPE', 'B-PPE-MASK',   'MASKS',                      array['mask'],                              null, false, null, null, null, 2),
    ('B-PPE', 'B-PPE-EAR',    'EAR PLUGS',                  array['ear','plug'],                        null, false, null, null, null, 3),
    ('B-PPE', 'B-PPE-FAID',   'FIRST-AID ITEMS',            array['first aid','bandage'],              null, false, null, null, null, 4),
    ('B-PPE', 'B-PPE-EXT',    'FIRE EXTINGUISHER REFILL',   array['extinguisher','refill'],            null, false, null, null, null, 5),
    -- B-TLS
    ('B-TLS', 'B-TLS-ELEC',   'ELECTRICAL ITEMS (BULB, CABLE)', array['bulb','tube','cable','wire'],   null, false, null, null, null, 1),
    ('B-TLS', 'B-TLS-PLMB',   'PLUMBING PARTS',             array['tap','pipe','valve'],               null, false, null, null, null, 2),
    ('B-TLS', 'B-TLS-TOOL',   'TOOLS',                      array['tool','screwdriver','spanner'],     null, false, null, null, null, 3),
    ('B-TLS', 'B-TLS-CIVIL',  'PAINT / CIVIL MATERIAL',     array['paint','cement'],                   null, false, null, null, null, 4),
    -- B-OFF
    ('B-OFF', 'B-OFF-PAPER',  'PAPER',                      array['paper','a4'],                        null, false, null, null, null, 1),
    ('B-OFF', 'B-OFF-PEN',    'PENS / FILES',               array['pen','file','folder'],              null, false, null, null, null, 2),
    ('B-OFF', 'B-OFF-TONER',  'PRINTER TONER',              array['toner','cartridge','ink'],          null, false, null, null, null, 3),
    ('B-OFF', 'B-OFF-REG',    'REGISTERS / BOOKS',          array['register','book','note'],           null, false, null, null, null, 4),
    -- B-HSK
    ('B-HSK', 'B-HSK-CLEAN',  'CLEANING SUPPLIES',          array['phenyl','broom','mop','cleaning'],  null, false, null, null, null, 1),
    ('B-HSK', 'B-HSK-WATER',  'DRINKING-WATER CANS',        array['water can','bubble top'],           null, false, null, null, null, 2),
    ('B-HSK', 'B-HSK-CANT',   'CANTEEN ITEMS',              array['canteen','tea','cups','plates'],    null, false, null, null, null, 3),
    ('B-HSK', 'B-HSK-TOIL',   'TOILET SUPPLIES',            array['soap','tissue','toilet'],           null, false, null, null, null, 4),
    -- B-ITE
    ('B-ITE', 'B-ITE-KBM',    'MOUSE / KEYBOARD',           array['mouse','keyboard'],                 null, false, null, null, null, 1),
    ('B-ITE', 'B-ITE-CABLE',  'CABLE / CHARGER',            array['cable','charger','adapter'],        null, false, null, null, null, 2),
    ('B-ITE', 'B-ITE-HEAD',   'HEADSET',                    array['headset','headphone'],              null, false, null, null, null, 3),
    -- C-PAY
    ('C-PAY', 'C-PAY-SHORT',  'SALARY SHORT OR NOT CREDITED', array['salary','wage','pay'],            null, false, null, null, 'PAY', 1),
    ('C-PAY', 'C-PAY-OT',     'OVERTIME NOT PAID',          array['ot','overtime'],                    null, false, null, null, 'PAY', 2),
    ('C-PAY', 'C-PAY-DED',    'WRONG DEDUCTION',            array['deduction','cut','fine'],           null, false, null, null, 'PAY', 3),
    ('C-PAY', 'C-PAY-PUNCH',  'ATTENDANCE / PUNCH MISSING', array['attendance','punch','absent'],      null, false, null, null, 'PAY', 4),
    ('C-PAY', 'C-PAY-LEAVE',  'LEAVE WRONGLY MARKED',       array['leave','holiday'],                  null, false, null, null, 'PAY', 5),
    -- C-BEH (sensitive)
    ('C-BEH', 'C-BEH-SHOUT',  'SHOUTING OR ABUSIVE WORDS',  array['shout','abuse','scold','insult'],   null, false, null, null, 'HAR', 1),
    ('C-BEH', 'C-BEH-THREAT', 'THREATS OR BULLYING',        array['threat','bully','pressure'],        null, false, null, null, 'HAR', 2),
    ('C-BEH', 'C-BEH-SEXUAL', 'SEXUAL HARASSMENT',          array['harassment','touch','posh'],        null, false, null, null, 'HAR', 3),
    ('C-BEH', 'C-BEH-VIOL',   'PHYSICAL CONTACT OR VIOLENCE', array['hit','push','violence'],          null, false, null, null, 'HAR', 4),
    -- C-FAI (sensitive)
    ('C-FAI', 'C-FAI-WORK',   'UNFAIR WORK ALLOTMENT',      array['unfair','work','target'],           null, false, null, null, 'DIS', 1),
    ('C-FAI', 'C-FAI-DENIED', 'DENIED LEAVE OR BENEFIT UNFAIRLY', array['denied','benefit','bonus'],  null, false, null, null, 'DIS', 2),
    ('C-FAI', 'C-FAI-DISC',   'DISCRIMINATION',             array['caste','religion','gender','age','region'], null, false, null, null, 'DIS', 3),
    -- C-WRK
    ('C-WRK', 'C-WRK-OT',     'FORCED OR EXCESS OVERTIME',  array['forced','excess','long hours','sunday'], null, false, null, null, 'SAF', 1),
    ('C-WRK', 'C-WRK-BREAK',  'NOT ALLOWED TOILET OR WATER BREAK', array['break','toilet break','water break'], null, false, null, null, 'SAF', 2),
    ('C-WRK', 'C-WRK-UNSAFE', 'UNSAFE PRACTICE',            array['unsafe','danger','risk'],           null, false, null, null, 'SAF', 3),
    ('C-WRK', 'C-WRK-FOOD',   'CANTEEN FOOD',               array['food','canteen','meal'],            null, false, null, null, 'FAC', 4),
    ('C-WRK', 'C-WRK-BUS',    'TRANSPORT / BUS',            array['bus','transport','van'],            null, false, null, null, 'FAC', 5),
    ('C-WRK', 'C-WRK-CRECHE', 'CRÈCHE OR REST ROOM',        array['creche','rest room','child care'],  null, false, null, null, 'FAC', 6),
    -- C-OTH
    ('C-OTH', 'C-OTH-GEN',    'SOMETHING ELSE',             array['other'],                             null, false, null, null, 'GEN', 1)
  ) as v(area, code, label, syn, det, dang, trade, sd, cmp, sort)
  join public.rh_catalog_areas a on a.code = v.area
on conflict (code) do nothing;
