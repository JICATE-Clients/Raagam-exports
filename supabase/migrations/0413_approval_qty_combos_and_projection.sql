-- ============================================================================
-- Raagam ERP — 0413 Garment Order Amendment ▸ Approval Qty ▸ combos + Projection
--
-- The legacy Approval Qty tab (client screenshot 2026-08-12, 11:15) is a
-- master-detail: each STYLE line expands into its COMBOS, and each combo row
-- carries four figures —
--
--   S No · Combo · ComboDescription · Qty · Excess Qty · Approval Qty · Total Qty
--
-- The app had the arithmetic (PO + Excess + Approval = Total, built 2026-08-10)
-- but only one row per style line. This adds the colour dimension it was missing
-- and the Projection term the client specified.
--
--
-- WHY `qty` IS STORED AND NOT DERIVED
--
-- There was nowhere to derive it from, and that is a fact about the schema, not
-- an oversight: `garment_order_amendment_combos` (0128, extended by 0397/0408)
-- carries no quantity at all, and `garment_order_amendment_quantities` (0398)
-- breaks `po_qty` down by country and consignee, not by combo. Splitting the
-- style's PO Qty evenly across its combos was considered and rejected with the
-- client (2026-08-12): a buyer orders 300 white and 200 navy far more often than
-- 250 each, so an even split would be a confident guess printed as a fact.
--
-- The legacy cell is an editable 0, which says the same thing.
--
--
-- `combo` IS TEXT, MATCHING ITS SIBLINGS
--
-- `garment_order_amendment_combos.combo` is text and this references it by
-- value, exactly as `style_ref_no` references the style line by value. The
-- reason is unchanged from 0407 and 0411: `writeChildren` deletes and reinserts
-- every child grid wholesale, so a combo row's id is a new uuid after each save
-- and an FK to it would dangle. Nothing parses either string.
--
--
-- UNIQUE PER (amendment, style, combo)
--
-- One approval line per colour per style. A second row for the same pair says
-- nothing the first did not and would double-count into Total Production —
-- which is the number the floor plans raw material against, so a silent
-- duplicate here is over-purchasing, not a cosmetic slip.
--
-- Nulls compare as distinct in Postgres, so the pre-0413 rows (which have no
-- combo) are unaffected and a row still being typed is not refused.
--
--
-- `rejection_rule_id` ON THE AMENDMENT — the Projection term
--
-- "Projection" adds a buffer for unavoidable production defects (oil stains,
-- sewing mistakes, fabric damage) so the number of GOOD pieces still meets the
-- order. The engine already exists — `rejectionFor` in lib/masters/rejection-rule.ts,
-- tiers on `garment_rejection_rule_lines`, pieces-or-percent per 0389, rounding
-- UP — and must not be reimplemented here or anywhere else.
--
-- What did not exist was a way to reach a rule FROM AN ORDER. 0389 put
-- `rejection_rule_id` on `garment_ppms` and 0390 on `sq_details`; neither is
-- reachable from a garment order amendment. Resolving it through the SQ Detail
-- was considered and rejected with the client (2026-08-12): the link is not
-- always present, and a missing link would show a blank Projection with nothing
-- on screen explaining why — the "empty report reads as a real answer" failure
-- AGENTS.md names under Cascading filters. An explicit picker on the header
-- states which rule applied and is visibly empty when none was chosen.
--
-- NULLABLE. An order with no rule chosen has no Projection, which is a
-- legitimate state and the one every existing row is in.
-- ============================================================================


alter table public.garment_order_amendment_approval_qtys
  add column if not exists combo             text,
  add column if not exists combo_description text,
  add column if not exists qty               numeric(16,3) not null default 0;

comment on column public.garment_order_amendment_approval_qtys.combo is
  'The colour/combo this approval line is for, by VALUE from garment_order_amendment_combos.combo — not an FK; see 0413.';
comment on column public.garment_order_amendment_approval_qtys.qty is
  'Ordered pieces of this combo. Typed, not derived — nothing in the schema holds a per-combo quantity (0413).';

create unique index if not exists uq_goa_approval_qty_combo
  on public.garment_order_amendment_approval_qtys(amendment_id, style_ref_no, combo);

alter table public.garment_order_amendments
  add column if not exists rejection_rule_id uuid
    references public.garment_rejection_rules(id);

comment on column public.garment_order_amendments.rejection_rule_id is
  'Which Garment Rejection Rule supplies the Approval Qty tab''s Projection buffer. NULL = no projection (0413).';

create index if not exists idx_goa_rejection_rule
  on public.garment_order_amendments(rejection_rule_id);


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- `qty` is asserted NOT NULL WITH A DEFAULT rather than merely present: it is
-- summed into Total Production, and a NULL propagating through that sum would
-- render the production target blank rather than wrong, which is the harder
-- failure to notice. The unique index is asserted by VIOLATING it.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col_null    text;
  col_default text;
  probe_amend uuid;
begin
  select is_nullable, column_default into col_null, col_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'garment_order_amendment_approval_qtys'
     and column_name  = 'qty';

  if col_null is null then
    raise exception '0413: approval_qtys.qty was not added';
  end if;
  if col_null <> 'NO' or col_default is null then
    raise exception '0413: approval_qtys.qty must be NOT NULL with a default; got nullable=% default=%',
      col_null, col_default;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'garment_order_amendments'
       and column_name = 'rejection_rule_id'
  ) then
    raise exception '0413: garment_order_amendments.rejection_rule_id was not added';
  end if;

  select id into probe_amend from public.garment_order_amendments limit 1;
  if probe_amend is null then
    raise notice '0413: no amendment to probe with - unique index assertion SKIPPED';
    return;
  end if;

  begin
    insert into public.garment_order_amendment_approval_qtys
      (amendment_id, sno, style_ref_no, combo, qty, approval_qty)
    values (probe_amend, 9001, '__0413_probe', 'WHITE', 100, 0),
           (probe_amend, 9002, '__0413_probe', 'WHITE', 200, 0);
    raise exception '0413: (amendment_id, style_ref_no, combo) admitted a duplicate combo';
  exception when unique_violation then
    null;  -- expected
  end;
  delete from public.garment_order_amendment_approval_qtys where style_ref_no = '__0413_probe';

  -- A DIFFERENT combo under the same style must be accepted — the colour
  -- breakdown is the entire point of this migration.
  insert into public.garment_order_amendment_approval_qtys
    (amendment_id, sno, style_ref_no, combo, qty, approval_qty)
  values (probe_amend, 9001, '__0413_probe', 'WHITE', 100, 0),
         (probe_amend, 9002, '__0413_probe', 'NAVY',  200, 0);
  if (select count(*) from public.garment_order_amendment_approval_qtys
       where style_ref_no = '__0413_probe') <> 2 then
    raise exception '0413: two different combos under one style were refused';
  end if;
  delete from public.garment_order_amendment_approval_qtys where style_ref_no = '__0413_probe';
end $verify$;
