-- ============================================================================
-- Raagam ERP — 0390  SQ Detail points at a Garment Rejection Rule
--
-- 0389 gave a rule's tiers an `allowance_type`, so "+3 pieces" and "+8 percent"
-- can finally live in one rule and be told apart. This is the other half: the
-- document that has to USE it.
--
-- WHY NOT GARMENT PPM, which 0389 wired. Because it is not there. The plan for
-- this change named `garment_ppms` / `garment_ppm_quantities` (0370) — and
-- `0332_drop_planning_module` dropped the whole module, so a catalog query for
-- `%ppm%` returns nothing. 0389 guarded its PPM branch with `to_regclass` and is
-- correct in both databases; it just has no effect in this one.
--
-- The workflow the client describes — pick the SC, pull the Order Quantity,
-- choose a rule, read back the Rejection Qty and the SD Qty — is alive on SQ
-- Detail (0321), which already carries every field of it:
--
--   sq_details.order_qty      the confirmed order
--   sq_details.excess_pct/qty a second, independent buffer
--   sq_details.rejection_pct  typed by hand today
--   sq_details.rejection_qty  default 0, never written
--   sq_details.sq_qty         default 0, never written  ← this is the SD Qty
--
-- `createSqDetail` inserts exactly what the form sends, so the last three have
-- sat at 0 on every row since the table was created. The rule is what makes them
-- answerable.
--
-- ON THE HEADER, not on `sq_quantities`. The operator picks a rule once per
-- document; every style line under it is measured the same way. Per-line would
-- be a second place for the same fact to disagree with itself.
--
-- Nullable, no default, no backfill: an SQ raised before this has no rule, and
-- its hand-typed rejection_pct stays exactly as entered. Picking a rule is what
-- switches a document over — see `deriveSqQuantities` in lib/sales/sq-types.ts,
-- which leaves the manual path alone when `rejection_rule_id` is null.
-- ============================================================================

alter table public.sq_details
  add column if not exists rejection_rule_id uuid
    references public.garment_rejection_rules(id);

comment on column public.sq_details.rejection_rule_id is
  'Which Garment Rejection Rule (0264) sizes this SQ''s rejection allowance. '
  'NULL = the legacy manual path, where rejection_pct is typed by hand (0390).';

create index if not exists idx_sq_details_rejection_rule
  on public.sq_details(rejection_rule_id);
