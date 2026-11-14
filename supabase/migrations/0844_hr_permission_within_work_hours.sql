-- ════════════════════════════════════════════════════════════════════════════
-- Raagam ERP — 0844 Time Off: a permission stays inside the working day
--
-- User 2026-11-14: "for staff we already set up work timings 9 am to 7 pm" —
-- the Permission screen now offers From / To only inside the person's hours;
-- this makes the database refuse the same thing, so an import or a second
-- route cannot store a permission outside them ("yes add the db check").
--
-- The hours: the person's employee category → its timing group (0769) → the
-- hr_group_timings row in force on the permission's date (latest
-- effective_from on or before it). Nothing is refused when there is no group,
-- no hours yet, or the hours cross midnight (Security's night shift) — the
-- same three cases the screen leaves on its full list.
--
-- A trigger, not a change to timeoff_apply: additive, and it catches every
-- writer. On UPDATE it runs only when the date or times move, so a decision,
-- withdrawal or an existing row is never re-judged.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.timeoff_refuse_outside_work_hours()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_group text;
  v_in    time;
  v_out   time;
begin
  if new.day_part <> 'hourly' or new.start_time is null or new.end_time is null then
    return new;
  end if;

  if new.staff_id is not null then
    select c.timing_group into v_group
      from public.staff s join public.employee_categories c on c.id = s.category_id
     where s.id = new.staff_id;
  else
    select c.timing_group into v_group
      from public.workers w join public.employee_categories c on c.id = w.category_id
     where w.id = new.worker_id;
  end if;
  if v_group is null then return new; end if;

  select t.in_time, t.out_time into v_in, v_out
    from public.hr_group_timings t
   where t.timing_group = v_group and t.effective_from <= new.start_date
   order by t.effective_from desc
   limit 1;
  if v_in is null or v_out <= v_in then return new; end if;

  if new.start_time < v_in or new.end_time > v_out then
    raise exception 'A permission must be within working hours (% to %)',
      to_char(v_in, 'HH12:MI AM'), to_char(v_out, 'HH12:MI AM') using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.timeoff_refuse_outside_work_hours() from public, anon;

drop trigger if exists trg_timeoff_requests_work_hours on public.timeoff_requests;
create trigger trg_timeoff_requests_work_hours
  before insert or update of start_date, start_time, end_time, day_part on public.timeoff_requests
  for each row execute function public.timeoff_refuse_outside_work_hours();
