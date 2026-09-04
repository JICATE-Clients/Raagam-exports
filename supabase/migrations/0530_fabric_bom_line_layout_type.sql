-- ============================================================================
-- Raagam ERP — 0530 Orders ▸ Fabric BOM ▸ Components — Layout Type on the
-- fabric row itself, gating the Component picker.
--
-- Section 4 of the client's "Structure Details & Components Redesign" spec
-- (2026-09-04): "When an operator adds a fabric row, they choose the layout
-- type (Open Width or Tubular)... The component dropdown must filter
-- dynamically based on this selection." Confirmed with the operator
-- (AskUserQuestion, same date) as a NEW field on the panel row, before
-- Component — not a repurposing of the existing colourway-row `fabric_form`
-- ("Type"), and not the per-style DECLARED fact 0527 already built.
--
--
-- A FOURTH WORD FOR THE SAME TWO CONCEPTS, AND WHY THAT IS CORRECT HERE
--
-- This module now has three Open/Tubular-shaped columns, and each answers a
-- different question:
--
--   order_fabric_bom_lines.fabric_form (0495)               — "how is THIS
--     colourway's roll presented to cutting" — entered per colourway, after
--     Component is chosen.
--   garment_order_amendment_style_components.layout_type (0527) — "which
--     Layout Type does this STYLE normally cut this part in" — a declared
--     fact, edited on Order Info, read passively to hide Manual tab options.
--   order_fabric_bom_lines.layout_type (THIS migration)      — "which Layout
--     Type is the operator choosing for THIS panel, right now, to narrow the
--     Component list they are about to pick from" — entered per panel,
--     BEFORE Component.
--
-- None of the three can stand in for another: the first is sequenced after
-- Component and repeats per colourway (rejected as a gate, client
-- 2026-09-02 — see component-map.ts's own header); the second is declared
-- upstream of this screen entirely and has no "adding a fabric row" moment
-- for the operator to answer here; only a new column has both properties
-- the spec asks for — chosen at the moment of adding the row, and read
-- before Component.
--
--
-- ON `order_fabric_bom_lines`, NOT A NEW TABLE — 0495's own finding restated
-- once more: a panel's line already holds every fact about it (coordinate,
-- component, fabric, form), so a fifth fact about the same panel is a fifth
-- column, not a new grain. Written through to EVERY colourway line of the
-- panel from `onPatchPanel`, the same way `component_id` and `fabric_form`
-- (before 2026-09-02) were — a garment panel is knit Open Width or Tubular
-- regardless of which colour it is dyed.
--
--
-- SPELLING: `open_width` | `tubular`, matching `LAYOUT_TYPE_OPTIONS`
-- (component-map.ts) and `order_fabric_bom_manual_entries.width_form`
-- (0495/0527) — NOT `fabric_form`'s `open` | `tubular`. Reusing the existing
-- vocabulary and its existing hide-list function
-- (`componentsHiddenForLayout`) is the whole point of building this as a
-- fourth column instead of a fourth set of rules.
--
--
-- NULLABLE AND PERMISSIVE, same shape as 0527: every line on this table
-- today has `layout_type is null`, and `componentsHiddenForLayout` already
-- treats "nothing chosen" as "hide nothing" — so this column can ship with
-- no back-fill and no blank Component list on any existing BOM.
--
--
-- PRE-FLIGHT (catalog, 2026-09-04): `order_fabric_bom_lines` confirmed to
-- hold {id, bom_id, sno, style_ref_no, combo, structure_id, component_id,
-- item_id, fabric_type, color_name, consumption, consumption_uom_id,
-- wastage_pct, requirement_basis, dia, required_by, rate, notes, created_at,
-- coordinate_id, fabric_form, required_print, specification, no_of_colors,
-- mixing_uom_id} — no `layout_type`, no unrelated drift since 0526.
-- ============================================================================

alter table public.order_fabric_bom_lines
  add column if not exists layout_type text;

alter table public.order_fabric_bom_lines
  drop constraint if exists order_fabric_bom_lines_layout_type_check;

alter table public.order_fabric_bom_lines
  add constraint order_fabric_bom_lines_layout_type_check
  check (layout_type is null or layout_type in ('open_width', 'tubular'));

comment on column public.order_fabric_bom_lines.layout_type is
  'Fabric BOM ▸ Components (0530) — the Layout Type (Open Width | Tubular, '
  'same spelling as garment_order_amendment_style_components.layout_type and '
  'order_fabric_bom_manual_entries.width_form) the OPERATOR chooses on this '
  'PANEL, before picking its Component — gates the Component picker via '
  'componentsHiddenForLayout (lib/orders/fabric-bom/component-map.ts). NOT '
  'the colourway-row fabric_form (0495) and NOT the per-style declared fact '
  '(0527) — three different questions sharing two spellings, see this '
  'migration''s own header. NULLABLE AND READ PERMISSIVELY: null hides '
  'nothing.';

-- ---------------------------------------------------------------------------
-- Read the result out of the CATALOG, never off the migration text.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'order_fabric_bom_lines'
      and column_name  = 'layout_type'
  ) then
    raise exception '0530: order_fabric_bom_lines is missing layout_type';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'order_fabric_bom_lines'
      and column_name  = 'layout_type'
      and is_nullable  = 'NO'
  ) then
    raise exception '0530: layout_type is NOT NULL — every existing row would be an immediate violation';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_fabric_bom_lines'::regclass
      and conname  = 'order_fabric_bom_lines_layout_type_check'
  ) then
    raise exception '0530: the layout_type CHECK is missing';
  end if;
end $$;
