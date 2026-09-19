-- ============================================================================
-- Raagam ERP — 0598 Internal Work Order numbers: a deleted number is reused.
--
-- User 2026-09-20: "if I delete the internal work order it deletes, but the
-- next one does not use the deleted IWO No — it is stored in the DB, so it
-- automatically creates the next number. Fix it."
--
-- The number came from `iwo_no_counters.last_no` (0559), a counter that only
-- ever goes UP. Deleting a work order left the counter where it was, so its
-- number was never issued again, and `peek_iwo_number` (0580), which previews
-- the next number on a new work order, read that same counter. Live: one work
-- order, HO/IWO/2627/0002, and the counter at 2 — 0001 was deleted and lost.
--
-- ## THE RULE NOW: THE LOWEST NUMBER NOT IN USE
--
-- The next number is worked out from the work orders that EXIST, per unit and
-- financial year: the lowest positive number no existing work order holds.
--   * Delete the newest → its number comes straight back.
--   * Delete one in the middle → the next new work order fills that gap, so
--     the series has no holes.
-- (A deleted work order could not have been bought against or budgeted:
-- po_line_items.iwo_id and iwo_budgets.iwo_id are RESTRICT, so a number that
-- is reused was never cited by another document.)
--
-- `iwo_next_no` is SECURITY DEFINER: RLS must not hide a unit's rows from the
-- count, or it would hand out a number already taken. Two saves at once are
-- serialised by an advisory lock per (unit, year); `unique (code)` stays as
-- the backstop. `iwo_no_counters` is no longer read or written — kept, not
-- dropped, so nothing that once referred to it breaks.
-- ============================================================================

create or replace function public.iwo_next_no(p_location_id uuid, p_fy text)
returns int
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with used as (
    select substring(w.code from '/([0-9]+)$')::int as n
      from public.internal_work_orders w
      join public.locations l on l.id = w.location_id
     where w.location_id = p_location_id
       and w.code ~ ('^' || l.code || '/IWO/' || p_fy || '/[0-9]+$')
  )
  select case
           when not exists (select 1 from used where n = 1) then 1
           else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
         end
$$;

comment on function public.iwo_next_no(uuid, text) is
  'IWO numbering (0598): the lowest positive number no existing work order of this unit and '
  'financial year holds — so a deleted number is reused. SECURITY DEFINER so RLS cannot hide a taken number.';

revoke all on function public.iwo_next_no(uuid, text) from public, anon;
grant execute on function public.iwo_next_no(uuid, text) to authenticated;

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

  v_fy := public.fiscal_year_segment(coalesce(new.iwo_date, current_date));

  -- 0598: one save at a time per (unit, year), then the lowest free number.
  perform pg_advisory_xact_lock(hashtext('iwo_no:' || new.location_id::text || ':' || v_fy));
  v_next := public.iwo_next_no(new.location_id, v_fy);

  new.code := public.iwo_no_format(v_loc, v_fy, v_next);
  return new;
end;
$function$;

create or replace function public.peek_iwo_number(p_location_id uuid, p_on date default null)
returns text
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  -- 0598: the same rule the insert uses, so the preview is the number given.
  select public.iwo_no_format(
           l.code,
           public.fiscal_year_segment(coalesce(p_on, current_date)),
           public.iwo_next_no(p_location_id, public.fiscal_year_segment(coalesce(p_on, current_date))))
    from public.locations l
   where l.id = p_location_id;
$function$;

comment on table public.iwo_no_counters is
  'RETIRED by 0598 — IWO numbers are the lowest free number among existing work orders '
  '(iwo_next_no), so a deleted number is reused. Kept, no longer read or written.';

do $$
begin
  if has_function_privilege('anon', 'public.iwo_next_no(uuid,text)', 'EXECUTE') then
    raise exception '0598: iwo_next_no is executable by anon';
  end if;
end $$;
