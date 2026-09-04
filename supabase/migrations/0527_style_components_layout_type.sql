-- ============================================================================
-- Raagam ERP — 0527 Orders ▸ Order Info ▸ Style(s) ▸ Components — Layout Type
--
-- Client's "Fab Rail" spec: a Fabric BOM ▸ Manual fabric row states a Layout
-- Type (Open Width / Tubular — the SAME two words `order_fabric_bom_manual_
-- entries.width_form` already uses, 0495), and the Components picker on that
-- row should only offer components that match it. Nothing anywhere records
-- which layout type a component normally belongs to (repo-wide grep, zero
-- hits for layout_type before this migration), so there is nothing yet to
-- filter BY.
--
--
-- WHY THIS TABLE, AND NOT `garment_style_components` (THE STYLE MASTER)
--
-- The obvious home for "a fact about a style's declared part" is the Style
-- master's own Components tab, which is where every other association rule
-- on this tab (Coordinate / Component / Structure) is declared. That screen
-- is RETIRED: client 2026-08-25, "Style — allow it manual entry now, unwire
-- that style mapping with that field in orderinfo" — `pickStyle` (which used
-- to copy `garment_style_components` onto a new order line) is GONE, and
-- Coordinate/Component/Structure are now typed directly on the Order Info ▸
-- Style(s) ▸ Components grid (`garment-order-screen.tsx`, `StyleComponentRow`,
-- writing straight to THIS table). Adding the column to the retired master
-- would put the new field somewhere no operator can reach any more.
--
-- `garment_order_amendment_style_components` (0457) is that grid's own table
-- and the one `declaredPanelsFor` (`lib/orders/fabric-bom/component-map.ts`)
-- already reads for the other three association rules — so this is the one
-- place a fourth rule can be added without inventing a second source of truth.
--
--
-- NULLABLE, AND PERMISSIVE IS THE WHOLE POINT
--
-- Every row on this table today (and for a long time after this ships) has
-- `layout_type is null` — no existing style has stated one. A component
-- picker that HIDES an option until its layout type is declared would go
-- blank on every order in the database the day this ships. So the rule this
-- column feeds must be "narrow only once the fact is stated" — the same
-- "restrict only in case X leaks through every state that is not X" rule
-- AGENTS.md already states for nominated vendors and cascading filters — never
-- "hide until declared". That is enforced in `panelsForLayout`
-- (component-map.ts), not here; this migration only makes the fact sayable.
--
--
-- VOCABULARY: `open_width` | `tubular`, NOT `open` | `tubular`
--
-- Two Open/Tubular columns already exist in this module and disagree on
-- spelling: `order_fabric_bom_lines.fabric_form` ('open'/'tubular', the
-- Components tab's colourway "Type") and `order_fabric_bom_manual_entries.
-- width_form` ('open_width'/'tubular', the Manual tab's fabric-row Layout
-- Type). This column feeds the Manual tab's filter, so it takes width_form's
-- spelling — comparing the two directly needs no translation table.
--
-- TEXT + CHECK, not a `config_lookups` kind: same call `fabric_form` and
-- `width_form` both already made — the list is CLOSED (0492's test), an
-- operator will never add a third layout a knitted roll can leave the machine
-- in, and an FK would let a deleted lookup row take a stored declaration with
-- it.
--
--
-- PRE-FLIGHT (catalog, 2026-09-04): `garment_order_amendment_style_components`
-- confirmed to hold exactly {id, amendment_id, style_ref_no, sno, coordinate_
-- id, component_id, fabric_category_id, comp_type, item_id, created_at} —
-- no `layout_type`, no unrelated drift since 0457.
-- ============================================================================

alter table public.garment_order_amendment_style_components
  add column if not exists layout_type text;

alter table public.garment_order_amendment_style_components
  drop constraint if exists goa_style_components_layout_type_check;

alter table public.garment_order_amendment_style_components
  add constraint goa_style_components_layout_type_check
  check (layout_type is null or layout_type in ('open_width', 'tubular'));

comment on column public.garment_order_amendment_style_components.layout_type is
  'Fab Rail (0527) — which Layout Type (Open Width | Tubular, same spelling as '
  'order_fabric_bom_manual_entries.width_form) this style part is normally cut '
  'in. NULLABLE AND READ PERMISSIVELY: a null here must be offered under EITHER '
  'Layout Type selection on Fabric BOM ▸ Manual, never hidden on an unstated '
  'fact — see panelsForLayout in lib/orders/fabric-bom/component-map.ts. Edited '
  'on Order Info ▸ Style(s) ▸ Components (the Style master screen that used to '
  'own this table is retired, client 2026-08-25).';

-- ---------------------------------------------------------------------------
-- Read the result out of the CATALOG, never off the migration text.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'garment_order_amendment_style_components'
      and column_name  = 'layout_type'
  ) then
    raise exception '0527: garment_order_amendment_style_components is missing layout_type';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'garment_order_amendment_style_components'
      and column_name  = 'layout_type'
      and is_nullable  = 'NO'
  ) then
    raise exception '0527: layout_type is NOT NULL — every existing row would be an immediate violation';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.garment_order_amendment_style_components'::regclass
      and conname  = 'goa_style_components_layout_type_check'
  ) then
    raise exception '0527: the layout_type CHECK is missing';
  end if;
end $$;
