-- =============================================================================
-- 0427 — Multi Order: one garment order, several buyer PO numbers
-- -----------------------------------------------------------------------------
-- The client's 2026-08-17 list asks for TWO switches on the order header where
-- there is one today:
--
--   "Add a Multi Style option in order info. Add a separate Multi Order button.
--    If enabled, it should open an extra column in the quantity tab for multiple
--    PO numbers."
--
-- ## `mult_ord` IS ALREADY THE MULTI **STYLE** SWITCH — DO NOT REPURPOSE IT
--
-- 0126 named the column after the legacy screen's `Mult.Ord` label, but what it
-- has always meant on this screen is "this PO carries more than one STYLE": it
-- captions the Style(s) grid ("Multiple styles on this PO" / "One style per PO")
-- and `addStyle` sets it when a second style line is added. The label is the
-- only wrong part, so the label is the only part that changes — renaming the
-- column would rewrite a value 100% of existing rows already carry a meaning
-- for, and every reader of it (`toRows`, the diff, the Order Sheet) would have
-- to be re-verified for a rename that buys nothing.
--
-- So Multi Order is a genuinely NEW flag. `git log --all -S multi_order` finds
-- nothing in any branch: there is no earlier attempt to be compatible with.
--
-- ## WHY THE PO NUMBER MOVES TO THE QUANTITY LINE AND NOT SOMEWHERE NEW
--
-- A quantity row is already the order's per-destination line — country,
-- consignee, assortment, delivery date, quantity. When a customer raises three
-- POs against one style/season, what differs between them is exactly that set,
-- so the PO number is a property of the line and not of a fourth table. One
-- nullable column, and the header's own `po_no` keeps meaning what it always
-- has: the single PO this order answers when Multi Order is off.
--
-- NOT `not null`, and not defaulted to the header's PO No. Every row that
-- exists today was entered under a single-PO order and genuinely has no
-- per-line number; copying the header's down into them would invent a fact and
-- then make it indistinguishable from one the operator typed.
--
-- `multi_order` IS `not null default false`, which is the same shape `pack` and
-- `mult_ord` already have: a boolean with a null state is a third answer to a
-- yes/no question, and nothing on the screen could render it.
-- =============================================================================

alter table public.garment_order_amendments
  add column if not exists multi_order boolean not null default false;

comment on column public.garment_order_amendments.multi_order is
  'Several buyer PO numbers on this one order; opens the PO No column on the Quantities tab. Distinct from mult_ord, which is the MULTI STYLE switch (several style lines on one PO).';

comment on column public.garment_order_amendments.mult_ord is
  'MULTI STYLE: this PO carries more than one style line. Named after the legacy Mult.Ord label; the UI says "Multi Style". See multi_order for the several-POs switch.';

alter table public.garment_order_amendment_quantities
  add column if not exists po_no text;

comment on column public.garment_order_amendment_quantities.po_no is
  'The buyer PO this destination line belongs to. Collected only while the order''s multi_order is on; null on every single-PO order, where the header po_no answers for the whole document.';
