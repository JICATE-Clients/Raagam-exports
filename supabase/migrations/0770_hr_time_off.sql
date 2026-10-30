-- 0770 — HR ▸ TIME OFF (MyJKKN HR port, phase 1 — client 2026-10-29)
--
-- A SEPARATE build beside the existing "Leave & Encashment" screen (hr_leaves),
-- which is untouched. Source: MyJKKN docs/HR-MODULE-SPEC.md §9, rebuilt on
-- Raagam's own people (staff + workers), units and approval engine.
--
--   MyJKKN                              Raagam
--   ─────────────────────────────────── ──────────────────────────────────────
--   hr_leave_applications (3 kinds)     timeoff_requests (request_category)
--   hr_leave_types                      timeoff_leave_types
--   hr_leave_balances + overrides       timeoff_entitlements + timeoff_balance_sheet()
--   hr_academic_years                   timeoff_years (Apr–Mar by default)
--   hr_comp_off_credits                 timeoff_comp_off_credits
--   hr_leave_blackouts                  timeoff_blackouts
--   hr_leave_encashments (a stub there) timeoff_encashments (approved + paid here)
--   hr_approval_flows + frozen chain    approval_flows + approval_runs (the engine
--                                       already freezes steps_snapshot)
--   institution / hr_organization       locations (Head Office, Unit 1, Unit 2)
--
-- WHERE EACH RULE LIVES — in the database, so a stale tab or a hand-written
-- PostgREST call is refused exactly as the screen is:
--
--   * Every write to a request, claim or encashment goes through a SECURITY
--     DEFINER function below; authenticated has NO insert/update/delete grant
--     on those three tables.
--   * Apply runs MyJKKN's checks in its order (§9.2): blackout → notice →
--     max continuous → day count → overlap → period cap → balance / credits /
--     short-time-off limits. The first failure raises the operator's sentence.
--   * Entitlement is DERIVED and usage is COUNTED from the requests themselves
--     (timeoff_balance_sheet), never a stored "used" figure a trigger keeps in
--     step — so a cancelled or revoked leave gives its days back by construction.
--   * Only the approval engine's terminal trigger moves a request out of
--     pending into approved / rejected / withdrawn.
--
-- Nothing in this file modifies or deletes an existing row.

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Helpers
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.timeoff_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- The signed-in user's own staff row, matched on e-mail the same way
-- lib/auth/self-service.ts does for "My Profile".
create or replace function public.timeoff_my_staff_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select s.id
    from public.staff s
   where s.email is not null
     and lower(btrim(s.email)) = lower((select u.email from auth.users u where u.id = auth.uid()))
   order by s.created_at
   limit 1;
$$;

-- One person, staff or worker, in one shape.
create or replace function public.timeoff_person(p_staff uuid, p_worker uuid)
returns table (name text, code text, location_id uuid, gender text, joined date,
               is_active boolean, biometric_id text, day_rate numeric)
language sql stable security definer set search_path = '' as $$
  select s.name, s.code, s.location_id, s.gender, s.joined_date, s.is_active, s.biometric_id,
         round(coalesce(s.monthly_salary, 0) / 30.0, 2)
    from public.staff s where p_staff is not null and s.id = p_staff
  union all
  select w.name, w.code, w.location_id, w.gender, w.joined_date, w.is_active, w.biometric_id,
         coalesce(w.shift_wage_per_day, 0)
    from public.workers w where p_worker is not null and w.id = p_worker;
$$;

