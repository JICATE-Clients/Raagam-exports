-- 0526 — Fabric BOM ▸ Manual ▸ Widths popup: only TWO fields, not eight.
--
-- Operator correction, 2026-09-03, minutes after 0525: "in width tab in
-- legacy finesh width and purchased width two field only but our
-- application did wrong screen update it again". 0525 built `roll_width` /
-- `roll_width_tolerance` as the popup's real editable pair (reading the
-- first two columns of legacy's 8-column band as the answer) and left
-- "Finished Width" as an unconfirmed dash. Both readings were wrong: the
-- two REAL fields on this popup are "Finished Width" and "Purchase Width" —
-- the operator's own words, not a screenshot re-reading.
--
-- `roll_width` / `roll_width_tolerance` are DROPPED rather than left unused:
-- they were this morning's mistake, not a second, still-possibly-right
-- reading kept for later — and the table still holds 0 rows (catalog,
-- 2026-09-03), so nothing is lost. `finished_width` is added in their place.
-- `purchase_width` is untouched — it already existed and already meant this.

alter table public.order_fabric_bom_manual_sizes
  drop column if exists roll_width,
  drop column if exists roll_width_tolerance;

alter table public.order_fabric_bom_manual_sizes
  add column if not exists finished_width numeric(10,2);

comment on column public.order_fabric_bom_manual_sizes.finished_width is
  'The "Widths" [Click] popup''s Finished Width (0526) -- one of the popup''s only two real fields, beside the existing purchase_width. Replaces 0525''s roll_width/roll_width_tolerance, which were the wrong reading.';
