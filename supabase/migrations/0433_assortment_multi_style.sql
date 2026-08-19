-- ============================================================================
-- Raagam ERP — 0433 Quantities ▸ Assortments: a line names its own style
--
-- The client's assortment redesign (screenshot 2356, 2026-08-19) asks for the
-- legacy window's header to be stripped down to ONE control — "remove that
-- country to no carton in that header, remove, only hold single style and
-- multiple style as toggle button" — and for the grid's first two columns,
-- StyleRefNo and Style, to be filled from the styles the order has already
-- entered.
--
-- Those two asks are the same ask. `Single Style` / `Multiple Style` is the
-- switch that decides whether the grid HAS a style column, and until now the
-- switch could not be honoured: an assortment line stores a combo, a carton
-- count and its inners, and nothing that says which garment it packs. So
-- `is_single_style_pack` has sat on the quantity row since 0414 as a tickbox
-- that changed nothing on screen and nothing in the arithmetic.
--
--
-- 1. `style_ref_no` IS TEXT, AND THAT IS NOT LAZINESS
--
-- BY VALUE, never an FK — the same decision `combo` records in 0414, for the
-- same mechanical reason. `writeChildren` DELETES and REINSERTS every child row
-- of an amendment on every save, so `garment_order_amendment_styles.id` is a
-- fresh uuid afterwards and any FK pointing at it would dangle within one save
-- of being written. The join key is the ref itself, through `styleKey()` in the
-- screen — never `===`, because rows saved before the CAPITALS rule are not
-- upper-cased.
--
-- NULLABLE, and left null on a Single Style row rather than filled in with the
-- parent's ref. A stored copy of a value one table up is a value that can
-- disagree with its source: change the destination's Ref No and every line
-- would go on naming the old style. Single Style means "this line inherits",
-- and null is how the row says so.
--
--
-- 2. THE BACKFILL STATES A FACT, IT DOES NOT GUESS ONE
--
-- Every quantity row written before this migration IS single-style. Not by
-- policy — by construction: there was no column in which a second style could
-- have been named, so no stored assortment can be anything else. Setting them
-- all true is reading back what the schema already guaranteed.
--
-- The DEFAULT has to move with them. Left at `false`, every destination created
-- from now on would open in Multiple Style: a Style Ref No column on every
-- line, blank, on the ~98% of orders that are one PO for one style. That is the
-- opposite of the request that prompted this.
--
-- Both halves, in one migration, for the reason 0387 records about the two
-- independent grants: fixing the existing rows and leaving the default alone
-- reads as a lockdown and leaves the NEXT row born wrong.
--
--
-- 3. WHAT IS NOT HERE
--
-- No column for the style NAME. It is `style_description` on the amendment's
-- own Styles Details row, reachable by the ref this migration adds, and a
-- second copy would be a second thing to keep true — the rule `PcsPerPack` and
-- `Gsm Range` are already decided by. The screen renders it read-only.
--
-- No per-style subtotal, and no change to the balance rule. The breakup must
-- still equal the quantity row's PO Qty (0432); splitting that target per style
-- would need a per-style PO Qty on the destination, which the client has not
-- asked for and the legacy screen does not show.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The style an assortment line packs.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_assort_lines
  add column if not exists style_ref_no text;

comment on column public.garment_order_amendment_assort_lines.style_ref_no is
  'Solid Colour / Multiple Style only: which of the amendment''s own Styles '
  'Details rows this line packs, BY VALUE (writeChildren reinserts those rows, '
  'so an FK would dangle - same reason as `combo`). Null means the line '
  'inherits the quantity row''s style, which is what a Single Style pack is.';


-- ---------------------------------------------------------------------------
-- 2. Every stored destination is single-style, and so is the next one.
-- ---------------------------------------------------------------------------
update public.garment_order_amendment_quantities
   set is_single_style_pack = true
 where is_single_style_pack = false;

alter table public.garment_order_amendment_quantities
  alter column is_single_style_pack set default true;


-- ---------------------------------------------------------------------------
-- 3. Read the result back out of the catalog, and exercise it.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable, and
-- 0432 records the same lesson one migration ago.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_type       text;
  v_default    text;
  n_multi      int;
  probe_amend  uuid;
  probe_qty    uuid;
  probe_line   uuid;
  v_single     boolean;
  v_ref        text;
begin
  -- The column, and its TYPE. `add column if not exists` is silent about a
  -- column that already exists as something else.
  select data_type into v_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'garment_order_amendment_assort_lines'
     and column_name  = 'style_ref_no';
  if v_type is distinct from 'text' then
    raise exception '0433: style_ref_no is missing or is %, not text', coalesce(v_type, 'absent');
  end if;

  -- Both halves of the switch. The backfill and the default are separate
  -- statements and either one can be the one that did not take.
  select count(*) into n_multi
    from public.garment_order_amendment_quantities
   where is_single_style_pack = false;
  if n_multi <> 0 then
    raise exception '0433: % quantity rows are still multi-style after the backfill', n_multi;
  end if;

  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'garment_order_amendment_quantities'
     and column_name  = 'is_single_style_pack';
  if v_default is distinct from 'true' then
    raise exception '0433: is_single_style_pack defaults to %, not true', coalesce(v_default, 'nothing');
  end if;

  -- EXERCISED, not read off the catalog. `column_default` can say 'true' while
  -- a rewritten table stored something else, and a text column can be born with
  -- a not-null constraint that turns "inherits" into ''.
  select id into probe_amend from public.garment_order_amendments limit 1;
  if probe_amend is null then
    return;  -- nothing to hang a probe off; skipped rather than faked
  end if;

  insert into public.garment_order_amendment_quantities (amendment_id, sno)
    values (probe_amend, 9433) returning id, is_single_style_pack into probe_qty, v_single;
  insert into public.garment_order_amendment_assort_lines (quantity_id, sno, combo)
    values (probe_qty, 1, '__0433_probe') returning id into probe_line;

  select style_ref_no into v_ref
    from public.garment_order_amendment_assort_lines where id = probe_line;

  -- Clean up before asserting, so a failure cannot leave the probe row behind.
  delete from public.garment_order_amendment_quantities where id = probe_qty;

  if v_single is distinct from true then
    raise exception '0433: a new destination was born multi-style (%)', v_single;
  end if;
  if v_ref is not null then
    raise exception '0433: a line naming no style stored %, not null', quote_literal(v_ref);
  end if;
end $verify$;
