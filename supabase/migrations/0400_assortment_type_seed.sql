-- ============================================================================
-- Raagam ERP — 0400 Seed the four packing methods into `assortment_type`
--
-- 0398 created the `assortment_type` kind for Quantities ▸ Assortment Type and
-- seeded it EMPTY, on the principle it stated: "the real vocabulary is the
-- client's and a made-up list is how the near-miss feature had to be rolled
-- back once already."
--
-- That principle is right and this is not the case it guards against. The four
-- methods below are the CLIENT'S OWN list, dictated on 2026-08-10 and recorded
-- as `PACK_TYPE_OPTIONS` in lib/orders/amendments/types.ts. 0398's own header
-- says the legacy Quantities screen shows "Solid Color - Solid…" in this very
-- column — so the list was never unknown, only unseeded.
--
-- The problem it fixes is concrete (2026-08-11): 0399 built the Pack type(s)
-- tab over those four, and Quantities asked the same question one tab later
-- from an EMPTY dropdown. The operator declared the methods, then re-typed them
-- by hand into a master, which is how a two-row vocabulary and a four-row one
-- start disagreeing about the wording — and the wording is what the Packing
-- List prints.
--
--
-- THE NAMES ARE `PACK_TYPE_OPTIONS`, VERBATIM
--
-- Character for character, British spelling included, so the two tabs read
-- identically. That tie is by WORDING and is NOT enforced by anything: this
-- kind is operator-maintained through the picker's inline Add/Modify, exactly
-- as intended, so a rename here does not reach the tuple and vice versa. If the
-- client re-words a method, both sides move — the tuple in types.ts and the row
-- here. Nothing breaks if they drift; the two tabs just stop reading alike,
-- which is the whole thing this migration is buying.
--
-- Deliberately NOT capitalised. AGENTS.md's "CAPITALS" rule is about values an
-- operator TYPES (`<Input uppercase>` + the Zod transform); a seeded lookup name
-- is neither, and the sibling seeds agree — 0241 'Ex Works', 0279 'Circular
-- Knit'. Upper-casing these would break the verbatim match for nothing.
--
--
-- ADDITIVE, AND STILL OPEN-ENDED
--
-- This does not close the list: `assortment_type` remains a `config_lookups`
-- kind the operator can add to, which is the reason 0398 chose a lookup for
-- Quantities and 0399 chose a fixed tuple for Pack type(s). Whether those two
-- should become ONE store is still open and is deliberately untouched here —
-- no column is re-pointed, no constraint added. This seeds rows and nothing
-- else.
-- ============================================================================


-- Matched on CODE, not on name, so a re-run after an operator has re-worded a
-- method inserts nothing rather than a near-duplicate beside it. The codes are
-- stable identifiers and are never shown; the name is what the picker renders.
insert into public.config_lookups (kind, code, name, is_active)
select 'assortment_type', v.code, v.name, true
from (values
  ('solid_solid',   'Solid Colour / Solid Size'),
  ('solid_assort',  'Solid Colour / Assort Size'),
  ('assort_solid',  'Assort Colour / Solid Size'),
  ('assort_assort', 'Assort Colour / Assort Size')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups
   where kind = 'assortment_type' and code = v.code
);


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — the
-- `where not exists` guard makes a no-op indistinguishable from success, and a
-- no-op is exactly what a wrong `kind` string would produce here.
--
-- The name check is BY EXACT STRING, because "the four rows exist" is not the
-- claim being made — the claim is that they read the same as the Pack type(s)
-- tab, and a row seeded as "Solid Color / Solid Size" would satisfy a count.
-- ----------------------------------------------------------------------------

do $verify$
declare
  n int;
begin
  select count(*) into n
    from public.config_lookups
   where kind = 'assortment_type'
     and name in (
       'Solid Colour / Solid Size',
       'Solid Colour / Assort Size',
       'Assort Colour / Solid Size',
       'Assort Colour / Assort Size'
     );
  if n <> 4 then
    raise exception
      '0400: expected the 4 PACK_TYPE_OPTIONS names under assortment_type, found %', n;
  end if;
end $verify$;
