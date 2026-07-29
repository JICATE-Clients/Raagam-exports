-- ============================================================================
-- Raagam ERP -- 0368 CAPS ship values
--
-- Field values are stored in CAPITALS (client 2026-07-23). Three ship-related
-- value sets never got the rule:
--
--   1. config_lookups kind='ship_type' -- the Incoterms seed in 0241 predates
--      the rule and stored Title Case ("Ex Works"). Every other lookup name is
--      force-uppercased on write (lib/masters/extras-actions.ts), so a
--      USER-ADDED ship type already saves as "EX WORKS" while the 13 seeded
--      rows stayed Title Case. This ends that split.
--
--   2. opportunities.delivery_mode / receipt_mode, styles.ship_mode,
--      order_bookings.ship_mode / receipt_mode -- stored lowercase
--      ('air','sea','road'), while lib/masters/applicant-types.ts has held
--      ["AIR","ROAD","SEA","SEA/AIR"] for the SAME concept all along. Three
--      screens papered over it at render time; those workarounds are deleted
--      in the matching commit.
--
-- MUST SHIP WITH the code change that uppercases SHIP_MODES / DELIVERY_MODES /
-- RECEIPT_MODES in lib/sales/types.ts and lib/orders/booking-types.ts. Between
-- this migration and that deploy, the old client writes lowercase and the new
-- CHECK rejects it -- saves fail loudly, which is the safe direction. Keep the
-- window short.
--
-- Value SETS are unchanged -- only their casing. In particular applicant's
-- extra "SEA/AIR" member is deliberately NOT added to the sales/orders sets;
-- merging them is a product decision, not a casing one.
-- ============================================================================

-- ---------- 1. Incoterm names ----------
-- Safe with zero code changes: every consumer joins on ship_type_id (uuid) and
-- nothing anywhere compares a ship-type NAME string.
update public.config_lookups
   set name = upper(name)
 where kind = 'ship_type'
   and name is not null
   and name <> upper(name);

-- ---------- 2. Mode columns ----------
-- Order is forced: the data cannot be updated while the old CHECK is in place,
-- and the new CHECK cannot be added while the old data is in place.
-- So: drop -> update -> re-add.
--
-- All five were declared as INLINE column checks (0319 lines 26/28/40, 0327
-- lines 33/36), so Postgres auto-named them <table>_<column>_check. `if exists`
-- keeps this re-runnable; if a drop matches nothing the re-add below fails
-- loudly against the old data rather than silently leaving it unconstrained.
alter table public.opportunities  drop constraint if exists opportunities_delivery_mode_check;
alter table public.opportunities  drop constraint if exists opportunities_receipt_mode_check;
alter table public.styles         drop constraint if exists styles_ship_mode_check;
alter table public.order_bookings drop constraint if exists order_bookings_ship_mode_check;
alter table public.order_bookings drop constraint if exists order_bookings_receipt_mode_check;

update public.opportunities  set delivery_mode = upper(delivery_mode) where delivery_mode is not null;
update public.opportunities  set receipt_mode  = upper(receipt_mode)  where receipt_mode  is not null;
update public.styles         set ship_mode     = upper(ship_mode)     where ship_mode     is not null;
update public.order_bookings set ship_mode     = upper(ship_mode)     where ship_mode     is not null;
update public.order_bookings set receipt_mode  = upper(receipt_mode)  where receipt_mode  is not null;

alter table public.opportunities
  add constraint opportunities_delivery_mode_check
  check (delivery_mode is null or delivery_mode in ('AIR','SEA','COURIER','ROAD'));

alter table public.opportunities
  add constraint opportunities_receipt_mode_check
  check (receipt_mode is null or receipt_mode in ('EMAIL','PHONE','FAX','COURIER','DIRECT'));

alter table public.styles
  add constraint styles_ship_mode_check
  check (ship_mode is null or ship_mode in ('AIR','SEA','ROAD'));

alter table public.order_bookings
  add constraint order_bookings_ship_mode_check
  check (ship_mode is null or ship_mode in ('AIR','SEA','ROAD'));

alter table public.order_bookings
  add constraint order_bookings_receipt_mode_check
  check (receipt_mode is null or receipt_mode in ('EMAIL','PHONE','FAX','COURIER','DIRECT'));

-- ---------- 3. Amendments: the unconstrained twins ----------
-- orders_amendments.ship_mode / received_mode / pay_mode are plain text with no
-- CHECK (0126 lines 45/49/50), but the amendment screen renders each as a FIXED
-- list and the Select matches on value. RECEIPT_MODES just moved from Title Case
-- ("By Mail") to CAPS, so a row still holding the old string would render as an
-- empty dropdown on an existing amendment. Rewrite the data to match.
-- ship_mode and pay_mode were already CAPS in code; upper() is a no-op there and
-- costs nothing, so it also cleans up anything hand-entered before the lists.
update public.orders_amendments set received_mode = upper(received_mode) where received_mode is not null;
update public.orders_amendments set ship_mode     = upper(ship_mode)     where ship_mode     is not null;
update public.orders_amendments set pay_mode      = upper(pay_mode)      where pay_mode      is not null;
