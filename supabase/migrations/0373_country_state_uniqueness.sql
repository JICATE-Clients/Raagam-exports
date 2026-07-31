-- ============================================================================
-- Raagam ERP — 0373 Country / State uniqueness
--
-- Countries were duplicating. "INDIA" could be saved twice — once from the
-- Country master, once from the "+ Add" sheet on any of the 12 Country fields —
-- because nothing rejected it at any layer. This is the third layer. The other
-- two (a live "already exists" hint as the operator types, and a
-- `checkDuplicateName` guard in the create/update actions) ship alongside it in
-- lib/masters/country-actions.ts, lib/masters/state-actions.ts,
-- components/masters/country-master-screen.tsx, country-picker.tsx and
-- state-master-screen.tsx. `public.states` had the same hole and gets the same
-- treatment.
--
-- ---------------------------------------------------------------------------
-- RUN THIS ONLY AFTER ANY EXISTING DUPLICATES ARE MERGED.
-- ---------------------------------------------------------------------------
-- `create unique index` fails outright — and rolls the whole migration back —
-- if the table already holds two rows that collide. Take the census FIRST with
-- the two queries in section 1 below. If either returns rows, work through
-- section 3 (a HUMAN chooses which row survives) before running section 2.
--
-- Census taken 2026-07-31 against the live project: BOTH queries returned zero
-- rows, so at that moment section 2 applies cleanly and section 3 is dead
-- weight. Re-run the census before applying — that reading is a snapshot, and
-- the defect this migration closes is exactly the one that creates new rows.
--
-- A DEACTIVATED NAME STAYS RESERVED: an inactive "INDIA" keeps the name taken,
-- so these are PLAIN unique indexes, not partial ones on `where inactive =
-- false`. This matches how `config_lookups` already behaves via
-- `uq_config_lookups_kind_name`, and it is what the client- and server-side
-- guards assume — a partial index here would let those two layers disagree with
-- the database.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. CENSUS — read-only. Run these by hand before applying section 2.
-- ---------------------------------------------------------------------------
-- select lower(trim(name)) as key, count(*), array_agg(id)
--   from public.countries group by 1 having count(*) > 1;
--
-- select lower(trim(name)) as key, count(*), array_agg(id)
--   from public.states group by 1 having count(*) > 1;


-- ---------------------------------------------------------------------------
-- 2. THE CONSTRAINTS
-- ---------------------------------------------------------------------------
-- `lower(trim(name))` rather than `name`: the duplicates that actually reach
-- the table are "India" / "INDIA" / "INDIA " — the same country typed by two
-- operators, not two different strings. The write path uppercases and trims
-- (Zod `capsName`), but data-io imports and rows saved before that rule did
-- not, so the constraint has to normalise rather than trust the value.

create unique index if not exists uq_countries_name
  on public.countries (lower(trim(name)));

-- Scoped per country, because `public.states` DOES carry a `country_id`
-- (nullable, `on delete set null` → public.countries) — verified against the
-- live schema, it is not in 0262 but was added later. "GEORGIA" is a US state
-- and a sovereign country's state list both, so an unscoped index would be
-- wrong the first time the master holds more than India.
--
-- `nulls not distinct` (PostgreSQL 15+; the project runs 17.6) is load-bearing:
-- nothing in the app writes `states.country_id` — it is absent from
-- `StateInput` — so every row created through the UI sits at country_id = null,
-- and under the default NULLS-DISTINCT rule those rows would ALL slip past the
-- index and the migration would protect nothing at all.
create unique index if not exists uq_states_name
  on public.states (country_id, lower(trim(name))) nulls not distinct;


-- ---------------------------------------------------------------------------
-- 3. MERGING DUPLICATES — COMMENTED OUT ON PURPOSE. A HUMAN MUST DECIDE.
-- ---------------------------------------------------------------------------
-- Only needed if the section 1 census came back non-empty.
--
-- WHICH ROW SURVIVES IS NOT A DECISION THIS FILE CAN MAKE. The duplicates are
-- rarely identical: one carries the ISD code that a dozen contact fields read,
-- the other the ECGC code the export documents need, and one of the two may be
-- the `default_country`. Read both rows, decide which is the keeper — or hand-
-- merge the good columns onto it first — then fill in the two ids below,
-- uncomment, and run ONE pair (keeper, loser) at a time.
--
-- Every child column below is a real FK found in the live schema; leave none
-- out or the delete fails on the one you missed. The `where` clauses are not
-- decorative — an unqualified update would repoint every row in the table.

-- ---- 3a. COUNTRY: fold :loser_id into :keeper_id -------------------------
-- begin;
-- -- \set keeper_id '00000000-0000-0000-0000-000000000000'
-- -- \set loser_id  '00000000-0000-0000-0000-000000000000'
--
-- update public.applicants                 set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.applicants                 set address_country_id = :'keeper_id' where address_country_id = :'loser_id';
-- update public.bank_branches              set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.brands                     set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.consignees                 set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.consignees                 set address_country_id = :'keeper_id' where address_country_id = :'loser_id';
-- update public.courier_delivery_addresses set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.courier_delivery_addresses set address_country_id = :'keeper_id' where address_country_id = :'loser_id';
-- update public.customers                  set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.customers                  set address_country_id = :'keeper_id' where address_country_id = :'loser_id';
-- update public.destinations               set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.garment_order_amendments   set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.garment_styles             set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.master_vendor_addresses    set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.master_vendors             set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.notifies                   set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.notifies                   set address_country_id = :'keeper_id' where address_country_id = :'loser_id';
-- update public.opportunities              set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.packing_advice_lines       set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.ports                      set country_id         = :'keeper_id' where country_id         = :'loser_id';
-- update public.states                     set country_id         = :'keeper_id' where country_id         = :'loser_id';
--
-- delete from public.countries where id = :'loser_id';
-- commit;

-- ---- 3b. STATE: fold :loser_id into :keeper_id ---------------------------
-- begin;
-- -- \set keeper_id '00000000-0000-0000-0000-000000000000'
-- -- \set loser_id  '00000000-0000-0000-0000-000000000000'
--
-- update public.applicants                 set state_id = :'keeper_id' where state_id = :'loser_id';
-- update public.company_profile            set state_id = :'keeper_id' where state_id = :'loser_id';
-- update public.consignees                 set state_id = :'keeper_id' where state_id = :'loser_id';
-- update public.courier_delivery_addresses set state_id = :'keeper_id' where state_id = :'loser_id';
-- update public.customers                  set state_id = :'keeper_id' where state_id = :'loser_id';
-- update public.master_vendor_addresses    set state_id = :'keeper_id' where state_id = :'loser_id';
-- update public.notifies                   set state_id = :'keeper_id' where state_id = :'loser_id';
--
-- delete from public.states where id = :'loser_id';
-- commit;
--
-- NOTE on the state FKs: every one of them is `on delete set null`, so deleting
-- a loser WITHOUT repointing first would not error — it would silently blank
-- the state on those records. That is the whole reason the updates come first
-- and the delete last, inside one transaction.
