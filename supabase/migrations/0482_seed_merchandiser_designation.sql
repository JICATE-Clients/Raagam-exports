-- ============================================================================
-- Raagam ERP — 0482 seed the "MERCHANDISER" designation
--
-- User decision 2026-08-31, following the measurement that made 0478
-- undeployable: the HR Employee master holds one test row, and **no
-- `config_lookups` row anywhere contains the word "merchandiser"**. So the
-- Merchandiser picker on Order Entry — mandatory from the same day — has
-- nothing to offer and cannot be given anything, because the designation an
-- employee would be tagged with does not exist yet.
--
-- This seeds the VOCABULARY. It creates no people.
--
--
-- ## IT CREATES NO EMPLOYEES, AND THAT IS NOT LAZINESS
--
-- Employees are real people with real names, and a migration inventing them
-- writes a person into the HR master who does not work here. AGENTS.md refuses
-- exactly this in the Created Date section — *"inventing a creator is a lie in
-- an audit column"* — and an invented employee is worse, because an order can
-- then be attributed to them and the attribution looks entirely ordinary.
--
-- The user creates and tags the real merchandisers on the Employee master.
--
--
-- ## `kind = 'designation'` — PINNED AGAINST THE CONSTRAINT AND AGAINST THE FK
--
-- This is the one value in the migration that can be wrong while everything
-- reports success, so it is checked from two directions rather than inferred
-- from the column's NAME:
--
--   1. `'designation'` is in the `config_lookups_kind_check` CHECK. 0243 lists
--      it (that migration re-states every kind while adding two), so a row of
--      this kind is accepted rather than rejected at insert time.
--   2. `employees.designation_id` is `references public.config_lookups(id)`
--      (0243:59). That FK is the thing that decides it. There is ALSO a
--      dedicated `public.designations` master (0260) and a `designationsAsLookups`
--      shim in `lib/masters/lookup-compat.ts` that dresses its rows up in
--      ConfigLookup clothing — so "the Designation master" names two different
--      tables in this codebase, and seeding the wrong one produces a row nobody
--      can attach to an employee. The FK names `config_lookups`, and an employee
--      row cannot hold anything else, so `config_lookups` is where the row goes.
--
-- Getting that wrong would be the 0386 / 0387 failure exactly: the migration
-- applies, reports `{"success": true}`, and changes nothing measurable — the
-- join in `getMerchandiserRows()` would simply keep finding no employees, and
-- the picker would stay empty with no error anywhere.
--
--
-- ## NO `'department'` ROW — CONSIDERED, AND DECLINED
--
-- The client's rule is "Designation **or** Department", and `getMerchandiserRows`
-- genuinely reads both, so a department row would work. It is not seeded, on the
-- lead's instruction and for a reason worth recording: two rows meaning the same
-- thing invites half the merchandisers being tagged one way and half the other,
-- and every later question ("how many merchandisers are there?") then has two
-- answers. One canonical place to tag somebody.
--
-- The OR in the filter stays, and stays useful: a company that organises by
-- department can add that row later and every existing tag keeps working. What
-- is declined is seeding both on day one and letting the split happen by
-- accident. This paragraph exists so the next reader knows it was a decision.
--
--
-- ## CASING
--
-- `MERCHANDISER`, in capitals, because field values are stored in capitals
-- (AGENTS.md, and the app-wide default since 2026-08-18). It does not affect
-- matching either way: `getMerchandiserRows()` compares
-- `name.trim().toLowerCase() === "merchandiser"`, and the idempotence guard
-- below compares `lower(...)`, so a row somebody later re-types as
-- "Merchandiser" is still found and still not duplicated.
--
--
-- ## DEPLOY ORDER — GETTING THIS WRONG IS AN OUTAGE
--
--   1. Apply **0482** (this file). The designation exists.
--   2. The user creates the merchandiser employees on the Employee master and
--      sets each one's Designation to MERCHANDISER.
--   3. **Only then** apply **0478**, before or with the code — never after.
--
-- 0478 makes Merchandiser mandatory and clears every existing order's value.
-- Applying it while step 2 is undone leaves the picker empty on a mandatory
-- field, which means **no order in the system can be saved** — not the one being
-- edited and not a new one. The screen explains the empty list rather than
-- leaving it mysterious (`merchandiserOptions` in
-- lib/orders/amendments/types.ts), but explaining an outage is not avoiding one.
--
-- Step 2 is done on **Master Data ▸ Associates ▸ Employee**
-- (`/masters/associates/employee`): create the person, then set their
-- **Designation** to MERCHANDISER — the picker there reads the same
-- `config_lookups` rows this migration seeds, so the value appears in it as
-- soon as 0482 has run. **Department** works equally well; the filter is
-- Designation OR Department. Either satisfies `getMerchandiserRows()`.
--
-- THAT SCREEN WAS UNREACHABLE WHEN THIS MIGRATION WAS FIRST WRITTEN, and this
-- note said so. The client had removed the Employee master on 2026-08-01 as
-- "not part of this business process"; the entity stopped being optional four
-- weeks later, when Merchandiser became mandatory and was sourced from it. The
-- user restored the row on 2026-08-31 rather than hold 0478 or ship a mandatory
-- field nothing could satisfy. Recorded because the earlier sentence was true
-- when written, and a migration header that misdescribes the world is worse
-- than one that says nothing.
-- ============================================================================


