-- 0441 — A MATERIAL BOM LINE CAN NAME THE GARMENT SIZE IT IS FOR
--
-- Client, 2026-08-20, pointing at the Prices tab (screenshots 2427 · 2428): the
-- Attribute should explode the line the way Price Type explodes a price. On
-- Size-wise, Prices lists Size | Price — one ROW per size of the order. On
-- Color-wise Size-wise it lists Colour | Size | Price.
--
-- `price_details` does that with two columns beside the rate: `combo` (the
-- colourway, text) and `size_id` (the size, a lookup). A BOM line already has
-- the first — `item_color_id`, wired on 2026-08-20 to the order's own declared
-- colours for exactly this reason. It has no second.
--
-- `size` IS NOT THAT COLUMN AND MUST NOT BE REUSED. It is the MATERIAL's size —
-- "50MM X 20MM", "12 INCH", "24 LIGNE" — and the screen says so where it is
-- declared: "NOT the garment size: a Size-wise line already explodes along that
-- axis, and putting both meanings on one field is how the two collide." A button
-- is 24 ligne on every garment size it is sewn to, so the two are independent
-- and a line genuinely needs both.
--
-- NULLABLE, AND NULL IS A REAL STATE — "every size", which is what an
-- order-wise, style-wise or colour-wise line means. Only the two bases with a
-- size axis fill it, and a line that predates this migration keeps the meaning
-- it already had.
--
-- A LOOKUP FK, NOT TEXT, and that is the difference from `size`. A garment size
-- is a row of `config_lookups` kind='size' that the order's Quantities and
-- Approval Qty tabs already key on; matching a BOM line to a production slice
-- on a typed string would break the first time somebody wrote "XL " or "X-L".
-- The material's size stays text because it is a free measurement with no master.

alter table public.material_bom_amendment_items
  add column if not exists garment_size_id uuid references public.config_lookups(id);

create index if not exists material_bom_amendment_items_garment_size_idx
  on public.material_bom_amendment_items (garment_size_id);

comment on column public.material_bom_amendment_items.garment_size_id is
  'The GARMENT size this line is for — config_lookups kind=size, the same rows '
  'Quantities and Approval Qty key on. NULL means every size. Distinct from '
  '"size", which is the MATERIAL''s own measurement (24 LIGNE) and is text '
  '(0441).';

-- VERIFY FROM THE CATALOG, never by reading this file back:
--
--   select column_name, data_type from information_schema.columns
--    where table_name = 'material_bom_amendment_items'
--      and column_name in ('size', 'garment_size_id');
--   -- expect: size = text (the material's), garment_size_id = uuid (the garment's)
