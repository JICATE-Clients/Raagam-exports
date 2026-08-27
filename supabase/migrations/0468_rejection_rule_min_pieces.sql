-- =============================================================================
-- 0468 — `min_pieces`: a floor under a rejection tier, in pieces
--
-- ## THIS MIGRATION IS A RECOVERY, AND THAT IS THE POINT OF THE FILE
--
-- The column was applied to the live database BY HAND on 2026-08-26, as
-- `0467_rejection_rule_min_pieces` (version 20260826140306), and NO FILE WAS
-- EVER COMMITTED. The code that reads it — `lib/masters/rejection-rule.ts` and
-- the Garment Rejection Rule screen — shipped normally. So the repository built
-- a database without the column while the application demanded it.
--
-- That is the SAME DEFECT that broke Order Entry on 2026-08-27, running the
-- other way round. There, 0467 was committed and never applied, and
-- `getAmendments` died on "Could not find a relationship between
-- 'garment_order_amendments' and 'garment_order_amendment_pack_components' in
-- the schema cache". Here the DB is ahead of the repo instead of behind it, and
-- the failure is worse for being deferred: nothing breaks on the machine that
-- applied it, and the first person to hit it is whoever rebuilds from
-- `supabase/migrations` — a new environment, a branch database, a restore.
--
-- 0467's own header already warned about this shape ("0436 was committed and
-- never applied at all while its column silently broke every save on the screen
-- above it"). It has now happened three times. The lesson is not "apply your
-- migrations" — it is that A MIGRATION APPLIED OUTSIDE THE REPO IS INVISIBLE,
-- and stays invisible until an environment is built from source.
--
--
-- ## NUMBERED 0468, THOUGH IT WAS APPLIED BEFORE 0467
--
-- The remote already holds `0467_amendment_set_packs`, so a second local 0467
-- would give the repo two files sharing a prefix and no way to order them. The
-- number is a filename, not a claim about time; the applied-at version above is
-- what records when it really landed.
--
--
-- ## SAFE TO RE-RUN, WHICH IS WHAT MAKES RECOVERY POSSIBLE
--
-- `add column if not exists` and a `comment on` are both idempotent. On the live
-- database this is a no-op that re-states the comment; on a fresh one it is what
-- creates the column. Recovering an ad-hoc change is only ever this cheap when
-- the original was written idempotently — which this one was.
--
--
-- ## WHAT THE COLUMN MEANS
--
-- A floor under `rejection_allowance`, in PIECES. It lets one tier say "5%, but
-- never fewer than 3 pieces", which is what stops the cut quantity collapsing at
-- a bracket boundary — the percentage of a small order rounds to almost nothing
-- exactly where the buffer matters most.
--
-- NULL IS NOT 0. Null means no floor, and every tier written before this column
-- computes exactly as it did. A default of 0 would be the same arithmetic, but
-- it would also be a claim every historical row never made. Same rule 0467
-- asserts for `packs_ordered` and 0465 for `loss_pct`.
--
-- Ignored on a flat tier, where the allowance is already a piece count and a
-- floor under it would be a second way to say one thing.
-- =============================================================================

alter table public.garment_rejection_rule_lines
  add column if not exists min_pieces numeric;

comment on column public.garment_rejection_rule_lines.min_pieces is
  'A floor under `rejection_allowance`, in PIECES (0467). Null = no floor, which is every tier written before this column and computes exactly as before. Lets one tier say "5%, but never fewer than 3 pieces", which is what stops the cut quantity falling at a bracket boundary. Ignored on a flat tier.';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — the
-- house rule this repo learned from 0383 and 0386, both of which applied
-- cleanly and both of which left a function anon-callable.
--
-- Nullability is asserted rather than assumed: it is the one property of this
-- column that carries meaning, and `add column if not exists` is SILENT when the
-- column is already there. So on the live database, where the column exists
-- from the ad-hoc run, this block is the only thing in the file that actually
-- checks anything.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col_ok boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'garment_rejection_rule_lines'
       and column_name = 'min_pieces'
  ) into col_ok;
  if not col_ok then
    raise exception '0468: garment_rejection_rule_lines.min_pieces missing';
  end if;

  select is_nullable = 'YES' into col_ok
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_rejection_rule_lines'
     and column_name = 'min_pieces';
  if not col_ok then
    raise exception '0468: min_pieces must be nullable — NULL is "no floor", 0 is a floor of zero';
  end if;

  raise notice '0468 verified: garment_rejection_rule_lines.min_pieces present and nullable';
end $verify$;
