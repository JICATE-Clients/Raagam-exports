-- ============================================================================
-- Raagam ERP — 0554 PP Approval Trigger Mode (Dual PP Approval production rule)
--
-- doc/ui/order/taupdate.md §2-3 asks for a second, DISTINCT gate alongside the
-- existing Cutting Room Safety Lock (0552's `production_based_pp_approval`
-- boolean, enforced in `startTaActivity`, lib/ta/worklist-actions.ts): a
-- "Yarn Purchase Based" mode where BULK YARN PURCHASE is what waits on PP
-- Sample approval, not cutting — for a 90-120 day order where buying bulk
-- yarn upfront eats a supplier's 30-60 day credit window before the sample
-- is even approved.
--
-- This is an ADDITIVE mode column, deliberately NOT a rework of the existing
-- boolean: `production_based_pp_approval` keeps meaning exactly what it means
-- today (does this order enforce a hard PP gate at all — the Cutting lock is
-- untouched by this migration), and `pp_approval_trigger_mode` only matters
-- WHEN that boolean is true. CUTTING_BASED (the default) is the status quo
-- for every existing order — nothing about the Cutting Room Safety Lock
-- changes on the day this ships. YARN_PURCHASE_BASED adds a NEW gate, in
-- lib/purchase/pp-approval-gate.ts, that blocks a Bulk Yarn PO line (item
-- class = YARN) tied to this order's sales_order_id until the same PPSAMPLE
-- tracker this order already uses is Approved — it does not touch cutting.
-- ============================================================================

alter table public.garment_order_amendments
  add column if not exists pp_approval_trigger_mode text not null default 'CUTTING_BASED';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_pp_approval_trigger_mode'
  ) then
    alter table public.garment_order_amendments
      add constraint chk_pp_approval_trigger_mode
      check (pp_approval_trigger_mode in ('CUTTING_BASED', 'YARN_PURCHASE_BASED'));
  end if;
end $$;

comment on column public.garment_order_amendments.pp_approval_trigger_mode is
  'Which physical step this order''s PP Sample approval gates, consulted only '
  'while production_based_pp_approval = true. CUTTING_BASED (default): the '
  'existing Cutting Room Safety Lock applies unchanged (startTaActivity). '
  'YARN_PURCHASE_BASED: cutting is not gated by this column at all — instead '
  'lib/purchase/pp-approval-gate.ts refuses a Bulk Yarn PO line against this '
  'order''s sales_order_id until PP Sample is Approved. '
  'doc/ui/order/taupdate.md §2-3.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'garment_order_amendments'
      and column_name = 'pp_approval_trigger_mode'
  ) then
    raise exception '0554: pp_approval_trigger_mode was not added';
  end if;
end $$;
