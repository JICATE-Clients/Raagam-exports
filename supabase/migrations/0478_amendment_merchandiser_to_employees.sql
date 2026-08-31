-- ============================================================================
-- Raagam ERP — 0478 Orders ▸ Order Management ▸ Order Entry ▸ Merchandiser
-- comes off the HR EMPLOYEE master, not off the login accounts
--
-- Client 2026-08-31: the Merchandiser field must offer the people in the HR
-- staff master, narrowed to those whose Designation *or* Department is
-- "Merchandiser" — and it becomes strictly mandatory.
--
--
-- ## WHY `employees`, AND WHY THE OTHER TWO CANDIDATES LOSE
--
-- Three tables could plausibly answer "who works here":
--
--   `profiles`   login accounts. Whoever can sign in — which is neither every
--                merchandiser (a merchandiser who does not use the system has
--                no row) nor only merchandisers (every storekeeper has one).
--                It carries no designation and no department, so the client's
--                filter is not expressible against it AT ALL.
--   `staff`      (0013) the lean payroll table: salary, ESI, PF. It has a
--                free-text `designation` and NO department, so "Designation or
--                Department" is half a question there.
--   `employees`  (0243) the Employee master proper, and the ONLY one carrying
--                both `designation_id` and `department_id`. That is what makes
--                the client's rule statable rather than approximated.
--
-- So this repoints `garment_order_amendments.merchandiser_id` from
-- `public.profiles` to `public.employees`.
--
--
-- ## THE FIELD IS ALSO CHANGING WHAT IT MEANS, AND THAT IS THE WHOLE MIGRATION
--
-- The old column answered "which LOGIN raised this document" — it is a
-- `profiles` FK, and `sales_orders.merchandiser_id` beside it defaults to
-- `auth.uid()` (0006). The new column answers "which member of STAFF is the
-- merchandiser on this order". Those are different questions with different
-- right answers, and a person can be one without being the other.
--
-- Which is why nothing here tries to be clever about the values already stored.
--
--
-- ## WHAT HAPPENS TO THE EXISTING VALUES — STATED, NOT ASSUMED
--
-- Every stored `merchandiser_id` is a `profiles` uuid and resolves against
-- `employees` only by coincidence. Leaving them would leave the column in
-- violation of its own new FK — not merely wrong on screen, but rejected the
-- next time anything updates an untouched row, with an error naming a column
-- the operator never touched.
--
-- Three things happen, in this order:
--
--   1. THE OLD ANSWER IS KEPT. `legacy_merchandiser_profile_id` is added and
--      every current value is copied into it. It is a RECORD, not a field:
--      nothing writes it and no screen shows it. The point is that changing
--      what a column MEANS must not destroy the answer it used to hold — the
--      same reasoning 0471 gives for leaving `order_unit_id` frozen beside the
--      new `unit_kind`, one table over. If the client later wants "who raised
--      it" back as its own field, the data is still here.
--
--   2. A VALUE IS CARRIED ACROSS ONLY WHERE THE IDENTITY IS CERTAIN.
--      `profiles.employee_code` and `employees.code` are the same number — the
--      one payroll knows a person by — so a match on it is a real identity and
--      not a guess. It is taken ONLY when the code is non-blank AND matches
--      exactly one row on EACH side. A blank code matches every other blank
--      code; an ambiguous one would assign an order to whichever row the
--      planner happened to return first.
--
--      NAME IS NOT USED, and refusing it is deliberate. AGENTS.md says it in
--      the duplicate-check rule: "never check `employees.name` — two workers
--      legitimately share a name". Naming the wrong merchandiser on a live
--      order is worse than naming none, because nothing about it looks wrong.
--
--   3. EVERYTHING ELSE IS NULLED. Not silently: the `do` block counts what it
--      mapped and what it cleared and `raise notice`s both, so the operator
--      applying this sees exactly how many orders now need a merchandiser
--      re-picked. NULL means "not answered", which is the honest state for a
--      question that has just been re-asked. The old answer is in (1).
--
--
-- ## `sales_orders.merchandiser_id` IS NOT REPOINTED, AND MUST NOT BE
--
-- It is a LOGIN and it has a second consumer: `sync_order_channel_members`
-- (0458) seeds the order's discussion channel with it as a `user_id`. An
-- `employees` uuid is not an account, so repointing it would break channel
-- membership for every order — and 0458's own comment says why that member
-- matters ("the one member no permission rule can identify").
--
-- The amendment action mirrored the field into `sales_orders` on every save.
-- That mirror is REMOVED in the same change (`lib/orders/amendments/actions.ts`),
-- for exactly the reason 0404 removed the party mirror beside it: writing one
-- table's uuid into a column that references another is an FK rejection, and it
-- would have failed EVERY save from the moment this migration applied. With the
-- mirror gone, `sales_orders.merchandiser_id` falls back to its `auth.uid()`
-- default — whoever saved the order — which is what the channel wants and what
-- the column has always meant.
--
--
-- ## NOT `not null`
--
-- The field is mandatory from today, and that is enforced where a person can be
-- told about it: the Zod schema (`amendmentInput`), the Save button and the
-- red `*`. A `not null` here would additionally reject every row that predates
-- the rule on its next update — including the ones step 3 just nulled — and it
-- would do so with a 23502 rather than a sentence. Same reasoning 0475 and 0471
-- give for this family of tables.
--
--
-- ## MIGRATION NOTE — THE MAPPING CHOICE, IN ONE LINE (client 2026-08-31)
--
-- Existing records unmapped in the HR Employee master have been set to **NULL**.
--
-- The client's rule is conditional on nullability: NULL where the column is
-- nullable, a system-generated "Unassigned" master row where it is not.
-- `merchandiser_id` is NULLABLE — deliberately, for the reason stated directly
-- above — so the first branch applies and the second does not arise.
--
-- WHICH IS THE OUTCOME TO WANT HERE, and worth saying rather than leaving as an
-- accident of the schema. A sentinel "System / Unassigned Merchandiser" row
-- would put a value in the column that READS like an answer: it resolves, it
-- renders a name on screen, it passes the mandatory check, and every report
-- counting orders by merchandiser would attribute a pile of them to a person who
-- does not exist. NULL cannot do any of that — it is the honest state for a
-- question that has just been re-asked, it shows as empty, and the Zod schema
-- and the red `*` make the operator answer it the next time the order is opened.
-- Step 3's `raise notice` is what turns "not answered" into a number the person
-- applying this can act on.
--
-- Nothing is lost either way: step 1 copies every pre-0478 value into
-- `legacy_merchandiser_profile_id` before anything is cleared.
--
--
-- ## AGAINST THE DATA AS IT STANDS TODAY, STEP 2 CARRIES ACROSS NOTHING
--
-- Measured on the live catalog before this was written (2026-08-31), not
-- reasoned from the schema:
--
--     employees, total rows                                       1
--     employees, active                                           1
--     with designation OR department = 'merchandiser', any state  0
--     config_lookups rows matching '%merch%'                   none
--     the sole row:  code = NULL   name = 'Test Employee'
--                    designation = 'Test Designation'
--                    department  = 'Test Department'
--
-- So the HR Employee master is, in practice, empty. The one row has a NULL
-- `code`, which step 2 requires to be non-blank on both sides — so **step 2
-- maps zero orders and step 3 clears every merchandiser this system holds.**
-- The `raise notice` will report 100% cleared.
--
-- That is this migration working exactly as designed; the design assumed a
-- populated master. It is written here rather than left to be read off the
-- console afterwards, because the consequence is a sentence and not a number:
-- **every existing order loses its merchandiser, and — since the field became
-- mandatory in the same change — none of them can be saved again until somebody
-- populates the Employee master.**
--
-- Two things follow that are NOT this file's to fix, and are recorded so the
-- person applying it is not surprised by them:
--
--   * There is no reachable Employee master screen. `EmployeeMasterScreen`
--     exists in the codebase but no route mounts it, `lib/masters/submodules.ts`
--     has no `employee` entry, and `listEmployees()` has no caller. So the data
--     cannot currently be entered through the app at all.
--   * No `config_lookups` row is named "Merchandiser", so even a fully populated
--     `employees` table would match nothing until that designation (or
--     department) exists. Note that the operator-facing Designation and
--     Department masters are the dedicated `public.designations` /
--     `public.departments` tables, while these two FKs point at
--     `config_lookups` — the rows have to be in the table the FK names.
--
-- THE FILTER IS NOT WIDENED TO COMPENSATE. Falling back to every employee when
-- none matches is the silent fallback AGENTS.md forbids under "Nominated
-- vendors" — it would make the designation advisory, let an order be attributed
-- to someone who is not a merchandiser, and ensure nobody ever learns the master
-- needs filling in. The picker empties and EXPLAINS instead
-- (`merchandiserEmptyReason` in lib/orders/amendments/types.ts). The fix is
-- data, not code.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Keep the old answer.
-- ---------------------------------------------------------------------------