-- May the caller act for this person? Their own staff record, or an HR
-- operator holding `action` in the person's unit.
create or replace function public.timeoff_may_act_for(p_staff uuid, p_worker uuid, p_location uuid, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (p_staff is not null and p_staff = public.timeoff_my_staff_id())
      or (public.has_permission('hr_payroll', p_action) and public.is_current_location(p_location));
$$;

-- Stamp location_id from the person when a row arrives without one.
create or replace function public.timeoff_stamp_location()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.location_id is null then
    select p.location_id into new.location_id from public.timeoff_person(new.staff_id, new.worker_id) p;
    new.location_id := coalesce(new.location_id, public.current_location());
  end if;
  if new.location_id is null then
    raise exception 'This person has no unit, and you are not working in one — pick a unit in the top bar first'
      using errcode = '23502';
  end if;
  return new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Leave years
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.timeoff_years (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (btrim(name) <> ''),
  start_date  date not null,
  end_date    date not null,
  is_closed   boolean not null default false,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint timeoff_year_span check (end_date > start_date)
);
comment on table public.timeoff_years is
  'HR ▸ Time Off leave years (MyJKKN hr_academic_years). Shared across units — no location_id. 0770.';

create or replace function public.timeoff_years_no_overlap()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.timeoff_years y
              where y.id <> new.id
                and daterange(y.start_date, y.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'This leave year overlaps another one' using errcode = '23P01';
  end if;
  return new;
end $$;
drop trigger if exists trg_timeoff_years_overlap on public.timeoff_years;
create trigger trg_timeoff_years_overlap before insert or update on public.timeoff_years
  for each row execute function public.timeoff_years_no_overlap();
drop trigger if exists trg_timeoff_years_updated on public.timeoff_years;
create trigger trg_timeoff_years_updated before update on public.timeoff_years
  for each row execute function public.set_updated_at();

create or replace function public.timeoff_year_of(p_day date)
returns uuid language sql stable security definer set search_path = '' as $$
  select y.id from public.timeoff_years y where p_day between y.start_date and y.end_date limit 1;
$$;

insert into public.timeoff_years (name, start_date, end_date)
select '2026-27', date '2026-04-01', date '2027-03-31'
where not exists (select 1 from public.timeoff_years);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Leave types (MyJKKN §9.4)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.timeoff_leave_types (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null check (btrim(code) <> ''),
  name                     text not null check (btrim(name) <> ''),
  color                    text not null default '#6366f1',
  sort_order               int  not null default 0,
  is_active                boolean not null default true,
  -- what kind of request this type books
  request_category         text not null default 'leave'
                           check (request_category in ('leave', 'short_time_off', 'compensatory_off')),
  -- who may take it
  applies_to               text not null default 'both' check (applies_to in ('staff', 'workers', 'both')),
  applicable_gender        text not null default 'any' check (applicable_gender in ('any', 'Male', 'Female')),
  -- day counting
  is_paid                  boolean not null default true,
  allow_half_day           boolean not null default true,
  skip_weekends            boolean not null default true,   -- Sundays are not counted
  skip_holidays            boolean not null default true,   -- Master Data ▸ Holidays are not counted
  -- policy
  track_balance            boolean not null default true,   -- false = unlimited (Loss of Pay)
  default_entitled_days    numeric(6,1) not null default 0 check (default_entitled_days >= 0),
  accrual_type             text not null default 'annual' check (accrual_type in ('annual', 'monthly')),
  accrual_rate             numeric(5,2) check (accrual_rate is null or accrual_rate > 0),
  min_advance_notice_days  int  not null default 0 check (min_advance_notice_days >= 0),
  max_continuous_days      numeric(5,1) check (max_continuous_days is null or max_continuous_days > 0),
  limit_period             text not null default 'none' check (limit_period in ('none', 'month', 'year')),
  max_days_per_period      numeric(6,1) check (max_days_per_period is null or max_days_per_period > 0),
  allow_carry_forward      boolean not null default false,
  max_carry_forward_days   numeric(6,1) check (max_carry_forward_days is null or max_carry_forward_days >= 0),
  is_encashable            boolean not null default false,
  max_encashable_days      numeric(6,1) check (max_encashable_days is null or max_encashable_days > 0),
  -- short time off (permission) limits
  sto_limit_mode           text not null default 'none' check (sto_limit_mode in ('none', 'count', 'minutes')),
  sto_limit_period         text not null default 'month' check (sto_limit_period in ('month', 'year')),
  sto_max_requests         int  check (sto_max_requests is null or sto_max_requests > 0),
  sto_total_minutes        int  check (sto_total_minutes is null or sto_total_minutes > 0),
  sto_min_minutes          int  check (sto_min_minutes is null or sto_min_minutes > 0),
  sto_max_minutes          int  check (sto_max_minutes is null or sto_max_minutes > 0),
  created_by               uuid default auth.uid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint timeoff_type_accrual  check (accrual_type <> 'monthly' or accrual_rate is not null),
  constraint timeoff_type_cap      check (limit_period = 'none' or max_days_per_period is not null),
  constraint timeoff_type_sto_cnt  check (sto_limit_mode <> 'count' or sto_max_requests is not null),
  constraint timeoff_type_sto_min  check (sto_limit_mode <> 'minutes' or sto_total_minutes is not null)
);
comment on table public.timeoff_leave_types is
  'HR ▸ Time Off leave type catalog (MyJKKN hr_leave_types). Shared across units — no location_id. 0770.';
create unique index if not exists uq_timeoff_type_code on public.timeoff_leave_types (upper(btrim(code)));
drop trigger if exists trg_timeoff_types_updated on public.timeoff_leave_types;
create trigger trg_timeoff_types_updated before update on public.timeoff_leave_types
  for each row execute function public.set_updated_at();

-- A starting catalog. Every figure is editable on Time Off ▸ Leave Setup.
insert into public.timeoff_leave_types
  (code, name, color, sort_order, request_category, is_paid, allow_half_day, track_balance,
   default_entitled_days, accrual_type, accrual_rate, allow_carry_forward, max_carry_forward_days,
   is_encashable, max_encashable_days, sto_limit_mode, sto_limit_period, sto_max_requests,
   sto_min_minutes, sto_max_minutes)
select v.* from (values
  ('CL',  'CASUAL LEAVE',       '#0ea5e9', 10, 'leave',            true,  true,  true,  12::numeric, 'annual',  null::numeric, false, null::numeric, false, null::numeric, 'none',  'month', null::int, null::int, null::int),
  ('SL',  'SICK LEAVE',         '#f43f5e', 20, 'leave',            true,  true,  true,  12,          'annual',  null,          false, null,          false, null,          'none',  'month', null,      null,      null),
  ('EL',  'EARNED LEAVE',       '#10b981', 30, 'leave',            true,  false, true,  15,          'monthly', 1.25,          true,  30,            true,  15,            'none',  'month', null,      null,      null),
  ('LOP', 'LOSS OF PAY',        '#64748b', 40, 'leave',            false, true,  false, 0,           'annual',  null,          false, null,          false, null,          'none',  'month', null,      null,      null),
  ('CO',  'COMPENSATORY OFF',   '#8b5cf6', 50, 'compensatory_off', true,  true,  false, 0,           'annual',  null,          false, null,          false, null,          'none',  'month', null,      null,      null),
  ('PER', 'PERMISSION',         '#f59e0b', 60, 'short_time_off',   true,  false, false, 0,           'annual',  null,          false, null,          false, null,          'count', 'month', 2,         30,        120)
) as v
where not exists (select 1 from public.timeoff_leave_types);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Blackout dates (no leave may start or run across them)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.timeoff_blackouts (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (btrim(name) <> ''),
  start_date     date not null,
  end_date       date not null,
  leave_type_id  uuid references public.timeoff_leave_types(id) on delete cascade,  -- null = every type
  location_id    uuid references public.locations(id),                              -- null = every unit
  reason         text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint timeoff_blackout_span check (end_date >= start_date)
);
drop trigger if exists trg_timeoff_blackouts_updated on public.timeoff_blackouts;
create trigger trg_timeoff_blackouts_updated before update on public.timeoff_blackouts
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Requests — leave, short time off and comp-off bookings (MyJKKN §9.1)
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_timeoff_request;

create table if not exists public.timeoff_requests (
  id                uuid primary key default gen_random_uuid(),
  code              text,
  staff_id          uuid references public.staff(id),
  worker_id         uuid references public.workers(id),
  location_id       uuid not null references public.locations(id),
  leave_type_id     uuid not null references public.timeoff_leave_types(id),
  year_id           uuid not null references public.timeoff_years(id),
  request_category  text not null check (request_category in ('leave', 'short_time_off', 'compensatory_off')),
  start_date        date not null,
  end_date          date not null,
  day_part          text not null default 'full' check (day_part in ('full', 'first_half', 'second_half', 'hourly')),
  start_time        time,
  end_time          time,
  total_days        numeric(6,2) not null default 0 check (total_days >= 0),
  duration_minutes  int check (duration_minutes is null or duration_minutes > 0),
  reason            text not null check (btrim(reason) <> ''),
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled', 'revoked')),
  applied_by        uuid default auth.uid(),
  decided_by        uuid,
  decided_at        timestamptz,
  decision_remark   text,
  closed_by         uuid,          -- who cancelled / revoked an approved request
  closed_at         timestamptz,
  close_reason      text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint timeoff_req_person check (num_nonnulls(staff_id, worker_id) = 1),
  constraint timeoff_req_span   check (end_date >= start_date),
  constraint timeoff_req_hourly check (day_part <> 'hourly'
                                       or (start_time is not null and end_time is not null and end_time > start_time
                                           and start_date = end_date)),
  constraint timeoff_req_half   check (day_part not in ('first_half', 'second_half') or start_date = end_date)
);
create index if not exists idx_timeoff_req_staff  on public.timeoff_requests (staff_id, start_date);
create index if not exists idx_timeoff_req_worker on public.timeoff_requests (worker_id, start_date);
create index if not exists idx_timeoff_req_status on public.timeoff_requests (status);
create index if not exists idx_timeoff_req_dates  on public.timeoff_requests (start_date, end_date);

drop trigger if exists trg_timeoff_req_code on public.timeoff_requests;
create trigger trg_timeoff_req_code before insert on public.timeoff_requests
  for each row execute function public.assign_code('LV', 'public.seq_timeoff_request');
drop trigger if exists trg_timeoff_req_updated on public.timeoff_requests;
create trigger trg_timeoff_req_updated before update on public.timeoff_requests
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Comp-off credits (MyJKKN §9.6)
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_timeoff_comp_off;

create table if not exists public.timeoff_comp_off_credits (
  id               uuid primary key default gen_random_uuid(),
  code             text,
  staff_id         uuid references public.staff(id),
  worker_id        uuid references public.workers(id),
  location_id      uuid not null references public.locations(id),
  worked_date      date not null,
  credit_days      numeric(3,1) not null default 1 check (credit_days in (0.5, 1)),
  reason           text not null check (btrim(reason) <> ''),
  had_punch        boolean not null default false,    -- a biometric punch exists for that day
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'consumed')),
  expires_on       date not null,
  consumed_by      uuid references public.timeoff_requests(id),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_remark  text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint timeoff_co_person check (num_nonnulls(staff_id, worker_id) = 1),
  constraint timeoff_co_consumed check ((status = 'consumed') = (consumed_by is not null))
);
-- One live credit per person per worked day.
create unique index if not exists uq_timeoff_co_day
  on public.timeoff_comp_off_credits (coalesce(staff_id, worker_id), worked_date)
  where status in ('pending', 'approved', 'consumed');
drop trigger if exists trg_timeoff_co_code on public.timeoff_comp_off_credits;
create trigger trg_timeoff_co_code before insert on public.timeoff_comp_off_credits
  for each row execute function public.assign_code('CO', 'public.seq_timeoff_comp_off');
