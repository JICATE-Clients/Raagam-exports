-- ============================================================================
-- Raagam ERP — 0476 Material BOM ▸ Items: the PURCHASE STAGE ("Greige")
--
-- Adds `material_bom_amendment_items.purchase_stage`, `default 'Greige'`.
--
-- Client 2026-08-29: "raw materials that require coloring or processing must
-- default to the Greige (uncolored/raw) stage during the purchase phase … set
-- the default Stage field value to Greige for all newly added raw purchase items
-- and lock/disable the field so users cannot manually change it during entry …
-- tracking them as Greige during purchase prevents inventory systems from
-- incorrectly assuming that pre-colored materials are already sitting in the
-- warehouse."
--
--
-- ## WHY A NEW COLUMN, WHEN A `stage` COLUMN ALREADY EXISTS
--
-- This is the whole reason the migration exists rather than a form default, and
-- it is the question a future reader will ask first.
--
-- `material_bom_amendment_processes.stage` has been there since 0465 and is NOT
-- this. It sits on a PROCESS row and means **what the material becomes** — the
-- only value ever observed in the wild is "DYED" (screenshot 2484), and the
-- screen's own comment reads: "the stage is WHAT the material becomes ('DYED')
-- and the process is HOW ('TRIMS DYEING')."
--
-- The client's Greige means **what you BUY** — the raw, uncoloured state a
-- purchase requisition is raised against, before any dyer has seen it. Same
-- word, opposite ends of the same transaction:
--
--     purchase_stage   Greige     the state the goods ARRIVE in     (item line)
--     processes.stage  Dyed       the state a process PRODUCES      (process row)
--
-- Putting both in one column was offered and declined. A single field answering
-- "what did you buy?" and "what did it become?" cannot answer either once a line
-- has a process on it — the value would have to be Greige and Dyed at once — and
-- the ambiguity would surface as an inventory row claiming pre-coloured stock is
-- already in the warehouse, which is the exact failure the client named.
--
--
-- ## THE VOCABULARY IS DELIBERATELY NOT A CHECK CONSTRAINT
--
-- The client names three values — Greige, Dyed, and "a brief mention of Print in
-- the context of fabric prints where the printing detail is typed in". That last
-- one is described as provisional in the client's own words, and the neighbouring
-- `processes.stage` is FREE TEXT for a documented reason worth repeating here:
--
--     "FREE TEXT, THOUGH LEGACY RENDERS A DROPDOWN. The only value ever observed
--      is 'DYED', and one sighting is not a vocabulary — this repo has already
--      paid for inventing one, when a seeded word list 'corrected' a Packing
--      Accessories name to COTTON and the client had the feature removed two days
--      later (AGENTS.md, Near misses)."
--
-- The same argument applies with more force to a column that is LOCKED on screen:
-- the operator cannot type a wrong value, so a constraint would only ever fire
-- against a migration or an import — and it would then reject the save rather
-- than explain it. Text now; a CHECK the day the client supplies the closed list.
--
--
-- ## 'Greige' — THE EXACT STRING, AND THE CASE IS LOAD-BEARING
--
-- Title case, matching `PURCHASE_STAGE_GREIGE` in
-- `lib/orders/material-bom/process-loss.ts`. Copied from that constant, never
-- retyped.
--
-- 0475 records at length why this matters on this very table: the supply-type
-- enums differ by case across three modules, and "a DB default of 'local'
-- against a client default of 'Local' would be that same bug with nothing to
-- fail against: no constraint to violate, no error to read, just two spellings
-- of one value accumulating in one column and a filter matching half of them."
-- A locked field makes that worse, not better — nobody would ever see the wrong
-- spelling to report it.
--
--
-- ## THIS MIGRATION IS ONLY HALF THE FIX — 0475's LESSON, APPLIED IN ADVANCE
--
-- **A column default applies only when an INSERT omits the column.** It does NOT
-- apply when the writer names the column with an explicit NULL. 0475 shipped
-- exactly that gap on this table and wrote it down: `normalizeItems` names
-- `supply_type` on every insert, so its new default "will never fire through the
-- application's own writer".
--
-- So the writer half is done in the SAME CHANGE as this migration rather than
-- being left to a follow-up: `normalizeItems` in
-- `lib/orders/material-bom-amendment/actions.ts` coalesces to
-- `PURCHASE_STAGE_GREIGE`, so a blank never reaches the column from the app.
-- The default below still earns its place — it covers a `lib/data-io` import, a
-- hand-written INSERT and any future writer that omits the column.
--
-- `set not null` is again NOT used, for 0475's reason: the writer passes a value
-- explicitly, so NOT NULL would not default anything — it would reject the save
-- and read as the cause of an outage it merely exposed.
--
--
-- ## THE BACKFILL IS A NO-OP TODAY AND IS WRITTEN ANYWAY
--
-- `material_bom_amendment_items` holds 0 rows in this database — measured, not
-- assumed. The update therefore changes nothing here, and is written and
-- asserted regardless for the reason 0466 states and 0474 and 0475 both quote:
-- it will not be a no-op on any environment that has data, and a migration that
-- skips its backfill because the dev database happens to be empty ships a gap
-- that only appears where it matters.
--
-- Asserted by its OWN QUESTION — "is any row still NULL?" — never by a row
-- count, which reads 0 on an empty table and proves nothing either way.
-- ============================================================================


