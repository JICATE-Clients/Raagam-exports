-- ============================================================================
-- Raagam ERP — 0410 "Fabric Print" is ONE field, not Fabric and Print
--
-- 0408 read the legacy nested grid's header (screenshots 2259 · 2260) as seven
-- columns and gave the component row both a `fabric_name` and a `print_id`.
-- The operator, who has used that screen for years, corrected it (2026-08-12):
--
--     "Fabric and print is not separate field which is single field so merge it"
--
-- The header reads **Fabric Print** — the print applied to the fabric — and it
-- carries ONE control (the green ⊛ inline-create icon under it, not two). What
-- looked like a column boundary in a screenshot of a dense grid was the gap
-- inside a two-word label.
--
-- `print_id` is the surviving half, and it is the right half: it points at
-- `config_lookups` kind 'roll_form_print', which is a maintained list with a
-- picker and inline create — exactly what the ⊛ is. `fabric_name` was free
-- text with no master behind it, mirroring `order_fabric_components.fabric_name`
-- on the order side, which is a column that side carries for its own reasons.
--
-- DROPPED RATHER THAN FROZEN, on the same evidence 0408 used for the four
-- columns it moved off the combo header: the table holds 0 rows. The freeze
-- convention protects stored VALUES, and this column was created hours ago and
-- has never been written to by anything — the screen that would write it has
-- not shipped. 0408's own words apply: "a frozen column that never held a value
-- is a column that can only ever mislead the next reader."
--
-- The seeder stops reading `order_fabric_components.fabric_name`; that column is
-- untouched on the order side, where it predates all of this.
-- ============================================================================

alter table public.garment_order_amendment_combo_components
  drop column if exists fabric_name;

comment on column public.garment_order_amendment_combo_components.print_id is
  'The component''s FABRIC PRINT — one field, labelled "Fabric Print" on the '
  'legacy grid (0410). `config_lookups` kind ''roll_form_print''.';


-- ---------------------------------------------------------------------------
-- Read the result out of the catalog. `{"success": true}` means the SQL ran,
-- not that it achieved its goal.
--
-- Both halves are asserted: the column is gone AND `print_id` survived. A
-- careless merge that dropped the wrong one would leave a component grid that
-- still saves and can no longer name a print at all.
-- ---------------------------------------------------------------------------
do $verify$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public'
       and table_name='garment_order_amendment_combo_components'
       and column_name='fabric_name'
  ) then
    raise exception '0410: fabric_name is still on the component row';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public'
       and table_name='garment_order_amendment_combo_components'
       and column_name='print_id'
  ) then
    raise exception '0410: print_id was dropped — the wrong half of the merge survived';
  end if;
end $verify$;
