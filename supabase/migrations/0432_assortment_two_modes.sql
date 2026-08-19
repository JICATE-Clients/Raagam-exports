-- ============================================================================
-- Raagam ERP — 0432 Quantities ▸ Assortments: two modes, and the inner carton
--
-- The client's packing spec (2026-08-18) reduces the four seeded assortment
-- types to the two this business actually ships, and gives each one a DIFFERENT
-- arithmetic. That is the whole change: the type stops being a label on a row
-- and becomes the switch that decides what the overlay asks for.
--
--   Solid Colour / Solid Size  — one colour and one size per carton. The number
--     of cartons is UNKNOWABLE at order entry, because how many pieces fit in a
--     box depends on the size (an XS packs tighter than an XXL). So the operator
--     names the colour and types a quantity per size, and that is all: the size
--     cells ARE the pieces.
--
--   Solid Colour / Assort Size — several sizes of ONE colour in a carton, to a
--     ratio (1:2:2:1). The ratio forms a bundle — an INNER — and several inners
--     go into a master carton. So:
--
--       Line Qty = No of Cartons x Inners per Carton x Sum of the ratio cells
--
-- `Assort Colour / Solid Size` and `Assort Colour / Assort Size` are "rarely
-- used and should be disabled or removed to avoid cluttering the interface".
--
--
-- 1. DISABLED, NOT DELETED — AGENTS.md "Disabled rows"
--
-- `is_active = false` is the app's one way to retire a lookup row, and the rule
-- that goes with it is why deletion is wrong here: "The one row that survives is
-- the one the record already holds. It stays on the field, greyed and tagged
-- (inactive), and cannot be re-picked." Deleting these two would blank the FK on
-- any quantity row that names one, on its next save — silent data loss dressed
-- up as tidiness.
--
-- Nothing in the SCREEN has to change for this to take effect, and that is the
-- standing rule paying for itself: `LookupDialogPicker` already passes
-- `inactive: isInactive(o)` and `DataPicker` already hides those rows while
-- keeping a held value. Filtering the list in the screen instead would satisfy
-- half the rule and break the other half.
--
-- MATCHED ON CODE, never on name. 0400 seeded these four with stable codes
-- precisely because the kind is operator-maintained through the picker's inline
-- Add/Modify — a client who re-words "Assort Colour / Assort Size" tomorrow must
-- not thereby switch it back on.
--
--
-- 2. `inners_per_carton` IS THE ONE NEW NUMBER
--
-- The formula names three factors and the table already stored two of them
-- (`no_of_cartons`, and the ratio as the line's size cells). The inner count is
-- typed and derivable from nothing, so it earns a column — the same test 0414
-- applied when it stored `no_of_cartons` and refused a column for `pcs_per_pack`.
--
-- ON THE LINE, NOT THE QUANTITY ROW, because it sits beside `no_of_cartons`:
-- one combo may pack six inners to a master and another eight, and a per-row
-- answer could not say so. (Legacy's `order_pack_ratios.inner_per_master` is a
-- header field, but that screen has one line per pack ratio, so its header IS
-- the line.)
--
-- DEFAULT 1, and the default is doing real work: it makes the new factor a
-- NO-OP for every row written before this migration. `cartons x 1 x ratio` is
-- exactly what `lineQtyOf` computed yesterday, so no stored assortment changes
-- its total by being read through the new formula. A default of 0 would zero
-- every existing line's quantity the moment the screen shipped.
--
--
-- 3. WHAT IS NOT HERE
--
-- No column for the MODE. It is `assortment_type_id` on the quantity row, which
-- has pointed at these lookup rows since 0398 — a second column saying "this is
-- a solid pack" would be a copy of a value already stored one field away, and
-- the two would drift the first time an operator changed the type without
-- re-opening the overlay.
--
-- `is_ratio_wise_pack` KEEPS ITS COLUMN AND LOSES ITS CHECKBOX. Its meaning
-- (0414: "when true the line's size cells are the ratio inside ONE carton") is
-- now ANSWERED BY THE TYPE rather than asked separately, so the screen derives
-- it and writes it. Two controls that must agree, one of which is a tickbox an
-- operator can contradict, is the disagreement this removes. The column stays
-- because it is what a reader of the row needs to interpret the size cells
-- without joining to the lookup table.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Retire the two assortment types the client does not use.
-- ---------------------------------------------------------------------------
update public.config_lookups
   set is_active = false
 where kind = 'assortment_type'
   and code in ('assort_solid', 'assort_assort');


-- ---------------------------------------------------------------------------
-- 2. The inner carton count, per assortment line.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_assort_lines
  add column if not exists inners_per_carton numeric(14,3) not null default 1;

comment on column public.garment_order_amendment_assort_lines.inners_per_carton is
  'Solid Colour / Assort Size only: how many ratio bundles (inners) go into one '
  'carton. Line Qty = no_of_cartons x inners_per_carton x sum(size cells). '
  'Defaults to 1 so a row written before 0432 reads through the new formula '
  'unchanged; a Solid/Solid line ignores it entirely.';


-- ---------------------------------------------------------------------------
-- 3. Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
-- ---------------------------------------------------------------------------
do $verify$
declare
  n_off        int;
  n_on         int;
  v_default    text;
  probe_amend  uuid;
  probe_qty    uuid;
  probe_line   uuid;
  v_inners     numeric;
begin
  -- The two that must be off, and the two that must still be on. Asserting both
  -- halves is the point: an `update` with a mistyped code reports success and
  -- switches nothing, and an over-broad one switches off the whole vocabulary.
  select count(*) into n_off
    from public.config_lookups
   where kind = 'assortment_type'
     and code in ('assort_solid', 'assort_assort')
     and is_active = false;
  if n_off <> 2 then
    raise exception '0432: expected 2 retired assortment types, found %', n_off;
  end if;

  select count(*) into n_on
    from public.config_lookups
   where kind = 'assortment_type'
     and code in ('solid_solid', 'solid_assort')
     and is_active = true;
  if n_on <> 2 then
    raise exception '0432: expected 2 live assortment types, found %', n_on;
  end if;

  -- The column, AND its default. A default of 0 here would zero every existing
  -- line's quantity, so it is the half worth asserting rather than mere
  -- presence.
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'garment_order_amendment_assort_lines'
     and column_name  = 'inners_per_carton';
  if v_default is null then
    raise exception '0432: inners_per_carton is missing or has no default';
  end if;

  -- EXERCISED, not read off the catalog: insert a line naming no inner count
  -- and check what actually landed. `column_default` can say '1' while a
  -- rewritten table stored something else.
  select id into probe_amend from public.garment_order_amendments limit 1;
  if probe_amend is null then
    return;  -- nothing to hang a probe off; skipped rather than faked
  end if;

  insert into public.garment_order_amendment_quantities (amendment_id, sno)
    values (probe_amend, 9432) returning id into probe_qty;
  insert into public.garment_order_amendment_assort_lines (quantity_id, sno, combo)
    values (probe_qty, 1, '__0432_probe') returning id into probe_line;

  select inners_per_carton into v_inners
    from public.garment_order_amendment_assort_lines where id = probe_line;

  -- Clean up before asserting, so a failure cannot leave the probe row behind.
  delete from public.garment_order_amendment_quantities where id = probe_qty;

  if v_inners is distinct from 1 then
    raise exception '0432: a line with no inner count defaulted to %, not 1', v_inners;
  end if;
end $verify$;
