-- =============================================================================
-- 0443 — The requirement CHECK catches up with the item CHECK
-- -----------------------------------------------------------------------------
-- 0440 widened `material_bom_amendment_items.requirement_basis` to admit
-- 'style' and did NOT widen the mirror on
-- `material_bom_amendment_requirements.basis`, which still admits only
-- ('order','colour','size','combination') — the set 0420 left it at.
--
-- So a style-wise line SAVES ITS ITEM ROW AND THEN FAILS ON ITS REQUIREMENT
-- ROWS. `requirementRows` writes `basis` straight through
-- (material-bom-amendment/actions.ts:274), so the insert raises check_violation
-- and the whole save rolls back. The feature 0440 shipped has never worked.
--
-- 0420 wrote the rule this broke, in its own header:
--
--     "BOTH CHECKS MOVE TOGETHER — widening one without the other admits a
--      value the write then rejects."
--
-- It was stated and nothing enforced it, which is exactly how it drifted. So
-- this migration does not merely repair the set; it adds the assertion that
-- COMPARES THE TWO, and that assertion fails against the catalog as it stands
-- today. A rule that is only written down is a rule that gets to rot once more.
--
-- ## Free, and verified free rather than assumed
--
-- `material_bom_amendment_requirements` holds ZERO rows (catalog, 2026-08-21),
-- so widening admits nothing retrospectively and no stored row has to be
-- re-checked. Same argument 0404 / 0418 / 0426 each made before touching a
-- constraint.
--
-- ## What this deliberately does NOT do
--
-- It does not touch `moq` or `round_to`. The client restated the quantity chain
-- on 2026-08-21 with Round To ahead of the MOQ; put back to them with 0437's
-- worked example (needs 100, MOQ 550, step 500 → 1,000 one way and 550 the
-- other, and only the first is a figure the supplier can pack), they confirmed
-- MOQ FIRST STANDS. 0437's comments are correct as written and are left alone.
-- =============================================================================

alter table public.material_bom_amendment_requirements
  drop constraint if exists material_bom_amendment_requirements_basis_check;

alter table public.material_bom_amendment_requirements
  add constraint material_bom_amendment_requirements_basis_check
  check (basis in ('order', 'style', 'colour', 'size', 'combination'));

comment on column public.material_bom_amendment_requirements.basis is
  'The basis the parent line was exploded on: order | style | colour | size | '
  'combination. Mirrors material_bom_amendment_items.requirement_basis and MUST '
  'admit the same set — 0443 asserts it (0418; combination 0420; style 0443, '
  'catching up with 0440).';

-- VERIFY FROM THE CATALOG, never by reading this file back.
do $$
declare
  v_items  text;
  v_reqs   text;
begin
  -- 1. The mirror admits 'style'. Fails against the pre-0443 catalog, which is
  --    the defect reproducing.
  begin
    insert into public.material_bom_amendment_requirements
      (id, amendment_id, item_line_id, sno, basis, slice_label, basis_qty,
       no_of_items, per_pieces, excess_pct, refusal_reason)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 0, 'style',
            'probe', 0, 1, 1, 0, 'probe');
    raise exception '0443: the style probe INSERTED — it should have been refused by a FK';
  exception
    when check_violation then
      raise exception '0443: basis CHECK still refuses ''style'' — the widening did not take';
    when others then null;   -- a FK refused first, which means the CHECK passed
  end;

  -- 2. A LABEL is still refused. 0418 put this guard here deliberately: the
  --    column stores the key and the screen owns the wording, so admitting
  --    'Color-wise' would let the two drift apart for good.
  begin
    insert into public.material_bom_amendment_requirements
      (id, amendment_id, item_line_id, sno, basis, slice_label, basis_qty,
       no_of_items, per_pieces, excess_pct, refusal_reason)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 0, 'Color-wise',
            'probe', 0, 1, 1, 0, 'probe');
    raise exception '0443: basis admitted "Color-wise" — the CHECK is not doing its job';
  exception
    when check_violation then null;   -- the CHECK held, which is the assertion
    when others then null;
  end;

  -- 3. THE ONE THAT WOULD HAVE CAUGHT 0440 — the two CHECKs admit the same set.
  --    Compared as normalised text rather than by hand, so it keeps working when
  --    a sixth basis is added and only one side is edited.
  select pg_get_constraintdef(oid) into v_items from pg_constraint
   where conname = 'material_bom_amendment_items_requirement_basis_check';
  select pg_get_constraintdef(oid) into v_reqs from pg_constraint
   where conname = 'material_bom_amendment_requirements_basis_check';

  if v_items is null or v_reqs is null then
    raise exception '0443: one of the two basis CHECKs is missing entirely';
  end if;

  -- Strip everything that legitimately differs — the column name, the items
  -- side's `is null or`, whitespace and quoting — and compare what is left.
  v_items := regexp_replace(lower(v_items), '[^a-z,]', '', 'g');
  v_reqs  := regexp_replace(lower(v_reqs),  '[^a-z,]', '', 'g');
  v_items := replace(replace(v_items, 'requirementbasisisnullor', ''), 'requirementbasis', 'basis');

  if v_items <> v_reqs then
    raise exception '0443: the item and requirement basis CHECKs admit different sets — % vs %',
      v_items, v_reqs;
  end if;

  -- 4. 0437's guard, re-asserted: the requirement table carries neither `moq`
  --    nor `round_to`. Both are per LINE, because six colour rows each rounded
  --    to the next 500 buys the rounding error six times.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_requirements'
       and column_name in ('moq', 'round_to', 'final_qty')
  ) then
    raise exception '0443: moq/round_to/final_qty must not live on a requirement row (0437)';
  end if;
end $$;
