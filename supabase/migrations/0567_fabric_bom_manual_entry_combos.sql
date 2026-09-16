-- ============================================================================
-- Raagam ERP — 0567 Fabric BOM ▸ Manual: WHICH COLOURWAYS ONE WEIGHT IS FOR
--
-- Client spec, Manual Consumption (Direct Entry), §2B: "When Assort Color-Wise
-- = ON, merchandisers group shades with identical weights using a Multi-Select
-- Picker instead of cluttering the screen with duplicate rows" — ☑ WHITE
-- ☑ DUTCH BLUE at 220g on one row, ☑ PARISIAN NIGHT at 230g on the next.
--
--
-- `assort_color_wise` HAS BEEN A CONTROL THAT CHANGED NOTHING
--
-- 0494 put the flag on the entry and every engine ignored it. Every reader of
-- an `assort_color_wise` in this codebase today is reading the PROCESS SCOPE's
-- separate flag (`order_fabric_bom_process_scope`, 0528) — `stageCoversCombo`,
-- `processSlices`, `normalizeProcessScopes`. The Manual entry's own copy is
-- written by `normalizeManualEntries` and read by nobody: `requirementRows`
-- passes `combo: null` with a comment saying so in as many words ("NEVER
-- SCOPED BY COMBO"), so the weight has always exploded across every colourway
-- whatever the toggle said.
--
-- That is AGENTS.md's "stated vs enforced" exactly — a switch the operator
-- sets, that is stored, and that no arithmetic consults. This table is what
-- gives it something to mean.
--
--
-- IT HANGS OFF THE ENTRY, AND THE SPEC'S OWN MOCKUP IS WHY
--
-- Rows 1 and 2 of §2B are the same component set, the same cloth and the SAME
-- SIZE (3YRS), differing only in their colourways and their weights. A size
-- row cannot express that: `uq_ofbms_entry_size` admits one row per size per
-- entry, so those two rows are two ENTRIES. Which is the right reading anyway
-- — 0494 calls an entry "one weight configuration", and "for these colourways"
-- is part of the configuration, not of the size beneath it.
--
--
-- A CHILD TABLE, NOT A `text[]`, and the same shape as its sibling
--
-- `order_fabric_bom_manual_components` (0494) already answers the identical
-- question one axis over — "which panels does this weight cover" — as a child
-- table with a `(entry_id, x)` unique index. Copying it costs nothing and buys
-- three things an array would need extra work for: PostgREST nests it in the
-- same `listFabricBoms` select the components already ride in, the unique
-- index makes "one colourway once per entry" a constraint rather than a
-- convention, and a duplicate cannot be stored at all.
--
--
-- TEXT, BECAUSE A COLOURWAY IS TEXT ON THIS DOCUMENT
--
-- 0426's rule, restated by 0512 when it faced the same choice: "the order keys
-- its colourways by text, not by an FK, and a second spelling here would not
-- resolve". `order_fabric_bom_lines.combo`, `order_fabric_bom_requirements.
-- combo`, `order_fabric_bom_processes.combo` and
-- `order_fabric_bom_yd_combinations.combo` are all text; this is the fifth and
-- it matches them. `comboKey()` is what compares them, everywhere.
--
--
-- NO BACKFILL, AND THE DATABASE SAYS SO RATHER THAN THE AUTHOR
--
-- All 11 stored entries across 4 BOMs read `assort_color_wise = false`
-- (checked 2026-09-16). False means "one weight for every colourway", which is
-- what the engine has always done, so every existing row keeps its exact
-- current behaviour with no row written here. An entry that is colour-wise
-- and names nothing is a different state and the engine REFUSES it by name
-- (`fabricSlices`) rather than treating it as "all" — see that function.
-- ============================================================================

create table if not exists public.order_fabric_bom_manual_combos (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null
               references public.order_fabric_bom_manual_entries(id) on delete cascade,

  -- The assort colourway, BY NAME. Not null: a row exists to name one, and a
  -- null here would be a third meaning ("every colourway") competing with the
  -- entry's own flag and with the absence of rows.
  combo      text not null,

  created_at timestamptz not null default now()
);

create index if not exists idx_ofbmcb_entry
  on public.order_fabric_bom_manual_combos(entry_id);

-- ONE COLOURWAY ONCE PER ENTRY — the multi-select cannot produce a duplicate,
-- but `lib/data-io` writes straight to Postgres and a second row would double
-- that colour's weight in the explosion. Same reasoning, same shape, as
-- `uq_ofbmc_entry_component` on the components beside it.
create unique index if not exists uq_ofbmcb_entry_combo
  on public.order_fabric_bom_manual_combos(entry_id, combo);

comment on table public.order_fabric_bom_manual_combos is
  'Which assort colourways one Manual entry''s weight is for (0567). Read only '
  'when the entry''s assort_color_wise is ON: off, the entry covers EVERY '
  'colourway of its style and these rows are absent. Held by NAME like every '
  'other combo on this document (0426) and compared with comboKey(). A '
  'colour-wise entry naming none is refused by fabricSlices, never read as '
  '"all" — see lib/orders/fabric-bom/requirement.ts.';

-- ---------------------------------------------------------------------------
-- RLS — the child shape, the same four policies every sibling carries.
--
-- NO `location_id`, for 0494's reason verbatim: this is a grandchild of
-- `order_fabric_boms`, which carries it and whose policies narrow on
-- `is_current_location()`. A location here would be a second answer to "which
-- unit is this BOM" that nothing keeps in step with the first.
-- ---------------------------------------------------------------------------
do $rls$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_fabric_bom_manual_combos'
  ) then
    create policy order_fabric_bom_manual_combos_read
      on public.order_fabric_bom_manual_combos
      for select to authenticated using (public.has_permission('orders','view'));
    create policy order_fabric_bom_manual_combos_insert
      on public.order_fabric_bom_manual_combos
      for insert to authenticated with check (public.has_permission('orders','create'));
    create policy order_fabric_bom_manual_combos_update
      on public.order_fabric_bom_manual_combos
      for update to authenticated using (public.has_permission('orders','edit'))
      with check (public.has_permission('orders','edit'));
    create policy order_fabric_bom_manual_combos_delete
      on public.order_fabric_bom_manual_combos
      for delete to authenticated using (public.has_permission('orders','delete'));
  end if;
end $rls$;

alter table public.order_fabric_bom_manual_combos enable row level security;
