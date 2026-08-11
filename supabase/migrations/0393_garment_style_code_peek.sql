-- ============================================================================
-- Raagam ERP — 0393 Garment Style ▸ show the serial BEFORE the record is saved
--
-- The Style form shows its serial (STL-2627-81) read-only. On a NEW style there
-- was nothing to show — the trigger assigns on INSERT — so the box read
-- "(auto)". The client wants the actual number on screen while entering
-- (2026-08-10), which is how the legacy form behaves.
--
-- THE NUMBER MUST COME FROM THE DATABASE. Composing it client-side would be a
-- second implementation of the format and the fiscal-year rule, and the two
-- would drift the first time either changed — the screen would then confidently
-- display a number different from the one saved.
--
-- So this adds a PEEK that reads the counter WITHOUT consuming it, and — the
-- load-bearing half — factors the fiscal-year rule into ONE function that the
-- assigner and the peek both call. `assign_garment_style_code()` is replaced
-- rather than left alone precisely so there is no second copy of that rule.
--
-- ADDITIVE AND ORDER-INDEPENDENT: every statement is `create or replace`, so
-- this applies cleanly whether or not 0392 has run yet. It is a separate
-- migration rather than an edit to 0392 because 0392 is already committed and
-- may have been applied somewhere; amending an applied migration is a change
-- that silently never runs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The fiscal year, once.
--
-- Indian FY runs April–March, so anything before April belongs to the year that
-- started the previous April. 2026 → '2627': two digits each, so the segment is
-- always four characters.
--
-- IMMUTABLE because it is a pure function of its argument — which is what lets
-- it be called from the peek without a per-row planner cost.
-- ---------------------------------------------------------------------------
create or replace function public.garment_style_fy(p_on date)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select to_char(
           (case when extract(month from p_on) >= 4
                 then extract(year from p_on)
                 else extract(year from p_on) - 1 end)::int % 100, 'FM00')
      || to_char(
           ((case when extract(month from p_on) >= 4
                  then extract(year from p_on)
                  else extract(year from p_on) - 1 end)::int + 1) % 100, 'FM00');
$$;

comment on function public.garment_style_fy(date) is
  'Indian fiscal-year segment for a garment style code: 2026-08-10 -> 2627. '
  'The ONE definition of that rule — assign_garment_style_code() and '
  'peek_garment_style_code() both call it so they cannot drift.';

revoke all on function public.garment_style_fy(date) from public, anon;
grant execute on function public.garment_style_fy(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The assigner, now reading the shared rule.
--
-- Behaviour is unchanged from 0392; the inline fiscal-year block is replaced by
-- the call above. Still SECURITY INVOKER — the caller must hold orders:create,
-- which is what the counter's own policies require.
-- ---------------------------------------------------------------------------
create or replace function public.assign_garment_style_code()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_fy   text;
  v_next int;
begin
  if new.code is not null and new.code <> '' then
    return new;
  end if;

  v_fy := public.garment_style_fy(coalesce(new.style_date, current_date));

  -- `as c` so the DO UPDATE can name the EXISTING row unambiguously.
  insert into public.garment_style_code_counters as c (fy, last_no)
  values (v_fy, 1)
  on conflict (fy) do update
    set last_no = c.last_no + 1
  returning c.last_no into v_next;

  -- Unpadded: STL-2627-81, not STL-2627-0081 (client, 2026-08-10).
  new.code := 'STL-' || v_fy || '-' || v_next::text;
  return new;
end;
$$;

revoke all on function public.assign_garment_style_code() from public, anon;
grant execute on function public.assign_garment_style_code() to authenticated;

-- Re-assert the trigger. `create or replace` on the function does not re-point a
-- trigger, and if 0392 has not run the table is still on assign_code('STL', …).
drop trigger if exists trg_garment_style_code on public.garment_styles;
create trigger trg_garment_style_code before insert on public.garment_styles
  for each row execute function public.assign_garment_style_code();

-- ---------------------------------------------------------------------------
-- 3. The peek — what the NEXT code would be, without taking it.
--
-- READ-ONLY AND STABLE: it does not touch the counter, so opening the New Style
-- form a hundred times burns no numbers. That is the whole point — a preview
-- that consumed a serial would leave a gap in the sequence every time an
-- operator opened the form and changed their mind, and those gaps are exactly
-- what an audit asks about.
--
-- THE CONSEQUENCE, STATED: the answer is a PREDICTION, not a reservation. Two
-- operators with the form open at once both see the same next number and only
-- one gets it; the trigger remains the sole authority and the saved value is
-- always right. Reserving instead would mean issuing a number to a record that
-- may never be saved, which is the worse trade — legacy behaves this way too.
--
-- SECURITY INVOKER, so the counter's RLS applies: a caller without orders:view
-- reads nothing and gets the first number for that year rather than an error.
-- The screen falls back to "(auto)" if this returns null.
-- ---------------------------------------------------------------------------
create or replace function public.peek_garment_style_code(p_on date default null)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select 'STL-' || public.garment_style_fy(coalesce(p_on, current_date)) || '-'
      || (coalesce(
            (select c.last_no
               from public.garment_style_code_counters c
              where c.fy = public.garment_style_fy(coalesce(p_on, current_date))),
            0) + 1)::text;
$$;

comment on function public.peek_garment_style_code(date) is
  'The code the next garment style created on p_on WOULD receive. Does not '
  'consume the counter, so it is a prediction rather than a reservation — the '
  'BEFORE INSERT trigger remains the only thing that assigns a real number.';

revoke all on function public.peek_garment_style_code(date) from public, anon;
grant execute on function public.peek_garment_style_code(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-verification.
--
-- A migration reporting success proves the SQL ran, not that it achieved its
-- stated goal (0386). These assert the two things that would silently be wrong:
-- the fiscal-year boundary, and the peek not consuming.
-- ---------------------------------------------------------------------------
do $$
declare
  v_before int;
  v_after  int;
  v_peek   text;
begin
  -- April 1 starts a new fiscal year; March 31 is still the old one.
  if public.garment_style_fy(date '2026-04-01') <> '2627' then
    raise exception '0393: FY for 2026-04-01 should be 2627, got %',
      public.garment_style_fy(date '2026-04-01');
  end if;
  if public.garment_style_fy(date '2026-03-31') <> '2526' then
    raise exception '0393: FY for 2026-03-31 should be 2526, got %',
      public.garment_style_fy(date '2026-03-31');
  end if;
  if public.garment_style_fy(date '2027-01-15') <> '2627' then
    raise exception '0393: FY for 2027-01-15 should be 2627, got %',
      public.garment_style_fy(date '2027-01-15');
  end if;

  -- The peek must not move the counter. Compare across two calls.
  select coalesce(max(last_no), 0) into v_before
    from public.garment_style_code_counters
   where fy = public.garment_style_fy(date '2026-08-10');
  v_peek := public.peek_garment_style_code(date '2026-08-10');
  select coalesce(max(last_no), 0) into v_after
    from public.garment_style_code_counters
   where fy = public.garment_style_fy(date '2026-08-10');

  if v_before <> v_after then
    raise exception '0393: peek CONSUMED a number (% -> %)', v_before, v_after;
  end if;
  if v_peek <> 'STL-2627-' || (v_before + 1)::text then
    raise exception '0393: peek returned %, expected STL-2627-%',
      v_peek, v_before + 1;
  end if;
end $$;
