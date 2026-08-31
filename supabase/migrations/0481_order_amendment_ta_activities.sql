-- ============================================================================
-- Raagam ERP — 0481 Orders ▸ Order Entry ▸ T&A — the order's own Time & Action
-- path.
--
-- `garment_order_amendment_ta_activities` — the 21st child of
-- `garment_order_amendments`, written by `writeChildren` like its siblings.
-- One row per activity in the order's ladder: Fabric Plan, Accessories BOM,
-- Yarn Purchase, Knitting, Dyeing, Cutting, Sewing, Packing, Inspection,
-- Shipment.
--
-- Client: "an order cannot be saved without its T&A path being defined", and
-- the reason legacy T&A died is that NOTHING EVER READ IT. So this table exists
-- to be queried, not merely to be filled in: a staff member logs in and is told
-- what their department owes today, and an activity past its `target_date` with
-- no `actual_date` is a backlog item that escalates. Every column below is
-- shaped by one of those two halves — the entry, or the daily read.
--
--
-- ## NUMBERED 0481, NOT 0478 — AND THE NUMBER MOVED TWICE WHILE THIS WAS
-- ## BEING WRITTEN
--
-- The build contract asked for `0478_order_amendment_ta_activities.sql`. 0478
-- was already taken (`0478_amendment_merchandiser_to_employees.sql`), so this
-- was written as 0479 — and 0479 and 0480 were both claimed, as untracked
-- files, by a second session editing this same working tree in the same hour
-- (`0479_amendment_file_per_style.sql`, `0480_combo_yarn_colours.sql`).
--
-- Two migrations sharing a number is not a naming quibble: the runner orders by
-- it, so one of the two silently does not run — the 0436 failure mode this repo
-- already records ("committed and never applied while its missing column broke
-- every save"). CHECK `ls supabase/migrations | tail` AGAINST THE WORKING TREE,
-- not against `git log`: a concurrent session's migration is untracked, so it is
-- invisible to every check that reads the index.
--
--
-- ## `row_uid` IS THE ANCHOR, AND IT IS THE WHOLE REASON THIS TABLE IS
-- ## DIFFERENT FROM ITS TWENTY SIBLINGS
--
-- `writeChildren` DELETES EVERY CHILD ROW AND REINSERTS. That is fine for a
-- pack type or a price line: the form holds the whole truth, so re-stating it is
-- lossless. It is NOT fine here, because two of this table's columns are not
-- entered on the order screen at all.
--
--     entered on the ORDER, on the T&A tab   activity_id · days_required
--     entered on the DASHBOARD, days later   actual_date · status · notes
--
-- So an operator reopening the order to fix a typo in Pay Terms and pressing
-- Save would destroy every completion record on the order — silently, with no
-- error, because deleting a child grid and writing it back is the ordinary
-- thing this writer does.
--
-- That is not hypothetical. It is the bug this repo has already paid for. From
-- AGENTS.md and the Material Attribute post-mortem: "BOTH writers replaced child
-- grids wholesale over an ON DELETE SET NULL FK; 12/12 lines + 10 answers
-- destroyed and unrecoverable."
--
-- `row_uid` is the fix, and it is 0446's fix applied a second time — minted
-- ONCE by the client, never shown, never edited, round-tripped by the form. The
-- writer reads the saved rows BEFORE the delete and carries `actual_date` /
-- `status` / `notes` across onto the incoming row bearing the same `row_uid`.
--
-- NEVER `id`, and never `sno`. Both are re-minted by the reinsert: `id` by
-- `gen_random_uuid()`, `sno` by the normalizer renumbering 1..n. 0459 states it
-- in one line — "the process row's `id` dies at the same save".
--
-- ### uuid, NOT text — a deliberate departure from the build contract
--
-- The contract wrote `row_uid text not null`. This is `uuid not null default
-- gen_random_uuid()`, copied character for character from 0446's line on
-- `material_bom_amendment_processes`, because this IS that anchor a second time
-- and two spellings of one idea is how the supply-type enums came to disagree on
-- case across three modules (0475). The client mints `crypto.randomUUID()`,
-- which is a uuid; the engine's `TaLadderRow.row_uid: string` is satisfied by
-- one; nothing downstream can tell the difference. What the stronger type buys
-- is that a mangled anchor is rejected at the door with a 22P02 rather than
-- stored as a key that will never match anything again.
--
-- ### THE DEFAULT IS A BACKSTOP FOR NON-APP WRITERS ONLY, AND THE SCHEMA IS
-- ### STRICTER THAN 0446'S ON PURPOSE
--
-- `mbaProcessInput.row_uid` is `.optional()`, and 0446 argues for that: "a
-- payload from an older client cannot fail to save — it produces a visibly
-- un-dispatched row instead". The stakes are not the same here. A lost anchor
-- there yields a findable orphan challan line; a lost anchor HERE re-mints the
-- row and the completion it carried is gone, invisibly, which is the exact
-- outcome the anchor exists to prevent.
--
-- There is also no older client to protect: this table is created today, so no
-- payload predates it. `amendmentTaActivityInput.row_uid` is therefore
-- REQUIRED — a payload without one fails validation with a sentence naming the
-- cause, which is a loud, one-edit failure instead of a silent data loss. The
-- DB default still earns its place for a hand-written INSERT and for any future
-- writer that omits the column.
--
--
-- ## `target_date` IS STORED, AND EVERYWHERE ELSE IN THIS REPO IT WOULD NOT BE
--
-- `chain.ts` is the canonical statement of the house rule — a value that can be
-- derived is derived, because "two columns and their difference kept in three
-- places is two chances for them to disagree" (0446, about Balance). 0414
-- refused `pcs_per_pack` and 0467 refused `pieces_per_pack` on that test, and
-- 0472 refused a `pieces` column three weeks ago.
--
-- This column fails that test and is here anyway, for one reason: THE DAILY
-- DASHBOARD ASKS POSTGRES "what is due today, across every open order". A
-- working-day ladder — Sundays off, an optional holiday set, each step counted
-- back from the step after it — is not a question SQL can answer, and deriving
-- it per row in the application would mean loading every open order to render
-- one worklist.
--
-- ### WHAT MAKES STORING IT SAFE IS `purchase_qty`'s RULE: BOTH HALVES OR
-- ### NEITHER
--
-- The screen and the server action call the SAME `orderTaLadder()`
-- (`lib/orders/ta/order-ladder.ts`), so the stored date is never a second
-- opinion — it is the same computation, written down. A screen resolving a
-- ladder the server did not is a date no control enforces, which is 0475's
-- complaint about a default that "will never fire through the application's own
-- writer" pointed at a date instead of a string.
--
-- `date`, not `timestamptz`. A T&A step is due on a DAY, and the app's own
-- `today()` returns `YYYY-MM-DD` for comparison against `date` columns
-- precisely because a timestamp read in UTC on a UTC+5:30 business reads a day
-- behind for the first five and a half hours of every Tirupur day — a bug this
-- repo has shipped twice.
--
--
-- ## THIS MIGRATION IS ONLY HALF THE FIX FOR `status` — 0475's LESSON AGAIN
--
-- **A column default applies only when an INSERT omits the column.** It does NOT
-- apply when the writer names the column with an explicit NULL. And this writer
-- always names it: the merge described above carries the saved `status` onto the
-- incoming row, so `status` is on every insert by construction.
--
-- So the writer half lands in the SAME CHANGE as this migration rather than
-- being left to a follow-up: `normalizeTaActivities` in
-- `lib/orders/amendments/actions.ts` coalesces to `'pending'`, so a NULL never
-- reaches the column from the app. Without it the insert would not quietly
-- default — it would violate `not null` and fail the whole save, which is at
-- least loud, but loud on a document nobody could then save at all.
--
-- The default below still earns its place for a hand-written INSERT and for any
-- future writer that omits the column.
--
--
-- ## THE VOCABULARY IS A CHECK CONSTRAINT HERE, UNLIKE 0476's `purchase_stage`
--
-- 0476 declined a CHECK because the client's list was provisional and the field
-- was locked on screen. Neither is true here. These three values are not a
-- vocabulary someone might extend — they are the state machine the dashboard
-- reads ("past `target_date` with no `actual_date` is Pending/Backlog"), and a
-- fourth spelling arriving from an import would not read as a new option, it
-- would read as a row that is in no bucket and appears in no worklist. An empty
-- worklist is the dangerous failure: it is indistinguishable from "nothing is
-- due today", so it gets believed rather than reported.
--
-- The three strings and the constraint name are copied VERBATIM from
-- `ta_plan_activities` (0401, folded in from 0273) — same question, same
-- answers, one spelling. Inventing a second set for the same state machine is
-- the case-drift 0475's header exists to prevent.
--
--
-- ## `updated_at` HAS A TRIGGER AND NO SIBLING CHILD TABLE HAS ONE
--
-- `garment_order_amendment_pack_type_lines` (0472) carries `created_at` and
-- nothing else, and that is right for it: the row is only ever deleted and
-- reinserted, so it has no lifetime during which anything could change.
--
-- This row does. The dashboard UPDATES it in place — `actual_date` and `status`
-- are set on a row that already exists — which makes "when was this last
-- touched" a real question for the first time on an amendment child. The
-- trigger is `public.set_updated_at`, the same one `ta_plan_activities` uses.
--
--
-- ## `created_by` RECORDS WHO PLANNED THE LINE, NOT WHO COMPLETED IT
--
-- Worth stating because the column will be read as the second thing and it is
-- not: the row is re-inserted on every order save, so `created_by` is whoever
-- last saved the ORDER — not whoever ticked the activity done on the dashboard.
-- Nothing here answers that; a completion's author would need its own column,
-- written by the dashboard's own action, and there is no screen asking for it
-- today.
--
-- The column follows the house pattern all the same (`default auth.uid()`,
-- 0383/0388) so the fact is captured rather than lost. AGENTS.md exempts a
-- LINE-ITEM table from the Created Date / Created User *columns* on screen —
-- "a PO line has no creator worth a column; the document above it does" — and
-- that exemption is what applies here.
--
--
-- ## IT ALSO SEEDS `ta_activities`, BECAUSE THE TABLE IS EMPTY
--
-- MEASURED FROM THE CATALOG, NOT ASSUMED: `ta_activities` held **0 rows** on the
-- live database. The T&A grid seeds its ladder from that master, so with it
-- empty the tab renders no rows, the operator can enter no days, and no ladder
-- can ever be defined — for every order, app-wide.
--
-- ### THIS PARAGRAPH SAID "AND THE TAB IS MANDATORY" AND NO LONGER DOES
--
-- Written hours before the client made the tab OPTIONAL — *"make it optional now
-- will implement it later as required"* (2026-08-31) — and the original
-- reasoning is corrected here rather than deleted, because a future reader would
-- otherwise be told this seed averted a blocking outage that, by the time they
-- read it, had never existed.
--
-- What was true when it was written: the tab was mandatory, so an empty master
-- did not degrade Order Entry, it BLOCKED it — the failure this repo keeps
-- meeting from the other end, a mandatory field whose list comes up empty, and
-- the one shape that reads as "the screen is broken" rather than "somebody has
-- not filled in a master".
--
-- What is true now, and why the seed still earns its place UNCHANGED:
--
--   * today an empty master makes the tab USELESS rather than blocking — the
--     operator can save, and simply has no T&A path to enter;
--   * the client has said the requirement RETURNS ("later as required"), and on
--     that day an unseeded master is the blocking outage described above,
--     arriving in a release that changed one line and touched no master.
--
-- Seeding now is what stops that. The rest of this section — what may and may
-- not be seeded, and why these ten in particular — is unaffected by the
-- reversal and stands as written.
--
-- ### SEEDING THIS IS LEGITIMATE, AND THE LINE IS WORTH DRAWING
--
-- AGENTS.md records a seeded word list being removed two days after it
-- "corrected" a Packing Accessories name to COTTON, and the rule it left behind
-- is real: a vocabulary nobody asked for must not reach a screen that did not
-- request it. These ten are the opposite case on every count. They are the
-- CLIENT'S OWN WORDS from the spec, in the client's own order; they are a
-- standardised process ladder rather than a claim about anybody; nothing here is
-- ever "corrected" onto a value an operator typed; and a wrong one is edited on
-- the TA Activity master in ten seconds.
--
-- The distinction to keep: seeding a vocabulary the client named is a claim the
-- client owns and can correct. Seeding PEOPLE, or a department, would be a claim
-- about the world.
--
-- ### `sequence` 1..10 IS THE LOAD-BEARING PART
--
-- The screen seeds the grid by `sequence`, and `orderTaLadder` takes rows in
-- EXECUTION order and reverses internally. A wrong `sequence` therefore does not
-- look wrong: it produces a complete, plausible ladder with every date against
-- the wrong activity. That is the failure nobody reports.
--
-- ### `department` IS DELIBERATELY NOT SEEDED
--
-- It is the free-text legacy column, empty everywhere, and the dashboard reads
-- it only as a fallback behind `ta_department_assign_lines`. Guessing which
-- department owns Knitting is exactly the claim-about-the-world above. NULL, and
-- the client maps it on TA Department Assign.
--
-- ### `default_offset_days` STAYS 0, WHICH MEANS "NOT ANSWERED"
--
-- The screen prefills Days only when this is `> 0`, precisely so a seeded 0 is
-- not read as "this step takes no time". The offsets are the operator's
-- per-order input; a seeded number would look configured and be arbitrary.
--
-- ### CAPITALS, AND THE STABLE HANDLE IS `short_name`
--
-- Field values are stored in capitals app-wide since 2026-08-18, and these will
-- sit in the same list as rows an operator types — a seed in Title Case would be
-- the one set of odd rows in the master. The idempotency guard matches on
-- `upper(short_name)` rather than on the name, because the name is the string a
-- client is most likely to reword and the short name is the handle legacy's own
-- form treats as the identifier (0266).
--
-- ### THE ASSERTION IS "MY TEN ARE THERE", NOT "THE TOTAL IS 10"
--
-- A deliberate narrowing of the instruction, stated rather than made quietly. A
-- total of 10 is the same fact today and stops being true the moment the client
-- adds an eleventh activity — which is the expected, correct future — and a
-- re-run would then fail a migration that had done nothing wrong. So the verify
-- block asks the migration's OWN question: is each of these ten names present
-- exactly once, and does it carry the sequence this migration gave it.
--
--
-- ## NO BACKFILL, AND THAT IS NOT THE 0466 SHORTCUT
--
-- 0474/0475/0476 each wrote a backfill that was a no-op on this database and
-- said why: "a migration that skips its backfill because the dev database
-- happens to be empty ships a gap that only appears where it matters." That
-- argument is about a column added to a table that already holds rows. This
-- migration CREATES the table, so there are no prior rows anywhere, on any
-- environment, by construction — an UPDATE here would be theatre, not caution.
--
-- What the same instinct DOES buy is the re-run guard. `create table if not
-- exists` is silent when it does nothing, so a database already holding an
-- earlier, narrower version of this table would skip the create and end up with
-- the columns it had before — 0401 hit exactly this ("a recreated table does NOT
-- re-run [0273], so those columns are folded in below"). The verify block
-- therefore names every column ONE BY ONE rather than counting them.
-- ============================================================================


create table if not exists public.garment_order_amendment_ta_activities (
  id            uuid primary key default gen_random_uuid(),
  amendment_id  uuid not null
                  references public.garment_order_amendments(id) on delete cascade,

  -- THE ANCHOR. See the header. Never shown, never edited, minted client-side
  -- and round-tripped; the default is a backstop for writers that are not the
  -- app. NOT `id` and NOT `sno` — both die at the next save.
  row_uid       uuid not null default gen_random_uuid(),

  -- Execution order: Fabric Plan first, Shipment last. Dense, renumbered 1..n on
  -- every save, exactly as every sibling child grid's `sno` is.
  sno           int not null default 0,

  -- Which activity, from the `ta_activities` master (0035 · 0266). The Dept the
  -- grid shows is READ THROUGH THIS, off `ta_activities.department` — not
  -- copied here, because a department is a property of the activity and a copy
  -- would be a second answer that goes stale the day the master is edited.
  --
  -- `on delete set null` and not `cascade`: retiring an activity from the master
  -- must not silently delete a step out of a live order's ladder, taking its
  -- completion with it. Same call `ta_department_assign_lines` (0267) makes.
  activity_id   uuid references public.ta_activities(id) on delete set null,

  -- The operator's "Days" offset — working days this step needs, counted back
  -- from the step after it.
  --
  -- NULLABLE, AND NULL IS NOT ZERO. A row nobody has filled in yet is a legal
  -- row (the grid seeds the whole ladder on first open), and `backwardSchedule`
  -- already refuses it BY NAME — "Knitting: enter how many days it needs".
  -- Defaulting it to 0 would collapse two steps onto one date and the plan would
  -- still look complete, which is the "0 is not an answer" call every BOM engine
  -- in this repo makes, on a figure that is a delivery promise rather than money.
  days_required int,

  -- STORED, not derived. See the header for why this one column breaks the house
  -- rule, and what makes it safe.
  target_date   date,

  -- Entered on the DASHBOARD, never on the order's T&A tab. This column and the
  -- two below it are what the merge in `writeChildren` exists to carry across a
  -- save; see the header.
  actual_date   date,

  status        text not null default 'pending',

  notes         text,

  -- Who PLANNED the line — not who completed it. See the header.
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Name and values copied verbatim from `ta_plan_activities` (0401), which
  -- answers the same question. One spelling of one state machine.
  constraint garment_order_amendment_ta_activities_status_check
    check (status in ('pending','in_progress','done'))
);

-- The dashboard updates a row in place, so this table has a lifetime. No
-- sibling amendment child does — see the header.
drop trigger if exists trg_goa_ta_activities_updated
  on public.garment_order_amendment_ta_activities;
create trigger trg_goa_ta_activities_updated
  before update on public.garment_order_amendment_ta_activities
  for each row execute function public.set_updated_at();

-- THE MERGE DEPENDS ON THIS BEING UNIQUE. `writeChildren` reads the saved rows
-- into a Map keyed by `row_uid`; two rows sharing one under a single amendment
-- would put one row's completion onto the other. Per amendment, not global, so
-- copying an order keeps each document's anchors to itself. Same shape as
-- `uq_mba_proc_row_uid` (0446).
create unique index if not exists uq_goa_ta_activities_row_uid
  on public.garment_order_amendment_ta_activities (amendment_id, row_uid);

-- The write path: every read and every delete in `writeChildren` is by
-- amendment.
create index if not exists idx_goa_ta_activities_amend
  on public.garment_order_amendment_ta_activities (amendment_id);

-- THE DASHBOARD'S OWN INDEX, and the reason `target_date` is a stored column at
-- all: "what is due today, across every open order" is
-- `where target_date <= $today and status <> 'done'`. Without this it is a
-- sequential scan of every activity of every order ever entered, run on every
-- login.
create index if not exists idx_goa_ta_activities_due
  on public.garment_order_amendment_ta_activities (target_date, status);

comment on table public.garment_order_amendment_ta_activities is
  'The order''s Time & Action ladder (0481) — one row per activity, entered on '
  'Order Entry ▸ T&A and completed on the T&A dashboard. `target_date` is '
  'STORED (not derived) so the daily worklist is a SQL question; both the '
  'screen and the server action resolve it through the same orderTaLadder(). '
  'Merged on save by `row_uid`, never replaced wholesale: actual_date, status '
  'and notes are entered days later and a delete-and-reinsert would destroy '
  'them.';

comment on column public.garment_order_amendment_ta_activities.row_uid is
  'Immutable per-row anchor (0481, the 0446 pattern). NEVER shown or edited. '
  'writeChildren deletes and reinserts every child row on save, so neither id '
  'nor sno survives; the completion columns are carried across by THIS. Minted '
  'client-side and required by the Zod input, with a DB default as the backstop '
  'for writers that are not the app.';

comment on column public.garment_order_amendment_ta_activities.target_date is
  'The date this step must be COMPLETE by. STORED rather than derived — the one '
  'place in this module that breaks that rule — because the daily dashboard '
  'asks Postgres "what is due today across every open order", and a working-day '
  'ladder with a holiday set is not a question SQL can answer. Safe only '
  'because the screen and the server action both resolve it through '
  'orderTaLadder(): BOTH HALVES OR NEITHER.';

comment on column public.garment_order_amendment_ta_activities.status is
  'pending | in_progress | done. Set on the DASHBOARD, not on the order. Values '
  'and constraint name copied verbatim from ta_plan_activities (0401) — same '
  'state machine, one spelling. The default does NOT fire through the app: '
  'normalizeTaActivities names the column on every insert and coalesces to '
  '''pending'' itself (0475''s lesson).';

comment on column public.garment_order_amendment_ta_activities.days_required is
  'Working days this step needs, counted back from the step after it. NULL is '
  '"not filled in yet" and is refused BY NAME by backwardSchedule, never '
  'treated as 0 — two steps collapsed onto one date is a plan that looks '
  'complete and is not.';


-- ----------------------------------------------------------------------------
-- SEED THE T&A ACTIVITY MASTER — the client's ten, in the client's order.
--
-- IDEMPOTENT ON `upper(short_name)`, and the reason is narrower and more real
-- than "in case the file runs twice".
--
-- A FULL re-run of this file cannot reach here: the RLS block below uses bare
-- `create policy`, which has no `if not exists` in Postgres, so a second run
-- raises 42710 and stops. What this guard is actually for is a PARTIAL
-- re-application — which is not hypothetical, it is how this migration was
-- applied: the DDL, RLS and verify went in as one statement and this seed as a
-- second, so the two halves already have separate histories. It also covers a
-- database that already held the table (`create table if not exists` is silent
-- when it does nothing) and anyone re-running just this block by hand.
--
-- A bare INSERT would stack a second ladder silently, and the grid would seed
-- twenty steps — a plan that looks complete and is doubled.
--
-- The `values` list carries `sequence` explicitly rather than relying on row
-- order: `insert ... select ... from (values ...)` makes no ordering promise
-- that a future editor should have to know about, and the number is the axis the
-- whole ladder is built on. See the header.
-- ----------------------------------------------------------------------------

insert into public.ta_activities
  (short_name, name, sequence, default_offset_days, is_active)
select v.short_name, v.name, v.sequence, 0, true
from (values
  ('FABPLAN', 'FABRIC PLAN',      1),
  ('ACCBOM',  'ACCESSORIES BOM',  2),
  ('YRNPUR',  'YARN PURCHASE',    3),
  ('KNIT',    'KNITTING',         4),
  ('DYE',     'DYEING',           5),
  ('CUT',     'CUTTING',          6),
  ('SEW',     'SEWING',           7),
  ('PACK',    'PACKING',          8),
  ('INSP',    'INSPECTION',       9),
  ('SHIP',    'SHIPMENT',        10)
) as v(short_name, name, sequence)
where not exists (
  select 1 from public.ta_activities a
   where upper(a.short_name) = v.short_name
);


-- ----------------------------------------------------------------------------
-- RLS — the existing 'orders' module, no new permission.
--
-- Shape copied from 0401 (which restored the TA Plan tables) and 0472 (the last
-- amendment child), so the twenty-one child tables stay one family rather than a
-- dozen dialects.
-- ----------------------------------------------------------------------------

do $rls$
declare t text;
begin
  foreach t in array array['garment_order_amendment_ta_activities'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
  end loop;
end $rls$;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` MEANS THE SQL RAN, NOT THAT IT ACHIEVED ITS GOAL. 0383 and
-- 0386 both applied cleanly and left a function anon-callable; 0387 ran,
-- succeeded and did nothing; 0436 was committed and never applied while its
-- missing column broke every save; 0467 was applied a day after the service
-- already embedded the table it declares.
--
-- SIX THINGS, ASSERTED SEPARATELY, BECAUSE EACH CAN SUCCEED ALONE:
--   1. every column, BY NAME — `create table if not exists` is silent when it
--      does nothing, which is precisely the re-run over an older, narrower
--      version of this table that 0401 was bitten by. A count of 12 is satisfied
--      by twelve columns of the wrong names.
--   2. `row_uid` is NOT NULL and HAS a default — the two halves of the anchor's
--      backstop, and either can be present without the other.
--   3. `status` defaults to the LITERAL 'pending' — not merely "has a default".
--      A default of 'Pending' would satisfy "is not null" and is the case-drift
--      0475's header exists to prevent, made invisible here because the value is
--      set by the dashboard rather than typed by anyone.
--   4. the status CHECK is EXERCISED, not looked up by name. What matters is
--      that a fourth spelling is refused, and a constraint can exist while
--      naming the wrong values.
--   5. the unique key is EXERCISED, and in BOTH directions: the same `row_uid`
--      twice under one amendment must be REFUSED (the merge would mis-pair), and
--      the same `row_uid` under a DIFFERENT amendment must be ACCEPTED (a copied
--      order is legitimate, and a global unique would refuse it).
--   6. RLS is on and all four policies landed — a table with RLS enabled and no
--      policies denies everyone, which reads on screen as an empty grid rather
--      than as an error.
--   7. the ten seeded activities are each present EXACTLY ONCE and each carries
--      the `sequence` this migration gave it. Not "the total is 10" — see the
--      header. "Exactly once" is the half that catches a re-run stacking a
--      second ladder, and the `sequence` half is the one that matters most: a
--      wrong number does not look wrong, it produces a complete, plausible
--      ladder with every date against the wrong activity.
--
-- Everything the probe inserts is taken back out before the block ends.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col          text;
  def          text;
  nullable     text;
  a1           uuid;
  a2           uuid;
  probe_uid    uuid := gen_random_uuid();
  bad_status   boolean := false;
  dup_refused  boolean := false;
  cross_ok     boolean := false;
  n_pol        int;
  rls_on       boolean;
  seed_row     record;
  n_seeded     int;
  n_seq        int;
begin
  -- 1 ----------------------------------------------------------------------
  foreach col in array array[
    'id','amendment_id','row_uid','sno','activity_id','days_required',
    'target_date','actual_date','status','notes',
    'created_by','created_at','updated_at'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'garment_order_amendment_ta_activities'
         and column_name = col
    ) then
      raise exception '0481: column garment_order_amendment_ta_activities.% is missing', col;
    end if;
  end loop;

  -- 2 ----------------------------------------------------------------------
  select is_nullable, column_default
    into nullable, def
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_ta_activities'
     and column_name = 'row_uid';
  if nullable <> 'NO' then
    raise exception '0481: row_uid is nullable — a NULL anchor matches every row';
  end if;
  if def is null then
    raise exception '0481: row_uid has no default — a non-app INSERT cannot anchor its row';
  end if;

  -- 3 ----------------------------------------------------------------------
  select column_default
    into def
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_ta_activities'
     and column_name = 'status';
  if def is null then
    raise exception '0481: status has no default';
  end if;
  /* Postgres stores it as the expression text `'pending'::text`, so this
     compares the LITERAL it contains. */
  if def not like '%''pending''%' then
    raise exception '0481: status defaults to %, expected ''pending''', def;
  end if;

  -- 7 ----------------------------------------------------------------------
  -- Each of the ten, by its own name, with the sequence this migration set.
  -- `n` counts them so a re-run that stacked a second ladder is caught, and the
  -- loop names the offender rather than reporting a total that moved.
  for seed_row in
    select * from (values
      ('FABRIC PLAN',1),('ACCESSORIES BOM',2),('YARN PURCHASE',3),('KNITTING',4),
      ('DYEING',5),('CUTTING',6),('SEWING',7),('PACKING',8),('INSPECTION',9),
      ('SHIPMENT',10)
    ) as t(name, sequence)
  loop
    select count(*) into n_seeded
      from public.ta_activities a
     where upper(a.name) = seed_row.name;
    if n_seeded = 0 then
      raise exception '0481: the T&A activity "%" was not seeded — the T&A tab has no ladder to offer, and becomes a blocking outage the day the client restores the requirement', seed_row.name;
    elsif n_seeded > 1 then
      raise exception '0481: the T&A activity "%" exists % times — a re-run stacked a second ladder', seed_row.name, n_seeded;
    end if;
    select a.sequence into n_seq
      from public.ta_activities a
     where upper(a.name) = seed_row.name;
    if n_seq is distinct from seed_row.sequence then
      raise exception '0481: "%" carries sequence %, expected % — a wrong sequence produces a complete, plausible ladder with every date on the wrong activity', seed_row.name, n_seq, seed_row.sequence;
    end if;
  end loop;

  -- 6 ----------------------------------------------------------------------
  select c.relrowsecurity into rls_on
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'garment_order_amendment_ta_activities';
  if not coalesce(rls_on, false) then
    raise exception '0481: row level security is not enabled';
  end if;

  select count(*) into n_pol from pg_policies
   where schemaname = 'public'
     and tablename = 'garment_order_amendment_ta_activities';
  if n_pol <> 4 then
    raise exception '0481: expected 4 policies, found %', n_pol;
  end if;

  -- 4 and 5 ----------------------------------------------------------------
  -- Both need a real amendment to hang off. Two, for the cross-document half.
  select id into a1 from public.garment_order_amendments order by created_at limit 1;
  select id into a2 from public.garment_order_amendments
   where id is distinct from a1 order by created_at limit 1;

  if a1 is null then
    raise notice '0481: no amendment to probe against — the CHECK and the unique key are NOT exercised';
    return;
  end if;

  -- 4. a fourth spelling must be refused.
  begin
    insert into public.garment_order_amendment_ta_activities
      (amendment_id, row_uid, sno, status)
    values (a1, gen_random_uuid(), 901, 'complete');
  exception when check_violation then
    bad_status := true;
  end;
  if not bad_status then
    delete from public.garment_order_amendment_ta_activities
     where amendment_id = a1 and sno = 901;
    raise exception '0481: status ''complete'' was accepted — the CHECK does not hold the state machine';
  end if;

  -- 5a. the same anchor twice under ONE amendment must be refused.
  insert into public.garment_order_amendment_ta_activities
    (amendment_id, row_uid, sno) values (a1, probe_uid, 902);
  begin
    insert into public.garment_order_amendment_ta_activities
      (amendment_id, row_uid, sno) values (a1, probe_uid, 903);
  exception when unique_violation then
    dup_refused := true;
  end;

  -- 5b. the same anchor under a DIFFERENT amendment must be accepted.
  if a2 is not null then
    insert into public.garment_order_amendment_ta_activities
      (amendment_id, row_uid, sno) values (a2, probe_uid, 902);
    cross_ok := true;
  end if;

  delete from public.garment_order_amendment_ta_activities where row_uid = probe_uid;

  if not dup_refused then
    raise exception '0481: one row_uid twice under one amendment was accepted — the merge would mis-pair a completion';
  end if;
  if a2 is null then
    raise notice '0481: only one amendment exists — the cross-document half of the unique key is NOT exercised';
  elsif not cross_ok then
    raise exception '0481: the same row_uid under a second amendment was refused — the key is global, not per document';
  end if;

  raise notice '0481: ok — 13 columns, row_uid not-null with a default, status defaults to pending, CHECK refuses a fourth value, unique key refuses a repeat and permits a copy, RLS on with 4 policies, and the client''s ten activities seeded once each in sequence';
end $verify$;
