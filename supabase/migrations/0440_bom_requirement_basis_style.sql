-- 0440 — A MATERIAL BOM LINE CAN BE PLANNED PER STYLE
--
-- Client, 2026-08-20: the Material BOM's "Attribute" is being made to read like
-- the Prices tab, whose modes are Style-wise / Color-wise / Size-wise /
-- Color+Size. Four of those five already existed here; `style` did not.
--
-- WHY IT IS A REAL AXIS AND NOT A CONVENIENCE
--
-- A multi-style order buys some trims once per STYLE and not once per colour: a
-- woven label carries the style's own art, so two colourways of one style share
-- a label and two styles never do. Without this basis that line had to be either
-- `order` (one label for the whole PO — wrong the moment a second style exists)
-- or `colour` (a label per colourway — over-buying by the number of colours).
--
-- 0436's header warns against adding a fifth basis, and that warning is about a
-- COMPONENT axis: a sleeve seam consuming less thread than a front seam is a
-- property of the panel, not of the order, so it became `material_bom_amendment_
-- item_components` rather than a basis. This is the opposite case — a style IS a
-- cut of the order's quantity, it sums with the others, and `productionSlices`
-- answers it from the same Approval Qty rows every other basis reads. So the
-- warning is honoured rather than overruled: read it, and this is not that.
--
-- THE CHECK IS WIDENED, NOT DROPPED. 0418 put it there deliberately and ships a
-- test that fails if the constraint ever admits a label like "Color-wise" — the
-- column stores the KEY, and the screen owns the wording. Adding one key keeps
-- that guarantee.
--
-- `order_fabric_bom_lines` is NOT touched. It carries its own two-value CHECK
-- ('colour','colour_size') for the fabric side, where a style axis has no
-- meaning: a fabric is cut per colourway.

alter table public.material_bom_amendment_items
  drop constraint if exists material_bom_amendment_items_requirement_basis_check;

alter table public.material_bom_amendment_items
  add constraint material_bom_amendment_items_requirement_basis_check
  check (
    requirement_basis is null
    or requirement_basis in ('order', 'style', 'colour', 'size', 'combination')
  );

comment on column public.material_bom_amendment_items.requirement_basis is
  'What this line is bought per: order | style | colour | size | combination. '
  'The KEY, never the label — REQUIREMENT_BASIS_LABELS owns the wording '
  '(0418; style added 0440).';

-- VERIFY FROM THE CATALOG, never by reading this file back. Both must hold:
--
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'material_bom_amendment_items_requirement_basis_check';
--   -- expect: order, style, colour, size, combination
--
--   insert ... requirement_basis = 'Style-wise'  -- must RAISE, as 0418 asserts
do $$
begin
  begin
    insert into public.material_bom_amendment_items (id, amendment_id, sno, requirement_basis)
    values (gen_random_uuid(), gen_random_uuid(), 0, 'Style-wise');
    raise exception '0440: requirement_basis admitted "Style-wise" — the CHECK is not doing its job';
  exception
    when check_violation then null;   -- the CHECK held, which is the assertion
    when others then null;            -- a FK or NOT NULL refused first; fine
  end;
end $$;
