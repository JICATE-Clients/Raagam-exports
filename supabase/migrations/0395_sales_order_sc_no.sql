-- ============================================================================
-- Raagam ERP — 0395 The SC No: HO/RE/2627/0001
--
-- The garment order's SC No is the number 500+ people use to talk about an
-- order — status, profit/loss, production stage all hang off it (client
-- 2026-08-10). It is FOUR segments:
--
--   HO   the location the order was raised at   → public.locations.code
--   RE   the document type, constant for orders → literal
--   2627 the fiscal year, April–March           → from the order's OWN date
--   0001 a running number, RESET every April    → per-location counter
--
-- What was there instead: `SO-0001`, from 0017's `assign_order_number()` —
-- `'SO-' || lpad(nextval('seq_sales_order'), 4, '0')`. No location, no year,
-- and a sequence CANNOT reset in April, which is the same wall 0392 hit for the
-- style code and solved with a counter TABLE keyed by the year.
--
-- ---------------------------------------------------------------------------
-- THE COUNTER IS PER (LOCATION, YEAR) — the client's decision, 2026-08-10.
--
-- Unit 2's first order of the year is U2/RE/2627/0001 even after Head Office
-- has reached 0002. The legacy "Document No format" master carries a
-- `location_wise` flag per menu, and this is the setting it names.
--
-- ONE CONSEQUENCE, AND IT IS NOT A DETAIL: a Location is now REQUIRED to number
-- an order. A blank one has no counter to draw from, so the trigger refuses
-- rather than inventing a shared bucket — a fallback bucket would mint
-- `/RE/2627/0001` for the first location-less order and then collide with it
-- forever. `sales_orders.location_id` stays nullable at the column level so the
-- ~existing rows and any import carrying its own number still load; the refusal
-- lives inside the assign branch, which is the only place it matters.
--
-- ---------------------------------------------------------------------------
-- WHY THE FISCAL-YEAR RULE MOVES OUT OF THE STYLE CODE.
--
-- 0393 factored the April–March rule into `garment_style_fy()` for exactly one
-- reason: so the assigner and the peek could not drift. That reason applies
-- twice as hard now that a SECOND document needs the same rule. Writing the
-- boundary arithmetic again here would be the third copy, and the one that
-- silently disagrees for the three months of the year anybody would notice.
--
-- So the rule becomes `public.fiscal_year_segment(date)` and
-- `garment_style_fy()` is redefined as a one-line call to it. Behaviour of the
-- style code is unchanged — asserted below across the boundary dates, rather
-- than assumed.
--
-- The FORMAT is factored the same way. 0393 left `'STL-' || fy || '-' || n`
-- written out in both the assigner and the peek; that is survivable for two
-- call sites of a 3-segment code and would not be for four segments, a
-- separator and a pad width. `sales_order_no_format()` is the one composer, and
-- the peek showing a different string from the one saved is thereby not a thing
-- that can happen.
--
-- ---------------------------------------------------------------------------
-- THE ORDER NEEDS A DATE, AND DID NOT HAVE ONE.
--
-- `sales_orders` carries ship_date, delivery_date and created_at — but not the
-- `Date` field the legacy header has always had. The fiscal year comes from the
-- DOCUMENT's date, not `current_date` (0392's rule): an order dated 31 March
-- keyed in on 2 April numbers into 2526, which is how document numbering is
-- expected to behave. Without the column that rule has nothing to read.
--
-- The accepted consequence is 0392's, unchanged: back-dating consumes a number
-- from that year's counter, so within a year the serial order is ENTRY order,
-- not date order.
--
-- ---------------------------------------------------------------------------
-- EXISTING ORDERS KEEP THEIR SO-#### NUMBERS. Nothing is renumbered: the SC No
-- is the key people quote from memory and off printed paperwork, so rewriting
-- history would invalidate every reference to it. `seq_sales_order` is left in
-- place for the same reason 0392 left `seq_garment_style` — the old codes stay
-- explicable and a rollback is a one-line trigger swap.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The fiscal year, once, for every document that has one.
--
-- Indian FY runs April–March, so anything before April belongs to the year that
-- started the previous April. 2026 → '2627': two digits each, so the segment is
-- always four characters.
--
-- IMMUTABLE because it is a pure function of its argument — which is what lets
-- a peek call it without a per-row planner cost.
-- ---------------------------------------------------------------------------
create or replace function public.fiscal_year_segment(p_on date)
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