alter table public.material_bom_amendment_items
  add column if not exists purchase_stage text;

alter table public.material_bom_amendment_items
  alter column purchase_stage set default 'Greige';

comment on column public.material_bom_amendment_items.purchase_stage is
  'The state this material is PURCHASED in — ''Greige'' (raw, uncoloured) by '
  'default and locked on screen (client 2026-08-29). NOT the same question as '
  'material_bom_amendment_processes.stage, which is what a PROCESS produces '
  '(''Dyed''): this is what arrives, that is what it becomes. Free text, like '
  'its neighbour, because the client''s list is provisional and a locked field '
  'cannot be typed wrong. Title case, matching PURCHASE_STAGE_GREIGE in '
  'lib/orders/material-bom/process-loss.ts. 0476.';


-- ----------------------------------------------------------------------------
-- Backfill: every existing line is raw stock until a process says otherwise.
-- ----------------------------------------------------------------------------

update public.material_bom_amendment_items
   set purchase_stage = 'Greige'
 where purchase_stage is null;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and left a function anon-callable, and 0436 was
-- committed and never applied while its missing column broke every save.
--
-- THREE HALVES, ASSERTED SEPARATELY, because each can succeed alone: the column
-- can exist with no default, the default can be set with the backfill forgotten,
-- and the backfill can run while the default is missed.
-- ----------------------------------------------------------------------------

do $verify$
declare
  def      text;
  leftover int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_items'
       and column_name = 'purchase_stage'
  ) then
    raise exception '0476: purchase_stage was not added';
  end if;

  select column_default
    into def
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'material_bom_amendment_items'
     and column_name = 'purchase_stage';

  if def is null then
    raise exception '0476: purchase_stage has no default';
  end if;

  /* THE VALUE IS TESTED, NOT MERELY THE PRESENCE OF A DEFAULT. Postgres stores
     it as the expression text `'Greige'::text`, so this compares the LITERAL it
     contains — a default of 'greige' would satisfy "is not null" and is exactly
     the case-drift 0475's header exists to prevent, made worse here by the field
     being locked where nobody would see the wrong spelling to report it. */
  if def not like '%''Greige''%' then
    raise exception '0476: purchase_stage defaults to %, expected ''Greige''', def;
  end if;

  /* THE BACKFILL BY ITS OWN QUESTION, not by a row count — a count reads 0 on
     this empty table and would pass whether or not the update ran. */
  select count(*) into leftover
    from public.material_bom_amendment_items
   where purchase_stage is null;
  if leftover <> 0 then
    raise exception '0476: % item line(s) still hold a NULL purchase_stage', leftover;
  end if;
end $verify$;
