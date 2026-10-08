-- 0695 · Sample Costing: "+ Add" charge rows on Overheads and Price & quote (2026-10-08).
--
-- Each row is { section: 'overhead' | 'price', name, kind: 'flat' | 'pct', value,
-- sign: 'add' | 'deduct' }. FLAT is ₹ per piece, PCT is % of the piece's net cost;
-- an Overheads row is a cost (joins the gross cost), a Price row is a surcharge or a
-- deduction on the selling price. The arithmetic lives in lib/sales/sample-costing/calc.ts.
--
-- Stored as ONE jsonb column on the sheet rather than a child table: the rows have no
-- identity beyond the sheet, are always read and rewritten whole, and nothing reports on
-- them individually. ADDITIVE; every existing sheet reads as '[]'.
--
-- save_sample_costing is deliberately NOT re-created: the server action writes this column
-- right after the RPC, so this change does not depend on (or collide with) whichever
-- migration last re-created that function.

alter table public.cost_sheets
  add column if not exists extra_charges jsonb not null default '[]'::jsonb;

comment on column public.cost_sheets.extra_charges is
  'Sample Costing "+ Add" rows of Overheads / Price & quote: [{section, name, kind, value, sign}].';