comment on function public.fiscal_year_segment(date) is
  'The Indian fiscal-year segment of a document number: 2026-08-10 -> 2627, '
  '2026-03-31 -> 2526. THE one definition of the April-March boundary — the '
  'garment style code and the sales order SC No both read it, so they cannot '
  'disagree about which year a March document belongs to.';

revoke all on function public.fiscal_year_segment(date) from public, anon;
grant execute on function public.fiscal_year_segment(date) to authenticated;

-- `garment_style_fy` becomes a delegating alias. Kept rather than dropped
-- because 0393's assigner and peek both name it, and this migration must apply
-- cleanly without editing an already-committed file. Same signature, same
-- answer — proved in section 7.
create or replace function public.garment_style_fy(p_on date)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select public.fiscal_year_segment(p_on);
$$;

comment on function public.garment_style_fy(date) is
  'Deprecated alias for public.fiscal_year_segment(date), kept because 0393''s '
  'assign_garment_style_code() and peek_garment_style_code() call it by name. '
  'New code should call fiscal_year_segment() directly.';

revoke all on function public.garment_style_fy(date) from public, anon;
grant execute on function public.garment_style_fy(date) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. The order's own date.
--
-- Added nullable and BACKFILLED from created_at before the NOT NULL goes on:
-- `add column ... not null default current_date` would stamp every historical
-- order with today, which is worse than having no column at all — it would look
-- like real data and mis-file every existing order into this fiscal year.
-- ---------------------------------------------------------------------------
alter table public.sales_orders
  add column if not exists order_date date;

update public.sales_orders
   set order_date = date(created_at)
 where order_date is null;

alter table public.sales_orders
  alter column order_date set default current_date;

alter table public.sales_orders
  alter column order_date set not null;

comment on column public.sales_orders.order_date is
  'The document date shown in the order header. Drives the fiscal-year segment '
  'of order_number, so back-dating an order numbers it into that year.';


-- ---------------------------------------------------------------------------
-- 3. The counter, keyed by (location, fiscal year).
--
-- WHY THIS IS NOT SECURITY DEFINER, restating 0392 because the temptation
-- recurs: a sequence is not RLS-protected, which is why the generic
-- assign_code() can bump one as the calling role. A table is. Marking the
-- trigger SECURITY DEFINER so it can write here regardless is the hole 0391
-- spends its header refusing. Instead the policies allow exactly the caller who
-- is already inserting an order — someone holding orders:create — and the
-- function stays SECURITY INVOKER.
--
-- SELECT is granted because the counter is read back by `returning`, and by the
-- peek. There is deliberately NO DELETE policy: losing a (location, year) row
-- would restart that branch's numbering at 1 and mint duplicate SC Nos.
--
-- The FK to locations is `on delete restrict` (the default) on purpose — a
-- location that has issued order numbers must not be removable out from under
-- them.
-- ---------------------------------------------------------------------------
create table if not exists public.sales_order_no_counters (
  location_id uuid not null references public.locations(id),
  fy          text not null,
  last_no     int  not null default 0,
  primary key (location_id, fy)
);

alter table public.sales_order_no_counters enable row level security;

drop policy if exists sales_order_no_counters_read on public.sales_order_no_counters;
create policy sales_order_no_counters_read on public.sales_order_no_counters
  for select to authenticated using (public.has_permission('orders', 'view'));

drop policy if exists sales_order_no_counters_insert on public.sales_order_no_counters;
create policy sales_order_no_counters_insert on public.sales_order_no_counters
  for insert to authenticated with check (public.has_permission('orders', 'create'));

drop policy if exists sales_order_no_counters_update on public.sales_order_no_counters;
create policy sales_order_no_counters_update on public.sales_order_no_counters
  for update to authenticated
  using (public.has_permission('orders', 'create'))
  with check (public.has_permission('orders', 'create'));

comment on table public.sales_order_no_counters is
  'Running SC No per (location, fiscal year). Resets each April by virtue of a '
  'new fy key rather than by anything resetting it. No DELETE policy: dropping '
  'a row restarts that branch at 0001 and mints duplicates.';