alter table public.garment_order_amendments
  add column if not exists legacy_merchandiser_profile_id uuid
    references public.profiles(id) on delete set null;

comment on column public.garment_order_amendments.legacy_merchandiser_profile_id is
  'WHAT `merchandiser_id` HELD BEFORE 0478 — a public.profiles uuid, i.e. the '
  'login that raised the document. Nothing writes this and no screen shows it. '
  'It exists because 0478 changed what the Merchandiser field MEANS (login → HR '
  'employee), and the old answer is not the new one''s to overwrite. 0478.';

update public.garment_order_amendments
   set legacy_merchandiser_profile_id = merchandiser_id
 where merchandiser_id is not null
   and legacy_merchandiser_profile_id is null;


-- ---------------------------------------------------------------------------
-- 2 + 3. Carry across what is certain, clear the rest, then repoint the FK.
--
-- The remap runs BEFORE the constraint swap on purpose: doing it after would
-- mean the table sat in violation of its own FK for the length of one
-- statement, and `alter table ... add constraint` validates existing rows, so
-- the add would simply fail.
-- ---------------------------------------------------------------------------

do $remap$
declare
  mapped  integer := 0;
  cleared integer := 0;
begin
  /* `(array_agg(id))[1]`, NOT `min(id)` — Postgres has no `min(uuid)`, and this
     migration was written and reviewed but never run, so nothing caught it
     until it was applied for real on 2026-08-31 (`42883: function min(uuid)
     does not exist`). The two are equivalent HERE only because the `having
     count(*) = 1` below means the group holds exactly one id; the aggregate is
     picking the sole member, not the smallest.

     A code is an identity only when it is unambiguous on BOTH sides. The two
     `having count(*) = 1` clauses are not belt-and-braces: one profile sharing
     a code with two employees, or two profiles sharing one code, is exactly the
     case where a "match" would assign an order to the wrong person. */
  with profile_code as (
    select id, upper(btrim(employee_code)) as code
      from public.profiles
     where employee_code is not null and btrim(employee_code) <> ''
  ),
  unique_profile as (
    select code, (array_agg(id))[1] as id from profile_code group by code having count(*) = 1
  ),
  employee_code as (
    select id, upper(btrim(code)) as code
      from public.employees
     where code is not null and btrim(code) <> ''
  ),
  unique_employee as (
    select code, (array_agg(id))[1] as id from employee_code group by code having count(*) = 1
  ),
  pairs as (
    select p.id as profile_id, e.id as employee_id
      from unique_profile p
      join unique_employee e on e.code = p.code
  )
  update public.garment_order_amendments a
     set merchandiser_id = pairs.employee_id
    from pairs
   where a.merchandiser_id = pairs.profile_id;
  get diagnostics mapped = row_count;

  update public.garment_order_amendments
     set merchandiser_id = null
   where merchandiser_id is not null
     and not exists (
       select 1 from public.employees e where e.id = merchandiser_id
     );
  get diagnostics cleared = row_count;

  raise notice '0478: % order(s) carried across on a unique employee code; % cleared and needing a merchandiser re-picked (their old value is in legacy_merchandiser_profile_id)',
    mapped, cleared;
