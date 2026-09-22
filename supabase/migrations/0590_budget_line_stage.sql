-- 0590 — A budget line records the yarn STAGE (2026-09-19)
--
-- Budget ▸ Purchase Rates ▸ Yarn Purchases gains Stage and Colour, "duplicated"
-- from the Fabric BOM's Yarn Process tab (user 2026-09-19: "see the stage is from
-- yarn process of fabric bom"). Colour already has a home — `combo` (0573). Stage
-- did not: this is it.
--
-- THE SAME LOOKUP THE FABRIC BOM USES. `order_fabric_bom_yarn_stages.stage_id`
-- points at `config_lookups` rows of kind `yarn_stage` (GREY / DYED, 0504), and so
-- does this, so a pulled line carries the very row the BOM chose and the screen's
-- dropdown lists the very values the BOM's does.
--
-- NULLABLE AND ADDITIVE. Every source but `yarn` leaves it NULL, as does a yarn
-- line nobody has staged. ON DELETE SET NULL: a lookup row removed later must not
-- delete budget lines — the line keeps its cost and loses only the label.
--
-- A SECOND FK FROM THIS TABLE TO `config_lookups` (`cost_head_id`, 0575, is the
-- first). A bare `config_lookups(...)` embed on order_budget_lines is therefore
-- ambiguous from here on (AGENTS.md, "A SECOND FK BREAKS EVERY EXISTING EMBED");
-- name the column: `config_lookups!stage_id(...)`. Checked on 2026-09-19: no
-- select in the repo embeds config_lookups from order_budget_lines today.

alter table public.order_budget_lines
  add column if not exists stage_id uuid
    references public.config_lookups(id) on delete set null;

comment on column public.order_budget_lines.stage_id is
  'Yarn stage (config_lookups kind yarn_stage: GREY / DYED) — the state a yarn purchase line is bought in, copied from the Fabric BOM Yarn Process on pull (0590).';
