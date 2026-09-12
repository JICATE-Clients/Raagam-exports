-- ============================================================================
-- Raagam ERP — 0556 Orders ▸ Fabric BOM ▸ Manual: every "Size Wise" toggle OFF
--
-- Operator instruction, 2026-09-11: every Size Wise toggle on the Manual tab is
-- to read off, not only the ones a new entry starts with. Asked once, then asked
-- again after being shown that this reaches rows already saved.
--
-- ## WHY THIS IS NOT OVERWRITING ANYBODY'S ANSWER
--
-- It is the third and last part of one bug, and the only part that reaches rows
-- that already exist:
--
--   * 0523 created the column with `default true`, which was legacy's behaviour.
--   * The client reversed that on 2026-09-04 ("its auto enabled so disable it").
--     The screen and the Zod schema were changed; 0555 changed the column.
--   * `normalizeManualEntries` (lib/orders/fabric-bom/actions.ts) NEVER WROTE THE
--     COLUMN. It builds each row field by field and `size_wise` was not among
--     them, so the value in every stored row is the table default and nothing
--     else. Fixed on 2026-09-11, in the same change as this migration.
--
-- So no row in this table holds an answer a planner gave. Every `true` in it was
-- put there by a default the client had already asked to have reversed. That is
-- what makes a blanket update legitimate here and would not make one legitimate
-- on a column operators have actually been typing into.
--
-- ## WHAT IT DOES NOT TOUCH, AND THE ONE THING TO WATCH
--
-- `size_wise` changes what the SCREEN ASKS FOR and never what is stored (0523's
-- own comment). Every per-size figure in `order_fabric_bom_manual_sizes` stays
-- exactly where it is; this only changes how the grid opens.
--
-- The consequence worth stating plainly: with the toggle off the grid shows ONE
-- row and writes the figure typed there to every size. So an entry whose sizes
-- genuinely differ will show only the first of them, and the next edit on that
-- entry will flatten the rest to one value. Switching the toggle back on before
-- editing is what avoids that, and nothing here prevents it — the control is
-- live again as of the actions.ts fix above, which it had never been.
--
-- 0524 recorded `order_fabric_bom_manual_sizes` holding 0 rows on 2026-09-03,
-- "the module has no save flow exercised yet", so the population at risk is
-- whatever has been entered in the week since. Small, but not asserted here:
-- this migration does not read that count and must not be taken as proof of it.
-- ============================================================================

update public.order_fabric_bom_manual_entries
   set size_wise = false
 where size_wise;

-- VERIFIED FROM THE CATALOG, NOT FROM THE STATEMENT ABOVE. A migration reporting
-- success means the SQL ran, not that it achieved its stated goal — the lesson
-- 0386 shipped a no-op to learn.
do $$
declare
  n bigint;
begin
  select count(*) into n
    from public.order_fabric_bom_manual_entries
   where size_wise;
  if n > 0 then
    raise exception '0556: % manual entries still read size_wise = true', n;
  end if;
end $$;
