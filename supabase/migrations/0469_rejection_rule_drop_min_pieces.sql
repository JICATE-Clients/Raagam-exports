-- =============================================================================
-- 0469 — drop `min_pieces`: 0468 recovered a column the client had withdrawn
--
-- ## WHAT WENT WRONG, PLAINLY
--
-- 0468 (2026-08-27) added `garment_rejection_rule_lines.min_pieces`, describing
-- itself as recovering a migration that had been applied by hand on 2026-08-26
-- and never committed. The evidence looked conclusive: the column was in the
-- live database, `supabase_migrations.schema_migrations` held a
-- `0467_rejection_rule_min_pieces` entry, and no file in `supabase/migrations`
-- created it. Every one of those facts is true.
--
-- THE CONCLUSION DRAWN FROM THEM WAS NOT. The file was not lost — the FEATURE
-- was withdrawn, the same day it was built, on the client's own instruction.
-- `lib/masters/rejection-rule.ts` says so in a comment that was sitting in the
-- repository the whole time:
--
--     A `min_pieces` FLOOR was built here on 2026-08-26 and removed the same
--     day, at the client's word: "maintain the same fields legacy have, only 4
--     — Range, From, To, Rejection Allowance". Migration 0467 was reverted with
--     it.
--
-- The revert took the FILE and the CODE and left the COLUMN standing, because
-- reverting a commit does not un-apply SQL. So the drift 0468 set out to fix was
-- real, and it pointed the opposite way: the database was ahead of the repo
-- because a withdrawal had been left half-done, not because a file went missing.
--
-- ## THE LESSON: "NO FILE CREATES THIS" IS TWO DIFFERENT STORIES
--
-- A column present in the database with no migration behind it means EITHER a
-- migration was never committed, OR a migration was reverted and the column
-- outlived it. The catalog cannot tell those apart — both leave exactly the same
-- residue. Only the code and its history can, and 0468 never asked them. The
-- check is cheap and was skipped: grep the column name across the repo before
-- writing a migration to restore it. Here that would have landed directly on the
-- comment above, in the one file that reads this table.
--
-- ## APPEND-ONLY, RATHER THAN EDITING 0468
--
-- 0468 is applied and merged. Rewriting it would leave the file disagreeing with
-- the version recorded as run, and would erase the record of a mistake that is
-- worth keeping — this repository already corrects forward for exactly this
-- reason (0383 → 0385 → 0386 → 0387, each coming back for what the last one
-- left). 0468 stays as it is and stays wrong; this is the migration that says so.
--
-- ## SAFE TO DROP
--
-- Verified against the live database immediately before writing this: the column
-- exists, `garment_rejection_rule_lines` holds 5 rows, and 0 of them carry a
-- non-null `min_pieces`. Nothing reads it — the only occurrence of the name in
-- the repository is the comment quoted above, and 0468 itself. The rule engine's
-- four fields (Range, From, To, Rejection Allowance) are untouched.
--
-- `if exists` so a database built from these files in order — where nothing ever
-- created the column, since the 08-26 run had no file — is a clean no-op rather
-- than an error.
-- =============================================================================

alter table public.garment_rejection_rule_lines
  drop column if exists min_pieces;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — the
-- house rule, and the one 0468 itself quoted while getting the intent wrong.
-- Running is not the part that was ever in doubt.
-- ----------------------------------------------------------------------------

do $verify$
declare
  still_there boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'garment_rejection_rule_lines'
       and column_name = 'min_pieces'
  ) into still_there;

  if still_there then
    raise exception '0469: garment_rejection_rule_lines.min_pieces is still present';
  end if;

  -- The four the client asked to keep must all still be here. Dropping the wrong
  -- column would also satisfy the assertion above.
  if (
    select count(*) from information_schema.columns
     where table_schema = 'public'
       and table_name = 'garment_rejection_rule_lines'
       and column_name in ('from_value', 'to_value', 'rejection_allowance', 'allowance_type')
  ) <> 4 then
    raise exception '0469: the four rule fields are not all present';
  end if;

  raise notice '0469 verified: min_pieces dropped, the four legacy fields intact';
end $verify$;
