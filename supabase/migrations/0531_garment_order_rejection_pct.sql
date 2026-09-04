-- ===========================================================================
-- 0531 — Garment Order Info: a flat `rejection_pct`, alongside the existing
-- tiered Rejection Rule, not replacing it.
--
-- ## WHY A SECOND REJECTION FIELD
--
-- The client's 2026-09-04 backend calculation spec (Formula 5) names a flat
-- percentage — "Total Production Target Piece Count = Total Ordered Pieces x
-- (1 + Rejection% / 100)", defaulting to 0 — inflating a BOM's target piece
-- count. That is NOT `rejection_rule_id` (0413): the rule is a required
-- TIERED master (flat pieces or percent PER BRACKET, `rejectionFor` in
-- `lib/masters/rejection-rule.ts`), it REFUSES a line when no tier covers the
-- order's quantity rather than defaulting to 0, and today it feeds Fabric BOM
-- only — Material BOM excludes rejection entirely by a separate, explicit
-- 2026-08-21 client decision (`lib/orders/material-bom/requirement.ts`,
-- `MATERIAL_BASE_QUANTITY`).
--
-- The exact arithmetic the spec describes already exists verbatim, but on a
-- different document: `sq_details.rejection_pct` (0390), read by
-- `deriveSqQuantities()` in `lib/sales/sq-types.ts` — `Math.ceil(order *
-- rejection_pct / 100)`, default 0. That field belongs to the Sales Quote,
-- not the Garment Order, and SQ is never wired into either BOM.
--
-- ## THIS DOES NOT TOUCH THE TIERED RULE
--
-- `rejection_rule_id` and Fabric BOM's requirement math built on it
-- (`fabricSlices -> productionSlices("full_target") -> fullTarget ->
-- productionTarget -> projectionQty -> rejectionFor`) are UNCHANGED by this
-- migration. Rewiring Fabric BOM to also apply this flat percentage would
-- double-count rejection on every fabric line — the tiered rule already
-- answers "how many extra pieces", and a second additive term on top of an
-- already-inflated target is not a second opinion, it is a second helping.
-- This column exists to give MATERIAL BOM — which has none today — the
-- rejection term the spec asks for, without touching a mechanism that is
-- already required, tested, and doing this job on Fabric BOM.
--
-- ## DEFAULT 0, NOT NULLABLE
--
-- `sq_details.rejection_pct` sets the precedent (0390): a rejection
-- percentage of zero and "the planner has not considered rejection yet" are
-- the same operational state here — unlike `rejection_rule_id`, whose NULL is
-- itself meaningful ("no projection"), a blank flat percentage contributes
-- nothing to the target either way, so there is no distinct state worth a
-- NULL for.
-- ===========================================================================

alter table public.garment_order_amendments
  add column if not exists rejection_pct numeric(6,2) not null default 0
    check (rejection_pct >= 0);

comment on column public.garment_order_amendments.rejection_pct is
  'Flat rejection allowance, percent of ordered pieces (0531, client backend spec Formula 5) — Material BOM''s target = qty + ceil(qty * this/100). Separate from rejection_rule_id''s tiered Projection buffer: that one stays Fabric-BOM-only and is untouched by this column, so the two never double-count on the same document. Default 0 = no rejection considered, same reading 0390 gives sq_details.rejection_pct.';

do $$
declare
  col_null text;
  col_default text;
begin
  select is_nullable, column_default into col_null, col_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'garment_order_amendments'
     and column_name = 'rejection_pct';

  if col_null is null then
    raise exception '0531: garment_order_amendments.rejection_pct was not added';
  end if;
  if col_null <> 'NO' or col_default is null or col_default not like '%0%' then
    raise exception '0531: rejection_pct must be NOT NULL with a default of 0; got nullable=% default=%',
      col_null, col_default;
  end if;
end $$;