drop trigger if exists trg_timeoff_co_updated on public.timeoff_comp_off_credits;
create trigger trg_timeoff_co_updated before update on public.timeoff_comp_off_credits
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Entitlement overrides + opening balances (MyJKKN §9.9)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.timeoff_entitlements (
  id               uuid primary key default gen_random_uuid(),
  year_id          uuid not null references public.timeoff_years(id),
  leave_type_id    uuid not null references public.timeoff_leave_types(id),
  staff_id         uuid references public.staff(id),
  worker_id        uuid references public.workers(id),
  location_id      uuid not null references public.locations(id),
  entitled_days    numeric(6,1) check (entitled_days is null or entitled_days >= 0),  -- null = the type's default
  carried_forward  numeric(6,1) not null default 0 check (carried_forward >= 0),
  opening_used     numeric(6,1) not null default 0 check (opening_used >= 0),          -- taken before this system
  reason           text not null check (btrim(reason) <> ''),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint timeoff_ent_person check (num_nonnulls(staff_id, worker_id) = 1)
);
create unique index if not exists uq_timeoff_ent
  on public.timeoff_entitlements (year_id, leave_type_id, coalesce(staff_id, worker_id));
drop trigger if exists trg_timeoff_ent_loc on public.timeoff_entitlements;
create trigger trg_timeoff_ent_loc before insert on public.timeoff_entitlements
  for each row execute function public.timeoff_stamp_location();
drop trigger if exists trg_timeoff_ent_updated on public.timeoff_entitlements;
create trigger trg_timeoff_ent_updated before update on public.timeoff_entitlements
  for each row execute function public.set_updated_at();

-- The adjustment audit (MyJKKN hr_leave_balance_adjustments): every change, append-only.
create table if not exists public.timeoff_entitlement_log (
  id               uuid primary key default gen_random_uuid(),
  entitlement_id   uuid not null,      -- no FK: a deleted override keeps its log
  location_id      uuid not null references public.locations(id),
  action           text not null check (action in ('insert', 'update', 'delete')),
  old_row          jsonb,
  new_row          jsonb,
  actor_id         uuid default auth.uid(),
  created_at       timestamptz not null default clock_timestamp()
);
create index if not exists idx_timeoff_ent_log on public.timeoff_entitlement_log (entitlement_id, created_at);

create or replace function public.timeoff_entitlement_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.timeoff_entitlement_log (entitlement_id, location_id, action, old_row, new_row)
  values (coalesce(new.id, old.id), coalesce(new.location_id, old.location_id), lower(tg_op),
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;
drop trigger if exists trg_timeoff_ent_audit on public.timeoff_entitlements;
create trigger trg_timeoff_ent_audit after insert or update or delete on public.timeoff_entitlements
  for each row execute function public.timeoff_entitlement_audit();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Encashment (MyJKKN §9 — a stub there; approved and paid here)
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_timeoff_encash;

create table if not exists public.timeoff_encashments (
  id               uuid primary key default gen_random_uuid(),
  code             text,
  staff_id         uuid references public.staff(id),
  worker_id        uuid references public.workers(id),
  location_id      uuid not null references public.locations(id),
  year_id          uuid not null references public.timeoff_years(id),
  leave_type_id    uuid not null references public.timeoff_leave_types(id),
  days             numeric(6,1) not null check (days > 0),
  rate_per_day     numeric(12,2) not null check (rate_per_day >= 0),
  amount           numeric(12,2) not null check (amount >= 0),
  reason           text not null check (btrim(reason) <> ''),
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'paid')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_remark  text,
  paid_by          uuid,
  paid_at          timestamptz,
  paid_ref         text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint timeoff_enc_person check (num_nonnulls(staff_id, worker_id) = 1)
);
drop trigger if exists trg_timeoff_enc_code on public.timeoff_encashments;
create trigger trg_timeoff_enc_code before insert on public.timeoff_encashments
  for each row execute function public.assign_code('ENC', 'public.seq_timeoff_encash');
drop trigger if exists trg_timeoff_enc_updated on public.timeoff_encashments;
create trigger trg_timeoff_enc_updated before update on public.timeoff_encashments
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Day counting (MyJKKN hr_calc_leave_days, §9.4)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hourly = 0 days (the minutes are the measure); half day = 0.5; a full-day
-- request counts each date, skipping Sundays when skip_weekends and Master Data
-- ▸ Holidays when skip_holidays. No sandwich rule (MyJKKN has none either).

create or replace function public.timeoff_count_days(p_type uuid, p_start date, p_end date, p_part text)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  t public.timeoff_leave_types;
  d date;
  n numeric := 0;
begin
  if p_part = 'hourly' then return 0; end if;
  select * into t from public.timeoff_leave_types where id = p_type;
  d := p_start;
  while d <= p_end loop
    if not (t.skip_weekends and extract(isodow from d) = 7)
       and not (t.skip_holidays and exists (
             select 1 from public.holidays h
              where d between h.holiday_date and coalesce(h.end_date, h.holiday_date))) then
      n := n + 1;
    end if;
    d := d + 1;
  end loop;
  if p_part in ('first_half', 'second_half') then
    return least(n, 0.5);
  end if;
  return n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Balances — derived, never stored (MyJKKN v_hr_leave_balance, §9.4)
-- ════════════════════════════════════════════════════════════════════════════
--
--   entitled  = override.entitled_days, else the type's default
--   accrued   = entitled (annual), or months elapsed × rate capped at entitled
--               (monthly), counted from the later of the year start and the
--               joining month up to p_as_of
--   used      = approved leave in the year + opening_used
--   pending   = leave still waiting for approval
--   encashed  = encashments pending, approved or paid
--   available = accrued + carried_forward − used − pending − encashed
--
-- WHO SEES WHAT: an HR viewer sees every person in the unit they are working
-- in; anyone else sees only their own staff row.

create or replace function public.timeoff_balance_sheet(
  p_year   uuid,
  p_staff  uuid default null,
  p_worker uuid default null,
  p_as_of  date default null)
