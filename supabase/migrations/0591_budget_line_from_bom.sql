-- 0591 — A budget line records whether it came FROM A BOM (2026-09-19)
--
-- The Budget fills itself: picking a garment order pulls its cost lines from the
-- Fabric BOM and the Material BOM, and the merchandiser types RATES ONLY (user
-- 2026-09-19). A pulled line's item, description, quantity, unit, stage and
-- colour are the BOM's answer and are read-only on the budget; a line typed by
-- hand stays fully editable.
--
-- THE SOURCE CANNOT SAY WHICH. `source = 'yarn'` is a Yarn Purchases line
-- whether the BOM raised it or the operator pressed "+ Add line" — every pulled
-- grid also takes a hand-added line. So the provenance needs its own column, or
-- the lock has nothing to key on and a re-pull cannot tell a stale BOM line
-- (gone from the BOM, to be flagged) from a typed one (to be left alone).
--
-- NOT NULL DEFAULT FALSE: every line written before this was typed or pulled
-- with no record of which, and there were none live (0 rows on 2026-09-19), so
-- the default is the honest reading and nothing needs backfilling.
--
-- A FLAG, NOT A LOCK IN THE DATABASE. The screen locks the cells and the submit
-- action re-pulls and refuses a budget whose pulled lines no longer match the
-- BOMs (`submitBudget`); a trigger could not re-run the Fabric BOM report that
-- the fabric weights come from.

alter table public.order_budget_lines
  add column if not exists from_bom boolean not null default false;

comment on column public.order_budget_lines.from_bom is
  'True when the line was pulled from the Fabric BOM / Material BOM / order (item, qty, unit, stage, colour are the BOM''s and read-only on the budget); false when typed by hand (0591).';
