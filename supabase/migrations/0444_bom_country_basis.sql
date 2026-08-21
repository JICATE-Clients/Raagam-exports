-- =============================================================================
-- 0444 — A Material BOM line can be planned per DESTINATION
--
-- Client, 2026-08-21: the Attribute gains "Country-Wise", splitting a material
-- across the countries an order ships to.
--
-- ## WHY IT NEEDS A COLUMN, WHEN `style` DID NOT
--
-- `uq_mba_req_slice` is (item_line_id, style_ref_no, combo, size_id) NULLS NOT
-- DISTINCT (0418:259). A country slice sets combo and size_id to NULL and takes
-- the order's single style, so TWO DESTINATIONS PRODUCE BYTE-IDENTICAL KEYS and
-- the second insert is refused. The index is not decoration — 0418's comment
-- says a duplicate double-counts into a purchase — so the axis has to be IN the
-- key, and that means a column.
--
-- Putting the country in `slice_label` and letting the key collide is the
-- alternative, and it is "a label is not a key" failing on the exact row the
-- constraint exists to protect.
--
-- ## BOTH CHECKS MOVE TOGETHER, AND 0443 NOW ASSERTS IT
--
-- 0420 wrote that rule, 0440 broke it, 0443 repaired it and added the parity
-- assertion. This is the first migration to widen the pair since, so it is also
-- the first test of whether that assertion actually holds the line. It is
-- re-run at the end of this file.
--
-- ## FREE, VERIFIED FROM THE CATALOGUE FIRST
--
-- `material_bom_amendment_requirements` holds ZERO rows (2026-08-21), so the
-- column is additive, the index rebuild rewrites nothing and the widened CHECK
-- admits nothing retrospectively. Same argument 0404 / 0418 / 0426 each made.
--
-- ## WHAT THIS DOES NOT DO
--
-- "Reference-Wise", the client's other new axis, is NOT here. Its field does not
-- exist yet: `garment_order_amendment_quantities.style_ref_no` is currently
-- carrying BOTH a style reference and a shipment line number depending on the
-- order (live data holds 'STL/26-27/0003', '123' and '12'), and the client
-- confirmed on 2026-08-21 that those are two different things needing two
-- columns. That split is its own migration and lands with the Quantities tab's
-- second heading.
-- =============================================================================

alter table public.material_bom_amendment_requirements
  add column if not exists country_id uuid references public.countries(id);

comment on column public.material_bom_amendment_requirements.country_id is
  'The destination this row is for, on a country-wise line and nowhere else. '
  'NULL is a VALUE — "every destination" — which is what every other basis '
  'means. In uq_mba_req_slice because two destinations otherwise collide (0444).';

-- The item column and its mirror, together, as 0420 requires and 0443 asserts.
alter table public.material_bom_amendment_items
  drop constraint if exists material_bom_amendment_items_requirement_basis_check;
alter table public.material_bom_amendment_items
  add constraint material_bom_amendment_items_requirement_basis_check
  check (
    requirement_basis is null
    or requirement_basis in ('order', 'style', 'colour', 'size', 'combination', 'country')
  );

alter table public.material_bom_amendment_requirements
  drop constraint if exists material_bom_amendment_requirements_basis_check;
alter table public.material_bom_amendment_requirements
  add constraint material_bom_amendment_requirements_basis_check
  check (basis in ('order', 'style', 'colour', 'size', 'combination', 'country'));

-- NULLS NOT DISTINCT preserved: on every non-country basis `country_id` is NULL
-- and must still collide with another NULL, or the index stops catching the
-- duplicates it was built for.
drop index if exists public.uq_mba_req_slice;
create unique index uq_mba_req_slice
  on public.material_bom_amendment_requirements
     (item_line_id, style_ref_no, combo, size_id, country_id)
  nulls not distinct;

do $assert$
declare
  v_items text;
  v_reqs  text;
  v_idx   text;
begin
  -- 1. Both CHECKs admit 'country'.
  foreach v_reqs in array array[
    'material_bom_amendment_items_requirement_basis_check',
    'material_bom_amendment_requirements_basis_check'
  ] loop
    if position('''country''' in (
      select pg_get_constraintdef(oid) from pg_constraint where conname = v_reqs
    )) = 0 then
      raise exception '0444: % does not admit country', v_reqs;
    end if;
  end loop;

  -- 2. PARITY, re-run. 0443 added this assertion; 0444 is the first migration to
  --    widen the pair since, so this is where it earns its place or does not.
  select pg_get_constraintdef(oid) into v_items from pg_constraint
   where conname = 'material_bom_amendment_items_requirement_basis_check';
  select pg_get_constraintdef(oid) into v_reqs from pg_constraint
   where conname = 'material_bom_amendment_requirements_basis_check';

  v_items := regexp_replace(lower(v_items), '[^a-z,]', '', 'g');
  v_reqs  := regexp_replace(lower(v_reqs),  '[^a-z,]', '', 'g');
  v_items := replace(replace(v_items, 'requirementbasisisnullor', ''), 'requirementbasis', 'basis');
  if v_items <> v_reqs then
    raise exception '0444: the two basis CHECKs have drifted — % vs %', v_items, v_reqs;
  end if;

  -- 3. The index carries the destination AND still treats NULLs as equal.
  select indexdef into v_idx from pg_indexes
   where schemaname = 'public' and indexname = 'uq_mba_req_slice';
  if v_idx is null then
    raise exception '0444: uq_mba_req_slice is missing — the drop ran and the create did not';
  end if;
  if position('country_id' in v_idx) = 0 then
    raise exception '0444: uq_mba_req_slice does not include country_id — two destinations will collide';
  end if;
  if position('NULLS NOT DISTINCT' in upper(v_idx)) = 0 then
    raise exception '0444: uq_mba_req_slice lost NULLS NOT DISTINCT — it stops catching duplicates on every other basis';
  end if;

  -- 4. 0437's boundary, still standing.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_requirements'
       and column_name in ('moq', 'round_to', 'final_qty')
  ) then
    raise exception '0444: a requirement row must carry none of moq / round_to / final_qty (0418 · 0437)';
  end if;
end $assert$;
