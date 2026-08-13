-- ============================================================================
-- Raagam ERP — 0423 A Material BOM line can say WHICH PANEL the trim goes on
--
-- Client, 2026-08-13, describing what the BOM fetches from Style Entry:
--
--     "The list of components (e.g. Front Body, Sleeves, Pockets) is fetched.
--      This is vital when materials like interlining or specialized tapes are
--      only required for specific parts of the garment."
--
-- The Material BOM did not fetch it, and could not: it never touches
-- `garment_styles` at all. Its "Style" cell is a plain `<Select>` over
-- `style_ref_no` TEXT STRINGS (0418) and resolves no style record, so nothing in
-- the module knew a style had parts.
--
--
-- DESCRIPTIVE, NOT A FIFTH REQUIREMENT BASIS (client's choice, 2026-08-13)
--
-- This is the decision that keeps the column honest, and it was made against the
-- alternative. `requirement_basis` explodes a line into rows — one per colour,
-- per size, or per colour × size (0420) — and a component axis was considered
-- for the same treatment and rejected: you need ONE collar interlining per
-- garment whichever panel it is cut for, so splitting by panel would multiply
-- the rows without changing the total, and every extra row would then have to be
-- reconciled against a quantity that never differed.
--
-- So `component_id` records WHERE a material goes, for the cutting room and for
-- the purchase spec. `productionSlices` in lib/orders/material-bom/requirement.ts
-- is deliberately untouched, and no requirement row gains a component column.
--
--
-- THE COMPONENTS MASTER, AND THE NARROWING IS THE SCREEN'S
--
-- References `components` (0228), the master — not `garment_style_components`,
-- which is the style's list of which ones it uses. Same call 0421 made for the
-- Style(s) ▸ Process panel and for the same reason: a style's component rows are
-- rewritten wholesale on every save of the Style master, so their ids are not
-- stable, while a master row persists.
--
-- Offering only THIS style's components is therefore a screen concern, which is
-- where the cascading-picker rule puts it. It matters here more than usual: the
-- BOM line's Style cell may say "All styles", and a component belongs to a
-- style, so a line that has not named one has no panel list to offer and the
-- screen says so rather than listing every component in the master.
--
-- NULLABLE. Most trims go on the whole garment — a main label, a polybag — and
-- have no panel at all. That is the common case, not a missing answer.
-- ============================================================================


alter table public.material_bom_amendment_items
  add column if not exists component_id uuid references public.components(id);

comment on column public.material_bom_amendment_items.component_id is
  'Which garment panel this material goes on, from the components master (0228). Descriptive: it does NOT split the requirement — see 0423.';

create index if not exists idx_mba_items_component
  on public.material_bom_amendment_items(component_id);


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- Two things asserted beyond presence. NULLABLE, because a trim with no panel is
-- the ordinary case and a NOT NULL would refuse every polybag line. And that the
-- REQUIREMENT table did not gain a component column: this migration's whole
-- premise is that the panel does not split the quantity, so a component axis
-- appearing there would mean the decision had been reversed by accident.
-- ----------------------------------------------------------------------------

do $verify$
declare
  col_null text;
begin
  select is_nullable into col_null
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'material_bom_amendment_items'
     and column_name  = 'component_id';

  if col_null is null then
    raise exception '0423: material_bom_amendment_items.component_id was not added';
  end if;
  if col_null <> 'YES' then
    raise exception '0423: component_id is NOT NULL — a trim with no panel is the ordinary case';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.material_bom_amendment_items'::regclass
       and contype = 'f'
       and confrelid = 'public.components'::regclass
  ) then
    raise exception '0423: component_id does not reference the components master';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_requirements'
       and column_name  = 'component_id'
  ) then
    raise exception '0423: the requirement table gained a component column — the panel must not split the quantity';
  end if;
end $verify$;
