-- ============================================================================
-- Raagam ERP — 0612 A purchase step is never a process charge (client
-- 2026-09-21, the Budget recordings: "Fabric Purchase was incorrectly
-- appearing inside the Process Rates section as well as the Purchase Rates
-- section … double-counting the fabric cost").
--
-- THE RULE: Purchase Rates holds raw material — Yarn, Fabric, Trims. Process
-- Rates holds job work — Knitting, Dyeing, Compacting, Stentering, Washing,
-- Printing. A route's opening purchase step is the FIRST, never the second.
--
-- THE FABRIC SIDE ALREADY HAD THE FLAG. `processes.is_cloth_purchase` (0583)
-- marks FABRIC PURCHASE and DYED FABRIC PURCHASE, and the Budget's pull now
-- skips a stage-ledger section whose process carries it (code change in this
-- same commit: lib/orders/budget/service.ts, lib/orders/iwo-budget/pull.ts).
--
-- THE YARN SIDE DID NOT. 0611 seeds YARN PURCHASE as the base of the GREIGE
-- yarn stage, so a yarn route opens with it and the step carries the purchase
-- weight — which the `yarn` purchase line already is. Unflagged, the pull would
-- make a "YARN PURCHASE · GREIGE" process line beside it: the fabric bug wearing
-- yarn. Read off the flag, never the name — "Process kind flags not derivable"
-- (0571): a name is the operator's to change, a flag is the system's.
--
-- WHY THE SAME COLUMN. The flag's meaning is "a step that BUYS the material
-- rather than making it"; "cloth" in its name is 0583's vantage point, not a
-- limit. Its readers are all fabric-route code (`stage-routes.ts`,
-- `fabric-source.ts`, `fabric-ta/service.ts`) that look up FABRIC processes
-- by id, and YARN PURCHASE is `for_yarn` only, so flagging it reaches none of
-- them. A second column (`is_yarn_purchase`) would be one fact under two names
-- for the Budget to OR together, and the one it forgot would be the next
-- double count.
--
-- Idempotent, and a no-op where 0611 has not yet run (the row is absent).
-- VERIFY FROM THE CATALOG:
--   select name, for_yarn, for_fabric, is_cloth_purchase from public.processes
--    where is_cloth_purchase;     -- YARN PURCHASE listed beside the two cloths
-- ============================================================================

update public.processes
   set is_cloth_purchase = true
 where upper(trim(name)) = 'YARN PURCHASE'
   and for_yarn
   and not is_cloth_purchase;

comment on column public.processes.is_cloth_purchase is
  'A step that BUYS the material rather than making it (0583 · 0612): FABRIC PURCHASE / DYED FABRIC PURCHASE open a bought cloth''s route (greige_purchase in the Greige stage, dyed_purchase in a coloured one); YARN PURCHASE opens a yarn''s. The Budget never charges such a step as a process — the purchase is its own line. Set by migration only.';
