-- ============================================================================
-- Raagam ERP — 0475 Material BOM ▸ Items: supply_type gets a DATABASE default
--
-- `material_bom_amendment_items.supply_type` becomes `default 'Local'`, and
-- every row still holding NULL is set to 'Local'.
--
--
-- WHY THE DATABASE HAS TO HOLD THIS ONE, WHEN A FORM DEFAULT NORMALLY WOULD
--
-- The app has had a default for this field since 2026-08-21:
-- `DEFAULT_SUPPLY_TYPE` in `lib/orders/material-bom-amendment/types.ts`, applied
-- by `blankItem` when the operator adds a line. That was the right place for it
-- while a control existed — the client's note was "a Vendor dropdown is
-- required. By default, it is Local", and a default belongs next to the field it
-- defaults.
--
-- The client then had **Supply Type and Vendor taken off the Material BOM screen
-- entirely** (2026-08-28) — not moved to the line detail, removed. So:
--
--   * `blankItem` is now the ONLY writer of this column anywhere in the app;
--   * it runs on exactly one event, adding a NEW line;
--   * and there is no control left that can change the value afterwards.
--
-- A form default that only fires on creation is not a default at all for any row
-- that already exists. Every line written before today, and every line arriving
-- by any other path, is pinned at NULL **for the life of the row** — there is no
-- screen anywhere able to set it.
--
-- That is the whole argument. A default normally belongs at the form because the
-- form is where the value is chosen; here the form can no longer choose it, so
-- the invariant has nowhere to live except the database.
--
--
-- WHAT A NULL COSTS DOWNSTREAM, WHICH IS WHY IT IS NOT MERELY UNTIDY
--
-- The nominated-vendor rule (AGENTS.md, "Nominated vendors";
-- `nominatedVendorOptions()`) answers a blank supply type with **NOTHING**, and
-- a line saying to pick the type first. That refusal is deliberate and is the
-- rule's entire history: a guard phrased as "restrict only in case X" leaked the
-- full vendor list through every state that was not X, blank included.
--
-- So a NULL line reaching a vendor decision is unresolvable in the strict sense
-- — the rule correctly refuses to offer a vendor, and no screen can supply the
-- value that would unblock it. Not a control in the wrong place: no exit at all.
-- This matters more now, not less, because vendor selection has moved to the PO
-- stage, where that rule is the only thing standing between a nominated material
-- and a vendor the customer never approved.
--
--
-- 'Local' — THE EXACT STRING, AND WHY THE CASE IS LOAD-BEARING
--
-- Title case, matching `SUPPLY_TYPE_OPTIONS = ["Local", "Import", "Nominated",
-- "Free Issue"]` and `DEFAULT_SUPPLY_TYPE = "Local"` in
-- `lib/orders/material-bom-amendment/types.ts`. Copied from that constant, not
-- retyped from memory.
--
-- AGENTS.md records that the three supply-type enums disagree on case — MBA
-- stores "Nominated", Orders and Planning store "nominated" — and that a `===`
-- at a call site therefore compiles, runs and quietly matches nothing. A DB
-- default of 'local' against a client default of 'Local' would be that same bug
-- with nothing to fail against: no constraint to violate, no error to read, just
-- two spellings of one value accumulating in one column and a filter matching
-- half of them.
--
-- ## AND THE THREE ENUMS ARE NOT CASE VARIANTS OF ONE LIST — THEY ARE THREE
-- ## DIFFERENT VOCABULARIES. THIS IS A SHARPER STATEMENT THAN AGENTS.md MAKES.
--
-- AGENTS.md says "the supply-type enums disagree on case", which is true and is
-- the trap `nominatedVendorOptions()` lower-cases to survive. But it understates
-- the difference, and the understatement is the dangerous part. Laid side by
-- side:
--
--   MBA (this column)  Local · Import · Nominated · Free Issue
--   Orders             nominated · recommended · foc_csp · foc_ssp ·
--                      purchase · csp_purchase · none
--   Planning           customer · nominated · recommended · others
--
-- 'Local' appears in NEITHER of the other two. Neither does 'Import' or 'Free
-- Issue'. Only `nominated` is genuinely common to all three, which is exactly
-- why the case rule was written about that one word and why it reads as though
-- the lists were otherwise the same.
--
-- The consequence for anyone who later decides to unify them: **that is a DATA
-- MIGRATION, not a `.toLowerCase()`.** Every value would need mapping — and
-- some have no target at all, since nothing in the MBA list means `foc_csp` and
-- nothing in the Orders list means `Free Issue`. A change that lower-cased these
-- three columns "to make them agree" would produce a column of values matching
-- nothing, quietly, with no constraint to fail against.
--
-- So nothing here should be "harmonised" with them, and nothing here should be
-- assumed comparable to them. Written into this migration rather than left in a
-- report because it is the kind of fact that exists in one place until someone
-- writes it down.
--
-- No CHECK constraint is added. `SUPPLY_TYPE_OPTIONS` is documented in its own
-- header as a **provisional** list, and pinning a provisional vocabulary into a
-- constraint buys nothing and costs a migration every time it moves.
--
--
-- THE BACKFILL IS A NO-OP TODAY AND IS WRITTEN ANYWAY
--
-- `material_bom_amendment_items` holds 0 rows in this database, so the update
-- changes nothing here. It is written and asserted regardless, for the reason
-- 0466 states and 0474 quotes: it will not be a no-op on any environment that
-- has data, and a migration that skips its backfill because the dev database
-- happens to be empty ships a gap that only appears where it matters.
--
-- Asserted by its OWN QUESTION — "is any row still NULL?" — never by a row
-- count, which reads 0 on an empty table and proves nothing either way.
--
--
-- ## THIS MIGRATION IS ONLY HALF THE FIX, AND THE OTHER HALF IS NOT HERE
--
-- Read this before assuming new rows are covered. **A column default applies
-- only when an INSERT omits the column** — it does NOT apply when the column is
-- named with an explicit NULL. `normalizeItems` in
-- `lib/orders/material-bom-amendment/actions.ts` writes
-- `supply_type: clean(c.supply_type)`, and `clean()` returns NULL for a blank —
-- so every insert this app makes NAMES the column, and the default below will
-- never fire through the application's own writer.
--
-- What this migration therefore does achieve, precisely:
--
--   * it repairs every EXISTING NULL row, which is the state no screen can
--     reach and the reason it was asked for;
--   * it sets the correct default for any writer that omits the column — a
--     `lib/data-io` import, a hand-written INSERT, a future path;
--   * it does NOT stop the current save path from writing a fresh NULL.
--
-- Closing that last gap is a one-line change in `normalizeItems`
-- (`clean(c.supply_type) ?? DEFAULT_SUPPLY_TYPE`), NOT a stricter column here.
-- `set not null` was considered and rejected: because the writer passes an
-- explicit NULL, NOT NULL would not default the value, it would REJECT the save
-- outright — every Material BOM save would fail until the writer changed, and
-- the migration would read as the cause of an outage it merely exposed.
-- Reported to the lead 2026-08-28 rather than decided here.
-- ============================================================================


