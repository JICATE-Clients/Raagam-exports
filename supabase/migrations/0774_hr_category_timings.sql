-- ============================================================================
-- Raagam ERP — 0774 HR ▸ Work Timing per Employee Category
--
-- User 2026-10-30: "in hr master work timing we need to separate for staff and
-- worker, whatever category we are creating … should be shown in work timing
-- separately so that we can assign timing for them". So the hours move from
-- the three fixed timing groups (0769) to EACH employee category, and Work
-- Timing lists the categories under Staff and under Worker (by their For).
--
-- Additive only:
--   1. `hr_category_timings` — Punch In / Out / grace per category, dated, the
--      exact shape of 0769's `hr_group_timings` with the category in place of
--      the group. A change of hours is a NEW row on a later effective_from.
--   2. A one-time copy of every group revision onto the categories linked to
--      that group, so the hours already set keep applying (insert only; a row
--      already there is left alone).
--   3. `hr_attendance_trend_by_kind(p_days)` — the dashboard's 7-day trend,
--      per Staff / Worker, each person judged by THEIR category's hours.
--
-- Left untouched: `hr_group_timings`, `employee_categories.timing_group` and
-- `hr_attendance_trend()` (0769). Nothing in the app reads them after this.
-- ============================================================================

create table if not exists public.hr_category_timings (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references public.employee_categories(id) on delete cascade,
  in_time        time not null,
  out_time       time not null,
  grace_minutes  integer not null default 0
                   check (grace_minutes between 0 and 180),
  effective_from date not null default current_date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  constraint hr_category_timings_in_ne_out check (in_time <> out_time),
  unique (category_id, effective_from)
);

comment on table public.hr_category_timings is
  'Punch In / Out / grace per employee category, dated (0774). Replaces the '
  'three fixed groups of 0769 as the source of a person''s working day.';

create trigger trg_hr_category_timings_updated before update on public.hr_category_timings
  for each row execute function public.set_updated_at();

alter table public.hr_category_timings enable row level security;

create policy hr_category_timings_read on public.hr_category_timings
  for select to authenticated using (true);
create policy hr_category_timings_insert on public.hr_category_timings
  for insert to authenticated with check (public.has_permission('masters', 'create'));
create policy hr_category_timings_update on public.hr_category_timings
  for update to authenticated
  using (public.has_permission('masters', 'edit'))
  with check (public.has_permission('masters', 'edit'));
create policy hr_category_timings_delete on public.hr_category_timings
  for delete to authenticated using (public.has_permission('masters', 'delete'));

-- Carry the hours already set: each group revision onto every category linked
-- to that group. Insert only.
insert into public.hr_category_timings (category_id, in_time, out_time, grace_minutes, effective_from)
select c.id, g.in_time, g.out_time, g.grace_minutes, g.effective_from
  from public.hr_group_timings g
  join public.employee_categories c on c.timing_group = g.timing_group
on conflict (category_id, effective_from) do nothing;

-- ----------------------------------------------------------------------------
-- hr_attendance_trend_by_kind(p_days) — present / late per day, Staff and
-- Worker, for the last p_days shift days (max 31).
--
-- THE SHIFT DAY is 0769's rule, now per category: a category's day D runs 24 h
-- from (D + in_time − 4 h), IST. A person with no category, or whose category
-- has no hours for D, is counted on the calendar day and is never late.
-- `lib/hr/timing-calc.ts` is the TypeScript twin — change one, change both.
--
-- SECURITY INVOKER: staff, workers and punches answer through the caller's
-- own RLS, exactly as the screens do.
-- ----------------------------------------------------------------------------
create or replace function public.hr_attendance_trend_by_kind(p_days integer default 7)
returns table (
  day       date,
  kind      text,
  enrolled  integer,
  present   integer,
  late      integer
)
language sql
stable
security invoker
set search_path to ''
as $f$
  with people as (
    select distinct on (bio) bio, kind, category_id
      from (
        select trim(s.biometric_id) as bio, 'staff'::text as kind, s.category_id, 0 as pref
          from public.staff s
         where s.is_active and s.biometric_id is not null and trim(s.biometric_id) <> ''
        union all
        select trim(w.biometric_id), 'worker', w.category_id, 1
          from public.workers w
         where w.is_active and w.biometric_id is not null and trim(w.biometric_id) <> ''
      ) u
     order by bio, pref
  ),
  days as (
    select (timezone('Asia/Kolkata', now())::date - g)::date as day
      from generate_series(0, greatest(least(p_days, 31), 1) - 1) g
  ),
  windows as (
    select d.day, p.bio, p.kind, t.in_time, t.grace_minutes,
           -- date + time first, THEN − 4 h: `time − interval` wraps at
           -- midnight, a timestamp does not.
           timezone('Asia/Kolkata',
             coalesce((d.day + t.in_time) - interval '4 hours', d.day::timestamp)) as w_start
      from days d
     cross join people p
      left join lateral (
        select h.in_time, h.grace_minutes
          from public.hr_category_timings h
         where h.category_id = p.category_id and h.effective_from <= d.day
         order by h.effective_from desc
         limit 1
      ) t on true
  ),
  firsts as (
    select w.day, w.bio, w.kind, w.in_time, w.grace_minutes,
           (select min(x.punch_time)
              from public.punches x
             where x.user_id = w.bio
               and x.punch_time >= w.w_start
               and x.punch_time <  w.w_start + interval '24 hours') as first_at
      from windows w
  )
  select d.day,
         k.kind,
         count(f.bio)::integer,
         count(f.first_at)::integer,
         count(f.first_at) filter (
           where f.in_time is not null
             and f.first_at > timezone('Asia/Kolkata',
                   f.day + f.in_time + make_interval(mins => f.grace_minutes))
         )::integer
    from (values ('staff'::text), ('worker'::text)) k(kind)
   cross join days d
    left join firsts f on f.kind = k.kind and f.day = d.day
   group by d.day, k.kind
   order by 1, 2
$f$;

comment on function public.hr_attendance_trend_by_kind(integer) is
  'Present / late per day for Staff and Worker over the last p_days shift days '
  '(max 31), each person judged by their category''s hours (0774). Security invoker.';

revoke all on function public.hr_attendance_trend_by_kind(integer) from public, anon;
grant execute on function public.hr_attendance_trend_by_kind(integer) to authenticated;
