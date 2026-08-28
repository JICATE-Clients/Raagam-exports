-- ============================================================================
-- Raagam ERP — 0474 Material BOM ▸ Items: "Free of Cost Receipt"
--
-- A tick on the material line saying THIS MATERIAL ARRIVES WITHOUT BEING
-- BOUGHT — the customer or their nominated supplier sends it in, and nobody
-- here raises a purchase order for it (client 2026-08-28: the FOC / Pre-Issue
-- column comes OFF the grid and becomes a corner tick "Free of Cost Receipt",
-- "allowing a direct Goods Receipt without a PO").
--
--
-- WHAT PROBLEM IT SOLVES
--
-- Goods arrive against a purchase order. That is the whole shape of the receipt
-- path: `getOpenPoLines()` feeds the GRN form, the operator picks an open PO
-- line, and `postGrn` walks each line back to `po_line_items` to consume its
-- open balance. A trim the BUYER supplies free has no purchase order to pick,
-- so today it has no way into stock at all — the storekeeper either invents a
-- zero-value PO to receive against, or the material is used and never appears
-- in the ledger.
--
-- Neither is a small wrong. A zero-value PO pollutes every purchase report and
-- consumes the 0424 ceiling, so a free trim eats the budget of a bought one;
-- an unreceived material is consumed out of a stock figure that never had it.
--
-- This column is the DECLARATION that lets the receipt path tell the two apart.
--
--
-- WHY IT IS `is_foc` AND NOT `foc`
--
-- The neighbouring boolean on this table is `send_out` (0466), unprefixed, so
-- local style argues for `foc`. It loses. FOC is already spelled `is_foc` on
-- six columns across three migrations — `order_price_confirmation_items` and
-- its sibling (0330), `po_line_items` (0359), and the three planning budget
-- tables (0369) — and in `lib/orders/pricing-types.ts`,
-- `lib/planning/budget-types.ts` and `lib/purchase/types.ts` beside them.
--
-- It is the SAME FACT in all of them, and a PO line raised from a BOM line
-- carries it across. One concept spelled two ways is exactly the drift 0466's
-- own header warns about one column to the left; cross-table naming wins over
-- one table's habit.
--
--
-- NOT NULL WITH A DEFAULT, NEVER NULLABLE
--
-- The shape every boolean in this feature takes — `send_out` (0466), and
-- `material_bom_amendment_item_slices.chosen` / `.size_wise` (0449). A nullable
-- flag would invent a third state ("not answered") for a question a checkbox
-- cannot leave unanswered, and here that third state would be read by a GATE:
-- "may this be received without a PO?" has no maybe.
--
--
-- THERE IS NO BACKFILL, AND THAT IS A DECISION RATHER THAN AN ABSENCE
--
-- 0466 had a signal to backfill from and this looks as though it does too:
-- `po_line_items.is_foc` exists (0359), and 0424 gave that table
-- `sales_order_id` + `item_id`, so a free purchase COULD be walked back onto
-- the BOM line for the same order and material. Three reasons not to:
--
-- 1. **They are not the same statement.** `po_line_items.is_foc` records that
--    one purchase was billed at nothing. This column designates a material as
--    arriving outside purchasing altogether. A supplier waiving the charge on a
--    consignment does not make the trim free-of-cost on the recipe, and writing
--    it here would say it did.
--
-- 2. **The join is one-to-many and would over-tick.** One material sits on
--    several BOM lines of an order — per colour, per panel, per style — so a
--    single FOC purchase line matching on (sales_order_id, item_id) would tick
--    every one of them, including the lines that are bought normally.
--
-- 3. **A line that HAS a purchase order is the case this flag is not for.** The
--    flag exists to open a receipt path for material with no PO; inferring it
--    from a PO line inverts its own meaning.
--
-- So every existing line reads `false`, which is the correct reading: nothing
-- on this BOM has been declared free-of-cost, because until now there was
-- nowhere to declare it. An operator ticks the ones that are. Inventing the
-- answer would be the audit-column lie AGENTS.md records under
-- "Created Date / Created User" — the same argument, one table along.
--
-- (It is also a no-op in THIS database — 0 amendments and 0 item lines at the
-- time of writing, as it was for 0466 — but that is not why there is no
-- backfill. 0466 wrote one anyway for exactly that reason.)
-- ============================================================================


alter table public.material_bom_amendment_items
  add column if not exists is_foc boolean not null default false;

comment on column public.material_bom_amendment_items.is_foc is
  'Ticked on the Items grid as "Free of Cost Receipt": this material arrives '
  'without being bought, so it may be taken into stock on a Goods Receipt with '
  'no purchase order behind it. Named to match po_line_items.is_foc (0359) and '
  'the planning budget tables (0369) — one concept, one spelling. 0474.';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and left a function anon-callable, and 0436 was
-- committed and never applied while its missing column broke every save.
--
-- There is no backfill to assert here (see the header), so the second half of
-- 0466's verify block has no counterpart. What IS asserted beyond the column's
-- shape is that `send_out` is still standing beside it: this migration is an
-- `add column`, and an `add column if not exists` that silently found the name
-- taken would report success over a column of the wrong shape. Checking its
-- neighbour is how the block notices it is looking at the table it thinks.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col      record;
  neighbour int;
begin
  select data_type, is_nullable, column_default
    into col
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'material_bom_amendment_items'
     and column_name = 'is_foc';

  if col is null then
    raise exception '0474: is_foc was not added to material_bom_amendment_items';
  end if;
  if col.data_type <> 'boolean' then
    raise exception '0474: is_foc is %, expected boolean', col.data_type;
  end if;
  if col.is_nullable <> 'NO' then
    raise exception '0474: is_foc is nullable — a checkbox has no third state';
  end if;
  if col.column_default is distinct from 'false' then
    raise exception '0474: is_foc defaults to %, expected false', col.column_default;
  end if;

  -- The table this landed on is the one carrying 0466's tick, not a namesake.
  select count(*) into neighbour
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'material_bom_amendment_items'
     and column_name = 'send_out';
  if neighbour <> 1 then
    raise exception '0474: send_out (0466) is missing — is_foc landed on the wrong table';
  end if;

  -- NOTHING IS TICKED BY THIS MIGRATION. Asserted rather than assumed: a
  -- backfill added later by someone reading only the DDL would pass every check
  -- above, and the header's three reasons would be silently reversed.
  --
  -- THIS ASSERTION IS NOT REPLAY-SAFE, AND THAT IS ACCEPTED RATHER THAN
  -- OVERLOOKED. Re-running this file BY HAND against a database where an
  -- operator has since ticked a line will raise — on a perfectly correct
  -- database. It cannot be narrowed to "ticked by this migration": `add column
  -- if not exists` does not report whether it did anything, so SQL here cannot
  -- tell a fresh column from one that has been in use for a month.
  --
  -- Kept because the two costs are not comparable. The false alarm is loud,
  -- immediate, and read by someone who is already hand-applying a migration and
  -- can see this paragraph; the failure it guards against is a silent reversal
  -- of the header's three reasons that nothing else would catch. Normal flow is
  -- unaffected — applied once, and replayed only onto an empty reset.
  if exists (select 1 from public.material_bom_amendment_items where is_foc) then
    raise exception
      '0474: is_foc is already true somewhere — this migration ticks nothing. '
      'If you are re-applying 0474 by hand to a live database this is expected; '
      'see the note above the assertion.';
  end if;
end $verify$;