-- Idempotent in the shape 0265 uses for the same table: insert-select guarded by
-- `not exists`, matched case-insensitively on the NAME. `on conflict` would not
-- help here — the only unique index on `config_lookups` is the partial one on
-- (kind, code) for `hsn_code` (0306), so nothing would conflict and a second run
-- would simply insert a second MERCHANDISER.
insert into public.config_lookups (kind, code, name, is_active)
select 'designation', v.code, v.name, true
from (values ('MERCHANDISER', 'MERCHANDISER')) as v(code, name)
where not exists (
  select 1
    from public.config_lookups c
   where c.kind = 'designation'
     and lower(btrim(c.name)) = lower(btrim(v.name))
);


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal. What is
-- worth knowing here is not "a row was inserted" but "the row is reachable by
-- the query that needs it", so the verification RE-RUNS the service's own test
-- rather than looking the row up by primary key.
--
-- Idempotence is asserted by RUNNING THE INSERT AGAIN, not by reading the guard.
-- A `where not exists` that silently fails to match is the way this kind of
-- migration doubles a lookup row, and it would do so quietly.
-- ----------------------------------------------------------------------------

do $verify$
declare
  n_before integer;
  n_after  integer;
  tagged   integer;
begin
  /* THE SERVICE'S OWN TEST, verbatim in SQL: getMerchandiserRows() matches
     `(name ?? "").trim().toLowerCase() === "merchandiser"` over config_lookups
     and then joins employees on designation_id OR department_id. */
  select count(*)
    into n_before
    from public.config_lookups
   where lower(btrim(name)) = 'merchandiser';

  if n_before = 0 then
    raise exception '0482: no config_lookups row matches "merchandiser" — the insert did not land';
  end if;

  if not exists (
    select 1 from public.config_lookups
     where kind = 'designation' and lower(btrim(name)) = 'merchandiser'
  ) then
    raise exception '0482: a "merchandiser" row exists but not under kind ''designation'' — employees.designation_id could not reference it';
  end if;

  /* SAID OUT LOUD, NOT ONLY IN THE HEADER. Whoever APPLIES this needs the trap,
     not only whoever edits it: there is a SECOND thing called the Designation
     master in this system, and seeding that one instead would apply cleanly and
     change nothing. Printed unconditionally so it is in the console output
     beside the result. */
  raise notice '0482: seeded into config_lookups (kind=''designation''), which is what employees.designation_id references. NOTE there is also a separate public.designations table (0260) with a designationsAsLookups shim — a row added THERE cannot be attached to an employee, and adding one would apply cleanly while leaving the Merchandiser picker empty.';

  -- Run the insert a second time. It must add nothing.
  insert into public.config_lookups (kind, code, name, is_active)
  select 'designation', v.code, v.name, true
  from (values ('MERCHANDISER', 'MERCHANDISER')) as v(code, name)
  where not exists (
    select 1
      from public.config_lookups c
     where c.kind = 'designation'
       and lower(btrim(c.name)) = lower(btrim(v.name))
  );

  select count(*)
    into n_after
    from public.config_lookups
   where lower(btrim(name)) = 'merchandiser';

  if n_after <> n_before then
    raise exception '0482: re-running the insert added % row(s) — the guard does not match', n_after - n_before;
  end if;

  /* THE HONEST STATE OF PLAY, reported rather than asserted. This migration
     seeds a word; it cannot seed people, so zero tagged employees is the
     EXPECTED outcome of applying it and not a failure. Saying the number out
     loud is what stops 0478 being applied on the assumption that this file
     fixed the empty picker. */
  select count(*)
    into tagged
    from public.employees e
   where exists (
     select 1 from public.config_lookups c
      where lower(btrim(c.name)) = 'merchandiser'
        and (c.id = e.designation_id or c.id = e.department_id)
   );

  if tagged = 0 then
    raise notice '0482: the MERCHANDISER designation now exists, and NO employee holds it yet. Tag them on Master Data > Associates > Employee (/masters/associates/employee) — set each merchandiser''s Designation (or Department) to MERCHANDISER — BEFORE applying 0478. Until then the Merchandiser picker is empty and, since the field is mandatory, no order can be saved.';
  else
    raise notice '0482: the MERCHANDISER designation exists and % employee(s) hold it. 0478 is safe to apply.', tagged;
  end if;
end $verify$;
