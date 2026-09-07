-- 0525 — Fabric BOM ▸ Manual: the entry row's "Widths" [Click] gets a real
-- popup, with its own two size-wise fields.
--
-- Client 2026-09-03, screenshot 2681 ("Width Details" — Style No / Article No /
-- Fabric, then a "Consumption Size Details" grid: S No | Width | Width
-- Tolerance | Width | Calculated Width | Final Width | Width For Calc |
-- Finished Width | Purchase Width, one row per size).
--
-- ONLY TWO OF THE EIGHT COLUMNS ARE STORED HERE. `roll_width` and
-- `roll_width_tolerance` are the popup's own plain inputs — the same shape as
-- `length` / `length_tolerance`, and unrelated to them: those drive the piece-
-- weight formula (`table_width` × `effectiveLength` × GSM), this is a separate
-- roll/purchase-width chain legacy keeps behind its own button. "Purchase
-- Width" reuses the EXISTING `purchase_width` column — moved into this popup's
-- UI, not duplicated. The remaining five columns (the second "Width",
-- Calculated Width, Final Width, Width For Calc, Finished Width) are NOT
-- added: every value in the reference screenshot is 0.00, so there is no
-- worked example to derive their formula from, and inventing one here would
-- be exactly the mistake 0491 made reading the OTHER "Length | Length
-- Tolerance | Length" band as a length allowance — a plausible number is not
-- a confirmed one. Add them, with their formula, once a populated example
-- exists.
--
-- NOT `width_tolerance` AGAIN. That name was `order_fabric_bom_manual_sizes`'
-- own column for a few hours today (0523) before reverting to
-- `length_tolerance` (0524) — reusing it here for an unrelated field would be
-- the exact "one word for two measurements" fault this file has now fixed
-- twice.

alter table public.order_fabric_bom_manual_sizes
  add column if not exists roll_width numeric(10,2),
  add column if not exists roll_width_tolerance numeric(10,2);

comment on column public.order_fabric_bom_manual_sizes.roll_width is
  'The "Widths" [Click] popup''s own Width (0525) -- legacy''s separate "Width Details" sub-form, not table_width. Plays no part in the piece-weight formula.';

comment on column public.order_fabric_bom_manual_sizes.roll_width_tolerance is
  'The Widths popup''s own tolerance, beside roll_width (0525) -- distinct from length_tolerance, which was briefly named width_tolerance for the SAME REASON this column is deliberately not.';
