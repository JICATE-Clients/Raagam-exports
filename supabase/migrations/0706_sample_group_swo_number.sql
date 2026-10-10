-- 0706 — A SAMPLE GROUP IS NUMBERED SWO/26-27/0001 (user 2026-10-10).
--
-- 0702 numbered groups GRP/<SEASON>-<YY>/001, one count per season + year
-- (the spec's GRP-SS26-001). The user asked for the Sample module's own
-- number style instead: SWO ("Sample Work Order") / financial year / 4 digits.
--
--   * Same shape as SMP / PRD / CST / SIW (0686 · 0705): `sample_series_format`,
--     the year from `fiscal_year_segment` of the day the group is made, no unit
--     prefix — a group is the company's, not a unit's (0702).
--   * ONE count per financial year, no longer per season: the season is on the
--     row and on screen, it is not part of the number any more.
--   * Same rule as every sample series: the LOWEST number no group holds.
--   * SWO is its own prefix. SIW (0705) stays the number of the Internal Work
--     Order a group raises — two documents, two series.
--
-- Existing groups are renumbered in creation order. Live on apply: one Draft
-- group, no IW raised from it. A raised IW carries the group code as its
-- reference_no (raiseSampleGroupIw), so those are carried across too.

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
  elsif p_series = 'SWO' then
    -- 0706: sample groups.
    with used as (
      select substring(g.group_code from v_re)::int as n from public.sample_product_groups g where g.group_code ~ v_re
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

create or replace function public.assign_sample_group_code()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_fy text;
begin
  if new.group_code is not null and new.group_code <> '' then
    return new;
  end if;
  v_fy := public.fiscal_year_segment(coalesce(new.created_at, now())::date);
  perform pg_advisory_xact_lock(hashtext('sample_series:SWO:' || v_fy));
  new.group_code := public.sample_series_format('SWO', v_fy, public.sample_series_next_no('SWO', v_fy));
  return new;
end;
$$;

revoke all on function public.assign_sample_group_code() from public, anon;

-- Renumber the groups made under 0702, oldest first, one count per year.
do $$
declare
  r      record;
  v_fy   text;
  v_new  text;
begin
  for r in
    select id, group_code, created_at from public.sample_product_groups
     where group_code is null or group_code !~ '^SWO/'
     order by created_at, id
  loop
    v_fy  := public.fiscal_year_segment(r.created_at::date);
    v_new := public.sample_series_format('SWO', v_fy, public.sample_series_next_no('SWO', v_fy));
    update public.sample_product_groups set group_code = v_new where id = r.id;
    update public.internal_work_orders w
       set reference_no = v_new
      from public.sample_product_groups g
     where g.id = r.id and w.id = g.iwo_id and w.reference_no = r.group_code;
  end loop;
end;
$$;
