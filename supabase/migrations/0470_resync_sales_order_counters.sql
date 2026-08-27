-- =============================================================================
-- 0470 — resync the RE No counters to the highest number actually issued
--
-- Client 2026-08-27: "RE No — why now starting from 1001?"
--
-- ## WHAT WAS WRONG
--
-- `sales_order_no_counters` holds `last_no` per (location, fiscal year) and the
-- next order takes `last_no + 1`. Measured before this migration:
--
--     HO   5 orders, highest HO/RE/26-27/0009    counter 1000   next 1001
--     U2  86 orders, highest U2/RE//2627/2086    counter 2100   next 2101
--
-- HO's orders were issued 0001 and 0006–0009 between 2026-08-18 and 08-21, so
-- numbering was working normally the whole time. A counter of 1000 against a
-- highest issued number of 9 cannot have been produced by the assigner:
-- `assign_order_number()` only ever does `last_no = c.last_no + 1`, and there is
-- no migration in this repository that seeds or bumps these rows. Both counters
-- were set by hand, against the live database, with nothing recording why.
--
-- ## THE INVARIANT, STATED
--
-- `last_no` IS the highest number issued for that (location, fy). Everything
-- else in 0395 follows from that: the peek shows `last_no + 1`, the trigger
-- returns the incremented value, and the April reset happens because a new fy
-- key starts at 0 rather than because anything resets it.
--
-- A counter ABOVE the highest issued number is not dangerous — it cannot mint a
-- duplicate — which is exactly why it went unnoticed for days. It just skips
-- numbers, and on a document series an unexplained jump from 0009 to 1001 is
-- something an auditor asks about and nobody can answer.
--
-- A counter BELOW it is the dangerous direction, and this migration cannot
-- create one: it sets the counter TO the maximum, never past it or short of it.
--
-- ## U2 MOVES TOO, AND THAT IS DELIBERATE — SAY SO OUT LOUD
--
-- U2's next number becomes 2087 rather than 2101. Nothing is renumbered and no
-- order is touched; 2087–2100 were never issued to anything, so no collision is
-- possible in either direction. The 14-number gap was not a reservation anybody
-- recorded — if it turns out the business wanted room left after the legacy
-- import, the fix is to raise that one counter deliberately AND write down why,
-- which is precisely what was missing here.
--
-- ## THE NUMBER IS PARSED FROM THE TRAILING DIGITS, WHICH IS THE ONLY THING BOTH
-- ## FORMATS SHARE
--
-- App-issued numbers read `HO/RE/26-27/0009` (dashed fiscal year, since 0431).
-- Legacy imported ones read `U2/RE//2627/2086` — a DOUBLE SLASH and an undashed
-- year. Splitting on '/' by position gets a different field for each; taking the
-- trailing run of digits gets the right one from both, and from any third
-- spelling a future import invents.
--
-- Rows whose number ends in no digits at all contribute nothing rather than
-- zero, so a malformed row cannot drag a counter DOWN to the dangerous side.
--
-- ## GROUPED BY THE FY THE ORDER WOULD BE ASSIGNED TODAY
--
-- `fiscal_year_segment(order_date)`, the same function the trigger keys on — NOT
-- the year embedded in the string. The two agree today, and if they ever
-- disagree the assigner's answer is the one that decides which counter row the
-- next order will read, so it is the one to group by.
-- =============================================================================

update public.sales_order_no_counters c
   set last_no = m.max_no
  from (
    select o.location_id,
           public.fiscal_year_segment(o.order_date) as fy,
           max((regexp_match(o.order_number, '(\d+)\s*$'))[1]::int) as max_no
      from public.sales_orders o
     where o.order_number is not null
       and o.order_number ~ '\d\s*$'
     group by o.location_id, public.fiscal_year_segment(o.order_date)
  ) m
 where c.location_id = m.location_id
   and c.fy = m.fy
   and c.last_no <> m.max_no;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran. What matters is the invariant, and it
-- is asserted over EVERY counter row rather than the two that prompted this —
-- a fix verified only against its own example is a fix that says nothing about
-- the next location somebody adds.
-- ----------------------------------------------------------------------------

do $verify$
declare
  bad      int;
  offender text;
begin
  select count(*), min(l.code || ' ' || c.fy)
    into bad, offender
    from public.sales_order_no_counters c
    join public.locations l on l.id = c.location_id
    left join lateral (
      select max((regexp_match(o.order_number, '(\d+)\s*$'))[1]::int) as max_no
        from public.sales_orders o
       where o.location_id = c.location_id
         and public.fiscal_year_segment(o.order_date) = c.fy
         and o.order_number ~ '\d\s*$'
    ) m on true
   where coalesce(m.max_no, 0) <> c.last_no;

  if bad > 0 then
    raise exception '0470: % counter row(s) still disagree with the numbers issued, e.g. %',
      bad, offender;
  end if;

  -- The direction that would actually hurt. Stated separately from the equality
  -- above so a later change that relaxes one does not silently relax the other:
  -- a counter BELOW the highest issued number mints a duplicate on the next save.
  if exists (
    select 1
      from public.sales_order_no_counters c
      join lateral (
        select max((regexp_match(o.order_number, '(\d+)\s*$'))[1]::int) as max_no
          from public.sales_orders o
         where o.location_id = c.location_id
           and public.fiscal_year_segment(o.order_date) = c.fy
           and o.order_number ~ '\d\s*$'
      ) m on true
     where c.last_no < coalesce(m.max_no, 0)
  ) then
    raise exception '0470: a counter is BELOW its highest issued number — the next order would duplicate';
  end if;

  raise notice '0470 verified: every counter equals the highest number issued for its location and year';
end $verify$;
