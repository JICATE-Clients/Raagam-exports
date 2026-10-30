-- ============================================================================
-- Raagam ERP — 0764 HR ▸ Timing Groups: Staff · Security · Production Staff
--
-- Client 2026-10-28: every employee category belongs to ONE of three fixed
-- timing groups, and a group is what fixes the working day — Punch In, Punch
-- Out and a grace allowance, nothing else. "Male Staff" and "Female Staff" are
-- two categories and one group (Staff), because they keep the same hours.
--
-- Two halves:
--   1. `employee_categories.timing_group` — the fixed three, as a CHECK, not a
--      lookup table. The set is the client's rule, not data an operator grows;
--      a fourth group is a decision, so it is a migration.
--   2. `hr_group_timings` — the hours, dated. A change of hours is a NEW row
--      on a later `effective_from`, so attendance for a past day is judged
--      against the hours that were in force that day, not today's.
--
-- Out earlier than In means the next morning (a Security night shift,
-- 20:00 → 08:00). Nothing stores that; it is read from the two times.
--
-- Only In and Out are fixed. Every punch between them is still stored in
-- `punches` and shown on Live Punches and the HR dashboard — it is simply not
-- compared against a time.
--
-- The old `work_timings` / `working_hours` tables are left untouched (they hold
-- only test rows); the Work Timing screen now edits this table instead.
-- RLS = masters (read open to authenticated, write gated by
-- has_permission('masters', …)), the same as every HR master.
-- ============================================================================

alter table public.employee_categories
  add column if not exists timing_group text
    check (timing_group in ('staff', 'security', 'production_staff'));

comment on column public.employee_categories.timing_group is
  'Which of the three fixed timing groups this category keeps the hours of '
  '(0764). Hours live in hr_group_timings, keyed by the group.';

-- The three categories that already exist ARE the three groups.
update public.employee_categories
   set timing_group = case upper(trim(name))
                        when 'STAFF'            then 'staff'
                        when 'SECURITY'         then 'security'
                        when 'PRODUCTION STAFF' then 'production_staff'
                      end
 where timing_group is null
   and upper(trim(name)) in ('STAFF', 'SECURITY', 'PRODUCTION STAFF');

create table if not exists public.hr_group_timings (
  id             uuid primary key default gen_random_uuid(),
  timing_group   text not null
                   check (timing_group in ('staff', 'security', 'production_staff')),
  in_time        time not null,
  out_time       time not null,
  grace_minutes  integer not null default 0
                   check (grace_minutes between 0 and 180),
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  constraint hr_group_timings_in_ne_out check (in_time <> out_time),
  unique (timing_group, effective_from)
);

create trigger trg_hr_group_timings_updated before update on public.hr_group_timings
  for each row execute function public.set_updated_at();

alter table public.hr_group_timings enable row level security;

create policy hr_group_timings_read on public.hr_group_timings
  for select to authenticated using (true);
create policy hr_group_timings_insert on public.hr_group_timings
  for insert to authenticated with check (public.has_permission('masters', 'create'));
create policy hr_group_timings_update on public.hr_group_timings
  for update to authenticated
  using (public.has_permission('masters', 'edit'))
  with check (public.has_permission('masters', 'edit'));
create policy hr_group_timings_delete on public.hr_group_timings
  for delete to authenticated using (public.has_permission('masters', 'delete'));

-- ----------------------------------------------------------------------------
-- hr_attendance_trend(p_days) — present / late per day per group, counted IN
-- THE DATABASE. A week of punches for ~1,800 people is ~50k rows, far past
-- what one PostgREST read returns, so the HR dashboard asks for the answer
-- rather than the rows.
--
-- THE SHIFT DAY, the one rule the dashboard's TypeScript twin
-- (`lib/hr/timing-calc.ts`) also follows: a group's day D runs from
-- (D + in_time − 4 h) for 24 hours, in IST. So Staff at 09:00 owns punches from
-- 05:00 to 05:00, and Security at 20:00 owns 16:00 → 16:00 — the 08:00 punch
-- the next morning is the END of D, not the start of D+1. Late = the first
-- punch of the day after (D + in_time + grace). A group with no hours set yet
-- falls back to the calendar day and is never late.
--
-- SECURITY INVOKER: staff, workers and punches answer through the caller's
-- own RLS (hr_payroll view, allocated units only), exactly as the screens do.
-- ----------------------------------------------------------------------------
create or replace function public.hr_attendance_trend(p_days integer default 7)
returns table (
  day           date,
  timing_group  text,
  enrolled      integer,
  present       integer,
  late          integer
)
language sql
stable
security invoker
set search_path to ''
as $f$
  with people as (
    select trim(s.biometric_id) as bio, c.timing_group
      from public.staff s
      join public.employee_categories c on c.id = s.category_id
     where s.is_active and s.biometric_id is not null and trim(s.biometric_id) <> ''
       and c.timing_group is not null
    union
    select trim(w.biometric_id), c.timing_group
      from public.workers w
      join public.employee_categories c on c.id = w.category_id
     where w.is_active and w.biometric_id is not null and trim(w.biometric_id) <> ''
       and c.timing_group is not null
  ),
  days as (
    select (timezone('Asia/Kolkata', now())::date - g)::date as day
      from generate_series(0, greatest(least(p_days, 31), 1) - 1) g
  ),
  groups as (
    select unnest(array['staff', 'security', 'production_staff']) as timing_group
  ),
  windows as (
    select d.day, g.timing_group, t.in_time, t.grace_minutes,
           -- date + time first, THEN − 4 h: `time − interval` wraps at
           -- midnight (02:00 − 4 h = 22:00 the same day), a timestamp does not.
           timezone('Asia/Kolkata',
             coalesce((d.day + t.in_time) - interval '4 hours', d.day::timestamp)) as w_start
      from days d
     cross join groups g
      left join lateral (
        select h.in_time, h.grace_minutes
          from public.hr_group_timings h
         where h.timing_group = g.timing_group and h.effective_from <= d.day
         order by h.effective_from desc
         limit 1
      ) t on true
  ),
  firsts as (
    select w.day, w.timing_group, p.bio, min(x.punch_time) as first_at
      from windows w
      join people p on p.timing_group = w.timing_group
      join public.punches x
        on x.user_id = p.bio
       and x.punch_time >= w.w_start
       and x.punch_time <  w.w_start + interval '24 hours'
     group by w.day, w.timing_group, p.bio
  )
  select w.day,
         w.timing_group,
         (select count(*) from people p where p.timing_group = w.timing_group)::integer,
         count(f.bio)::integer,
         count(f.bio) filter (
           where w.in_time is not null
             and f.first_at > timezone('Asia/Kolkata',
                   w.day + w.in_time + make_interval(mins => w.grace_minutes))
         )::integer
    from windows w
    left join firsts f on f.day = w.day and f.timing_group = w.timing_group
   group by w.day, w.timing_group, w.in_time, w.grace_minutes
   order by w.day, w.timing_group
$f$;

comment on function public.hr_attendance_trend(integer) is
  'Present / late per day per timing group for the last p_days shift days '
  '(max 31). Security invoker — answers through the caller''s RLS (0764).';

revoke all on function public.hr_attendance_trend(integer) from public, anon;
grant execute on function public.hr_attendance_trend(integer) to authenticated;
