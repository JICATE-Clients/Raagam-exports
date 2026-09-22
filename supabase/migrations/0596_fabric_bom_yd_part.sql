-- 0596 — YD PART: the same yarn-dyed fabric allocated more than once on one BOM.
--
-- Client ticket 2026-09-19: "Allow duplicate selection of the same fabric
-- construction for yarn-dyed fabrics in Fabric Allocation." A Top and a Bottom
-- may be knitted from the SAME yarn-dyed cloth to DIFFERENT stripe ratios (80%
-- NAVY / 20% WHITE vs 70 / 30), so each needs its own Yarn Dyed Details, its
-- own piece weight, and its own yarn split on the requirement report.
--
-- Until now a yarn-dyed cloth was addressed on this document by (style,
-- structure, fabric) — `fabricGroupKey` — and every child that describes it
-- (the Repeats that carry the stripe shares, the Combinations that carry the
-- dyeing losses) hung off that address. Two allocations of one cloth were the
-- same address, so the screen merged them into one row and refused the second
-- pick outright (collision guard, 2026-09-04).
--
-- `yd_part` IS THE FOURTH PART OF THE ADDRESS. Free text, operator-named
-- (TOP, BOTTOM, …), upper-cased by the Zod schema like every other value.
--
-- NULL MEANS "THE ONLY PART", and that is what makes this migration a no-op for
-- every existing document: every row written before it is the single part of
-- its cloth, exactly as the screen already read it. Nothing is backfilled.
--
-- Carried on four tables, because four things must agree on which part they
-- describe:
--   * lines              — which part a panel's colourway is cut from;
--   * yd_repeats         — that part's stripe shares;
--   * yd_combinations    — that part's colourway names and dyeing losses;
--   * manual_entries     — which part a piece weight is for.
--
-- Additive and nullable: no constraint, no default, no trigger change. The
-- document-level order lock (0576/0577) is row-level and reads no column list,
-- so it covers the new column as it covers the rest.

alter table public.order_fabric_bom_lines            add column if not exists yd_part text;
alter table public.order_fabric_bom_yd_repeats       add column if not exists yd_part text;
alter table public.order_fabric_bom_yd_combinations  add column if not exists yd_part text;
alter table public.order_fabric_bom_manual_entries   add column if not exists yd_part text;

comment on column public.order_fabric_bom_lines.yd_part is
  'YD Part (0596): which allocation of a yarn-dyed fabric this line is cut from (TOP, BOTTOM, ...). NULL = the fabric''s only part.';
comment on column public.order_fabric_bom_yd_repeats.yd_part is
  'YD Part (0596): the part of the fabric these stripe shares describe. NULL = the only part.';
comment on column public.order_fabric_bom_yd_combinations.yd_part is
  'YD Part (0596): the part of the fabric this combination describes. NULL = the only part.';
comment on column public.order_fabric_bom_manual_entries.yd_part is
  'YD Part (0596): which part of a yarn-dyed fabric this piece weight is for. NULL = the only part.';
