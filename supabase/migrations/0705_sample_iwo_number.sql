-- 0705 — A SAMPLE WORK ORDER IS NUMBERED SIW/26-27/0001 (user 2026-10-09).
--
-- 0704 marked the work orders raised from the Sample module (`is_sample`).
-- The user asked for them to read in the Sample module's own number style
-- rather than HO/IWO/2627/0001. SMP/26-27/… was NOT an option: Sample Entry
-- already numbers opportunities SMP/26-27/0001, so a second count in that
-- prefix would give two documents one number. SIW ("Sample IW") is its own
-- series — the user's choice of the three offered.
--
--   * Same shape as SMP / PRD / CST (0686): series / 26-27 / 4 digits, the
--     year from `fiscal_year_segment`, NO unit prefix (no Sample number
--     carries one). So SIW counts across units, like SMP.
--   * Same rule as every sample series and as 0598's IWO numbers: the LOWEST
--     number no existing work order holds, so a deleted one is reused.
--   * Production work orders are untouched: `is_sample = false` keeps the
--     unit/IWO/2627/0001 path exactly as 0598 wrote it.
--
-- Live on apply: no work order is `is_sample`, so nothing is renumbered.

create or replace function public.sample_series_next_no(p_series text, p_fy text)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_re text := '^' || p_series || '/' || public.fiscal_year_label(p_fy) || '/([0-9]+)$';
  v_next int;
begin
  if p_series = 'SMP' then
    with used as (
      select substring(o.code from v_re)::int as n from public.opportunities o where o.code ~ v_re
    )
    select case when not exists (select 1 from used where n = 1) then 1
                else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
           end into v_next;
  elsif p_series = 'PRD' then
    with used as (
      select substring(s.sample_no from v_re)::int as n from public.styles s where s.sample_no ~ v_re
    )
    select case when not exists (select 1 from used where n = 1) then 1
                else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
           end into v_next;
  elsif p_series = 'CST' then
    with used as (
      select distinct substring(c.code from v_re)::int as n from public.cost_sheets c where c.code ~ v_re
    )
    select case when not exists (select 1 from used where n = 1) then 1
                else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
           end into v_next;
  elsif p_series = 'SIW' then
    -- 0705: sample work orders, every unit in one count.
    with used as (
      select substring(w.code from v_re)::int as n from public.internal_work_orders w where w.code ~ v_re
    )
    select case when not exists (select 1 from used where n = 1) then 1
                else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
           end into v_next;
  else
    raise exception 'Unknown sample series %', p_series;
  end if;
  return v_next;
end;
$function$;

revoke all on function public.sample_series_next_no(text, text) from public, anon;
grant execute on function public.sample_series_next_no(text, text) to authenticated;

create or replace function public.assign_iwo_number()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_loc  text;
  v_fy   text;
  v_next int;
begin
  if new.code is not null and new.code <> '' then
    return new;
  end if;

  v_fy := public.fiscal_year_segment(coalesce(new.iwo_date, current_date));

  -- 0705: a SAMPLE work order takes the Sample module's own series.
  if new.is_sample then
    perform pg_advisory_xact_lock(hashtext('sample_series:SIW:' || v_fy));
    new.code := public.sample_series_format('SIW', v_fy, public.sample_series_next_no('SIW', v_fy));
    return new;
  end if;

  if new.location_id is null then
    raise exception
      'An Internal Work Order needs a Location before it can be numbered — '
      'the IWO number counts per location and restarts each April.'
      using errcode = '23502';
  end if;

  select l.code into v_loc
    from public.locations l
   where l.id = new.location_id;

  if v_loc is null or v_loc = '' then
    raise exception
      'Location % has no code, so it cannot start an IWO number.', new.location_id
      using errcode = '23502';
  end if;

  -- 0598: one save at a time per (unit, year), then the lowest free number.
  perform pg_advisory_xact_lock(hashtext('iwo_no:' || new.location_id::text || ':' || v_fy));
  v_next := public.iwo_next_no(new.location_id, v_fy);

  new.code := public.iwo_no_format(v_loc, v_fy, v_next);
  return new;
end;
$function$;

revoke all on function public.assign_iwo_number() from public, anon;

-- What a NEW sample work order dated p_on would be numbered — the preview
-- twin of `peek_iwo_number`, reading the same rule the insert uses.
create or replace function public.peek_sample_iwo_number(p_on date default null)
returns text
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  select public.sample_series_format(
           'SIW',
           public.fiscal_year_segment(coalesce(p_on, current_date)),
           public.sample_series_next_no('SIW', public.fiscal_year_segment(coalesce(p_on, current_date))));
$function$;

revoke all on function public.peek_sample_iwo_number(date) from public, anon;
grant execute on function public.peek_sample_iwo_number(date) to authenticated;
