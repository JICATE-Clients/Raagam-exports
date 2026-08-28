-- ----------------------------------------------------------------------------
-- 0473 - Pack type(s) drives the Assortment's piece counts.
--
-- Client ruling 2026-08-27: the two grids "cannot be kept as two disconnected
-- statements" - if they are, "the BOM calculation engine will read 0 pieces for
-- those colors, and the factory will fail to purchase any fabric or sewing
-- thread for the order".
--
-- The pipeline the ruling describes, in one line:
--
--     pieces(colourway, size) = boxes(size) x pieces-of-colourway-per-box
--
-- 0472 stored the right-hand factor (a pack type's lines). This migration adds
-- the two facts that were still missing, and NOTHING ELSE - the exploded piece
-- counts already have a home in `garment_order_amendment_assort_line_sizes`.
--
-- ## 1. WHICH METHOD A DESTINATION SHIPS
--
-- An order may declare several pack types and ship different ones to different
-- countries; the quantity row carried only `assortment_type_id` (Solid vs
-- Assort), which is a different question. Without this column the explosion has
-- no left-hand side to multiply and would have to guess - and a guess here buys
-- the wrong quantity of cloth.
--
-- TEXT, matching `garment_order_amendment_pack_type_lines.pack_type` and for
-- the same reason: `uq_goa_pack_types_method` makes `(amendment_id, pack_type)`
-- unique, so the word identifies the method exactly, and every child on this
-- document is already keyed by value rather than by FK.
--
-- ## 2. WHERE THE BOX COUNT IS TYPED
--
-- ONE BOX HOLDS EVERY COLOURWAY AT ONCE, so the count of boxes is a property of
-- the SIZE and not of the colourway. The Assortment grid's rows are one per
-- colourway, so without a marker the operator would type the same physical
-- carton count once per colour - and could enter 100 against WHITE and 90
-- against BLACK for one size, silently meaning two different pack counts for
-- one carton (client's choice of layout, 2026-08-27).
--
-- So one assort line per style is flagged `is_pack_row`, its size cells hold
-- BOXES, and the colourway lines beneath it hold the PIECES those boxes explode
-- into. Declared rather than inferred: "the line with no combo" is already a
-- legal state on a Single Style pack (0433), so reusing it would make two
-- different things indistinguishable in the table.
--
-- ## THE COLOURWAY LINES STAY STORED, AND THAT IS THE POINT
--
-- They are derived, and they are written anyway - the ruling's own words: the
-- exploded piece counts go into the quantities and sizes tables "so the
-- downstream Material and Fabric BOM engines never even have to know that
-- 'Packs' existed". Same call 0467 made for `po_qty` on a set pack: a derived
-- figure IS stored when every consumer reads it as a plain piece count and none
-- of them carries a multiplier.
--
-- The input and the output therefore live side by side, which is safe only
-- because the input is on a row of its own: the packs row is typed, every other
-- row is regenerated from it, and no row is ever both.
-- ----------------------------------------------------------------------------

-- ---------- 1. Which packing method this destination ships ----------

alter table public.garment_order_amendment_quantities
  add column if not exists pack_type text;

comment on column public.garment_order_amendment_quantities.pack_type is
  'Which pack type(s) method this destination ships, BY VALUE - matches '
  '`garment_order_amendment_pack_type_lines.pack_type`, which '
  '`uq_goa_pack_types_method` makes unique per amendment. NULL means the '
  'destination is not packed to a declared method and its size cells are '
  'ordinary piece counts (0473).';

-- ---------- 2. The line whose size cells are BOXES ----------

alter table public.garment_order_amendment_assort_lines
  add column if not exists is_pack_row boolean not null default false;

comment on column public.garment_order_amendment_assort_lines.is_pack_row is
  'This line''s size cells hold BOXES, not pieces - one box holds every '
  'colourway at once, so the count belongs to the size. The colourway lines '
  'beneath it hold the pieces those boxes explode into. Declared rather than '
  'inferred from a null combo, which is already a legal Single Style state '
  '(0473).';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal - 0383
-- and 0386 both applied cleanly and both left a function anon-callable, and
-- 0467 was committed and left unapplied for a day while the service already
-- embedded the table it declares.
--
-- `add column if not exists` is SILENT when it does nothing, so both columns are
-- named one by one rather than counted, and the boolean's DEFAULT is asserted
-- separately: a `not null` column with no default would reject every insert
-- `writeChildren` makes, which is a save that fails on a screen the operator
-- filled in correctly.
-- ----------------------------------------------------------------------------

do $verify$
declare
  d_type   text;
  d_null   text;
  d_deflt  text;
begin
  select data_type into d_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_quantities'
     and column_name = 'pack_type';
  if d_type is null then
    raise exception '0473: garment_order_amendment_quantities.pack_type missing';
  end if;
  if d_type <> 'text' then
    raise exception '0473: quantities.pack_type is %, expected text', d_type;
  end if;

  select data_type, is_nullable, column_default
    into d_type, d_null, d_deflt
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_assort_lines'
     and column_name = 'is_pack_row';
  if d_type is null then
    raise exception '0473: garment_order_amendment_assort_lines.is_pack_row missing';
  end if;
  if d_type <> 'boolean' then
    raise exception '0473: is_pack_row is %, expected boolean', d_type;
  end if;
  if d_null <> 'NO' then
    raise exception '0473: is_pack_row must be not null';
  end if;
  -- The default is what keeps every existing line, and every line
  -- `writeChildren` inserts without naming the column, a PIECES line.
  if d_deflt is null or d_deflt not like 'false%' then
    raise exception '0473: is_pack_row default is %, expected false', d_deflt;
  end if;

  raise notice '0473: ok - quantities.pack_type text, assort_lines.is_pack_row boolean not null default false';
end $verify$;
