-- ============================================================================
-- Raagam ERP — 0679 Work Flow: Pattern Sent / Pattern Approval REMOVED
-- ============================================================================
-- User 2026-10-01, Order Entry ▸ T&A: "remove this — Pattern Sent,
-- Pattern Approval — two approvals from the T&A tab".
--
-- 0628 added the two rows; 0642 re-pointed them at pattern-maker ASSIGN and
-- pattern READY. Both are withdrawn. The Work Flow is six milestones again,
-- renumbered so SN reads 1–6 with no gap:
--
--   ORDER_ENTRY 1 · CAD_COMPLETION 2 · MATERIAL_BOM 3 · FABRIC_BOM 4 ·
--   BUDGETING 5 · BUDGET_APPROVAL 6
--
-- Mirrored by WORK_FLOW_MILESTONES (lib/orders/work-flow/types.ts); asserted
-- equal by `npm run check:work-flow`, which parses THIS file now.
--
-- WHAT IS LOST, AND WHY IT IS RECOVERABLE. 14 stored rows (7 orders × 2;
-- 7 done, 3 in progress, 4 pending on 2026-10-01). Every one was DERIVED —
-- stamped by `cad_work_flow_sync` from `order_cad_allocations` (assignment
-- date, Ready date) and never typed. The CAD data itself is untouched, so
-- restoring the milestones is: re-add the two codes here and to the
-- constraint, restore 0642's `cad_work_flow_sync` body, and run it per order.
--
-- `cad_work_flow_sync` IS KEPT AS A NO-OP rather than dropped: the CAD
-- allocation triggers (0628 · 0638 · 0642) call it, and dropping it would make
-- every pattern-maker assignment fail. CAD itself — allocations, Ready, the
-- CAD Completion milestone (`CAD sheet submitted`, 0607) — is unaffected.
-- ============================================================================

-- 1. Nothing stamps the two rows any more.
create or replace function public.cad_work_flow_sync(p_order uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- 0679: Pattern Sent / Pattern Approval are no longer Work Flow milestones.
  -- Kept so the CAD allocation triggers that call it keep working.
  return;
end $$;
revoke all on function public.cad_work_flow_sync(uuid) from public, anon, authenticated;

-- 2. The seed every order's rows are created from.
create or replace function public.work_flow_milestone_defaults()
returns table (code text, sn int, days int)
language sql immutable
set search_path = ''
as $$
  values
    ('ORDER_ENTRY',      1, 1),
    ('CAD_COMPLETION',   2, 2),
    ('MATERIAL_BOM',     3, 3),
    ('FABRIC_BOM',       4, 3),
    ('BUDGETING',        5, 4),
    ('BUDGET_APPROVAL',  6, 4)
$$;
revoke all on function public.work_flow_milestone_defaults() from public, anon, authenticated;

-- 3. The stored rows: drop the two, close the SN gap, tighten the checks.
alter table public.order_work_flow_milestones
  drop constraint if exists order_work_flow_milestones_code_check,
  drop constraint if exists order_work_flow_milestones_sn_check;

delete from public.order_work_flow_milestones
 where code in ('PATTERN_SENT', 'PATTERN_APPROVAL');

update public.order_work_flow_milestones set sn = case code
    when 'ORDER_ENTRY'     then 1
    when 'CAD_COMPLETION'  then 2
    when 'MATERIAL_BOM'    then 3
    when 'FABRIC_BOM'      then 4
    when 'BUDGETING'       then 5
    when 'BUDGET_APPROVAL' then 6
    else sn end;

alter table public.order_work_flow_milestones
  add constraint order_work_flow_milestones_code_check check (code in (
    'ORDER_ENTRY','CAD_COMPLETION','MATERIAL_BOM',
    'FABRIC_BOM','BUDGETING','BUDGET_APPROVAL')),
  add constraint order_work_flow_milestones_sn_check check (sn between 1 and 6);
