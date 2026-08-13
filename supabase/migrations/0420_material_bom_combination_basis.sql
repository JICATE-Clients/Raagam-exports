-- ============================================================================
-- Raagam ERP — 0420 Material BOM ▸ the fourth Attribute: Combination
--
-- The client's attribute list is FOUR, not three: Order Number, Color-Wise,
-- Size-Wise and **Combination** — "the most complex attribute, used for
-- materials that vary by both color and size … a specific label for a Red Size
-- Small garment" (client spec, 2026-08-13).
--
--
-- IT ALSO CORRECTS WHAT `size` MEANT, WHICH IS THE HALF THAT WAS A BUG
--
-- The engine shipped the colour × size MATRIX under the name `size`, so a size
-- label produced `WHITE · M` and `NAVY · M` as separate rows. A SIZE LABEL DOES
-- NOT CARE WHAT COLOUR THE SHIRT IS — the question it asks is "how many Mediums
-- are there?", and the answer is one number. Emitting two doubles the row count
-- and asks the operator to reconcile figures that are only ever added back
-- together.
--
-- So `size` now collapses the colour axis and `combination` is the matrix. The
-- matrix is still apportioned PER COMBO before being summed by size — two
-- colourways rarely carry the same size curve, and blending them before
-- apportioning would move pieces between sizes. Every basis still sums to the
-- same order total; `scripts/check-bom-requirement.mts` asserts that across all
-- four, and asserts the size labels do NOT name a colour.
--
--
-- BOTH CHECKS MOVE TOGETHER
--
-- `material_bom_amendment_items.requirement_basis` is what the operator picks;
-- `material_bom_amendment_requirements.basis` is what the row was computed
-- under. Widening one without the other admits a value the write then rejects —
-- surfacing to the operator as a save that fails with a constraint name instead
-- of a sentence.
-- ============================================================================

alter table public.material_bom_amendment_items
  drop constraint if exists material_bom_amendment_items_requirement_basis_check;
alter table public.material_bom_amendment_items
  add constraint material_bom_amendment_items_requirement_basis_check
  check (requirement_basis is null
         or requirement_basis in ('order','colour','size','combination'));

alter table public.material_bom_amendment_requirements
  drop constraint if exists material_bom_amendment_requirements_basis_check;
alter table public.material_bom_amendment_requirements
  add constraint material_bom_amendment_requirements_basis_check
  check (basis in ('order','colour','size','combination'));

comment on column public.material_bom_amendment_items.requirement_basis is
  'How the requirement splits: order | colour | size | combination. `size` collapses the colour axis (one row per size); `combination` is the colour x size matrix, the only basis whose row identifies a single SKU (0420).';


-- ----------------------------------------------------------------------------
-- Read it back, and assert the CHECK BY USING IT.
--
-- A constraint dropped and not re-added lets every value through, and reports
-- success while doing so — the shape 0383 and 0386 both shipped. So this
-- asserts the new value is ACCEPTED *and* that a wrong one is still REFUSED;
-- only the pair distinguishes "widened" from "removed".
-- ----------------------------------------------------------------------------

do $verify$
declare
  v_goa uuid; v_mba uuid; v_line uuid;
begin
  insert into public.garment_order_amendments (amend_date, excess_pct, pack, mult_ord)
    values (current_date, 0, false, false) returning id into v_goa;
  insert into public.material_bom_amendments (garment_order_id, amend_date)
    values (v_goa, current_date) returning id into v_mba;
  insert into public.material_bom_amendment_items (amendment_id, sno)
    values (v_mba, 1) returning id into v_line;

  update public.material_bom_amendment_items
     set requirement_basis = 'combination' where id = v_line;
  insert into public.material_bom_amendment_requirements
    (amendment_id, item_line_id, basis, combo, size_id, slice_label,
     basis_qty, no_of_items, per_pieces, required_qty)
  values (v_mba, v_line, 'combination', 'WHITE', null, 'WHITE / S', 100, 2, 1, 200);

  begin
    update public.material_bom_amendment_items
       set requirement_basis = 'Color-wise' where id = v_line;
    raise exception '0420: requirement_basis admitted "Color-wise" - the CHECK was dropped and not replaced';
  exception when check_violation then null;
  end;

  begin
    insert into public.material_bom_amendment_requirements
      (amendment_id, item_line_id, basis, slice_label, basis_qty, no_of_items, per_pieces, required_qty)
    values (v_mba, v_line, 'matrix', 'x', 1, 1, 1, 1);
    raise exception '0420: requirements.basis admitted "matrix" - the CHECK was dropped and not replaced';
  exception when check_violation then null;
  end;

  delete from public.garment_order_amendments where id = v_goa;
  raise notice '0420 VERIFY: combination accepted on both tables, wrong values still refused';
end $verify$;
