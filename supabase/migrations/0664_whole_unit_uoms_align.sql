-- 0664 — whole-unit UOMs: ONE list, ONE rounding (corrects 0663).
--
-- 0663 marked PCS, NOS, GROSS, BOX, PACKET, CONE whole by setting
-- `decimal_places_allowed = 0`, and its comment said such a quantity rounds
-- UP and that DZN stays measured. Both were written before finding that the
-- app ALREADY had a whole-unit rule: `WHOLE_UNIT_UOM_CODES` in
-- lib/orders/material-bom/process-loss.ts (client 2026-08-29) — GROSS, PCS,
-- NOS, NBR, DZN, CONE, ROLL, ROLLS — rounding HALF-UP, from the client's own
-- "5321.5" example. Two rules would have made a line with a process loss and
-- one without round the same Gross differently.
--
-- So there is one rule now:
--   * the declared list (plus BOX, PACK, PACKET from budgetupdate.md §6), and
--     the master's 0 as the second way to say "whole" — the two kept in step
--     by this migration for every unit in the list;
--   * one rounding, half-up (`roundForUom` / `roundRequirement`), which is
--     also what the spec literally says ("standard rounding Math.round()").
--
-- This brings DZN and NBR into the master's 0, since the list already counts
-- them. Every other reader of the column goes through `uomPrecision`, which
-- floors at 2 (lib/uom/convert.ts), so nothing outside the Material BOM moves.

update public.uoms
   set decimal_places_allowed = 0
 where upper(trim(code)) in ('GROSS', 'PCS', 'NOS', 'NBR', 'DZN', 'CONE', 'ROLL', 'ROLLS', 'BOX', 'PACK', 'PACKET')
   and decimal_places_allowed is distinct from 0;
