-- ============================================================================
-- Raagam ERP — 0412 Fabric Type gains PRINTED; the clutter columns go
--
-- Two corrections from the operator's field-by-field walk of the Combos ▸
-- Structure Details grid (2026-08-12).
--
--
-- 1. FABRIC TYPE IS FOUR ANSWERS, NOT THREE
--
--     "Fabric Type: this defines the fabric category — specifically whether it
--      is Solid, Yarn-Dyed (Y/D), Melange, or Printed."
--
-- 0408 copied the vocabulary from `order_fabrics.item_sub_type` (0329), whose
-- CHECK is `solid | melange | yarn_dyed`. That list was built for the ORDER
-- side, where it exists to answer one narrow question — "does this fabric need
-- a dyeing row?" — and melange and yarn-dyed are the two answers that mean no.
-- A printed fabric is not a fourth way of being dyed, so it never needed
-- naming there.
--
-- Here it does, and it carries a rule: **Fabric Print is the field a PRINTED
-- fabric fills**, exactly as the declared dyeing palette is the list a SOLID
-- one picks from. Without `printed` in the tuple the screen has no way to ask
-- which of the two aesthetic fields applies, and both would stand open on every
-- row.
--
-- THE ORDER SIDE IS NOT TOUCHED. 0329's CHECK stays as it is: it belongs to a
-- different document with a different question, and widening it would let a
-- value through that `seedAmendmentFromOrder` has no way to produce. The
-- consequence is worth stating plainly — a seeded amendment can never arrive
-- with `printed`, because the order it seeds from cannot say so. The operator
-- sets it here.
--
--
-- 2. THE CLUTTER COLUMNS
--
--     "Redundant legacy columns such as 'Other Details', 'Specification', and
--      the 'Style Reference/Article No' (if already in the header) should be
--      removed to reduce screen clutter."
--
-- `specifications` was never mirrored (0397 left it out on the client's
-- 2026-08-10 word, and the legacy column is empty in the screenshots too), and
-- the identity fields are the overlay's read-only HEADER rather than columns —
-- which is the arrangement this asks for. So what is actually left to remove is
-- `other_details`, on both levels of the tree.
--
-- DROPPED, NOT FROZEN, on the same evidence 0408 and 0410 used: both tables
-- hold 0 rows and were created hours ago by this same piece of work. The freeze
-- convention protects stored VALUES; there are none, and a frozen column that
-- never held a value is one that can only mislead the next reader.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. `printed` joins the tuple.
--
-- Drop-and-recreate rather than `ALTER ... ADD CONSTRAINT`: a CHECK cannot be
-- widened in place, and the name is preserved so nothing that looks it up by
-- name (this migration's own verify block included) stops finding it.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_combo_structures
  drop constraint if exists garment_order_amendment_combo_structures_item_sub_type_check;

alter table public.garment_order_amendment_combo_structures
  add constraint garment_order_amendment_combo_structures_item_sub_type_check
  check (item_sub_type is null
         or item_sub_type in ('solid', 'melange', 'yarn_dyed', 'printed'));

comment on column public.garment_order_amendment_combo_structures.item_sub_type is
  '"Fabric Type" — solid | melange | yarn_dyed | printed (0412). It decides '
  'which aesthetic field a component fills: SOLID picks from the order''s '
  'declared dyeing colours, PRINTED picks from its declared prints, and melange '
  '/ yarn-dyed take their colour from the yarn so neither applies. Wider than '
  'order_fabrics.item_sub_type (0329) on purpose — see this migration''s header.';


-- ---------------------------------------------------------------------------
-- 2. Other Details leaves both levels.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_combo_structures
  drop column if exists other_details;

alter table public.garment_order_amendment_combo_components
  drop column if exists other_details;


-- ---------------------------------------------------------------------------
-- 3. Read the result out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal.
--
-- The widened CHECK is asserted BY EXERCISING IT — inserting a `printed` row
-- and rolling it back — not by reading `pg_get_constraintdef` and matching a
-- string. A constraint definition that merely MENTIONS 'printed' proves the
-- text changed; what is worth knowing is that the value is now admitted, and
-- that the three it replaced still are.
-- ---------------------------------------------------------------------------
do $verify$
declare
  probe_amend  uuid;
  probe_combo  uuid;
  v_type       text;
begin
  foreach v_type in array array['other_details'] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema='public'
         and table_name='garment_order_amendment_combo_structures'
         and column_name = v_type
    ) then
      raise exception '0412: combo_structures still carries %', v_type;
    end if;
    if exists (
      select 1 from information_schema.columns
       where table_schema='public'
         and table_name='garment_order_amendment_combo_components'
         and column_name = v_type
    ) then
      raise exception '0412: combo_components still carries %', v_type;
    end if;
  end loop;

  select id into probe_amend from public.garment_order_amendments limit 1;
  if probe_amend is not null then
    insert into public.garment_order_amendment_combos (amendment_id, sno, combo)
      values (probe_amend, 9412, '__0412_probe') returning id into probe_combo;

    -- All four must be admitted; a typo that dropped one of the original three
    -- while adding 'printed' would otherwise ship silently.
    foreach v_type in array array['solid','melange','yarn_dyed','printed'] loop
      begin
        insert into public.garment_order_amendment_combo_structures
          (combo_id, sno, item_sub_type)
        values (probe_combo, 1, v_type);
      exception when check_violation then
        delete from public.garment_order_amendment_combos where id = probe_combo;
        raise exception '0412: item_sub_type rejected %', v_type;
      end;
    end loop;

    -- …and something outside the tuple must still be refused, or the CHECK was
    -- dropped rather than widened.
    begin
      insert into public.garment_order_amendment_combo_structures
        (combo_id, sno, item_sub_type)
      values (probe_combo, 2, '__not_a_fabric_type');
      delete from public.garment_order_amendment_combos where id = probe_combo;
      raise exception '0412: item_sub_type admitted a value outside the tuple';
    exception when check_violation then
      null;  -- expected
    end;

    delete from public.garment_order_amendment_combos where id = probe_combo;
  end if;
end $verify$;
