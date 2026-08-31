-- ============================================================================
-- Raagam ERP — 0477 Color/Print ▸ Fabric Print: the name, TYPED
--
-- Adds `garment_order_amendment_prints.print_name`.
--
-- Client 2026-08-29: a third pane on the Color/Print Details tab beside Yarn
-- Dyeing and Fabric Dyeing — "just a single field which is fabric print, allow
-- manual entry, this third section".
--
--
-- ## WHY A COLUMN AT ALL, WHEN THE TABLE ALREADY HOLDS A PRINT
--
-- It holds a print ID. `print_id` references `config_lookups` (kind
-- 'roll_form_print'), so the only print this table can express is one that is
-- already a row in that master. A name the operator types has nowhere to go —
-- there is no text column on this table at all.
--
-- That is the whole of the change: the grid is a restore (it stood on this tab
-- until 2026-08-14 and its state, its save path and this table were all kept
-- deliberately), and manual entry is the one thing it could not do.
--
--
-- ## `print_id` STAYS, AND THAT IS NOT TIDINESS LEFT UNDONE
--
-- `writeChildren` DELETES AND REINSERTS every child grid wholesale, so a column
-- the form stops carrying is not frozen — it is NULLED on the next save of every
-- order that had one. The screen therefore keeps round-tripping `print_id`, and
-- this column joins it rather than replacing it.
--
-- The pairing is `garment_order_amendment_dyeings`' exactly, one grid over:
--
--     color_id    uuid   the master row, when one was picked
--     color_name  text   THE VALUE — always text, picked or typed
--
-- and it is the same shape `style_id` / `style_ref_no` uses two tabs up. 0415
-- states the reasoning for the dyeings pair and it carries over unchanged: the
-- text is what every consumer reads, so a typed value reaches them exactly as a
-- picked one does and nothing downstream has to learn that the id can be null.
--
--
-- ## WHY THE VALUE IS TEXT AND NOT A SECOND LOOKUP KIND
--
-- Because the client asked for manual entry, and because the screen answers it
-- with `TypeOrPick` — the same control the Colour cell beside it uses, for the
-- same instruction ("allow users to manually type/input color names or numbers
-- … rather than forcing a selection strictly from the master list", 2026-08-17).
-- A picked print still writes `print_id`, which is what keeps the Combos tab's
-- Fabric Print list narrowing to what this order declared; a typed one writes
-- only the name and that list falls back to the full master, which is what it
-- does today.
--
-- So the master is not bypassed — it is made optional, and its ⊕ inline-create
-- is still on the cell.
--
--
-- ## NOT NULL IS NOT USED, DELIBERATELY
--
-- 0475's reasoning on this same family of tables: the writer names every column
-- on every insert, so NOT NULL would not default anything — it would reject the
-- save and read as the cause of an outage it merely exposed. A print row with
-- neither an id nor a name is dropped by `normalizePrints` before it gets here.
--
--
-- ## NO BACKFILL, AND THE ABSENCE IS THE POINT
--
-- `print_name` is the value a human typed. A row saved before today has an id
-- and no typed name, and resolving one FROM the master would invent a fact —
-- the screen reads the master for the label when the id is set, which is where
-- that resolution belongs and where it stays correct if the master is renamed.
-- Compare 0476, which DID backfill: 'Greige' there is a default state every row
-- genuinely has, not a record of what somebody entered.
-- ============================================================================


alter table public.garment_order_amendment_prints
  add column if not exists print_name text;

comment on column public.garment_order_amendment_prints.print_name is
  'The fabric print, AS TEXT — the value, whether it was picked from the '
  '''roll_form_print'' lookup or typed (client 2026-08-29: "allow manual '
  'entry"). Pairs with print_id exactly as dyeings.color_name pairs with '
  'color_id: the id is set only when a master row was chosen, and the TEXT is '
  'what every consumer reads. Not backfilled — a row with no typed name never '
  'had one. 0477.';


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and left a function anon-callable, and 0436 was
-- committed and never applied while its missing column broke every save.
-- ----------------------------------------------------------------------------

do $verify$
declare
  t text;
begin
  select data_type
    into t
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendment_prints'
     and column_name = 'print_name';

  if t is null then
    raise exception '0477: print_name was not added';
  end if;

  /* TEXT, NOT uuid. The whole point of the column is that it holds something no
     master row has to exist for; a uuid here would mean the add ran against the
     wrong intent even though it ran. */
  if t <> 'text' then
    raise exception '0477: print_name is %, expected text', t;
  end if;

  /* AND `print_id` IS STILL THERE. This migration ADDS a partner to it; a
     reading of "the name replaces the id" would null every print on every
     order's next save (`writeChildren` deletes and reinserts). Asserted so that
     reading cannot pass silently. */
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'garment_order_amendment_prints'
       and column_name = 'print_id'
  ) then
    raise exception '0477: print_id is gone — it must survive beside print_name';
  end if;
end $verify$;
