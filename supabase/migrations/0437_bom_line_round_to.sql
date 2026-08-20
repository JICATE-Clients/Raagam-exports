-- ============================================================================
-- Raagam ERP — 0437 A Material BOM line can round its purchase figure UP
--
-- Client, 2026-08-19, describing the tail of the Items grid:
--
--     "round to field — sometimes that excess field will show 567 kind of
--      number value, that time user will use round to field for round the
--      value ... end of the calculation need to show the final quantity in
--      this field — final quantity"
--
-- So the line's quantity chain becomes four VISIBLE steps where it was one
-- opaque "Calculated Qty":
--
--     No. of Items / Per Pieces  ->  Excess Calculated Qty
--                                ->  MOQ           (supplier's minimum)
--                                ->  Round To      (this column)
--                                ->  Final Quantity
--
--
-- ## THE ORDER OF MOQ AND ROUND TO IS A DECISION, NOT AN ACCIDENT
--
-- Both push the figure UP, and they do NOT commute. Take a line needing 100,
-- an MOQ of 550 and a Round To of 500:
--
--     MOQ then Round   ->  max(100, 550) = 550  ->  ceil to 500s = 1000
--     Round then MOQ   ->  ceil to 500s  = 500  ->  max(500, 550) = 550
--
-- 1000 against 550 is nearly double, on a rule that reads identically either
-- way in prose. The client chose MOQ FIRST (2026-08-19): the supplier's
-- minimum is a fact about what may be bought, and Round To is how the operator
-- makes THAT figure orderable. Rounding first and then lifting to the minimum
-- would leave a Final Quantity that is not a multiple of the step the operator
-- asked for, which defeats the column.
--
--
-- ## NULLABLE WITH NO DEFAULT, and that is the same argument `per_pieces` made
--
-- A default of 1 would round every line to whole units, silently. A default of
-- 0 would have to be read as "no rounding", which makes 0 mean two things on a
-- column whose whole job is to be a step. NULL means the operator has not asked
-- for rounding and the figure passes through — the ~90% case, and the state
-- every existing row is in.
--
-- NO CHECK CONSTRAINT TIGHTER THAN `> 0`. A step of 144 (a gross), 12 (a dozen)
-- and 0.5 (half a metre) are all legitimate, so the column cannot know what a
-- sensible step is. The engine refuses a step of 0 or below rather than the
-- database, because it is the engine that has a sentence to print.
--
--
-- ## IT IS NOT ON THE REQUIREMENT TABLE, FOR THE REASON MOQ IS NOT
--
-- 0418: "MOQ is applied to the ITEM'S TOTAL — never to a requirement row. A
-- colour-wise explosion makes six rows for one material; an MOQ of 500 applied
-- per row orders 3,000 of something the order needs 100 of." Rounding is the
-- same shape: six colour rows each rounded up to the next 500 buys six times
-- the rounding error. Both belong to the LINE, and the line is where this
-- column lives.
-- ============================================================================

alter table public.material_bom_amendment_items
  add column if not exists round_to numeric;

comment on column public.material_bom_amendment_items.round_to is
  'Round the line''s post-MOQ quantity UP to the next multiple of this step (0437). NULL = no rounding asked for. Applied AFTER the MOQ and never to a requirement row — see the header.';

do $assert$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_items'
       and column_name  = 'round_to'
       and data_type    = 'numeric'
       and is_nullable  = 'YES'
  ) then
    raise exception '0437: round_to must exist as a NULLABLE numeric on material_bom_amendment_items';
  end if;

  -- The line/row boundary this migration's header spends its length on. MOQ has
  -- never appeared on a requirement row and neither may this: the day either
  -- does, the "a minimum is per ORDER" reasoning has been abandoned and this is
  -- what says so out loud instead of quietly buying six times too much.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_requirements'
       and column_name in ('round_to', 'moq')
  ) then
    raise exception '0437: a requirement row must carry neither round_to nor moq — both are per LINE (see 0418)';
  end if;
end $assert$;
