-- ===========================================================================
-- 0532 — `uoms` gains INCH.
--
-- The client's 2026-09-04 backend calc spec (Formula 2) names cm OR inches as
-- how a yarn-dyed stripe's physical width may be typed on the Yarn Dyed
-- Details ▸ Repeats panel. `CM` (`Centimeters`) is already a seeded row —
-- MTR too — but the master carries no inch unit at all today (catalog,
-- 2026-09-04: `select code from uoms` returns BOX/CM/CONE/DZN/GROSS/KGS/
-- LTR/MTR/NOS/PACKET/PCS/% and nothing named inch). Without this row a
-- planner who wants to type a stripe repeat in inches has no unit to pick,
-- so `lib/orders/fabric-bom/yarn-dyed.ts`'s new cm/inch conversion
-- (`LENGTH_CM_PER_UNIT`) would have a formula and no way to reach it.
--
-- A PHYSICAL CONSTANT, NOT A GUESSED VOCABULARY WORD. AGENTS.md's "Near
-- misses" section is about NAME vocabularies (categories, materials) where an
-- invented word can be wrong for the trade; a unit of length is not a name a
-- business chooses, it is the same inch every ruler in the country agrees on
-- — the same standing `CM`/`MTR`/`KGS` already have as master rows.
-- ===========================================================================

insert into public.uoms (code, name) values
  ('INCH', 'Inches')
on conflict (code) do nothing;
