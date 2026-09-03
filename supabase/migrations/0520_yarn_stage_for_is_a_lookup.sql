-- ===========================================================================
-- 0520 — Fabric BOM ▸ Yarn Process: `For` is a LOOKUP, not a colourway.
--
-- Client, 2026-09-03: "for field is dropdown field values are Process Wise,
-- Color Wise", confirmed against the alternative that kept the colourway.
--
-- ## THIS REVERSES 0504's RULE 3, DELIBERATELY, AND THE REVERSAL IS THE POINT
--
-- 0504 §3 is headed "`combo` IS THE `For` COLUMN, AND IT DIVIDES THE WEIGHT",
-- and quotes the client of 2026-09-01: "it only applies the dyeing process to
-- the exact weight percentage of yarn destined for that specific colour combo".
-- That was built, and `stageProcessQty` scoped each step's budget line to the
-- lot it named.
--
-- The client was shown that this choice REMOVES that split — a `For` holding
-- two fixed words cannot name PURPLE, so a stage can no longer be quoted on the
-- purple lot alone — and chose it anyway. The later instruction wins. Restoring
-- the colourway needs a new client decision, not a tidy-up, and a reader who
-- finds 0504 §3 quoted elsewhere is holding something this supersedes.
--
-- ## WHAT SURVIVES, SO THE REVERSAL IS NOT READ WIDER THAN IT IS
--
-- The OTHER 09-01 decision is untouched: `Loss %` still grosses the weight up
-- as `x (1 + loss/100)` and stages still COMPOUND sequentially — 3% then 2% is
-- x 1.03 x 1.02 = 5.06%, not 5.00%. `scripts/check-yarn-process.mts` still
-- refutes 111.12 and 1050.00 for those two, and neither vector changed here.
--
-- The per-colourway BREAKDOWN also survives: a yarn's net is still weighed per
-- combo (`yarnNetByCombo`), because that is a property of the FABRIC's
-- requirement and not of the `For` column. What changed is only which stages
-- treat which colourway — now every stage treats every one.
--
-- ## NOTHING IS LOST, AND THAT IS CHECKED RATHER THAN ASSUMED
--
-- `select count(*) from order_fabric_bom_yarn_stages` returned 0 on 2026-09-03,
-- before this ran. No planner has recorded a treatment, so `combo` holds no
-- answer for a backfill to preserve and dropping it destroys nothing. Had it
-- held rows, the honest migration would have been to keep the column and
-- backfill `loss_for_id` from it (a named combo -> COLOR WISE, a NULL ->
-- PROCESS WISE) rather than to drop an operator's answer to make a column tidy.
--
-- ## THE VOCABULARY IS SHARED WITH THE FABRIC ROUTE, NOT COPIED
--
-- `process_loss_for` is the kind `order_fabric_bom_processes.loss_for_id`
-- already points at (0492), and 0519 added COLOR WISE beside its PROCESS WISE.
-- One list behind both `For` columns, so a value the operator adds on either
-- tab is on both — the alternative was a second kind that would drift the first
-- time someone extended one of them.
-- ===========================================================================

alter table public.order_fabric_bom_yarn_stages
  add column if not exists loss_for_id uuid references public.config_lookups(id);

alter table public.order_fabric_bom_yarn_stages
  drop column if exists combo;

comment on column public.order_fabric_bom_yarn_stages.loss_for_id is
  'The `For` column — how this step''s Loss % is measured. `config_lookups` '
  'kind `process_loss_for`: PROCESS WISE / COLOR WISE, the same list the '
  'fabric route''s `Loss for` reads (0492 - 0519). DESCRIPTIVE, not '
  'arithmetic: it replaced a colour combo on 2026-09-03 (0520) and with it the '
  'rule that a step could be quoted on one lot, so every step now treats every '
  'colourway.';

comment on column public.order_fabric_bom_yarn_stages.process_qty is
  'The weight this step handles — the yarn''s WHOLE gross purchase, since '
  '0520 removed the colourway that used to narrow it. Two steps on one yarn '
  'each carry its full weight, which looks like a double count and is not: the '
  'dyer and the winder each handle that lot and each invoice for it. Written '
  'by the server, never by the form.';
