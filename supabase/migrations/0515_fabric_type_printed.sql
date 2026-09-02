-- Fabric Type gains PRINTED (client 2026-09-02: "Fabric Type - solid, yarn
-- dyed, printed, melange", screenshot 2643).
--
-- `config_lookups` kind `fabric_type` has held three values since 0279 — Solid,
-- Yarn Dyed, Melange — and it is what `items.fabric_type_id` points at: the
-- Material master's Fabric Type, shown on Fabric BOM ▸ Fabric Lines as the read-
-- only `Type` column and on ▸ Components as the Fabric picker's narrowing cell.
--
--
-- ## THIS IS NOT THE `printed` THAT 0478 REMOVED, AND THE DISTINCTION IS THE
-- ## WHOLE REASON THIS FILE CARRIES A COMMENT
--
-- On 2026-08-31 the client had `printed` removed from `item_sub_type` — the
-- ORDER's own word on a combo structure — and 0478 dropped it from both
-- amendment CHECKs. `combo-rules.ts` records that removal at length, including
-- why deleting one option was not a one-line change (`takesAllOverPrint`
-- answered `itemSubType === "printed"` and could never return true again).
--
-- Two different columns, on two different tables, answering two different
-- questions:
--
--   garment_order_amendment_combo_structures.item_sub_type
--       what the ORDER says this structure is, per colourway. Solid | Melange |
--       Yarn Dyed. `printed` removed 08-31 and STAYS removed — nothing here
--       re-adds it, and `itemSubTypeOrNull` still narrows the word away.
--
--   items.fabric_type_id  →  config_lookups(kind = 'fabric_type')
--       what the fabric MASTER says a cloth is. This one, which the client has
--       now named as a list of four.
--
-- A reader who finds the 08-31 removal quoted and concludes this migration
-- undoes it is holding two facts that only share a word.
--
--
-- ## SAFE FOR THE YARN-DYED GATE, BY THAT GATE'S OWN STATED DESIGN
--
-- `isYarnDyed` (lib/orders/fabric-bom/fabric-line-rules.ts) decides whether
-- Mixing UOM and No Of Colors are live and whether [Detail] opens. It is a test
-- for ONE name rather than a list of the others, and its header says why: "a
-- type this function has never heard of reads as NOT yarn dyed, which hides the
-- mixing cells rather than demanding them. That is the safe direction — the
-- alternative makes a new master row block Save on a screen with nothing to say
-- why." A Printed fabric is dyed as a whole roll, so that is also the correct
-- answer and not merely the safe one.
--
-- CODE `printed`, matching the slug style of the other three, and the same word
-- `styles.fabric_subtype` used before 0478 — so a legacy import mapping onto
-- this kind lands on the right row rather than creating a fourth spelling.
insert into public.config_lookups (kind, code, name, is_active)
select 'fabric_type', v.code, v.name, true
from (values
  ('printed', 'Printed')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups where kind = 'fabric_type' and code = v.code
);
