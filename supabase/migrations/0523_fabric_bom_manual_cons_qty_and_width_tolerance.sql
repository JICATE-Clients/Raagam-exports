-- 0523 — Fabric BOM ▸ Manual: Cons Qty becomes a FIELD, and the tolerance moves
-- off the length and onto the width.
--
-- Client 2026-09-03, two written specs for this tab. Three separate corrections,
-- and the first two are defects rather than additions.
--
-- ## 1. THE TOLERANCE APPLIES TO THE WIDTH, NOT THE LENGTH
--
--     "Width (cm): the physical width of the pattern block.
--      Tolerance (cm): extra safety margin added to the width (e.g. 2 cm).
--      Calculated Width (cm) = Width + Tolerance
--      Piece Weight (g) = Calculated Width x Length x GSM / 10,000"
--
-- 0491 read legacy's column band — `Length | Length Tolerance | Length` — and
-- added the allowance to the LENGTH. Both readings produce a plausible weight
-- and the wrong one, and the error is proportional: a 2 cm allowance on a 70 cm
-- length is +2.9%, on a 52 cm width it is +3.8%, and every purchase weight on
-- the tab carries the difference. The column is renamed rather than
-- re-interpreted, because `length_tolerance` holding a width allowance is
-- exactly the "one word for two measurements" fault 0495 renamed `width` to
-- `table_width` to fix.
--
-- ## 2. Cons Qty IS TYPED, AND WAS NOT STORED AT ALL
--
--     "Cons Qty: the physical length or unit quantity of fabric consumed per
--      single garment piece (e.g. 1.25 metres per t-shirt). The field is fully
--      editable and acts as a manual override — the merchandiser types the value
--      the CAD team provides."
--
--     "Net Weight = Order Quantity x Cons Qty x Cons Wt"
--
-- The screen had a `Cons Qty` column and it was DERIVED — it printed
-- `netKg(orderQty, grams)`, a weight in kilograms, under a heading that means a
-- quantity per garment. So the multiplier the client's own formula names had
-- nowhere to be entered and nowhere to be stored, and the column that appeared
-- to hold it held something else. This adds the field.
--
-- NULLABLE, AND NULL MEANS ONE. A blank is the ordinary case — one panel set per
-- garment — and defaulting the COLUMN to 1 would make a row the planner never
-- touched indistinguishable from one they deliberately set to 1. The arithmetic
-- reads null as 1 in a single place (`consQtyOf` in ./manual.ts), so nothing
-- downstream has to know.
--
-- ## 3. "SIZE WISE" IS A PROPERTY OF THE ENTRY
--
--     "If the Size Wise toggle is unchecked, the system applies a single, flat
--      consumption quantity across all sizes. If checked, the grid expands to
--      display size-specific rows."
--
-- DEFAULT TRUE, which is what the tab already does — every size gets its own
-- row. Unchecked is the convenience: one row typed once and applied to every
-- size. It stores nothing differently (the screen writes the same figure to each
-- size row), so it is a UI state and not a second shape for the data — which is
-- why it is a boolean here rather than a nullable `size_id` on the size table.
--
-- ## NOTHING TO BACK-FILL, MEASURED RATHER THAN ASSUMED
--
-- `order_fabric_bom_manual_sizes` held 0 rows immediately before this migration,
-- and no view and no function in `public` references `length_tolerance`
-- (catalog, 2026-09-03). A rename is therefore free; with rows in it this would
-- have had to be an add-copy-drop.

alter table public.order_fabric_bom_manual_sizes
  rename column length_tolerance to width_tolerance;

alter table public.order_fabric_bom_manual_sizes
  -- "Cons Qty" — units of cloth per garment. NULL means 1; see the header.
  add column if not exists cons_qty numeric(12,4)
    check (cons_qty is null or cons_qty > 0);

alter table public.order_fabric_bom_manual_entries
  add column if not exists size_wise boolean not null default true;

comment on column public.order_fabric_bom_manual_sizes.width_tolerance is
  'The cutting allowance ADDED TO THE WIDTH (0523). Calculated Width = table_width + this, and the piece weight multiplies that. It was named length_tolerance and applied to the length until 2026-09-03, which is a defect and not a preference: the client spec states "extra safety margin added to the width".';

comment on column public.order_fabric_bom_manual_sizes.cons_qty is
  'Cons Qty (0523) — units of cloth consumed per garment piece, typed by the merchandiser from the CAD report. NULL MEANS 1: a blank is the ordinary case, and a column default of 1 would make an untouched row indistinguishable from a deliberate 1. Net Weight = order qty x this x the piece weight.';

comment on column public.order_fabric_bom_manual_entries.size_wise is
  'Legacy''s "Size Wise" toggle (0523). TRUE — the default and the existing behaviour — gives every size its own row. FALSE lets the planner type one figure that is written to every size, so it changes what the SCREEN asks for and never what is stored.';
