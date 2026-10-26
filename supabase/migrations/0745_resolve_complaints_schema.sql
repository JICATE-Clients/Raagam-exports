-- ============================================================================
-- 0745 — Resolve Hub stage 2: complaints — schema, RLS, seeds.
--
-- Contract: doc/resolve/resolve-hub-plan.md §10. Functions/RPCs are in 0746.
--
-- A complaint is an rh_tickets row with kind = 'complaint'. Its statuses are
-- its own (open, assigned, in_progress, escalated, resolved, withdrawn); the
-- status check is now PER KIND, so a Broken ticket still cannot be 'assigned'
-- and a complaint cannot be 'fixed'.
--
-- rh_tickets_select is rewritten so a complaint row is visible ONLY through
-- rh_can_see() (0746's complaint branch). Left as it was, the Broken staff
-- rule (triage / analytics / unit head / team) would have shown every
-- sensitive complaint in the unit to every manager.
-- ============================================================================

-- ─── 1. Categories + members ────────────────────────────────────────────────

create table public.rh_complaint_categories (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null default public.current_location() references public.locations(id),
  code              text not null,
  name              text not null,
  description       text,
  is_sensitive      boolean not null default false,
  anonymous_allowed boolean not null default false,
  handler_id        uuid references public.profiles(id) on delete set null,
  response_hours    int not null default 72 check (response_hours between 1 and 2160),
  inactive          boolean not null default false,
  created_by        uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (location_id, code),
  unique (location_id, name)
);

create table public.rh_category_members (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.rh_complaint_categories(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('committee', 'oversight')),
  created_at  timestamptz not null default now(),
  unique (category_id, profile_id)
);
create index rh_category_members_profile_idx on public.rh_category_members (profile_id);
create index rh_complaint_categories_location_idx on public.rh_complaint_categories (location_id);

-- ─── 2. Settings + ticket columns ───────────────────────────────────────────

alter table public.rh_unit_settings
  add column superior_handler_id      uuid references public.profiles(id) on delete set null,
  add column complaint_response_hours int not null default 72
    check (complaint_response_hours between 1 and 2160);

alter table public.rh_tickets
  add column resolution_message text,
  add column response_due_at    timestamptz,
  add column first_response_at  timestamptz,
  add column resolved_at        timestamptz,
  add column withdrawn_at       timestamptz,
  add constraint rh_tickets_category_id_fkey
    foreign key (category_id) references public.rh_complaint_categories(id);

alter table public.rh_tickets drop constraint rh_tickets_status_check;
alter table public.rh_tickets add constraint rh_tickets_status_check check (
     (kind in ('broken', 'requirement')
      and status in ('open', 'in_progress', 'blocked', 'fixed', 'closed', 'cancelled', 'withdrawn'))
  or (kind = 'complaint'
      and status in ('open', 'assigned', 'in_progress', 'escalated', 'resolved', 'withdrawn'))
);
alter table public.rh_tickets add constraint rh_tickets_complaint_shape check (
  kind <> 'complaint' or (category_id is not null and place_id is null and trade_id is null)
);
-- An anonymous complaint carries NOTHING that names its author (§10.2).
alter table public.rh_tickets add constraint rh_tickets_anonymous_unlinked check (
  not is_anonymous or (kind = 'complaint' and reporter_id is null and created_by is null
                       and tracking_token_hash is not null)
);
create unique index rh_tickets_tracking_token_hash_key
  on public.rh_tickets (tracking_token_hash) where tracking_token_hash is not null;
create index rh_tickets_category_idx on public.rh_tickets (category_id) where category_id is not null;

-- ─── 3. Membership predicate + child scope ──────────────────────────────────

create or replace function public.rh__cat_member(p_category_id uuid, p_uid uuid, p_roles text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_category_id is not null and p_uid is not null and exists (
    select 1 from public.rh_category_members m
     where m.category_id = p_category_id and m.profile_id = p_uid and m.role = any (p_roles))
$$;
revoke all on function public.rh__cat_member(uuid, uuid, text[]) from public, anon, authenticated;

create or replace function public.lv_rh_category(p_category_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select p_category_id is null or exists (
  select 1 from public.rh_complaint_categories c
   where c.id = p_category_id and public.is_current_location(c.location_id)) $$;
revoke all on function public.lv_rh_category(uuid) from public, anon;
grant execute on function public.lv_rh_category(uuid) to authenticated;

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────

alter table public.rh_complaint_categories enable row level security;
alter table public.rh_category_members     enable row level security;
revoke all on public.rh_complaint_categories, public.rh_category_members from anon;

create policy rh_complaint_categories_select on public.rh_complaint_categories for select to authenticated
  using (public.has_permission('resolve', 'view') and public.is_current_location(location_id));
create policy rh_complaint_categories_insert on public.rh_complaint_categories for insert to authenticated
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_complaint_categories_update on public.rh_complaint_categories for update to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id))
  with check (public.has_permission('resolve', 'create') and public.is_current_location(location_id));
create policy rh_complaint_categories_delete on public.rh_complaint_categories for delete to authenticated
  using (public.has_permission('resolve', 'create') and public.is_current_location(location_id));

-- Who sits on a committee is itself sensitive: administrators, and each
-- member for their own row.
create policy rh_category_members_select on public.rh_category_members for select to authenticated
  using (public.lv_rh_category(category_id)
         and (public.has_permission('resolve', 'create') or profile_id = auth.uid()));
create policy rh_category_members_insert on public.rh_category_members for insert to authenticated
  with check (public.has_permission('resolve', 'create') and public.lv_rh_category(category_id));
create policy rh_category_members_update on public.rh_category_members for update to authenticated
  using (public.has_permission('resolve', 'create') and public.lv_rh_category(category_id))
  with check (public.has_permission('resolve', 'create') and public.lv_rh_category(category_id));
create policy rh_category_members_delete on public.rh_category_members for delete to authenticated
  using (public.has_permission('resolve', 'create') and public.lv_rh_category(category_id));

drop policy rh_tickets_select on public.rh_tickets;
create policy rh_tickets_select on public.rh_tickets for select to authenticated
  using (
    case when kind = 'complaint'
      then public.rh_can_see(id)
      else (   reporter_id = auth.uid()
            or public.rh_is_joiner(id)
            or (public.is_current_location(location_id)
                and public.rh_staff_row(location_id, owner_id, assignee_id, team_id)))
    end
  );

-- ─── 5. Seeds ───────────────────────────────────────────────────────────────

insert into public.notification_event_settings (event_key, mandatory, push, fallback_to_admins) values
  ('resolve.complaint_new',       true,  true, false),
  ('resolve.complaint_escalated', false, true, false),
  ('resolve.complaint_resolved',  false, true, false)
on conflict (event_key) do nothing;

insert into public.rh_complaint_categories
  (location_id, code, name, description, is_sensitive, anonymous_allowed, response_hours, created_by)
select l.id, c.code, c.name, c.description, c.sensitive, c.anon, 72, null
  from public.locations l
  cross join (values
    ('GEN', 'GENERAL',              'Anything that does not fit another category', false, false),
    ('FAC', 'WORKPLACE FACILITIES', 'Canteen, toilets, drinking water, rest areas, transport', false, false),
    ('PAY', 'SALARY & PAY',         'Wages, overtime, deductions, payslips', false, false),
    ('HAR', 'HARASSMENT',           'Harassment of any kind — handled by the committee only', true, true),
    ('DIS', 'DISCRIMINATION',       'Unfair treatment — handled by the committee only', true, true),
    ('SAF', 'SAFETY CONCERN',       'Unsafe practice or condition that is not a broken item', false, true),
    ('OTH', 'OTHER',                null, false, false)
  ) as c(code, name, description, sensitive, anon)
on conflict (location_id, code) do nothing;
