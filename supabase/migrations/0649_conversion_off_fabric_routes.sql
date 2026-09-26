-- ============================================================================
-- Raagam ERP — 0649 CONVERSION leaves every saved fabric route (user
-- 2026-09-26, screenshot 3112: "fabric process no more conversion process,
-- remove it"; client spec "Exclude CONVERSION Process from Fabric Process Tab").
--
-- CONVERSION unravels loose fabric into yarn, so it is a Yarn Process step
-- only. The app stopped OFFERING it on Fabric Process the same day, but a
-- route saved before still HELD one (the "Disabled rows" rule keeps a held
-- value), so it stayed on screen. This deletes those steps.
--
-- NOTHING IS LOST: a loss typed on the route step moves onto the yarn's own
-- CONVERSION step when that step has none — the loss the calculation now reads
-- first (`planConversions` · `conversionStepLossesOf`). On 2026-09-26 the one
-- such step in the database carried no loss.
-- ============================================================================

update public.order_fabric_bom_yarn_stages ys
   set loss_pct = fp.loss_pct
  from public.order_fabric_bom_yarns y,
       public.processes py,
       public.order_fabric_bom_processes fp,
       public.processes pf
 where y.id = ys.yarn_id
   and py.id = ys.process_id and py.is_unravelling
   and fp.bom_id = y.bom_id
   and fp.item_id = ys.source_loose_fabric_id
   and pf.id = fp.process_id and pf.is_unravelling
   and ys.loss_pct is null
   and fp.loss_pct is not null;

update public.iwo_fabric_bom_yarn_stages ys
   set loss_pct = fp.loss_pct
  from public.iwo_fabric_bom_yarns y,
       public.processes py,
       public.iwo_fabric_bom_processes fp,
       public.processes pf
 where y.id = ys.yarn_id
   and py.id = ys.process_id and py.is_unravelling
   and fp.bom_id = y.bom_id
   and fp.item_id = ys.source_loose_fabric_id
   and pf.id = fp.process_id and pf.is_unravelling
   and ys.loss_pct is null
   and fp.loss_pct is not null;

delete from public.order_fabric_bom_processes fp
 using public.processes p
 where p.id = fp.process_id and p.is_unravelling;

delete from public.iwo_fabric_bom_processes fp
 using public.processes p
 where p.id = fp.process_id and p.is_unravelling;

-- VERIFY (run by hand)
--   select count(*) from public.order_fabric_bom_processes fp join public.processes p on p.id = fp.process_id where p.is_unravelling;  -- 0
--   select count(*) from public.iwo_fabric_bom_processes   fp join public.processes p on p.id = fp.process_id where p.is_unravelling;  -- 0