end $remap$;

alter table public.garment_order_amendments
  drop constraint if exists garment_order_amendments_merchandiser_id_fkey;

alter table public.garment_order_amendments
  add constraint garment_order_amendments_merchandiser_id_fkey
  foreign key (merchandiser_id) references public.employees(id) on delete set null;

comment on column public.garment_order_amendments.merchandiser_id is
  'The merchandiser on this order — a public.employees row (0478), narrowed on '
  'screen to staff whose Designation or Department is "Merchandiser". Was a '
  'public.profiles FK, i.e. a LOGIN; the two answer different questions and the '
  'old answer is preserved in legacy_merchandiser_profile_id. Mandatory from '
  '2026-08-31, enforced in amendmentInput rather than by NOT NULL so a row that '
  'predates the rule fails with a sentence instead of a 23502. NOT the same '
  'column as sales_orders.merchandiser_id, which stays a login because '
  'sync_order_channel_members (0458) seeds a chat member from it.';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog, and EXERCISE the FK.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and left a function anon-callable, and 0436 was
-- committed and never applied while its missing column broke every save.
--
-- The constraint is asserted by VIOLATING it rather than by reading its name
-- out of pg_constraint: a name being present proves a name is present, and what
-- is worth knowing is that a profiles uuid is actually refused now.
-- ----------------------------------------------------------------------------

