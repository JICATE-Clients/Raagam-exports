-- 0712 — Sample ▸ Grouping: an SWO's Description (user 2026-10-12).
--
-- The planner names the batch in their own words. NULL means "not given",
-- and the screen then shows the SWO number in the box: the default is a
-- DISPLAY fallback, never written back, so a later renumber can't leave a
-- stale copy of the old code sitting in this column.
alter table public.sample_product_groups
  add column if not exists description text;

comment on column public.sample_product_groups.description is
  'Free description of the SWO; NULL = show the SWO number (0712).';
