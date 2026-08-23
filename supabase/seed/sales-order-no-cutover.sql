-- ============================================================================
-- Raagam ERP — SC No cutover: where each location's numbering RESUMES
--
-- RUN THIS ONCE, AFTER 0395 AND BEFORE THE FIRST REAL ORDER IS ENTERED.
-- It is a seed, not a migration, because the numbers in it are a fact about the
-- legacy system on the day you switch — not something a fresh database or a CI
-- run should ever apply.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM IT SOLVES.
--
-- `sales_order_no_counters` starts empty, so the first order raised at Head
-- Office in 2026-27 is numbered HO/RE/2627/0001. But RP Software has been
-- issuing SC Nos under that same format all year — HO/RE/2627/0001 is already
-- written on a real order, a real PO and a real invoice. The new system would
-- mint a second document with an identifier 500+ people already associate with
-- a different order, and every report keyed on the SC No would silently merge
-- two orders into one.
--
-- Seeding `last_no` is what prevents that. The counter is per (location, fy),
-- so this needs ONE ROW PER LOCATION that has issued numbers this year — a
-- single company-wide figure would restart every branch except one.
--
-- Nothing here renumbers anything. Existing rows in `sales_orders` keep their
-- old SO-#### codes (0395's header explains why); this only decides where the
-- NEW series picks up.
--
-- ---------------------------------------------------------------------------
-- FIND THE NUMBERS FIRST. In RP Software, per location, for the current
-- financial year, the highest running number issued so far:
--
--   HO/RE/2627/0847  → location 'HO', fy '2627', last_no 847
--
-- Take the HIGHEST issued, not the count of orders — a cancelled or deleted
-- order still consumed its number, and reusing it is the duplicate this file
-- exists to prevent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- TODO (Roja) — fill in one row per location, then run.
--
-- The shape is below; `last_no` is the last number ALREADY ISSUED, so the next
-- order gets last_no + 1. `on conflict … do update` makes the file re-runnable:
-- correcting a figure and running again is safe.
--
-- Three ways to answer this, and the choice is yours because it is about how
-- you want the year to read, not about what the code can do:
--
--   1. RESUME  — last_no = the legacy high-water mark (847 → next is 0848).
--      One unbroken series per location for the year. Cleanest on a report;
--      requires knowing the exact figure per location.
--
--   2. JUMP    — last_no = a round number above it (e.g. 999 → next is 1000).
--      Leaves a visible gap, so anyone looking at an SC No can tell instantly
--      whether it came from the old system or the new one. Costs a
--      discontinuity that an auditor will ask about, so write down why.
--
--   3. RESTART — leave this file unrun (last_no stays 0 → next is 0001).
--      ONLY correct if the switch happens on 1 April, or if the legacy system
--      never used this format at that location. During a parallel run it means
--      two live documents share an identifier.
--
-- If you are unsure of a location's figure, DO NOT GUESS LOW — guessing high
-- leaves a gap, guessing low mints a duplicate, and only one of those is
-- recoverable.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- FILLED AND RUN 2026-08-23 — U2 ONLY, strategy 2 (JUMP). Client's decision.
--
-- ## WHY 2100, WRITTEN DOWN BECAUSE STRATEGY 2 SAYS TO
--
-- Unit 2's legacy high-water mark READ FROM THE DATA is 2086 (order dated
-- 2026-08-17). 2100 clears it with ~14 of headroom and is a round number, so an
-- SC No tells you at a glance which system issued it: at or below 2086 is RP
-- Software, at or above 2101 is Raagam, and the gap between is the switch.
--
-- The headroom is not decoration. The 86 imported U2 orders come from a
-- PENDING-BALANCE report, so a fully-shipped order never appeared in it — 2086
-- is a floor on what was issued, not a ceiling. Ten serials are missing inside
-- the imported span for exactly that reason, and orders raised between
-- 2026-08-17 and the switch are invisible to us entirely. Guessing high leaves
-- an explainable gap; guessing low mints a duplicate, and only one of those is
-- recoverable.
--
-- ## WHY THE SERIAL LOOKS LIKE 2086 AND NOT 86
--
-- The legacy counter resets each April to a base near 2000, not to 1: FY 2627's
-- first order is serial 2002, dated 2026-04-03, three days into the year. So
-- 2086 is the 86th order of this financial year. Reading it as the 2,086th is
-- what made the gap count look like two thousand missing orders instead of ten.
--
-- ## WHY `2627` AND NOT `26-27`
--
-- `fy` here is the COUNTER KEY, which is `fiscal_year_segment()`'s undashed
-- output. 0431's dash lives in `fiscal_year_label()`, called only by the
-- composers. Writing `26-27` in this column orphans the counter and silently
-- restarts the series mid-year.
--
-- ## HO IS SEEDED BLIND, AT 1000 — AND THAT IS THE POINT, NOT A GAP
--
-- Added 2026-08-23, client's figure. Unlike U2 there is NO high-water mark to
-- read: the client's legacy screenshots show `HO/RE//2627/0001`, so Head Office
-- issued numbers in this format too, but no HO legacy order was ever imported.
-- Nothing in this database knows what RP Software issued at HO.
--
-- So 1000 is a CEILING, not a resumption. It is strategy 2 taken deliberately
-- without the figure: any legacy HO serial below 1000 is jumped clean over, and
-- the gap between HO's five real orders (0001-0009) and 1001 is the switch. The
-- exposure that remains is a legacy HO serial ABOVE 1000, which nobody has
-- claimed exists and which a higher ceiling could be re-run against — this file
-- is re-runnable by design.
--
-- ## WHY THE `0` PLACEHOLDER HAD TO GO FIRST
--
-- The original template carried `('HO','2627', 0)` as a TODO, under the same
-- `on conflict … do update`. Running it would have RESET Head Office's live
-- counter from 9 to 0 and re-minted HO/RE/26-27/0001, which already exists. A
-- placeholder that overwrites live state is not a placeholder, and it is why
-- this insert names its locations explicitly rather than carrying spares.
-- ---------------------------------------------------------------------------

insert into public.sales_order_no_counters (location_id, fy, last_no)
select l.id, v.fy, v.last_no
  from (values
         ('U2', '2627', 2100),  -- legacy high-water 2086, READ from the data + headroom
         ('HO', '2627', 1000)   -- no legacy figure exists; a deliberate ceiling
       ) as v(code, fy, last_no)
  join public.locations l on l.code = v.code
    on conflict (location_id, fy) do update set last_no = excluded.last_no;

-- ---------------------------------------------------------------------------
-- After running, check what the next number will be at each location. This
-- reads the counter without consuming it, so it is safe to run as often as you
-- like — and it is the same function the New Order form shows in its SC No box,
-- so what you see here is exactly what the operator will see.
-- ---------------------------------------------------------------------------
select l.code,
       l.name,
       public.peek_sales_order_number(l.id, current_date) as next_sc_no
  from public.locations l
 where l.is_active
 order by l.code;