returns table (
  person_kind     text,
  staff_id        uuid,
  worker_id       uuid,
  person_name     text,
  person_code     text,
  location_id     uuid,
  leave_type_id   uuid,
  leave_code      text,
  leave_name      text,
  entitled        numeric,
  accrued         numeric,
  carried         numeric,
  used            numeric,
  pending         numeric,
  encashed        numeric,
  available       numeric,
  has_override    boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  y        public.timeoff_years;
  v_mine   uuid := public.timeoff_my_staff_id();
  v_hr     boolean := public.has_permission('hr_payroll', 'view');
  v_loc    uuid := public.current_location();
  v_as_of  date;
begin
  select * into y from public.timeoff_years where id = p_year;
  if y.id is null then return; end if;
  v_as_of := least(greatest(coalesce(p_as_of, public.timeoff_today()), y.start_date), y.end_date);

  return query
  with people as (
    select 'staff'::text as kind, s.id as sid, null::uuid as wid, s.name, s.code, s.location_id,
           s.gender, s.joined_date
      from public.staff s
     where s.is_active
       and (p_worker is null)
       and (p_staff is null or s.id = p_staff)
       and ((v_hr and public.is_current_location(s.location_id)) or s.id = v_mine)
    union all
    select 'worker', null, w.id, w.name, w.code, w.location_id, w.gender, w.joined_date
      from public.workers w
     where w.is_active
       and (p_staff is null)
       and (p_worker is null or w.id = p_worker)
       and v_hr and public.is_current_location(w.location_id)
  ),
  grid as (
    select p.*, t.id as tid, t.code as tcode, t.name as tname, t.default_entitled_days,
           t.accrual_type, t.accrual_rate, t.sort_order,
           e.entitled_days as ov_entitled, coalesce(e.carried_forward, 0) as cf,
           coalesce(e.opening_used, 0) as opening, (e.id is not null) as has_ov
      from people p
      join public.timeoff_leave_types t
        on t.is_active and t.request_category = 'leave' and t.track_balance
       and (t.applies_to = 'both' or (t.applies_to = 'staff') = (p.kind = 'staff'))
       and (t.applicable_gender = 'any' or t.applicable_gender = p.gender)
      left join public.timeoff_entitlements e
        on e.year_id = y.id and e.leave_type_id = t.id
       and coalesce(e.staff_id, e.worker_id) = coalesce(p.sid, p.wid)
  ),
  figures as (
    select g.*,
           coalesce(g.ov_entitled, g.default_entitled_days) as ent,
           (select coalesce(sum(r.total_days), 0) from public.timeoff_requests r
             where r.year_id = y.id and r.leave_type_id = g.tid and r.status = 'approved'
               and coalesce(r.staff_id, r.worker_id) = coalesce(g.sid, g.wid)) as used_req,
           (select coalesce(sum(r.total_days), 0) from public.timeoff_requests r
             where r.year_id = y.id and r.leave_type_id = g.tid and r.status = 'pending'
               and coalesce(r.staff_id, r.worker_id) = coalesce(g.sid, g.wid)) as pend,
           (select coalesce(sum(x.days), 0) from public.timeoff_encashments x
             where x.year_id = y.id and x.leave_type_id = g.tid and x.status in ('pending', 'approved', 'paid')
               and coalesce(x.staff_id, x.worker_id) = coalesce(g.sid, g.wid)) as enc,
           -- months elapsed, inclusive, from the later of year start and joining month
           greatest(0,
             (extract(year from v_as_of)::int * 12 + extract(month from v_as_of)::int)
             - (extract(year from greatest(y.start_date, date_trunc('month', coalesce(g.joined_date, y.start_date))::date))::int * 12
                + extract(month from greatest(y.start_date, date_trunc('month', coalesce(g.joined_date, y.start_date))::date))::int)
             + 1) as months
      from grid g
  )
  select f.kind, f.sid, f.wid, f.name, f.code, f.location_id, f.tid, f.tcode, f.tname,
         f.ent,
         case when f.accrual_type = 'monthly'
              then least(f.ent, round(f.months * f.accrual_rate, 1))
              else f.ent end as accrued,
         f.cf,
         f.used_req + f.opening,
         f.pend,
         f.enc,
         (case when f.accrual_type = 'monthly'
               then least(f.ent, round(f.months * f.accrual_rate, 1))
               else f.ent end) + f.cf - f.used_req - f.opening - f.pend - f.enc,
         f.has_ov
    from figures f
   order by f.name, f.sort_order, f.tcode;
end $$;

-- The available comp-off credit for a booking from p_start to p_end:
-- approved, unconsumed, worked before the leave, not expired by its end,
-- less what pending comp-off bookings have already claimed.
create or replace function public.timeoff_comp_off_available(p_staff uuid, p_worker uuid, p_start date, p_end date)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(c.credit_days) from public.timeoff_comp_off_credits c
                    where coalesce(c.staff_id, c.worker_id) = coalesce(p_staff, p_worker)
                      and c.status = 'approved' and c.worked_date < p_start and c.expires_on >= p_end), 0)
       - coalesce((select sum(r.total_days) from public.timeoff_requests r
                    where coalesce(r.staff_id, r.worker_id) = coalesce(p_staff, p_worker)
                      and r.request_category = 'compensatory_off' and r.status = 'pending'), 0);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Apply (MyJKKN §9.2) — one statement: validate, insert, start the approval
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.timeoff_apply(
  p_staff_id      uuid,
  p_worker_id     uuid,
  p_leave_type_id uuid,
  p_start         date,
  p_end           date,
  p_day_part      text,
  p_start_time    time,
  p_end_time      time,
  p_reason        text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p        record;
  t        public.timeoff_leave_types;
  v_year   public.timeoff_years;
  v_self   boolean := p_staff_id is not null and p_staff_id = public.timeoff_my_staff_id();
  v_days   numeric;
  v_mins   int;
  v_part   text := coalesce(p_day_part, 'full');
  v_cap    numeric;
  v_avail  numeric;
  v_n      int;
  v_id     uuid;
  v_run    public.approval_runs;
  v_today  date := public.timeoff_today();
begin
  if num_nonnulls(p_staff_id, p_worker_id) <> 1 then
    raise exception 'Pick one staff member or worker' using errcode = '23514';
  end if;
  select * into p from public.timeoff_person(p_staff_id, p_worker_id);
  if p.name is null then
    raise exception 'Person not found' using errcode = '23503';
  end if;
  if not p.is_active then
    raise exception '% is inactive — leave cannot be applied for them', p.name using errcode = '23514';
  end if;
  if not public.timeoff_may_act_for(p_staff_id, p_worker_id, p.location_id, 'create') then
    raise exception 'You can apply only for yourself, or for people in the unit you are working in' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why — the reason is mandatory' using errcode = '23514';
  end if;

  select * into t from public.timeoff_leave_types where id = p_leave_type_id;
  if t.id is null or not t.is_active then
    raise exception 'That leave type is not available' using errcode = '23503';
  end if;
  if t.applies_to = 'staff' and p_staff_id is null or t.applies_to = 'workers' and p_worker_id is null then
    raise exception '% is not available to %', t.name,
      case when p_staff_id is null then 'workers' else 'staff' end using errcode = '23514';
  end if;
  if t.applicable_gender <> 'any' and coalesce(p.gender, '') <> t.applicable_gender then
    raise exception '% is only for % employees', t.name, lower(t.applicable_gender) using errcode = '23514';
  end if;

  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'The To date cannot be before the From date' using errcode = '23514';
  end if;

  -- shape of the request
  if t.request_category = 'short_time_off' then
    v_part := 'hourly';
    if p_start <> p_end then
      raise exception 'A permission is for one day' using errcode = '23514';
    end if;
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'Enter the From and To time — To must be after From' using errcode = '23514';
    end if;
    v_mins := (extract(epoch from (p_end_time - p_start_time)) / 60)::int;
    if t.sto_min_minutes is not null and v_mins < t.sto_min_minutes then
      raise exception 'A % must be at least % minutes', lower(t.name), t.sto_min_minutes using errcode = '23514';
    end if;
    if t.sto_max_minutes is not null and v_mins > t.sto_max_minutes then
      raise exception 'A % can be at most % minutes', lower(t.name), t.sto_max_minutes using errcode = '23514';
    end if;
  else
    if v_part not in ('full', 'first_half', 'second_half') then
      raise exception 'Pick full day or a half' using errcode = '23514';
    end if;
    if v_part <> 'full' then
      if not t.allow_half_day then
        raise exception '% cannot be taken as a half day', t.name using errcode = '23514';
      end if;
      if p_start <> p_end then
        raise exception 'A half day is for one date' using errcode = '23514';
      end if;
    end if;
  end if;

  -- leave year
  select * into v_year from public.timeoff_years where id = public.timeoff_year_of(p_start);
  if v_year.id is null then
    raise exception 'No leave year covers %. Add one on Time Off ▸ Leave Setup', to_char(p_start, 'DD/MM/YYYY')
      using errcode = '23503';
  end if;
  if v_year.is_closed then
    raise exception 'Leave year % is closed', v_year.name using errcode = '55000';
  end if;
  if p_end > v_year.end_date then
    raise exception 'A request cannot cross the end of leave year % (%) — split it in two',
      v_year.name, to_char(v_year.end_date, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  -- 1. blackout
  if exists (select 1 from public.timeoff_blackouts b
              where daterange(b.start_date, b.end_date, '[]') && daterange(p_start, p_end, '[]')
                and (b.leave_type_id is null or b.leave_type_id = t.id)
                and (b.location_id is null or b.location_id = p.location_id)) then
    raise exception 'These dates fall in a blackout period — no leave can be taken then' using errcode = '23514';
  end if;

  -- 2. notice (asked of the applicant; HR recording leave for someone else is not refused)
  if v_self and t.min_advance_notice_days > 0 and p_start < v_today + t.min_advance_notice_days then
    raise exception '% needs % day(s) notice — the earliest From date is %', t.name, t.min_advance_notice_days,
      to_char(v_today + t.min_advance_notice_days, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  -- 3. days
  v_days := public.timeoff_count_days(t.id, p_start, p_end, v_part);
  if t.request_category <> 'short_time_off' and v_days <= 0 then
    raise exception 'Every date in that range is a Sunday or a holiday — nothing to apply for' using errcode = '23514';
  end if;
  if t.max_continuous_days is not null and v_days > t.max_continuous_days then
    raise exception '% can be taken for at most % days at a time', t.name, t.max_continuous_days using errcode = '23514';
  end if;

  -- 4. overlap: one live request per person per day. Two halves of one day, or
  --    two permission windows that do not touch, may share it.
  if exists (
    select 1 from public.timeoff_requests r
     where coalesce(r.staff_id, r.worker_id) = coalesce(p_staff_id, p_worker_id)
       and r.status in ('pending', 'approved')
       and daterange(r.start_date, r.end_date, '[]') && daterange(p_start, p_end, '[]')
       and not (
         r.start_date = r.end_date and p_start = p_end and (
              (r.day_part = 'first_half'  and v_part = 'second_half')
           or (r.day_part = 'second_half' and v_part = 'first_half')
           or (r.day_part = 'hourly' and v_part = 'hourly'
               and (r.end_time <= p_start_time or p_end_time <= r.start_time))
           or (r.day_part = 'hourly' and v_part in ('first_half', 'second_half'))
           or (r.day_part in ('first_half', 'second_half') and v_part = 'hourly')))
  ) then
    raise exception 'There is already a pending or approved request on these dates' using errcode = '23P01';
  end if;

  -- 5. period cap
  if t.request_category = 'leave' and t.limit_period <> 'none' then
    select coalesce(sum(r.total_days), 0) into v_cap
      from public.timeoff_requests r
     where coalesce(r.staff_id, r.worker_id) = coalesce(p_staff_id, p_worker_id)
       and r.leave_type_id = t.id and r.status in ('pending', 'approved')
       and case t.limit_period
             when 'month' then date_trunc('month', r.start_date) = date_trunc('month', p_start)
             else r.year_id = v_year.id end;
    if v_cap + v_days > t.max_days_per_period then
      raise exception '% is limited to % day(s) a %; % already taken or pending', t.name,
        t.max_days_per_period, t.limit_period, v_cap using errcode = '23514';
    end if;
  end if;

  -- 6. balance / credits / permission limits
  if t.request_category = 'leave' and t.track_balance then
    select b.available into v_avail
      from public.timeoff_balance_sheet(v_year.id, p_staff_id, p_worker_id, p_end) b
     where b.leave_type_id = t.id;
    if coalesce(v_avail, 0) < v_days then
      raise exception 'Not enough % — % day(s) available, % asked', t.name, coalesce(v_avail, 0), v_days
        using errcode = '23514';
    end if;
  elsif t.request_category = 'compensatory_off' then
    v_avail := public.timeoff_comp_off_available(p_staff_id, p_worker_id, p_start, p_end);
    if v_avail < v_days then
      raise exception 'Not enough comp-off credit — % day(s) usable for these dates, % asked', v_avail, v_days
        using errcode = '23514';
    end if;
  elsif t.request_category = 'short_time_off' and t.sto_limit_mode <> 'none' then
    select count(*), coalesce(sum(r.duration_minutes), 0) into v_n, v_cap
      from public.timeoff_requests r
     where coalesce(r.staff_id, r.worker_id) = coalesce(p_staff_id, p_worker_id)
       and r.leave_type_id = t.id and r.status in ('pending', 'approved')
       and case t.sto_limit_period
             when 'month' then date_trunc('month', r.start_date) = date_trunc('month', p_start)
             else r.year_id = v_year.id end;
    if t.sto_limit_mode = 'count' and v_n + 1 > t.sto_max_requests then
      raise exception 'Only % % allowed a % — % already taken or pending', t.sto_max_requests, lower(t.name),
        t.sto_limit_period, v_n using errcode = '23514';
    end if;
    if t.sto_limit_mode = 'minutes' and v_cap + v_mins > t.sto_total_minutes then
      raise exception 'Only % minutes of % allowed a % — % already used or pending', t.sto_total_minutes,
        lower(t.name), t.sto_limit_period, v_cap using errcode = '23514';
    end if;
  end if;

  insert into public.timeoff_requests
    (staff_id, worker_id, location_id, leave_type_id, year_id, request_category, start_date, end_date,
     day_part, start_time, end_time, total_days, duration_minutes, reason)
  values
    (p_staff_id, p_worker_id, p.location_id, t.id, v_year.id, t.request_category, p_start, p_end,
     v_part, case when v_part = 'hourly' then p_start_time end, case when v_part = 'hourly' then p_end_time end,
     v_days, v_mins, upper(btrim(p_reason)))
  returning id into v_id;

  v_run := public.approval_start_run(
    'timeoff_request',
    'timeoff_requests',
    v_id,
    jsonb_build_object(
      'person_name', p.name,
      'person_kind', case when p_staff_id is null then 'worker' else 'staff' end,
      'leave_type_code', t.code,
      'leave_type', t.name,
      'request_category', t.request_category,
      'start_date', p_start,
      'end_date', p_end,
      'total_days', v_days,
      'duration_minutes', v_mins),
    jsonb_build_object('location_id', p.location_id),
    null,
    auth.uid());
  return v_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. The decision (called from approval_apply_terminal)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.timeoff_request_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r       public.timeoff_requests;
  t       public.timeoff_leave_types;
  v_avail numeric;
  v_need  numeric;
  c       record;
begin
  select * into r from public.timeoff_requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then
    raise exception 'Request % is not awaiting a decision — reload, it may already have been decided', p_id
      using errcode = '55000';
  end if;
  select * into t from public.timeoff_leave_types where id = r.leave_type_id;

  if p_run_status = 'completed' then
    -- Re-check what may have moved since the request was made. Pending days are
    -- already inside `available`, so a request that still fits leaves it ≥ 0.
    if r.request_category = 'leave' and t.track_balance then
      select b.available into v_avail
        from public.timeoff_balance_sheet(r.year_id, r.staff_id, r.worker_id, r.end_date) b
       where b.leave_type_id = r.leave_type_id;
      if coalesce(v_avail, 0) < 0 then
        raise exception 'Not enough % left to approve this — the balance changed after it was applied for', t.name
          using errcode = '23514';
      end if;
    elsif r.request_category = 'compensatory_off' then
      -- consume credits, earliest expiry first
      v_need := r.total_days;
      for c in
        select id, credit_days from public.timeoff_comp_off_credits
         where coalesce(staff_id, worker_id) = coalesce(r.staff_id, r.worker_id)
           and status = 'approved' and worked_date < r.start_date and expires_on >= r.end_date
         order by expires_on, worked_date
         for update
      loop
        exit when v_need <= 0;
        update public.timeoff_comp_off_credits set status = 'consumed', consumed_by = r.id where id = c.id;
        v_need := v_need - c.credit_days;
      end loop;
      if v_need > 0 then
        raise exception 'Not enough comp-off credit left to approve this booking' using errcode = '23514';
      end if;
    end if;
    update public.timeoff_requests
       set status = 'approved', decided_by = p_actor, decided_at = p_at, decision_remark = p_remark
     where id = r.id;

  elsif p_run_status = 'rejected' then
    update public.timeoff_requests
       set status = 'rejected', decided_by = p_actor, decided_at = p_at, decision_remark = p_remark
     where id = r.id;

  elsif p_run_status = 'cancelled' then
    update public.timeoff_requests
       set status = 'withdrawn', decided_by = coalesce(auth.uid(), p_actor), decided_at = p_at,
           decision_remark = p_remark
     where id = r.id;
  end if;
end $$;

create or replace function public.timeoff_encashment_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x       public.timeoff_encashments;
  v_avail numeric;
begin
  select * into x from public.timeoff_encashments where id = p_id for update;
  if x.id is null or x.status <> 'pending' then
    raise exception 'Encashment % is not awaiting a decision — reload', p_id using errcode = '55000';
  end if;
  if p_run_status = 'completed' then
    select b.available into v_avail
      from public.timeoff_balance_sheet(x.year_id, x.staff_id, x.worker_id, null) b
     where b.leave_type_id = x.leave_type_id;
    if coalesce(v_avail, 0) < 0 then
      raise exception 'The leave balance no longer covers this encashment' using errcode = '23514';
    end if;
    update public.timeoff_encashments
       set status = 'approved', decided_by = p_actor, decided_at = p_at, decision_remark = p_remark where id = x.id;
  elsif p_run_status = 'rejected' then
    update public.timeoff_encashments
       set status = 'rejected', decided_by = p_actor, decided_at = p_at, decision_remark = p_remark where id = x.id;
  elsif p_run_status = 'cancelled' then
    update public.timeoff_encashments
       set status = 'withdrawn', decided_by = coalesce(auth.uid(), p_actor), decided_at = p_at,
           decision_remark = p_remark where id = x.id;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. Withdraw (pending), cancel (own approved, future) and revoke (HR)
-- ════════════════════════════════════════════════════════════════════════════

-- Withdraw a pending request or encashment by cancelling its run. Written out
-- here rather than calling approval_cancel because that one admits only the
-- run's requester — and a staff member must be able to withdraw a leave HR
-- typed in for them. The terminal trigger turns the cancel into `withdrawn`.
create or replace function public.timeoff_withdraw(p_table text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_staff  uuid;
  v_worker uuid;
  v_loc    uuid;
  v_status text;
  v_run    public.approval_runs;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why it is being withdrawn' using errcode = '23514';
  end if;
  if p_table = 'timeoff_requests' then
    select staff_id, worker_id, location_id, status into v_staff, v_worker, v_loc, v_status
      from public.timeoff_requests where id = p_id;
  elsif p_table = 'timeoff_encashments' then
    select staff_id, worker_id, location_id, status into v_staff, v_worker, v_loc, v_status
      from public.timeoff_encashments where id = p_id;
  else
    raise exception 'Unknown time-off document' using errcode = '22023';
  end if;
  if v_status is null then
    raise exception 'Not found' using errcode = '23503';
  end if;
  if not public.timeoff_may_act_for(v_staff, v_worker, v_loc, 'edit') then
    raise exception 'You can withdraw only your own requests, or those in the unit you are working in'
      using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'Only a pending request can be withdrawn (this one is %)', v_status using errcode = '55000';
  end if;

  select * into v_run from public.approval_runs
   where subject_table = p_table and subject_id = p_id and status = 'in_progress'
   order by started_at desc limit 1
   for update;
  if v_run.id is null then
    raise exception 'This has no open approval to withdraw — reload' using errcode = '55000';
  end if;

  insert into public.approval_run_events (run_id, step_order, action, actor_id, comment)
  values (v_run.id, v_run.current_step, 'cancel', auth.uid(), upper(btrim(p_reason)));
  update public.approval_runs
     set status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
   where id = v_run.id;
end $$;

-- Cancel an APPROVED request that has not started yet: the owner, or HR.
-- Revoke an approved request (already started or not): HR only, reason
-- mandatory. Either way its days return to the balance by construction and a
-- comp-off booking gives its credits back.
create or replace function public.timeoff_close_approved(p_id uuid, p_mode text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.timeoff_requests;
begin
  if p_mode not in ('cancel', 'revoke') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why' using errcode = '23514';
  end if;
  select * into r from public.timeoff_requests where id = p_id for update;
  if r.id is null then
    raise exception 'Request not found' using errcode = '23503';
  end if;
  if r.status <> 'approved' then
    raise exception 'Only an approved request can be %', case p_mode when 'cancel' then 'cancelled' else 'revoked' end
      using errcode = '55000';
  end if;
  if exists (select 1 from public.timeoff_years y where y.id = r.year_id and y.is_closed) then
    raise exception 'Its leave year is closed' using errcode = '55000';
  end if;

  if p_mode = 'cancel' then
    if not public.timeoff_may_act_for(r.staff_id, r.worker_id, r.location_id, 'edit') then
      raise exception 'You can cancel only your own leave, or leave in the unit you are working in' using errcode = '42501';
    end if;
    if r.start_date <= public.timeoff_today() then
      raise exception 'This leave has already started — ask HR to revoke it instead' using errcode = '55000';
    end if;
  else
    if not (public.has_permission('hr_payroll', 'edit') and public.is_current_location(r.location_id)) then
      raise exception 'Only HR can revoke an approved leave' using errcode = '42501';
    end if;
  end if;

  update public.timeoff_comp_off_credits
     set status = 'approved', consumed_by = null
   where consumed_by = r.id;

  update public.timeoff_requests
     set status = case p_mode when 'cancel' then 'cancelled' else 'revoked' end,
         closed_by = auth.uid(), closed_at = now(), close_reason = upper(btrim(p_reason))
   where id = r.id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. Comp-off claims and decisions (MyJKKN §9.6 — decided by HR, no chain)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.timeoff_claim_comp_off(
  p_staff_id uuid, p_worker_id uuid, p_dates date[], p_credit numeric, p_reason text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  p       record;
  d       date;
  v_n     int := 0;
  v_today date := public.timeoff_today();
begin
  if num_nonnulls(p_staff_id, p_worker_id) <> 1 then
    raise exception 'Pick one staff member or worker' using errcode = '23514';
  end if;
  select * into p from public.timeoff_person(p_staff_id, p_worker_id);
  if p.name is null then raise exception 'Person not found' using errcode = '23503'; end if;
  if not public.timeoff_may_act_for(p_staff_id, p_worker_id, p.location_id, 'create') then
    raise exception 'You can claim only for yourself, or for people in the unit you are working in' using errcode = '42501';
  end if;
  if coalesce(array_length(p_dates, 1), 0) = 0 then
    raise exception 'Pick at least one worked date' using errcode = '23514';
  end if;
  if array_length(p_dates, 1) > 31 then
    raise exception 'At most 31 dates in one claim' using errcode = '23514';
  end if;
  if coalesce(p_credit, 0) not in (0.5, 1) then
    raise exception 'Credit is a full day or a half day' using errcode = '23514';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say what the work was — the reason is mandatory' using errcode = '23514';
  end if;

  foreach d in array p_dates loop
    if d > v_today then
      raise exception '% is in the future — a credit is claimed for a day already worked', to_char(d, 'DD/MM/YYYY')
        using errcode = '23514';
    end if;
    if (d + interval '1 month')::date < v_today then
      raise exception 'A credit for % would already have expired (a month after the day worked)', to_char(d, 'DD/MM/YYYY')
        using errcode = '23514';
    end if;
    if exists (select 1 from public.timeoff_comp_off_credits c
                where coalesce(c.staff_id, c.worker_id) = coalesce(p_staff_id, p_worker_id)
                  and c.worked_date = d and c.status in ('pending', 'approved', 'consumed')) then
      raise exception 'There is already a credit for %', to_char(d, 'DD/MM/YYYY') using errcode = '23505';
    end if;
    insert into public.timeoff_comp_off_credits
      (staff_id, worker_id, location_id, worked_date, credit_days, reason, had_punch, expires_on)
    values
      (p_staff_id, p_worker_id, p.location_id, d, p_credit, upper(btrim(p_reason)),
       p.biometric_id is not null and exists (
         select 1 from public.punches x
          where x.user_id = p.biometric_id
            and (x.punch_time at time zone 'Asia/Kolkata')::date = d),
       (d + interval '1 month')::date);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Approve / reject pending claims, or withdraw one's own. HR may not decide
-- a claim on their own staff record.
create or replace function public.timeoff_decide_comp_off(p_ids uuid[], p_decision text, p_remark text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  c      public.timeoff_comp_off_credits;
  v_mine uuid := public.timeoff_my_staff_id();
  v_n    int := 0;
begin
  if p_decision not in ('approved', 'rejected', 'withdrawn') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and btrim(coalesce(p_remark, '')) = '' then
    raise exception 'Say why the claim is rejected' using errcode = '23514';
  end if;
  for c in select * from public.timeoff_comp_off_credits where id = any(p_ids) for update loop
    if c.status <> 'pending' then
      raise exception 'Claim % is already %', c.code, c.status using errcode = '55000';
    end if;
    if p_decision = 'withdrawn' then
      if not public.timeoff_may_act_for(c.staff_id, c.worker_id, c.location_id, 'edit') then
        raise exception 'You can withdraw only your own claims' using errcode = '42501';
      end if;
    else
      if not (public.has_permission('hr_payroll', 'edit') and public.is_current_location(c.location_id)) then
        raise exception 'Only HR in this unit can decide comp-off claims' using errcode = '42501';
      end if;
      if c.staff_id is not null and c.staff_id = v_mine then
        raise exception 'You cannot decide your own claim' using errcode = '42501';
      end if;
      if p_decision = 'approved' and c.expires_on < public.timeoff_today() then
        raise exception 'Claim % has expired — it can only be rejected', c.code using errcode = '55000';
      end if;
    end if;
    update public.timeoff_comp_off_credits
       set status = p_decision, decided_by = auth.uid(), decided_at = now(),
           decision_remark = nullif(upper(btrim(coalesce(p_remark, ''))), '')
     where id = c.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 14. Encashment request + mark paid
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.timeoff_request_encashment(
  p_staff_id uuid, p_worker_id uuid, p_leave_type_id uuid, p_days numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p       record;
  t       public.timeoff_leave_types;
  v_year  uuid := public.timeoff_year_of(public.timeoff_today());
  v_avail numeric;
  v_done  numeric;
  v_id    uuid;
begin
  if num_nonnulls(p_staff_id, p_worker_id) <> 1 then
    raise exception 'Pick one staff member or worker' using errcode = '23514';
  end if;
  select * into p from public.timeoff_person(p_staff_id, p_worker_id);
  if p.name is null then raise exception 'Person not found' using errcode = '23503'; end if;
  if not public.timeoff_may_act_for(p_staff_id, p_worker_id, p.location_id, 'create') then
    raise exception 'You can request only for yourself, or for people in the unit you are working in' using errcode = '42501';
  end if;
  if v_year is null then
    raise exception 'No leave year covers today' using errcode = '23503';
  end if;
  select * into t from public.timeoff_leave_types where id = p_leave_type_id;
  if t.id is null or not t.is_encashable then
    raise exception 'That leave type cannot be encashed' using errcode = '23514';
  end if;
  if coalesce(p_days, 0) <= 0 then
    raise exception 'Enter the days to encash' using errcode = '23514';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'The reason is mandatory' using errcode = '23514';
  end if;
  select coalesce(sum(days), 0) into v_done from public.timeoff_encashments
   where coalesce(staff_id, worker_id) = coalesce(p_staff_id, p_worker_id)
     and year_id = v_year and leave_type_id = t.id and status in ('pending', 'approved', 'paid');
  if t.max_encashable_days is not null and v_done + p_days > t.max_encashable_days then
    raise exception 'At most % day(s) of % can be encashed a year; % already requested', t.max_encashable_days,
      t.name, v_done using errcode = '23514';
  end if;
  select b.available into v_avail
    from public.timeoff_balance_sheet(v_year, p_staff_id, p_worker_id, null) b where b.leave_type_id = t.id;
  if coalesce(v_avail, 0) < p_days then
    raise exception 'Only % day(s) of % available', coalesce(v_avail, 0), t.name using errcode = '23514';
  end if;

  insert into public.timeoff_encashments
    (staff_id, worker_id, location_id, year_id, leave_type_id, days, rate_per_day, amount, reason)
  values
    (p_staff_id, p_worker_id, p.location_id, v_year, t.id, p_days, p.day_rate, round(p_days * p.day_rate, 2),
     upper(btrim(p_reason)))
  returning id into v_id;

  perform public.approval_start_run(
    'timeoff_encashment', 'timeoff_encashments', v_id,
    jsonb_build_object('person_name', p.name, 'leave_type', t.name, 'days', p_days,
                       'amount', round(p_days * p.day_rate, 2)),
    jsonb_build_object('location_id', p.location_id), null, auth.uid());
  return v_id;
end $$;

create or replace function public.timeoff_mark_encashment_paid(p_id uuid, p_ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x public.timeoff_encashments;
begin
  select * into x from public.timeoff_encashments where id = p_id for update;
  if x.id is null then raise exception 'Not found' using errcode = '23503'; end if;
  if not (public.has_permission('hr_payroll', 'edit') and public.is_current_location(x.location_id)) then
    raise exception 'Only HR in this unit can mark an encashment paid' using errcode = '42501';
  end if;
  if x.status <> 'approved' then
    raise exception 'Only an approved encashment can be marked paid' using errcode = '55000';
  end if;
  update public.timeoff_encashments
     set status = 'paid', paid_by = auth.uid(), paid_at = now(), paid_ref = nullif(upper(btrim(coalesce(p_ref, ''))), '')
   where id = x.id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 15. Engine wiring — terminal branches + default flows
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''timeoff_requests'' then\n'
                || E'        perform public.timeoff_request_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark, coalesce(new.completed_at, now()));\n'
                || E'        return new;\n'
                || E'    end if;\n\n'
                || E'    if new.subject_table = ''timeoff_encashments'' then\n'
                || E'        perform public.timeoff_encashment_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark, coalesce(new.completed_at, now()));\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''timeoff_requests''' in v_def) > 0 then
    return;  -- already there (a re-run)
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0770: approval_apply_terminal''s final refusal was not found — add the timeoff branches by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

-- Catch-all flows, copied from the staff fine's so an approver resolves on day
-- one (MD or HR Manager). Admin ▸ Approval Flows changes who approves, and can
-- add narrower flows by leave_type_code / request_category / person_kind.
insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'timeoff_request', 'Time Off — default',
       'Catch-all. Every leave, permission and comp-off booking goes to the Managing Director or an HR Manager.',
       '{}'::jsonb, f.steps, 900, true
  from public.approval_flows f
 where f.workflow_key = 'hr_fine' and f.flow_name = 'HR Fine — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'timeoff_request');

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'timeoff_encashment', 'Leave Encashment — default',
       'Catch-all. Every leave encashment goes to the Managing Director or an HR Manager.',
       '{}'::jsonb, f.steps, 900, true
  from public.approval_flows f
 where f.workflow_key = 'hr_fine' and f.flow_name = 'HR Fine — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'timeoff_encashment');

-- If the fine's flow was renamed, the copies above found nothing: seed the same
-- one step literally rather than leave every apply refused with "no flow".
insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select k.key, k.flow_name, k.descr, '{}'::jsonb,
       '[{"step_order":1,"step_type":"final","step_label":"MD / HR Manager","approver_resolver":"md_or_hr_manager"}]'::jsonb,
       900, true
  from (values
    ('timeoff_request',    'Time Off — default',          'Catch-all. Every leave, permission and comp-off booking goes to the Managing Director or an HR Manager.'),
    ('timeoff_encashment', 'Leave Encashment — default',  'Catch-all. Every leave encashment goes to the Managing Director or an HR Manager.')
  ) as k(key, flow_name, descr)
 where not exists (select 1 from public.approval_flows x where x.workflow_key = k.key);

-- ════════════════════════════════════════════════════════════════════════════
-- 16. RLS + grants
-- ════════════════════════════════════════════════════════════════════════════

alter table public.timeoff_years            enable row level security;
alter table public.timeoff_leave_types      enable row level security;
alter table public.timeoff_blackouts        enable row level security;
alter table public.timeoff_requests         enable row level security;
alter table public.timeoff_comp_off_credits enable row level security;
alter table public.timeoff_entitlements     enable row level security;
alter table public.timeoff_entitlement_log  enable row level security;
alter table public.timeoff_encashments      enable row level security;

-- Shared catalogs: anyone who may open HR reads them; HR edits them.
drop policy if exists timeoff_years_read  on public.timeoff_years;
drop policy if exists timeoff_years_write on public.timeoff_years;
create policy timeoff_years_read  on public.timeoff_years for select using (public.has_permission('hr_payroll', 'view'));
create policy timeoff_years_write on public.timeoff_years for all
  using (public.has_permission('hr_payroll', 'edit')) with check (public.has_permission('hr_payroll', 'edit'));

drop policy if exists timeoff_types_read  on public.timeoff_leave_types;
drop policy if exists timeoff_types_write on public.timeoff_leave_types;
create policy timeoff_types_read  on public.timeoff_leave_types for select using (public.has_permission('hr_payroll', 'view'));
create policy timeoff_types_write on public.timeoff_leave_types for all
  using (public.has_permission('hr_payroll', 'edit')) with check (public.has_permission('hr_payroll', 'edit'));

-- Blackouts: unit-wide (location_id null) or the current unit.
drop policy if exists timeoff_blackouts_read  on public.timeoff_blackouts;
drop policy if exists timeoff_blackouts_write on public.timeoff_blackouts;
create policy timeoff_blackouts_read on public.timeoff_blackouts for select
  using (public.has_permission('hr_payroll', 'view') and (location_id is null or public.is_current_location(location_id)));
create policy timeoff_blackouts_write on public.timeoff_blackouts for all
  using (public.has_permission('hr_payroll', 'edit') and (location_id is null or public.is_current_location(location_id)))
  with check (public.has_permission('hr_payroll', 'edit') and (location_id is null or public.is_current_location(location_id)));

-- Person documents: HR reads the current unit; a staff member reads their own.
-- Writes go only through the functions above.
drop policy if exists timeoff_requests_read on public.timeoff_requests;
create policy timeoff_requests_read on public.timeoff_requests for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));

drop policy if exists timeoff_co_read on public.timeoff_comp_off_credits;
create policy timeoff_co_read on public.timeoff_comp_off_credits for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));

drop policy if exists timeoff_enc_read on public.timeoff_encashments;
create policy timeoff_enc_read on public.timeoff_encashments for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));

drop policy if exists timeoff_ent_read  on public.timeoff_entitlements;
drop policy if exists timeoff_ent_write on public.timeoff_entitlements;
create policy timeoff_ent_read on public.timeoff_entitlements for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));
create policy timeoff_ent_write on public.timeoff_entitlements for all
  using (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id));

