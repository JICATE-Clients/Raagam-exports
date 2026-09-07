-- ===========================================================================
-- 0519 — "COLOR WISE" joins the `process_loss_for` vocabulary.
--
-- Client, 2026-09-03, reading the Fabric BOM process tabs: "for field is
-- dropdown field values are Process Wise, Color Wise".
--
-- 0492 SEEDED ONE VALUE AND SAID SO. Its comment reads "the two values the
-- screenshot actually shows, and nothing else" — the legacy screenshot printed
-- `Process wise` in that cell and nothing else, so a second value would have
-- been invented rather than observed. AGENTS.md records under "Near misses"
-- what a defaulted vocabulary costs: the first spell-suggest shipped a fibre
-- word list as a fallback, "corrected" a Packing Accessories name to COTTON,
-- and the client had the whole feature removed two days later. An empty list
-- the operator extends is the honest state; a guessed list is not.
--
-- SO THIS IS THE CLIENT SUPPLYING IT, which is the one thing that was missing.
-- It is seeded rather than left to "+ Add" for the reason 0492 seeded the first
-- one: a value BOTH process tabs will offer, on every unit and every install,
-- is not per-operator data.
--
-- `where not exists` ON CODE — 0279's idiom, and 0492's. A re-run adds nothing,
-- and a name the operator has since edited (COLOUR WISE, say — this business
-- writes both spellings) is never overwritten by the seed's own wording.
--
-- NO CODE READS THE CODE. `process_loss_for` is chosen by id off
-- `config_lookups` (`loss_for_id` on `order_fabric_bom_processes`), so nothing
-- branches on 'color_wise' and renaming or deactivating it breaks nothing. That
-- is what makes it safe to seed a word whose arithmetic is still being settled
-- with the client.
-- ===========================================================================

insert into public.config_lookups (kind, code, name, is_active)
select 'process_loss_for', v.code, v.name, true
from (values
  ('color_wise', 'COLOR WISE')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups where kind = 'process_loss_for' and code = v.code
);
