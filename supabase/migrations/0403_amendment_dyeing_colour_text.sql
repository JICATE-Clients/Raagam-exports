-- ============================================================================
-- Raagam ERP — 0403 The dyeing rows carry a colour NAME, not only a colour id
--
-- Colour Cards is being withdrawn as a screen (client 2026-08-11). It was the
-- ONLY source of colours in this app: there is no global colour master —
-- `public.colors` was dropped by 0382 as "not applicable to the business
-- process" — so the Color/Print tab's Colour picker was about to become a
-- permanently empty dropdown over a feature the operator can no longer reach.
--
-- The screen's Colour cell therefore becomes free text, matching the `Type` box
-- beside it, which has always been free text. That needs somewhere to put the
-- text: `garment_order_amendment_dyeings` carries `color_id uuid references
-- public.color_card_colors(id)` (0128:69) and nothing else. This adds
-- `color_name text`.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO.
--
-- It does not drop `color_id`, and it does not touch `color_cards` /
-- `color_card_colors`. Three reasons, in order of how expensive getting them
-- wrong is:
--
--  1. 0397 ASSERTS THE FK. Its verification block raises an exception unless
--     `garment_order_amendment_combo_components.color_id` still points at
--     `public.color_card_colors`. Dropping the tables would make a migration
--     that has already run stop being true of the database.
--  2. Removing an interface is not removing data. The tables hold 0 rows today,
--     so nothing is gained by dropping them and a re-introduced Colours master
--     would have to rebuild what is already there — the same call the plan
--     records for the Colour Cards routes themselves.
--  3. `color_id` on the dyeing rows is likewise frozen, not deleted. Every save
--     deletes and reinserts a child grid wholesale (`writeChildren`), so the
--     application keeps carrying the value it loaded; a column dropped here
--     would take with it whatever a future Colours master would want to read.
--
-- The two columns are not redundant and neither is authoritative over the
-- other: `color_id` is what a colour card issued, `color_name` is what the
-- operator typed. Nothing today writes both.
--
-- Additive and idempotent — no data is rewritten, no constraint is added. A
-- CHECK forcing "one of the two is set" is deliberately absent: a dyeing row
-- may legitimately name only a Type (`normalizeDyeings` already keeps a row on
-- `dye_type || color_id` alone).
-- ============================================================================

alter table public.garment_order_amendment_dyeings
  add column if not exists color_name text;

comment on column public.garment_order_amendment_dyeings.color_name is
  'Colour as typed on the Color/Print tab (0403). Free text since Colour Cards '
  'was withdrawn as a screen; color_id beside it is the pre-0403 colour-card '
  'reference, frozen rather than dropped.';

-- ---------------------------------------------------------------------------
-- Verify from the catalog, not from the fact that the statements above ran.
-- `{"success": true}` means the SQL executed, not that it achieved its stated
-- goal (AGENTS.md, "Function grants").
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'garment_order_amendment_dyeings'
      and column_name  = 'color_name'
      and data_type    = 'text'
  ) then
    raise exception '0403: color_name is missing from garment_order_amendment_dyeings';
  end if;

  -- The freeze, asserted: this migration must not have cost the row its
  -- colour-card reference, and 0397's own assertion depends on the target
  -- table still being there.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'garment_order_amendment_dyeings'
      and column_name  = 'color_id'
  ) then
    raise exception '0403: color_id was dropped — it is frozen, not removed';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid  = 'public.garment_order_amendment_dyeings'::regclass
      and c.contype   = 'f'
      and c.confrelid = 'public.color_card_colors'::regclass
  ) then
    raise exception '0403: the color_card_colors FK is gone — see 0397';
  end if;
end $$;