do $verify$
declare
  target      text;
  probe_amend uuid;
  stray_prof  uuid;
  refused     boolean := false;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'garment_order_amendments'
       and column_name = 'legacy_merchandiser_profile_id'
  ) then
    raise exception '0478: legacy_merchandiser_profile_id was not added — the old answer would be lost';
  end if;

  select cl.relname
    into target
    from pg_constraint c
    join pg_class cl on cl.oid = c.confrelid
   where c.conrelid = 'public.garment_order_amendments'::regclass
     and c.contype = 'f'
     and c.conname = 'garment_order_amendments_merchandiser_id_fkey';

  if target is null then
    raise exception '0478: merchandiser_id has no foreign key at all';
  end if;
  if target <> 'employees' then
    raise exception '0478: merchandiser_id still references %, expected employees', target;
  end if;

  /* NO ROW MAY BE LEFT IN VIOLATION. `add constraint` would have refused, so
     this cannot fail here — which is the point of asserting it: if a later
     hand-edit ever makes the add conditional, this line is what notices. */
  if exists (
    select 1 from public.garment_order_amendments a
     where a.merchandiser_id is not null
       and not exists (select 1 from public.employees e where e.id = a.merchandiser_id)
  ) then
    raise exception '0478: an order still names a merchandiser that is not an employee';
  end if;

  select id into probe_amend from public.garment_order_amendments limit 1;
  select id into stray_prof
    from public.profiles
   where id not in (select id from public.employees)
   limit 1;

  if probe_amend is null or stray_prof is null then
    raise notice '0478: nothing to probe with — the FK was asserted structurally only';
  else
    begin
      update public.garment_order_amendments
         set merchandiser_id = stray_prof
       where id = probe_amend;
    exception when foreign_key_violation then
      refused := true;
    end;

    if not refused then
      /* Undo before failing: leaving the probe value stored would put the
         table in the state this migration exists to prevent. */
      update public.garment_order_amendments
         set merchandiser_id = legacy_merchandiser_profile_id
       where id = probe_amend and merchandiser_id = stray_prof;
      raise exception '0478: the FK accepted a profiles uuid — it does not point at employees';
    end if;
  end if;

  raise notice '0478 verified: merchandiser_id references employees, no row is in violation, and a profiles uuid is refused';
end $verify$;