-- ---------------------------------------------------------------------------
-- 4. The format, once.
--
-- IMMUTABLE and total: given the three parts it always answers the same string,
-- so the assigner and the peek are the same statement rather than two that
-- happen to match today.
--
-- 'RE' IS THE DOCUMENT TYPE, and it is a literal here rather than a parameter.
-- The legacy "Document No format" master can express a per-menu prefix, but
-- nothing reads that master yet and a parameter with exactly one caller is a
-- setting pretending to be a feature. When a second order-shaped document needs
-- its own letters, that is the moment to widen this signature.
--
-- THE PAD MUST BE A FLOOR, AND `lpad` ALONE DOES NOT GIVE ONE. Postgres's
-- lpad(string, length, fill) is a WIDTH: it truncates anything longer.
-- `lpad('12345', 4, '0')` is '1234', so the 12,345th order of a year would have
-- been stamped HO/RE/2627/1234 — a silent duplicate of order 1234's SC No, in
-- the one field the whole company tracks an order by.
--
-- That is not hypothetical: it is what this function did when first written,
-- and section 7c caught it on the first apply. `greatest(4, length(...))` is
-- what makes the 4 a minimum. The assertion stays exactly where it is.
-- ---------------------------------------------------------------------------
create or replace function public.sales_order_no_format(
  p_location_code text,
  p_fy            text,
  p_next          int
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_location_code || '/RE/' || p_fy || '/'
      || lpad(p_next::text, greatest(4, length(p_next::text)), '0');
$$;

comment on function public.sales_order_no_format(text, text, int) is
  'Composes an SC No: HO + 2627 + 1 -> HO/RE/2627/0001. The ONE place the '
  'format lives — assign_order_number() and peek_sales_order_number() both '
  'call it, so a preview can never show a different string from the one saved. '
  'The 4-digit pad is a FLOOR, not a width — bare lpad() would truncate order '
  '12345 to 1234 and duplicate an existing SC No.';

revoke all on function public.sales_order_no_format(text, text, int) from public, anon;
grant execute on function public.sales_order_no_format(text, text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. The assigner — replaces 0017's SO-#### generator.
--
-- An explicitly supplied order_number is still honoured and does NOT advance
-- the counter: same guard 0017 and assign_code() both have, and what lets a
-- data import carry its own legacy SC Nos.
--
-- The `on conflict … do update … returning` is ONE atomic statement, so two
-- operators saving at the same instant cannot be handed the same number.
-- ---------------------------------------------------------------------------
create or replace function public.assign_order_number()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_loc  text;
  v_fy   text;
  v_next int;
begin
  if new.order_number is not null and new.order_number <> '' then
    return new;
  end if;

  -- Refuse rather than invent a bucket. See the header: a shared fallback would
  -- collide with itself the moment a second location-less order was raised.
  if new.location_id is null then
    raise exception
      'An order needs a Location before it can be numbered — the SC No counts '
      'per location and restarts each April.'
      using errcode = '23502';
  end if;

  select l.code into v_loc
    from public.locations l
   where l.id = new.location_id;

  if v_loc is null or v_loc = '' then
    raise exception
      'Location % has no code, so it cannot start an SC No.', new.location_id
      using errcode = '23502';
  end if;

  v_fy := public.fiscal_year_segment(coalesce(new.order_date, current_date));

  -- `as c` so the DO UPDATE can name the EXISTING row unambiguously. A
  -- schema-qualified reference is not accepted there, and bare `last_no` would
  -- be the column being assigned rather than its current value.
  insert into public.sales_order_no_counters as c (location_id, fy, last_no)
  values (new.location_id, v_fy, 1)
  on conflict (location_id, fy) do update
    set last_no = c.last_no + 1
  returning c.last_no into v_next;

  new.order_number := public.sales_order_no_format(v_loc, v_fy, v_next);
  return new;
end;
$$;

comment on function public.assign_order_number() is
  'Assigns the SC No HO/RE/<fy>/<nnnn> on insert. Fiscal year comes from '
  'order_date; the running number is per (location, year) and resets each '
  'April. SECURITY INVOKER — the caller must hold orders:create, which is what '
  'sales_order_no_counters'' policies require.';

revoke all on function public.assign_order_number() from public, anon;
grant execute on function public.assign_order_number() to authenticated;

-- Re-assert the trigger. `create or replace` on the function does not re-point
-- a trigger, and the name is reused from 0017.
drop trigger if exists trg_so_code on public.sales_orders;
create trigger trg_so_code before insert on public.sales_orders
  for each row execute function public.assign_order_number();


-- ---------------------------------------------------------------------------
-- 6. The peek — what the NEXT SC No would be, without taking it.
--
-- Same contract as 0393's peek, and the same stated cost. READ-ONLY: opening
-- the New Order form a hundred times burns no numbers, because a preview that
-- consumed a serial would leave a gap every time an operator changed their
-- mind, and those gaps are exactly what an audit asks about.
--
-- A PREDICTION, NOT A RESERVATION. Two operators with the form open both see
-- the same next number and only one gets it; the trigger stays the sole
-- authority, so the STORED value is always right.
--
-- KEYED ON BOTH THE LOCATION AND THE DATE, because both move the answer. The
-- screen must re-ask when either field changes — a preview pinned to the
-- location the form opened with is wrong for precisely the branch orders whose
-- numbering is the point of this migration.
--
-- Returns NULL when no location is given, rather than guessing: the field then
-- shows "(auto)", which is the honest answer for a number that cannot yet be
-- determined.
--
-- SECURITY INVOKER, so the counter's RLS applies: a caller without orders:view
-- reads nothing and is shown 0001 rather than an error.
-- ---------------------------------------------------------------------------
create or replace function public.peek_sales_order_number(
  p_location_id uuid,
  p_on          date default null
)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select public.sales_order_no_format(
           l.code,
           public.fiscal_year_segment(coalesce(p_on, current_date)),
           coalesce(
             (select c.last_no
                from public.sales_order_no_counters c
               where c.location_id = p_location_id
                 and c.fy = public.fiscal_year_segment(coalesce(p_on, current_date))),
             0) + 1)
    from public.locations l
   where l.id = p_location_id;
$$;

comment on function public.peek_sales_order_number(uuid, date) is
  'The SC No the next order raised at p_location_id on p_on WOULD receive. '
  'Does not consume the counter, so it is a prediction rather than a '
  'reservation — the BEFORE INSERT trigger remains the only thing that assigns '
  'a real number. NULL when the location is unknown.';

revoke all on function public.peek_sales_order_number(uuid, date) from public, anon;
grant execute on function public.peek_sales_order_number(uuid, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Self-verification.
--
-- `{"success": true}` means the SQL ran, not that it achieved its stated goal —
-- 0383 and 0386 both applied cleanly and both left a function anon-callable.
--
-- The counter test uses two THROWAWAY locations rather than inserting real
-- sales_orders: an order insert fires the audit trigger (0041), and rows in the
-- audit log for records that never existed are noise a future investigation has
-- to explain away. The two locations are created and removed inside this block,
-- and exercise the exact upsert statement the trigger runs.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn     text;
  v_pair   text;
  v_loc_a  uuid;
  v_loc_b  uuid;
  v_n      int;
  v_before int;
  v_after  int;
  v_peek   text;
begin
  -- 7a. Nothing new is reachable without a login. Both grants — Postgres's
  -- built-in EXECUTE TO PUBLIC and Supabase's separate `anon` grant — are
  -- revoked in one statement above; this reads the result out of the catalog.
  foreach v_fn in array array[
    'public.fiscal_year_segment(date)',
    'public.garment_style_fy(date)',
    'public.sales_order_no_format(text, text, int)',
    'public.assign_order_number()',
    'public.peek_sales_order_number(uuid, date)'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception '0395: % is executable by anon — the revoke did not take', v_fn;
    end if;
  end loop;

  -- 7b. The fiscal-year boundary, on the dates that decide it. An off-by-one
  -- here mislabels every document for three months of the year.
  foreach v_pair in array array[
    '2026-03-31=2526',  -- last day of the OLD year
    '2026-04-01=2627',  -- first day of the new one
    '2026-08-10=2627',  -- mid-year
    '2027-03-31=2627',  -- last day of this one
    '2027-04-01=2728'   -- and over again
  ] loop
    declare
      d    date := split_part(v_pair, '=', 1)::date;
      want text := split_part(v_pair, '=', 2);
      got  text := public.fiscal_year_segment(split_part(v_pair, '=', 1)::date);
    begin
      if got <> want then
        raise exception '0395: % builds fiscal year %, expected %', d, got, want;
      end if;
      -- The style code must not have changed meaning by being re-pointed at the
      -- shared function. Same date, same answer, or the alias is a regression.
      if public.garment_style_fy(d) <> got then
        raise exception '0395: garment_style_fy(%) = % but fiscal_year_segment = % — the alias changed style numbering',
          d, public.garment_style_fy(d), got;
      end if;
    end;
  end loop;

  -- 7c. The composed string. Catches a wrong pad width and the empty-segment
  -- '//' the legacy screen prints.
  if public.sales_order_no_format('HO', '2627', 1) <> 'HO/RE/2627/0001' then
    raise exception '0395: format(HO,2627,1) = %, expected HO/RE/2627/0001',
      public.sales_order_no_format('HO', '2627', 1);
  end if;
  -- The pad is a MINIMUM. Truncating here would collide 12345 with 2345.
  if public.sales_order_no_format('HO', '2627', 12345) <> 'HO/RE/2627/12345' then
    raise exception '0395: format(HO,2627,12345) = %, expected HO/RE/2627/12345 — the pad truncated',
      public.sales_order_no_format('HO', '2627', 12345);
  end if;

  -- 7d. The trigger is on the new function, not still on 0017's.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.sales_orders'::regclass
      and tgname  = 'trg_so_code'
      and tgfoid  = 'public.assign_order_number()'::regprocedure
  ) then
    raise exception '0395: sales_orders is not on the SC No trigger';
  end if;

  -- 7e. The counter is writable by someone. A policy-less RLS table denies
  -- everyone, which would reject every order insert with a confusing error.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sales_order_no_counters'
  ) then
    raise exception '0395: sales_order_no_counters has no policies — every order insert would be denied';
  end if;

  -- 7f. order_date exists and is mandatory — the fiscal year has nothing to
  -- read otherwise, and a nullable one would silently fall back to today.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_orders'
      and column_name = 'order_date' and is_nullable = 'NO'
  ) then
    raise exception '0395: sales_orders.order_date is missing or nullable';
  end if;

  -- 7g. THE DECISION ITSELF: two locations count INDEPENDENTLY. This is the
  -- client's 2026-08-10 answer, and the thing that would be quietly wrong if
  -- the primary key were (fy) alone — Unit 2's first order would read 0003.
  insert into public.locations (code, name)
       values ('ZZ-T1', 'SC No self-test A') returning id into v_loc_a;
  insert into public.locations (code, name)
       values ('ZZ-T2', 'SC No self-test B') returning id into v_loc_b;

  -- Location A, twice — the same upsert the trigger runs.
  insert into public.sales_order_no_counters as c (location_id, fy, last_no)
       values (v_loc_a, '2627', 1)
       on conflict (location_id, fy) do update set last_no = c.last_no + 1;
  insert into public.sales_order_no_counters as c (location_id, fy, last_no)
       values (v_loc_a, '2627', 1)
       on conflict (location_id, fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_n;
  if v_n <> 2 then
    raise exception '0395: second order at one location got %, expected 2', v_n;
  end if;

  -- Location B, first time — must be 1, not 3.
  insert into public.sales_order_no_counters as c (location_id, fy, last_no)
       values (v_loc_b, '2627', 1)
       on conflict (location_id, fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_n;
  if v_n <> 1 then
    raise exception '0395: a SECOND location started at %, expected 1 — the counter is not per-location', v_n;
  end if;

  -- A new fiscal year restarts the same location at 1. This is the April reset,
  -- and it is a consequence of the key rather than of anything running in April.
  insert into public.sales_order_no_counters as c (location_id, fy, last_no)
       values (v_loc_a, '2728', 1)
       on conflict (location_id, fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_n;
  if v_n <> 1 then
    raise exception '0395: the next fiscal year started at %, expected 1 — the counter does not reset', v_n;
  end if;

  -- 7h. The peek predicts the next one and does not consume it.
  select last_no into v_before
    from public.sales_order_no_counters
   where location_id = v_loc_a and fy = '2627';
  v_peek := public.peek_sales_order_number(v_loc_a, date '2026-08-10');
  select last_no into v_after
    from public.sales_order_no_counters
   where location_id = v_loc_a and fy = '2627';

  if v_before <> v_after then
    raise exception '0395: peek CONSUMED a number (% -> %)', v_before, v_after;
  end if;
  if v_peek <> 'ZZ-T1/RE/2627/0003' then
    raise exception '0395: peek returned %, expected ZZ-T1/RE/2627/0003', v_peek;
  end if;
  if public.peek_sales_order_number(null, date '2026-08-10') is not null then
    raise exception '0395: peek with no location returned a number instead of null';
  end if;

  -- Clean up. The counter rows must go first — the FK is `on delete restrict`,
  -- which is the protection this test is standing on.
  delete from public.sales_order_no_counters where location_id in (v_loc_a, v_loc_b);
  delete from public.locations where id in (v_loc_a, v_loc_b);
end $$;