alter table public.material_bom_amendment_items
  alter column supply_type set default 'Local';

comment on column public.material_bom_amendment_items.supply_type is
  'How this material is sourced — SUPPLY_TYPE_OPTIONS in '
  'lib/orders/material-bom-amendment/types.ts (Local · Import · Nominated · '
  'Free Issue), Title case. Defaults to ''Local'' in the DATABASE since 0475 '
  'because the Supply Type control was removed from the Material BOM screen on '
  '2026-08-28, leaving no screen able to set it on an existing row. A blank '
  'value makes nominatedVendorOptions() offer no vendor at all. 0475.';


-- ----------------------------------------------------------------------------
-- Backfill: every row no screen can now reach.
-- ----------------------------------------------------------------------------

update public.material_bom_amendment_items
   set supply_type = 'Local'
 where supply_type is null;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and left a function anon-callable, and 0436 was
-- committed and never applied while its missing column broke every save.
--
-- BOTH HALVES ARE ASSERTED SEPARATELY, because either can succeed alone: the
-- default can be set while the backfill is forgotten (new rows fine, old rows
-- still unreachable), and the backfill can run while the default is missed (old
-- rows fixed, the next omitting writer making another).
-- ----------------------------------------------------------------------------

do $verify$
declare
  def      text;
  leftover int;
begin
  select column_default
    into def
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'material_bom_amendment_items'
     and column_name = 'supply_type';

  if def is null then
    raise exception '0475: supply_type still has no default';
  end if;

  /* THE VALUE IS TESTED, NOT MERELY THE PRESENCE OF A DEFAULT. Postgres stores
     it as the expression text `'Local'::text`, so this compares the LITERAL it
     contains rather than the whole string — a default of 'local' would satisfy
     "is not null" and is exactly the case-drift this migration's header exists
     to prevent. */
  if def not like '%''Local''%' then
    raise exception '0475: supply_type defaults to %, expected ''Local''', def;
  end if;

  /* THE BACKFILL BY ITS OWN QUESTION, not by a row count — a count reads 0 on
     this empty table and would pass whether or not the update ran. */
  select count(*) into leftover
    from public.material_bom_amendment_items
   where supply_type is null;
  if leftover <> 0 then
    raise exception '0475: % item line(s) still hold a NULL supply_type', leftover;
  end if;
end $verify$;
