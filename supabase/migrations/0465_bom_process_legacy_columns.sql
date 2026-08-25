-- =============================================================================
-- 0465 — The process row gains legacy's five columns
--
-- Client, 2026-08-24, with legacy's Processes tab beside ours (screenshots
-- 2484 / 2485): "keep the lifecycle and add legacy's five fields nested".
--
-- Legacy's nested grid is  S No | Stage | Process | For | Descriptions | Loss % |
-- Notes , hung under the ITEM rather than beside a material picker. Ours carried
-- the grey-to-processed lifecycle instead — Vendor / Qty Out / Challan / Qty In /
-- Balance / Status (0459) — which legacy has nowhere at all.
--
-- BOTH SURVIVE, and that is the client's explicit decision rather than a
-- compromise reached by adding columns until everyone was quiet. The lifecycle is
-- what `chain.ts` walks, what `Generate Delivery Challan` reads and what
-- `check:process-chain` covers; dropping it to match a legacy layout would delete
-- working function to make a screenshot match.
--
--
-- ## THE THREE THAT ARE UNAMBIGUOUS, AND THE TWO THAT ARE NOT
--
-- `loss_pct`, `notes` and `stage` are plain: a number, a free note, and the name
-- of what the material becomes at this step.
--
-- `for_scope` and `description` are NOT, and they are stored as TEXT rather than
-- as anything cleverer, deliberately:
--
--   * legacy renders **For** as a DROPDOWN and the only value ever observed is
--     "Process wise" (screenshot 2484). One sighting is not a vocabulary. This
--     repo has already paid for inventing one: a seeded fibre word list
--     "corrected" a Packing Accessories name to COTTON and the client had the
--     feature removed two days later (see AGENTS.md, Near misses). A text column
--     stores exactly what the operator chose and becomes a lookup the moment the
--     client supplies the list — the reverse is a migration plus an apology.
--
--   * legacy's **Descriptions** cell reads "Click", which in that UI usually
--     means it opens a sub-dialog rather than holding the text itself — the same
--     shape its Combination cell has. Until that dialog has been seen, a text
--     column is the honest floor: it holds whatever the field turns out to be a
--     summary of, and nothing has to be un-stored if it becomes an overlay.
--
-- Naming: `for_scope`, because `for` is a reserved word. `description` singular
-- though legacy's header is plural — the column holds one row's text.
--
--
-- ## `loss_pct` IS STORED AND SHOWN, AND IT DOES NOT COMPUTE YET
--
-- Stated here because a percentage that looks live and is not is exactly the
-- class of defect this module keeps finding. Dyeing genuinely loses material, so
-- the figure has an obvious arithmetic home in `requirementFor` — and wiring it
-- there changes every purchase quantity on any BOM that carries a process. That
-- is a decision with a number attached and it has not been made, so this
-- migration adds the column and NOTHING reads it. When it is wired, it needs its
-- own vectors: the loss compounds along a chain (`prev_row_uid`), so two stages
-- at 5% is not 10%.
--
--
-- ## NO BACKFILL, AND NO DEFAULTS
--
-- Every column is nullable with no default. NULL means "not answered", which is
-- the state every existing row is genuinely in — and `material_bom_amendment_
-- processes` holds zero rows today anyway (verified from the catalog). A default
-- of 0 on `loss_pct` would be a claim that a process loses nothing, which is a
-- different statement from not having been asked.
-- =============================================================================

alter table public.material_bom_amendment_processes
  add column if not exists stage       text,
  add column if not exists for_scope   text,
  add column if not exists description text,
  add column if not exists loss_pct    numeric(6,2),
  add column if not exists notes       text;

comment on column public.material_bom_amendment_processes.stage is
  'Legacy''s Stage: what the material becomes at this step ("DYED"). Free text, '
  'not an enum — `chain.ts` already models grey vs coloured through '
  'item_color_id (NULL = grey), and this is the operator''s NAME for the step '
  'rather than a second source of that truth (0465).';
comment on column public.material_bom_amendment_processes.for_scope is
  'Legacy''s "For" column. A dropdown there; the only observed value is '
  '"Process wise", so this is text rather than an invented lookup. Becomes a '
  'config_lookups kind once the client supplies the option list (0465).';
comment on column public.material_bom_amendment_processes.description is
  'Legacy''s Descriptions. Its cell reads "Click", which in that UI usually '
  'opens a sub-dialog, so this may later become a summary of one (0465).';
comment on column public.material_bom_amendment_processes.loss_pct is
  'Legacy''s Loss %. STORED AND DISPLAYED ONLY — nothing computes from it yet. '
  'Wiring it into requirementFor changes every purchase quantity on a BOM with '
  'processes, and loss COMPOUNDS along a chain, so it needs its own decision '
  'and its own vectors (0465).';
comment on column public.material_bom_amendment_processes.notes is
  'Legacy''s Notes. Free text against one process row (0465).';

do $assert$
declare
  missing text;
begin
  -- Named one by one rather than counted: a count of 5 is satisfied by five
  -- columns of the wrong names, and `add column if not exists` is silent when it
  -- does nothing. 0436 shipped an unapplied column that read as applied and
  -- broke every insert, which is the failure this shape exists to prevent.
  select string_agg(c, ', ') into missing
    from unnest(array['stage', 'for_scope', 'description', 'loss_pct', 'notes']) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'material_bom_amendment_processes'
        and column_name  = c
   );
  if missing is not null then
    raise exception '0465: these columns were not added: %', missing;
  end if;

  -- `loss_pct` must stay NULLABLE. NULL is "not asked"; 0 is "loses nothing",
  -- and those are different claims about a figure a purchase may one day be
  -- computed from.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_processes'
       and column_name  = 'loss_pct'
       and is_nullable  = 'NO'
  ) then
    raise exception '0465: loss_pct must be nullable — NULL is not the same claim as 0';
  end if;

  -- The lifecycle 0459 built is untouched. Asserted because this migration's
  -- whole premise is that both column families coexist, and a later "tidy-up"
  -- that drops one should fail here rather than in a purchase order.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_processes'
       and column_name  = 'prev_row_uid'
  ) then
    raise exception '0465: prev_row_uid is gone — 0459''s chain was dropped';
  end if;
end
$assert$;
