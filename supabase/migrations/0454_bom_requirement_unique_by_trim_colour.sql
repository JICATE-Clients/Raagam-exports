-- ============================================================================
-- Raagam ERP — 0454 A requirement row's identity includes its TRIM COLOUR
--
-- 0436 said it in its own header:
--
--     "What does not sum away is COLOUR. White on the front and navy on the
--      sleeve are two different things to buy, so the requirement splits by trim
--      colour and `item_color_id` is added to the requirements table."
--
-- It added the column and left `uq_mba_req_slice` alone. That index is
--
--     (item_line_id, style_ref_no, combo, size_id, country_id) NULLS NOT DISTINCT
--
-- — the slice, and only the slice. So the moment a line's Combination sheet
-- names two colours, the SAME slice produces two rows, and the second is
-- rejected by a constraint whose name says nothing about colour. The feature
-- 0436 exists to enable is refused by the half of 0436 that shipped.
--
--
-- ## THIS IS A WIDENING, AND IT CANNOT REJECT ANYTHING IT USED TO ACCEPT
--
-- Adding a column to a unique key only ever admits more rows. Every pairing the
-- old index permitted, the new one permits; what changes is that (slice, NAVY)
-- and (slice, RED) stop colliding. So no existing row can be made invalid by
-- this, which is what makes it safe to apply to a live table.
--
-- `NULLS NOT DISTINCT` is carried over deliberately rather than re-decided.
-- NULL is a VALUE in every one of these columns — "this basis has no such axis",
-- and on `item_color_id` "the line's own colour" — so two NULLs are the same
-- row, not two unrelated unknowns. Dropping the clause would let one slice
-- accumulate unlimited colourless duplicates, which is the doubling this index
-- exists to prevent.
--
--
-- ## WHY NOT A COMPONENT COLUMN INSTEAD
--
-- Because 0423 and 0436 both assert there must never be one, and this migration
-- does not disturb that: you do not buy sleeve-thread and front-thread, you buy
-- thread. `colourSplits()` collapses the panels onto colour before a row is ever
-- built, so the grain here is the grain a purchase order is written at.
-- ============================================================================

drop index if exists public.uq_mba_req_slice;

create unique index uq_mba_req_slice
  on public.material_bom_amendment_requirements
     (item_line_id, style_ref_no, combo, size_id, country_id, item_color_id)
  nulls not distinct;

comment on index public.uq_mba_req_slice is
  'One requirement row per (slice, trim colour). The colour joined the key in 0454: 0436 split the requirement by trim colour and left this index at slice grain, so a two-colour Combination sheet was refused by a constraint that never mentions colour.';


-- ---------- assertions ------------------------------------------------------
--
-- VERIFY FROM THE CATALOG, NEVER BY READING THE MIGRATION (AGENTS.md, "Function
-- grants"): {"success": true} proves the SQL ran, not that it achieved its goal.

do $assert$
declare
  d text;
begin
  select pg_get_indexdef(x.indexrelid) into d
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
   where i.relname = 'uq_mba_req_slice';

  if d is null then
    raise exception '0454: uq_mba_req_slice is missing — the drop ran and the create did not';
  end if;

  if d not like '%item_color_id%' then
    raise exception '0454: uq_mba_req_slice does not include item_color_id: %', d;
  end if;

  -- The clause is load-bearing, not decoration: without it every axis that is
  -- legitimately NULL stops de-duplicating and the index silently permits the
  -- doubling it was created to refuse.
  if d not like '%NULLS NOT DISTINCT%' then
    raise exception '0454: uq_mba_req_slice lost NULLS NOT DISTINCT: %', d;
  end if;

  if not exists (
    select 1 from pg_index x join pg_class i on i.oid = x.indexrelid
     where i.relname = 'uq_mba_req_slice' and x.indisunique
  ) then
    raise exception '0454: uq_mba_req_slice is no longer UNIQUE';
  end if;
end $assert$;
