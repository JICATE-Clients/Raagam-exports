-- ============================================================================
-- Raagam ERP — 0466 Material BOM ▸ Items: "Send out"
--
-- A tick on the material line saying THIS MATERIAL GOES OUT FOR A PROCESS —
-- dyeing, washing, printing — declared while the material is being entered
-- (client 2026-08-25: "while adding material they give any tick box that
-- selected item will only list in process tab").
--
--
-- WHAT PROBLEM IT SOLVES
--
-- The Processes tab drew a bordered card for EVERY material on the BOM whether
-- or not it had a process: ~95px of gap, header band, grid frame and "+ Add
-- process" to say "nothing here", twenty times over on an ordinary document.
-- Most trims are bought and sewn on; only a few are sent out.
--
--
-- IT IS A UNION, NOT A FILTER, AND THAT IS THE WHOLE SAFETY ARGUMENT
--
-- The screen lists a material on the Processes tab when it is TICKED **or**
-- when it already HAS a process row. Never ticked-only.
--
-- That matters because `writeChildren` deletes and reinserts every process row
-- on each save, and it REFUSES a save that drops a row already dispatched under
-- a delivery challan — testing the raw payload, not what is on screen. Under a
-- union, un-ticking can never remove a row from the tab, so it can never take a
-- row out of the payload, so it can never trip that refusal or silently delete
-- an un-dispatched row. There is no guard to write and no confirm dialog,
-- because there is no way to lose anything.
--
-- The screen already derives the list from "has a process row" (the client's
-- other 2026-08-25 note). This column adds the one state deriving cannot
-- express: **decided, not yet filled in** — the to-do that makes the tab a work
-- list rather than a record of finished work.
--
--
-- NOT NULL WITH A DEFAULT, NEVER NULLABLE
--
-- The shape the only other booleans in this feature take —
-- `material_bom_amendment_item_slices.chosen` / `.size_wise` (0449). A nullable
-- flag would invent a third state ("not answered") for a question a checkbox
-- cannot leave unanswered.
--
--
-- THE BACKFILL IS THE HALF THAT WOULD BE MISSED
--
-- Without it every BOM already saved opens with an empty Processes tab: the
-- flag is false everywhere, and only the "has a row" half of the union would
-- carry them. The rows are not lost — the union still shows them — but a
-- material an operator deliberately sent out would come back un-ticked, and the
-- next person to read the line would believe it was never meant to go out.
--
-- It is a NO-OP IN THIS DATABASE — 0 amendments, 0 item lines, 0 process rows
-- at the time of writing — and it is written and asserted anyway, because it
-- will not be a no-op on any environment that has data. 0455/0456 record what a
-- backfill that omits a case costs.
-- ============================================================================


alter table public.material_bom_amendment_items
  add column if not exists send_out boolean not null default false;

comment on column public.material_bom_amendment_items.send_out is
  'Ticked on the Items grid: this material goes out for a process. The Processes '
  'tab lists a material when it is ticked OR already has a process row (a union, '
  'so un-ticking can never hide a row). 0466.';


-- ----------------------------------------------------------------------------
-- Backfill: anything that already has a process was, self-evidently, sent out.
-- ----------------------------------------------------------------------------

update public.material_bom_amendment_items i
   set send_out = true
 where i.send_out = false
   and exists (
     select 1
       from public.material_bom_amendment_processes p
      where p.amendment_id = i.amendment_id
        and p.item_id = i.item_id
   );


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and left a function anon-callable, and 0436 was
-- committed and never applied while its missing column broke every save.
--
-- The backfill is asserted by its OWN QUESTION rather than by a row count: "is
-- there any item line that has a process row and is still false?" A count would
-- read 0 on this empty database and prove nothing.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col        record;
  stragglers int;
begin
  select data_type, is_nullable, column_default
    into col
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'material_bom_amendment_items'
     and column_name = 'send_out';

  if col is null then
    raise exception '0466: send_out was not added to material_bom_amendment_items';
  end if;
  if col.data_type <> 'boolean' then
    raise exception '0466: send_out is %, expected boolean', col.data_type;
  end if;
  if col.is_nullable <> 'NO' then
    raise exception '0466: send_out is nullable — a checkbox has no third state';
  end if;
  if col.column_default is distinct from 'false' then
    raise exception '0466: send_out defaults to %, expected false', col.column_default;
  end if;

  select count(*) into stragglers
    from public.material_bom_amendment_items i
   where i.send_out = false
     and exists (
       select 1 from public.material_bom_amendment_processes p
        where p.amendment_id = i.amendment_id and p.item_id = i.item_id
     );
  if stragglers <> 0 then
    raise exception '0466: % item line(s) carry a process row and were left un-ticked', stragglers;
  end if;
end $verify$;
