-- ============================================================================
-- Raagam ERP — 0552 Production-Based PP Approval toggle
--
-- doc/ui/order/ta two approval.md §3 asks for a per-order boolean that
-- governs whether a declared PP Sample approval acts as a strict Cutting
-- Room hardlock (YES, the default) or is decoupled from cutting and material
-- procurement (NO, fast-track). The hardlock itself already exists — the
-- "Cutting Room Safety Lock" (doc/approval.md §5.2), enforced server-side in
-- `startTaActivity` (lib/ta/worklist-actions.ts) and mirrored for display in
-- lib/ta/worklist.ts — it has simply never had an off switch: today it fires
-- unconditionally whenever the order declares a PP_SAMPLE approval tracker.
--
-- DEFAULT TRUE, deliberately, so this migration changes no order's observed
-- behaviour on the day it ships: every existing and in-flight order keeps
-- exactly the strict gate it has today, and an operator opts OUT per order
-- from the T&A tab, beside the Approvals panel this setting gates.
-- ============================================================================

alter table public.garment_order_amendments
  add column if not exists production_based_pp_approval boolean not null default true;

comment on column public.garment_order_amendments.production_based_pp_approval is
  'YES (default): the Cutting Room Safety Lock applies — the CUTTING T&A row '
  'refuses to start while this order''s declared PP Sample approval is not '
  'yet approved (doc/approval.md §5.2, enforced in startTaActivity). NO: '
  'cutting and material procurement proceed on the ordinary backward '
  'schedule regardless of PP Sample status. doc/ui/order/ta two approval.md §3.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'garment_order_amendments'
      and column_name = 'production_based_pp_approval'
  ) then
    raise exception '0552: production_based_pp_approval was not added';
  end if;
end $$;
