-- ============================================================================
-- Raagam ERP — 0562 Fabric BOM ▸ the requirement's unit is the KILOGRAM
--
-- `order_fabric_bom_requirements.required_qty` has been a weight in kilograms
-- on every row written since 0494: a Manual entry states `grams` per garment
-- (`order_fabric_bom_manual_sizes.grams`, "THE FIGURE EVERYTHING DOWNSTREAM
-- MULTIPLIES") and `consumptionMap` divides by 1,000. `consumption_uom_id`,
-- though, kept being stamped from `items.base_uom_id` — the unit the CLOTH is
-- BOUGHT in — because that was the right source back when 0426's LINE carried
-- a `consumption` typed in the cloth's own unit.
--
-- ONE MISLABEL, THREE READERS, AND THE WORST OF THEM FAILED CLOSED
--
--   * `yarnPurchase` (lib/orders/fabric-bom/yarn-process.ts) refuses to add two
--     fabrics whose `uom_id` differ — correctly, since kg and metres cannot be
--     summed. On HO/RE/26-27/0007 the three fabrics feeding 10'S COMBED COTTON
--     are mastered KGS, NOS and MTR, so the yarn row stored `purchase_qty`
--     NULL and the refusal "The fabrics using this yarn are measured in
--     different units" — over three figures (214, 16.05, 10.7) that were all
--     kilograms. The Yarn & Fabric Requirement Report printed that sentence and
--     a TOTAL YARN PURCHASE REQUIREMENT of 0.
--   * `lib/orders/budget/service.ts` prices the requirement at
--     `uom_id: r.consumption_uom_id` — 16.05 "NOS" of cuff fabric.
--   * The Fabric BOM Entry Register's Unit column printed NOS beside a weight.
--
-- The writer is fixed (`requirementRows` resolves the kilogram once per save,
-- via `kilogramUom`, and refuses the save outright if the UOM master has no
-- active kg row). This relabels what is already stored.
--
-- IT IS A RELABEL AND NOT A CONVERSION — deliberately, and this is the whole
-- reason it is safe to run unattended. No `required_qty` is touched: every one
-- of them was ALREADY kilograms, computed by one formula that has no branch on
-- the unit. A migration that multiplied anything here would be inventing a
-- conversion between units that never differed.
--
-- SCOPED TO ENTRY-BASED ROWS. `chk_ofbr_one_parent` (0494) says exactly one of
-- `line_id` / `entry_id` is set, and only the `entry_id` branch goes through
-- `consumptionMap`'s grams/1000. Nothing in this app writes a `line_id`
-- requirement today, but 0494 kept that shape on purpose ("dropping the column
-- would throw away 0426's whole shape for a change the client could reverse"),
-- and a line-based row's unit would genuinely come off its line. So the WHERE
-- clause is the guard, not an optimisation.
--
-- THE YARN ROWS ARE NOT PATCHED HERE. `order_fabric_bom_yarns.purchase_qty` is
-- NULL wherever this refusal fired, and the figure that replaces it is the
-- backward-markup walk over the fabric's declared route — arithmetic, not a
-- column copy. Recomputing it in SQL would be a second implementation of
-- `yarnPurchase`, which is the one thing that file's header forbids. The report
-- already tells the operator what to do ("open Yarn Process and save, so the
-- figures this report prints are the ones that were approved"), and the next
-- save of each affected BOM writes them through the fixed path.
-- ============================================================================

do $$
declare
  kg_id uuid;
  moved integer;
begin
  -- The same match `kilogramUom` (lib/uom/kilogram.ts) makes: by CODE, active
  -- rows only. The live master holds CONE, DZN, GROSS, KGS, LTR, MTR, NOS, PCS
  -- and an INACTIVE `kg`, so an unqualified `like 'KG%'` would find the wrong
  -- one half the time.
  select id into kg_id
    from public.uoms
   where is_active
     and upper(btrim(code)) in ('KG', 'KGS', 'KILOGRAM', 'KILOGRAMS')
   order by upper(btrim(code))
   limit 1;

  if kg_id is null then
    -- NOT AN EXCEPTION. A database with no kilogram row has no correct value to
    -- write, and failing the migration would block every later one for a data
    -- fix an operator can make on the UOM master in a minute. The app-side
    -- guard refuses the SAVE by name in the same state, which is where an
    -- operator can actually see it.
    raise notice '0562: no active kilogram UOM — requirement rows left unrelabelled';
    return;
  end if;

  update public.order_fabric_bom_requirements
     set consumption_uom_id = kg_id
   where entry_id is not null
     and consumption_uom_id is distinct from kg_id;

  get diagnostics moved = row_count;
  raise notice '0562: relabelled % requirement row(s) to kilograms', moved;
end
$$;

comment on column public.order_fabric_bom_requirements.consumption_uom_id is
  'The unit required_qty is in. For an entry-based row (the only kind this app '
  'writes) that is ALWAYS the kilogram: a Manual entry states grams per garment '
  'and the engine divides by 1,000. Stamped by requirementRows from '
  'kilogramUom(), never from items.base_uom_id — that is the unit the cloth is '
  'BOUGHT in, and stamping it here made three fabrics of one yarn look '
  'unsummable (0562).';
