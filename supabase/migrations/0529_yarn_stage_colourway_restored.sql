-- ===========================================================================
-- 0529 — Fabric BOM ▸ Yarn Process: the colourway split RETURNS to `For`.
--
-- 0504 built `combo` on this table — a stage marked PURPLE grossed up the
-- purple share alone. 0520 (2026-09-03) dropped it on the client's own
-- instruction, replacing `For` with the fixed PROCESS WISE / COLOR WISE label,
-- and its header said in so many words: "Restoring the colourway needs a new
-- client decision, not a tidy-up." 0519, seeding COLOR WISE the same day, went
-- further and made sure nothing in the codebase acted on it yet: "nothing
-- branches on 'color_wise' … safe to seed a word whose arithmetic is still
-- being settled with the client."
--
-- THIS IS THAT SETTLEMENT. A business requirements document supplied
-- 2026-09-04 specifies exactly 0504's pre-0520 shape: a yarn colour dropdown
-- "scoped strictly to the current style's declared colours" that divides a
-- treatment's loss between colourways, confirmed against this repo's own
-- account of what 0520 gave up (`lib/orders/fabric-bom/yarn-process.ts`
-- header) before this migration was applied.
--
-- `loss_for_id` (0520) IS NOT REMOVED. It stays the `For` column's LABEL —
-- PROCESS WISE / COLOR WISE, still the fabric route's shared
-- `process_loss_for` list — and the screen now uses COLOR WISE to decide
-- whether the colourway field is shown at all
-- (`components/orders/yarn-process-grid.tsx`). The ARITHMETIC reads `combo`
-- alone, exactly as it did before 0520, so nothing branches on the lookup's
-- code or name in the engine — a lookup renamed on the master degrades a
-- field's visibility, never the purchase figure.
--
-- NOTHING TO BACK-FILL. `order_fabric_bom_yarn_stages` held 0 rows when 0520
-- dropped `combo`, and holds either 0 or rows written entirely under 0520's
-- shape (no `combo` to have carried) — there is no colourway answer this
-- migration could destroy by re-adding the column blank.
-- ===========================================================================

alter table public.order_fabric_bom_yarn_stages
  add column if not exists combo text;

comment on column public.order_fabric_bom_yarn_stages.combo is
  'The `For` column''s ARITHMETIC (0504, restored 0529 after 0520 removed it) '
  '— which colour combo this treatment applies to. NULL means EVERY combo, '
  'which is the ordinary case. Text by VALUE, matching '
  'order_fabric_bom_requirements.combo, because a combo is free text on the '
  'garment order and has no master row to reference.';

comment on column public.order_fabric_bom_yarn_stages.loss_for_id is
  'The `For` column''s LABEL — how the operator describes this step''s Loss %.'
  ' `config_lookups` kind `process_loss_for`: PROCESS WISE / COLOR WISE, the '
  'same list the fabric route''s `Loss for` reads (0492 - 0519). COLOR WISE is '
  'what the SCREEN uses to decide whether `combo` is shown; the arithmetic '
  'reads `combo` alone, restored 0529.';

comment on column public.order_fabric_bom_yarn_stages.process_qty is
  'The weight this step handles — the purchase weight of the COMBOS IT '
  'APPLIES TO (0529, restoring 0504''s reading after 0520''s "whole yarn" '
  'interlude). Two steps on one combo each carry that lot''s full weight, '
  'which looks like a double count and is not: the dyer and the winder each '
  'handle that lot and each invoice for it. Written by the server, never by '
  'the form.';


-- ---------------------------------------------------------------------------
-- VERIFY (run by hand)
--
--   -- the column is back (expect 1)
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'order_fabric_bom_yarn_stages'
--      and column_name = 'combo';
--
--   -- loss_for_id is untouched, still there beside it (expect 1)
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'order_fabric_bom_yarn_stages'
--      and column_name = 'loss_for_id';
-- ---------------------------------------------------------------------------