drop policy if exists timeoff_ent_log_read on public.timeoff_entitlement_log;
create policy timeoff_ent_log_read on public.timeoff_entitlement_log for select
  using (public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id));

revoke insert, update, delete on public.timeoff_requests         from anon, authenticated;
revoke insert, update, delete on public.timeoff_comp_off_credits from anon, authenticated;
revoke insert, update, delete on public.timeoff_encashments      from anon, authenticated;
revoke insert, update, delete on public.timeoff_entitlement_log  from anon, authenticated;

revoke all on function public.timeoff_today()                                                   from public, anon;
revoke all on function public.timeoff_my_staff_id()                                             from public, anon;
revoke all on function public.timeoff_person(uuid, uuid)                                        from public, anon, authenticated;
revoke all on function public.timeoff_may_act_for(uuid, uuid, uuid, text)                       from public, anon, authenticated;
revoke all on function public.timeoff_stamp_location()                                          from public, anon;
revoke all on function public.timeoff_years_no_overlap()                                        from public, anon;
revoke all on function public.timeoff_year_of(date)                                             from public, anon;
revoke all on function public.timeoff_count_days(uuid, date, date, text)                        from public, anon;
revoke all on function public.timeoff_balance_sheet(uuid, uuid, uuid, date)                     from public, anon;
revoke all on function public.timeoff_comp_off_available(uuid, uuid, date, date)                from public, anon;
revoke all on function public.timeoff_apply(uuid, uuid, uuid, date, date, text, time, time, text) from public, anon;
revoke all on function public.timeoff_request_apply_decision(uuid, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.timeoff_encashment_apply_decision(uuid, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.timeoff_withdraw(text, uuid, text)                                from public, anon;
revoke all on function public.timeoff_close_approved(uuid, text, text)                          from public, anon;
revoke all on function public.timeoff_claim_comp_off(uuid, uuid, date[], numeric, text)         from public, anon;
revoke all on function public.timeoff_decide_comp_off(uuid[], text, text)                       from public, anon;
revoke all on function public.timeoff_request_encashment(uuid, uuid, uuid, numeric, text)       from public, anon;
revoke all on function public.timeoff_mark_encashment_paid(uuid, text)                          from public, anon;
revoke all on function public.timeoff_entitlement_audit()                                       from public, anon;
revoke all on function public.approval_apply_terminal()                                         from public, anon;

grant execute on function public.timeoff_today()                                                   to authenticated;
grant execute on function public.timeoff_my_staff_id()                                             to authenticated;
grant execute on function public.timeoff_year_of(date)                                             to authenticated;
grant execute on function public.timeoff_count_days(uuid, date, date, text)                        to authenticated;
grant execute on function public.timeoff_balance_sheet(uuid, uuid, uuid, date)                     to authenticated;
grant execute on function public.timeoff_comp_off_available(uuid, uuid, date, date)                to authenticated;
grant execute on function public.timeoff_apply(uuid, uuid, uuid, date, date, text, time, time, text) to authenticated;
grant execute on function public.timeoff_withdraw(text, uuid, text)                                to authenticated;
grant execute on function public.timeoff_close_approved(uuid, text, text)                          to authenticated;
grant execute on function public.timeoff_claim_comp_off(uuid, uuid, date[], numeric, text)         to authenticated;
grant execute on function public.timeoff_decide_comp_off(uuid[], text, text)                       to authenticated;
grant execute on function public.timeoff_request_encashment(uuid, uuid, uuid, numeric, text)       to authenticated;
grant execute on function public.timeoff_mark_encashment_paid(uuid, text)                          to authenticated;
