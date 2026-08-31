-- ============================================================================
-- Raagam ERP — 0480 Combos ▸ Structure Details: a yarn-dyed fabric NAMES ITS
--                    YARN COLOURS, and "Printed" leaves the Fabric Type list
--
-- Three statements, one screen (Garment Order ▸ Combos ▸ [Detail], the
-- Structure Details overlay), all from the client 2026-08-31:
--
--   1. `garment_order_amendment_combo_structures.yarn_colors text[]` is added.
--   2. `printed` is dropped from that table's item_sub_type CHECK.
--   3. `printed` is dropped from `garment_order_amendment_structures`' CHECK
--      too — the Color/Print tab's own structure grid, which shares the
--      vocabulary.
--
-- 2 and 3 partially reverse 0412 and 0415. Read those before "restoring" it.
--
-- NUMBERED 0480, APPLIED BEFORE 0478 AND 0479. Written as 0478 and renumbered
-- when two other files claimed 0478/0479 in the same working tree on the same
-- day; this one had already been applied, so it holds the EARLIER
-- `supabase_migrations` timestamp (20260831040935) while carrying the LATER
-- filename. The file order and the applied order genuinely disagree here, and
-- that is recorded rather than tidied away — nothing in this migration depends
-- on either of those two, and renumbering theirs instead would have edited
-- files another agent owned. A fresh database replaying the directory in name
-- order gets the same result: the three changes are independent.
--
--
-- ## 1. WHY A YARN-DYED FABRIC NEEDS COLOURS OF ITS OWN
--
-- A yarn-dyed fabric is knitted from PRE-DYED yarns of several colours — a
-- stripe or a check. The colour is in the yarn before the fabric exists, which
-- is exactly why `melange` and `yarn_dyed` are the two Fabric Types that mean
-- "no dyeing row" (0412's header states this for the fabric-dyeing question).
--
-- But "needs no fabric dyeing" is not "needs no dyeing". The YARN was dyed, and
-- until now the order had nowhere to say in how many colours or which — so the
-- fabric plan could not compute the dyeing split, which is the whole reason the
-- client asked. The row could say "this is yarn-dyed" and then say nothing that
-- made the statement actionable.
--
--
-- ## WHY NAMES AND NOT IDS
--
-- The value is a set of colour NAMES, picked from THIS ORDER'S OWN combo
-- (colourway) names — `garment_order_amendment_combos.combo`, which is `text`
-- and nullable, i.e. free text the operator typed. There is no master row to
-- point an FK at, and inventing one would mean a yarn colour could not be a
-- colourway the operator named for this order only.
--
-- This is `garment_order_amendment_dyeings`' reasoning, one grid over, and 0477
-- restated it for `prints.print_name` nine hours ago:
--
--     the TEXT is what every consumer reads
--
-- so a typed value reaches the fabric plan exactly as a picked one does and
-- nothing downstream has to learn that an id can be null. Here there is not
-- even an id half to pair with — the source is free text at BOTH ends.
--
-- CAPITALS are the app's job, not this column's (AGENTS.md, "CAPITALS": the
-- write-side transform belongs in the Zod schema). No `upper()` trigger here;
-- a database that re-cased its input would be a second, invisible writer.
--
--
-- ## NOT NULL WITH A DEFAULT — AND THIS DEPARTS FROM 0475/0477 ON PURPOSE
--
-- 0477 says, under "NOT NULL IS NOT USED, DELIBERATELY", that on this family of
-- tables the writer names every column on every insert, so NOT NULL defaults
-- nothing — it only rejects the save, and then reads as the cause of an outage
-- it merely exposed. That reasoning is sound and it is why `print_name` is
-- nullable.
--
-- IT DOES NOT CARRY TO AN ARRAY, because an array's "none" is not NULL:
--
--     '{}'::text[]    an empty set — this fabric names no yarn colours
--     null            ...also "this fabric names no yarn colours"
--
-- Two spellings of one fact. Nullable, every reader must handle both — and the
-- one that forgets does not fail loudly: `array_length(null, 1)` is NULL, not
-- 0, and `null || 'RED'` is NULL, so a missed case silently swallows a colour
-- rather than throwing. `cardinality('{}')` is 0 and behaves.
--
-- So the column is `not null default '{}'`, which collapses the two spellings
-- into one and makes "no colours" a value rather than an absence.
--
-- The 0477 objection does not bite here for the same reason: the default is a
-- SAFETY NET FOR LEGACY ROWS, not the normal path. `writeComboTree`
-- (lib/orders/amendments/actions.ts) builds an explicit object naming every
-- column, so the app's own insert will always supply this one — verified by
-- reading it, not assumed. NOT NULL can therefore only reject a writer that
-- deliberately sends NULL, which is the writer this column exists to prevent.
--
-- Note the difference from 0475's trap while you are here: a column default
-- fires only when an INSERT OMITS the column, never when it names an explicit
-- NULL. That is why NOT NULL is doing the work below and the default is not —
-- the default covers the 26 rows already stored; NOT NULL covers everything
-- written from now on.
--
--
-- ## text[] — WHAT WAS CONSIDERED AND REJECTED
--
--   * A CHILD TABLE (the relational answer). Rejected: the value is a small
--     unordered set of names, read wholesale with its row, and there is nothing
--     to hang off a colour — no quantity, no shade percentage, no sequence.
--     `writeComboTree` already deletes and re-inserts this tree wholesale, so a
--     child table adds a fourth level that gains nothing and can only drift.
--     WHEN THAT CHANGES, CHANGE THIS: the moment the fabric plan needs a
--     per-colour percentage or metreage, a set of names stops being enough and
--     a table is right. That is a foreseeable ask, so it is written down rather
--     than left to be rediscovered.
--   * A COMMA-SEPARATED text COLUMN. Rejected: it needs a parser at every
--     reader, and every reader must then agree about a colour name containing a
--     comma. `= any`, `@>` and `unnest` all work on an array and none of them
--     work on a CSV.
--   * jsonb. Rejected: it buys a shape this value does not have, and costs the
--     array operators above.
--
--
-- ## NO CROSS-COLUMN CHECK TYING yarn_colors TO item_sub_type = 'yarn_dyed'
--
-- Considered, and deliberately not added. `item_sub_type` is nullable and NULL
-- is a real, common state — 21 of the 21 rows in
-- `garment_order_amendment_structures` hold it today, and 0415's own comment
-- says NULL means "not answered yet" and is never defaulted to 'solid'. A CHECK
-- would therefore turn the ORDER the operator fills two cells in into a failed
-- save, on a screen that writes the whole tree at once. Which field is offered
-- when is the screen's rule, and it stays there.
--
--
-- ## 2 AND 3. "PRINTED" LEAVES THE FABRIC TYPE LIST
--
-- The client, 2026-08-31, verbatim:
--
--     "Fabric Type is meant to define the structural weave or dye category of
--      the fabric. 'Printed' is an aesthetic processing step, not a base fabric
--      type. Leaving it in the construction list causes planning confusion and
--      corrupts downstream material requirements."
--
-- This overturns 0412's charge 1 ("FABRIC TYPE IS FOUR ANSWERS, NOT THREE",
-- operator, 2026-08-12) and the copy of it 0415 put on the Color/Print tab.
-- 0412's reasoning was that the type decides WHICH AESTHETIC FIELD a component
-- fills — solid picks from the declared dyeing colours, printed from the
-- declared prints. The client is not disputing that a printed fabric picks a
-- print; they are saying the CONSTRUCTION column is the wrong place to record
-- it, because a printed fabric is still solid or yarn-dyed or melange
-- underneath, and answering "printed" erases which.
--
-- That erasure is the "corrupts downstream material requirements" half, and it
-- is concrete: a `printed` row names no base construction, so the fabric plan
-- cannot tell whether the greige beneath the print needs piece dyeing, and 0477
-- has just given Fabric Print a home of its own on the Color/Print tab. The
-- aesthetic step now has somewhere to live that is not this column.
--
-- BOTH tables, in one migration, because they are one vocabulary — 0415 says so
-- in its own comment ("the same vocabulary ... declared once in
-- ITEM_SUB_TYPE_OPTIONS"). Dropping it from one would leave the constant
-- matching neither table.
--
-- `order_fabrics` IS NOT TOUCHED and needs nothing: its CHECK reads
-- ('solid','melange','yarn_dyed') and never held 'printed' — 0412 stated
-- plainly that it was leaving the order side alone. Confirmed from the catalog
-- today rather than trusted:
--     order_fabrics_item_sub_type_check
--       CHECK ((item_sub_type IS NULL) OR (item_sub_type = ANY
--              (ARRAY['solid','melange','yarn_dyed'])))
-- So after this migration all three agree again, which is the state 0412 broke
-- on purpose and this restores for a different reason.
--
--
-- ## DROPPED, NOT FROZEN — AND THE ARGUMENT IS NOT QUITE 0408/0412/0430/0434'S
--
-- Those four each dropped something from a table holding ZERO ROWS, and each
-- wrote the same sentence: "the freeze convention protects STORED VALUES and
-- there are none." Read carefully, because THIS IS A WEAKER PRE-CONDITION and
-- saying otherwise would be a false citation:
--
--     garment_order_amendment_combo_structures   26 rows  (24 solid, 2 melange)
--     garment_order_amendment_structures         21 rows  (21 null)
--     ---------------------------------------------------------------
--     rows holding 'printed', either table                0
--
-- Both tables have data. What neither has is a row holding the value being
-- removed, so the freeze convention is still satisfied — no stored value is
-- destroyed, and the 47 rows that do exist keep values this migration still
-- accepts. It is a TIGHTENING of a vocabulary nobody used, not a value freeze.
--
-- THE ADD IS ITS OWN GUARD, which is why this is safe to state so flatly.
-- Postgres validates `ADD CONSTRAINT ... CHECK` against every existing row (no
-- NOT VALID here), so a single `printed` row anywhere would make the statement
-- FAIL rather than silently orphan a value. The explicit pre-flight below is
-- therefore a courtesy — it produces a readable message naming the table and
-- the count instead of a bare check_violation — and not the only protection.
-- Re-run the counts before applying on any other environment anyway.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Pre-flight. Refuse LEGIBLY rather than by check_violation.
--
-- Deliberately BEFORE the DDL, so a database that does hold a 'printed' row
-- stops here with its table and count named, having changed nothing.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  n_combo int;
  n_struct int;
begin
  select count(*) into n_combo
    from public.garment_order_amendment_combo_structures
   where item_sub_type = 'printed';

  select count(*) into n_struct
    from public.garment_order_amendment_structures
   where item_sub_type = 'printed';

  if n_combo > 0 or n_struct > 0 then
    raise exception
      '0480: refusing to drop ''printed'' — % row(s) in combo_structures and '
      '% row(s) in structures still hold it. Decide what those rows should '
      'become (a base construction + a print on the Color/Print tab) and '
      'migrate them first; this migration destroys no stored value.',
      n_combo, n_struct;
  end if;
end $preflight$;


-- ---------------------------------------------------------------------------
-- 1. Yarn colours.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_combo_structures
  add column if not exists yarn_colors text[] not null default '{}'::text[];

comment on column public.garment_order_amendment_combo_structures.yarn_colors is
  'The colours of the PRE-DYED yarns a yarn-dyed fabric is knitted from — a '
  'stripe or a check (client 2026-08-31). Colour NAMES, not ids: they are '
  'picked from this order''s own combo names (garment_order_amendment_combos.'
  'combo, free text), so there is no master row to reference — the same reason '
  'dyeings.color_name and prints.print_name (0477) store text. The fabric plan '
  'reads this to compute the dyeing split. NOT NULL default ''{}'': an array''s '
  '"none" is the empty array, so a nullable column would give "no colours" two '
  'spellings and array_length(null,1) returns NULL rather than 0. No CHECK '
  'ties it to item_sub_type = ''yarn_dyed'' — which field is offered when is '
  'the screen''s rule. 0480.';


-- ---------------------------------------------------------------------------
-- 2. `printed` leaves the Combos ▸ Structure Details tuple.
--
-- Drop-and-recreate under the SAME NAME, the idiom 0412 established when it
-- widened this constraint: a CHECK cannot be altered in place, and anything
-- looking it up by name (this migration's verify block included) must keep
-- finding it.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_combo_structures
  drop constraint if exists garment_order_amendment_combo_structures_item_sub_type_check;

alter table public.garment_order_amendment_combo_structures
  add constraint garment_order_amendment_combo_structures_item_sub_type_check
  check (item_sub_type is null
         or item_sub_type in ('solid', 'melange', 'yarn_dyed'));

comment on column public.garment_order_amendment_combo_structures.item_sub_type is
  '"Fabric Type" — solid | melange | yarn_dyed. The fabric''s CONSTRUCTION, '
  'i.e. its structural weave or dye category. ''printed'' was a fourth member '
  'from 0412 and was REMOVED by 0480 on the client''s word: "Printed is an '
  'aesthetic processing step, not a base fabric type ... corrupts downstream '
  'material requirements" — a printed fabric is still solid or yarn-dyed '
  'underneath, and answering ''printed'' erased which. The print itself lives '
  'on the Color/Print tab (garment_order_amendment_prints, 0477). Matches '
  'order_fabrics.item_sub_type (0329) again, and garment_order_amendment_'
  'structures.item_sub_type — one vocabulary, declared once in '
  'ITEM_SUB_TYPE_OPTIONS.';


-- ---------------------------------------------------------------------------
-- 3. And leaves the Color/Print tab's structure grid, which shares the list.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_structures
  drop constraint if exists garment_order_amendment_structures_item_sub_type_check;

alter table public.garment_order_amendment_structures
  add constraint garment_order_amendment_structures_item_sub_type_check
  check (item_sub_type is null or item_sub_type = any (array[
    'solid','melange','yarn_dyed'
  ]));

comment on column public.garment_order_amendment_structures.item_sub_type is
  'Solid / Melange / Yarn Dyed (0415, narrowed by 0480) — the same vocabulary '
  'as garment_order_amendment_combo_structures.item_sub_type, declared once in '
  'ITEM_SUB_TYPE_OPTIONS. ''Printed'' was dropped from both in one change '
  'because they are one list; narrowing either alone would leave the constant '
  'matching neither. NULL means not answered yet and offers NEITHER a colour '
  'nor a print list — never defaulted to ''solid'', which would be an invented '
  'answer on every row.';


-- ---------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and left a function anon-callable, and 0436 was
-- committed and never applied while its missing column broke every save.
-- ---------------------------------------------------------------------------

do $verify$
declare
  t        text;
  nullable text;
  deflt    text;
  kept     text;
  probe    uuid;
begin
  ---------------------------------------------------------------------------
  -- 1. The column, and the three things about it that are the decision.
  ---------------------------------------------------------------------------
  select data_type, is_nullable, column_default
    into t, nullable, deflt
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'garment_order_amendment_combo_structures'
     and column_name  = 'yarn_colors';

  if t is null then
    raise exception '0480: yarn_colors was not added';
  end if;

  /* ARRAY, not text. A CSV column would satisfy "the column exists" and every
     reader would then need a parser — the alternative this migration's header
     names and rejects. */
  if t <> 'ARRAY' then
    raise exception '0480: yarn_colors is %, expected ARRAY (text[])', t;
  end if;

  /* NOT NULL and defaulted, the whole point of the departure from 0477. A
     nullable array gives "no colours" two spellings; asserted rather than
     trusted because `add column if not exists` is a NO-OP against a column that
     already exists in a weaker form, and would report success. */
  if nullable <> 'NO' then
    raise exception '0480: yarn_colors is nullable — an array''s "none" must '
                    'be ''{}'' and nothing else';
  end if;

  if deflt is null or deflt not like '%{}%' then
    raise exception '0480: yarn_colors has no ''{}'' default (found %)', deflt;
  end if;

  ---------------------------------------------------------------------------
  -- 2/3. Both CHECKs, read from what Postgres STORED.
  ---------------------------------------------------------------------------
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.garment_order_amendment_combo_structures'::regclass
       and conname  = 'garment_order_amendment_combo_structures_item_sub_type_check'
       and pg_get_constraintdef(oid) like '%printed%'
  ) then
    raise exception '0480: combo_structures still admits ''printed''';
  end if;

  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.garment_order_amendment_structures'::regclass
       and conname  = 'garment_order_amendment_structures_item_sub_type_check'
       and pg_get_constraintdef(oid) like '%printed%'
  ) then
    raise exception '0480: structures still admits ''printed''';
  end if;

  /* AND THE THREE THAT REMAIN ARE STILL ACCEPTED. The dangerous failure here is
     not "printed survived" — it is a CHECK rebuilt wrong, which reads as a
     successful tightening and rejects every row at runtime. A constraint of
     `check (false)` passes both tests above. */
  foreach kept in array array['solid','melange','yarn_dyed'] loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.garment_order_amendment_combo_structures'::regclass
         and conname  = 'garment_order_amendment_combo_structures_item_sub_type_check'
         and pg_get_constraintdef(oid) like '%' || kept || '%'
    ) then
      raise exception '0480: combo_structures no longer accepts %', kept;
    end if;

    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.garment_order_amendment_structures'::regclass
         and conname  = 'garment_order_amendment_structures_item_sub_type_check'
         and pg_get_constraintdef(oid) like '%' || kept || '%'
    ) then
      raise exception '0480: structures no longer accepts %', kept;
    end if;
  end loop;

  ---------------------------------------------------------------------------
  -- 4. Assert by USE, which reading the constraint text back cannot do.
  --
  -- 0415 wanted this and could not have it: its table was empty, so a probe
  -- insert tripped not_null_violation on the parent FK before ever reaching the
  -- CHECK — a test asserting its own success. This table holds 26 rows, so a
  -- real combo_id exists to hang a probe off, and the whole thing is undone by
  -- a savepoint. Skipped (not failed) where there is no parent, so the
  -- migration still runs on a fresh database.
  ---------------------------------------------------------------------------
  select combo_id into probe
    from public.garment_order_amendment_combo_structures
   limit 1;

  if probe is not null then
    begin
      insert into public.garment_order_amendment_combo_structures
        (combo_id, sno, item_sub_type, yarn_colors)
      values (probe, -478, 'printed', array['__0480 PROBE__']);

      delete from public.garment_order_amendment_combo_structures
       where combo_id = probe and sno = -478;

      raise exception '0480: the CHECK admitted ''printed'' — the constraint '
                      'text reads as narrowed but the table does not enforce it';
    exception when check_violation then
      null;  -- refused, which is the pass
    end;
  end if;
end $verify$;
