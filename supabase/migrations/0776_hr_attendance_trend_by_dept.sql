-- ============================================================================
-- 0776 — HR dashboard: the 7-day trend per Staff / Worker AND department
-- (user 2026-10-31: "i can be able to filter depts everywhere in the
-- dashboard"). The dashboard filters everything else from today's people in
-- the browser's own data; the week needs past days, which only SQL has.
--
-- ADDITIVE ONLY: one new function. `hr_attendance_trend_by_kind` (0774) is
-- left as it is — the dashboard falls back to it while this is not applied.
--
-- Same rules as 0774, line for line: a category's shift day D runs 24 h from
-- (D + in_time − 4 h) IST; no category or no hours → calendar day, never late.
-- `lib/hr/timing-calc.ts` is the TypeScript twin. The only difference is the
-- extra `department_id` column (null = no department), and that only groups
-- that have people come back — the caller sums, so a missing group is 0.
--
-- SECURITY INVOKER: staff, workers and punches answer through the caller's
-- own RLS, exactly as the screens do.
-- ============================================================================

create or replace function public.hr_attendance_trend_by_dept(p_days integer default 7)
returns table (
  day            date,
  kind           text,
  department_id  uuid,
  enrolled       integer,
  present        integer,
  late           integer
)
language sql
stable
security invoker
set search_path to ''
as $f$
  with people as (
    select distinct on (bio) bio, kind, category_id, department_id
      from (
        select trim(s.biometric_id) as bio, 'staff'::text as kind, s.category_id, s.department_id, 0 as pref
          from public.staff s
         where s.is_active and s.biometric_id is not null and trim(s.biometric_id) <> ''
        union all
        select trim(w.biometric_id), 'worker', w.category_id, w.department_id, 1
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
    select d.day, p.bio, p.kind, p.department_id, t.in_time, t.grace_minutes,
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
    select w.day, w.bio, w.kind, w.department_id, w.in_time, w.grace_minutes,
           (select min(x.punch_time)
              from public.punches x
             where x.user_id = w.bio
               and x.punch_time >= w.w_start
               and x.punch_time <  w.w_start + interval '24 hours') as first_at
      from windows w
  )
  select f.day,
         f.kind,
         f.department_id,
         count(f.bio)::integer,
         count(f.first_at)::integer,
         count(f.first_at) filter (
           where f.in_time is not null
             and f.first_at > timezone('Asia/Kolkata',
                   f.day + f.in_time + make_interval(mins => f.grace_minutes))
         )::integer
    from firsts f
   group by f.day, f.kind, f.department_id
   order by 1, 2
$f$;

comment on function public.hr_attendance_trend_by_dept(integer) is
  'Present / late per day for Staff and Worker per department over the last '
  'p_days shift days (max 31), each person judged by their category''s hours '
  '(0776, same rules as 0774). Security invoker.';

revoke all on function public.hr_attendance_trend_by_dept(integer) from public, anon;
grant execute on function public.hr_attendance_trend_by_dept(integer) to authenticated;
