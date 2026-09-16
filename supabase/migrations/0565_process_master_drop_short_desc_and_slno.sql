-- ============================================================================
-- Raagam ERP — 0565 Process Master form cleanup (client, doc/order/fabriprocess.md §4)
--
-- Two fields leave the Process master, and they leave the DATABASE rather than
-- just the screen:
--
--   1. SHORT DESCRIPTION — "the redundant short description textbox" (client,
--      form review at the end of record-1789468621009.wav). It goes from BOTH
--      places it exists: the header (`processes.short_description`) and the Sub
--      Categories line grid (`process_sub_categories.short_description`).
--
--   2. SL NO — `processes.sl_no`, added verbatim by 0293/0294 from the legacy
--      EDP2 export, where a hand-typed serial was how process steps were
--      ordered. It is redundant now and worse than redundant: step ordering is
--      governed by the 5 standard process routes (the stage → base process
--      table in §3 of the same spec, and `process_fabric_stages` in 0563), so a
--      second, hand-typed ordering is a way to enter a sequence the routes then
--      contradict. The client's own words: manual serial numbers "cause
--      sequencing errors".
--
-- ## WHY THE COLUMNS GO AND NOT JUST THE FIELDS
--
-- This is the repo's own idiom, recorded twice in
-- `lib/orders/fabric-bom/processes.ts` (`rate`, dropped by 0521; `description`,
-- dropped by 0528): `lib/data-io` parses imports with the same `*Input` Zod
-- schemas the screen uses and writes STRAIGHT to Postgres, so a field left
-- standing in the schema is a door the screen has closed and a spreadsheet
-- import can still walk through. `processes` IS a data-io entity
-- (`lib/data-io/entities.ts`), so that is not hypothetical here — its field list
-- carried `Short Description` as an importable column until this change.
--
-- ## THE ONE CONSUMER OF `sl_no` OUTSIDE THIS MASTER, FIXED IN THE SAME CHANGE
--
-- `getProcessRows()` in `lib/orders/fabric-plan/service.ts` ordered the Fabric
-- Plan's process picker by it (`.order("sl_no")`). PostgREST answers a sort over
-- a missing column with an ERROR, and that call site reads `data ?? []` — so
-- leaving it would have emptied the picker silently rather than loudly (the
-- "A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST" trap AGENTS.md records). It
-- now orders by `name`, which is what every other process feed in the app
-- already does.
--
-- `commodity_id` is NOT touched. It is the other withdrawn field on this master
-- (client 2026-08-01, when the Commodities master itself went) and it stays in
-- the database holding its values, unread and unwritten — see 0227 and
-- `lib/masters/process-types.ts`. That was a decision about a MASTER being
-- withdrawn while its data stayed meaningful; this one is about two fields the
-- client asked to stop collecting.
-- ============================================================================

alter table public.processes
  drop column if exists short_description,
  drop column if exists sl_no;

alter table public.process_sub_categories
  drop column if exists short_description;
