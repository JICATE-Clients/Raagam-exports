-- ============================================================================
-- Raagam ERP — 0555 Orders ▸ Fabric BOM ▸ Manual: "Size Wise" defaults to OFF
--
-- 0523 created `order_fabric_bom_manual_entries.size_wise` with `default true`,
-- which was the legacy behaviour. The client reversed it (2026-09-04: "its auto
-- enabled so disable it") and the screen was changed the same day —
-- `blankManualEntry` seeds `size_wise: false` and the loader's fallback for a
-- NULL stored value is false. The other two statements of the same default were
-- left saying TRUE: the Zod input schema (`fabricBomManualEntryInput`) and this
-- column. This migration is the third of them.
--
-- WHY IT MATTERS EVEN THOUGH THE SCREEN ALWAYS SENDS THE FIELD. The insert in
-- `saveFabricBom` spreads the PARSED entry, so the value that reaches Postgres
-- is whatever the schema resolved — and the schema's default is what a payload
-- omitting the field got. An entry saved that way read back size-wise while the
-- toggle the planner saw had never been switched on: the grid then fans into a
-- row per size on the next open, with no keystroke anywhere that asked for it.
-- The schema default is flipped in the same change; this column is the floor
-- under any insert that reaches the table without going through it.
--
-- EXISTING ROWS ARE NOT TOUCHED. A row saved with `size_wise = true` was a
-- deliberate answer where the sizes genuinely differ, and re-deriving it here
-- would silently collapse a planner's per-size figures to one. Only the default
-- for "nothing was ever stated" changes, which is exactly what the screen and
-- the schema already do.
-- ============================================================================

alter table public.order_fabric_bom_manual_entries
  alter column size_wise set default false;

comment on column public.order_fabric_bom_manual_entries.size_wise is
  'Legacy''s "Size Wise" toggle (0523). TRUE gives every size its own row. FALSE — THE DEFAULT since 0555 (client 2026-09-04: "its auto enabled so disable it") — lets the planner type one figure that is written to every size, so it changes what the SCREEN asks for and never what is stored.';

-- VERIFIED FROM THE CATALOG, NOT FROM THE STATEMENT ABOVE. A migration reporting
-- success means the SQL ran, not that it achieved its stated goal.
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'order_fabric_bom_manual_entries'
       and column_name = 'size_wise'
       and column_default like '%false%'
  ) then
    raise exception '0555: size_wise must default to false';
  end if;
end $$;
