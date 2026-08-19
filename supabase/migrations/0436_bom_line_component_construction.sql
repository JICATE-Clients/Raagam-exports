-- ============================================================================
-- Raagam ERP — 0436 A Material BOM line can carry a construction PER PANEL
--
-- Client, 2026-08-19, describing the Combination button:
--
--     "This allows the user to specify different thread colours or materials for
--      individual Components (e.g. front, back, sleeve). It must allow for
--      different Construction values (consumption rates) for each part, as a
--      sleeve might use less thread than the front of the garment."
--
--
-- ## THIS REVERSES PART OF 0423, AND ONLY THE PART WHOSE PREMISE EXPIRED
--
-- 0423 added `material_bom_amendment_items.component_id` and DELIBERATELY made
-- it descriptive, rejecting a component axis in these words:
--
--     "you need ONE collar interlining per garment whichever panel it is cut
--      for, so splitting by panel would multiply the rows without changing the
--      total, and every extra row would then have to be reconciled against a
--      quantity that never differed."
--
-- That is correct for interlining and FALSE FOR THREAD. A sleeve seam is shorter
-- than a front seam, so the rate genuinely differs by panel — the premise, not
-- the reasoning, is what fails. So the axis is added as an OPT-IN PER LINE
-- rather than as a fifth `requirement_basis`:
--
--   * a line that names a single `component_id` and enters one ratio behaves
--     EXACTLY as it does today, and no existing row changes meaning;
--   * a line that enters component rows here takes its ratio from them instead.
--
-- Making it a basis would have forced every line onto the choice, which is the
-- multiplication 0423 was right to refuse.
--
--
-- ## A COMPONENT STILL NEVER REACHES A REQUIREMENT ROW. A COLOUR NOW DOES.
--
-- 0423's assertion survives intact and is re-asserted at the bottom of this
-- file: `material_bom_amendment_requirements` gains no component column. You do
-- not buy sleeve-thread and front-thread; you buy thread. The panels are how the
-- consumption rate is ARRIVED AT, and they sum away once it has been.
--
-- What does not sum away is COLOUR. White on the front and navy on the sleeve
-- are two different things to buy, so the requirement splits by trim colour and
-- `item_color_id` is added to the requirements table (client 2026-08-19).
--
-- IT WAS ALREADY SHOWN AND NEVER STORED — the Requirement tab computes an "Item
-- Color" column in `colourOf` (mba-master-screen.tsx) and throws it away on
-- save. So a purchase order has, until now, been checked against a quantity with
-- no colour attached to it. That gap is harmless while one line means one
-- colour, and becomes a wrong purchase the moment this table has two rows of
-- different colours under one line.
--
--
-- ## WHY `components` (0228) AND NOT `garment_style_components`
--
-- The same call 0423 and 0421 both made, for the same reason: a style's
-- component rows are rewritten wholesale on every save of the Style master, so
-- their ids are not stable, while a master row persists. Narrowing the picker to
-- THIS style's panels is the screen's job, per the cascading-picker rule.
-- ============================================================================


-- ---------- 1. the per-panel construction rows -----------------------------

create table if not exists public.material_bom_amendment_item_components (
  id            uuid primary key default gen_random_uuid(),
  item_line_id  uuid not null
                references public.material_bom_amendment_items(id) on delete cascade,
  sno           int  not null default 0,
  -- The panel. NOT NULL: a row that names no panel is the line's own ratio,
  -- which already has a home on the line itself.
  component_id  uuid not null references public.components(id),
  -- The trim's colour ON THIS PANEL. NULL means "the line's own Item Color" —
  -- the ordinary case, where the parts differ only in how much they consume.
  item_color_id uuid references public.config_lookups(id),
  -- The SAME numerator/divisor pair the line carries, and deliberately the same
  -- names: `requirement.ts` reads one shape whether the ratio came from the line
  -- or from a panel, so there is one arithmetic and not two.
  no_of_items   numeric(14,3) not null,
  per_pieces    numeric(14,3) not null,
  created_at    timestamptz not null default now(),
  -- A DIVISOR OF ZERO IS NOT A RATE. 0418 keeps `per_pieces` un-defaulted on the
  -- line for the same reason: an unfinished row must not compute a number that
  -- reaches a purchase order.
  constraint chk_mba_item_comp_per_pieces check (per_pieces > 0),
  constraint chk_mba_item_comp_no_of_items check (no_of_items >= 0)
);

-- ONE ROW PER PANEL PER COLOUR. The same panel twice in one colour is a data
-- entry slip that would silently double the line's rate; the same panel in two
-- colours is legitimate (a contrast-stitched cuff).
create unique index if not exists uq_mba_item_comp_line_panel_colour
  on public.material_bom_amendment_item_components (
    item_line_id, component_id, coalesce(item_color_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists idx_mba_item_comp_line
  on public.material_bom_amendment_item_components(item_line_id);

comment on table public.material_bom_amendment_item_components is
  'Per-panel construction for one Material BOM line — the Combination sheet (client 2026-08-19). OPT-IN: a line with no rows here uses its own no_of_items/per_pieces, exactly as before. Reverses the narrow part of 0423 whose premise expired; see this migration''s header.';
comment on column public.material_bom_amendment_item_components.item_color_id is
  'The trim colour on THIS panel. NULL means the line''s own Item Color. Two colours under one line become two requirement rows — you buy white thread and navy thread separately.';
comment on column public.material_bom_amendment_item_components.per_pieces is
  'The DIVISOR, same meaning as on the line. CHECKed > 0: never defaulted to 1, per 0418.';


-- ---------- 2. the requirement row learns its trim colour ------------------

alter table public.material_bom_amendment_requirements
  add column if not exists item_color_id uuid references public.config_lookups(id);

comment on column public.material_bom_amendment_requirements.item_color_id is
  'The TRIM''s own colour (kind fabric_color) — not the garment combo, which is the `combo` column beside it. Shown on the Requirement tab since 0418 and stored only from 0436: without it a two-colour line produces two identical-looking rows and a purchase order has no colour to be checked against.';


-- ---------- 3. RLS (0265's block, verbatim) --------------------------------

do $rls$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'material_bom_amendment_item_components'
  ) then
    execute $f$
      create policy material_bom_amendment_item_components_read on public.material_bom_amendment_item_components
        for select to authenticated using (public.has_permission('orders','view'));
      create policy material_bom_amendment_item_components_insert on public.material_bom_amendment_item_components
        for insert to authenticated with check (public.has_permission('orders','create'));
      create policy material_bom_amendment_item_components_update on public.material_bom_amendment_item_components
        for update to authenticated using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy material_bom_amendment_item_components_delete on public.material_bom_amendment_item_components
        for delete to authenticated using (public.has_permission('orders','delete'));
    $f$;
  end if;
end $rls$;

alter table public.material_bom_amendment_item_components enable row level security;


-- ---------- 4. assertions ---------------------------------------------------
--
-- VERIFY FROM THE CATALOG, NEVER BY READING THE MIGRATION. AGENTS.md records why
-- under "Function grants": a migration that applies cleanly and reports
-- {"success": true} has proved that the SQL ran, not that it achieved its stated
-- goal — 0386 asserted its own success and shipped a no-op.

do $assert$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_item_components'
  ) then
    raise exception '0436: material_bom_amendment_item_components was not created';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_requirements'
       and column_name  = 'item_color_id'
  ) then
    raise exception '0436: requirements.item_color_id was not added';
  end if;

  -- 0423'S RULE, RE-ASSERTED RATHER THAN INHERITED. Its own assertion block
  -- cannot speak for a migration written after it, and this is the boundary the
  -- header spends its length on: panels arrive at the rate, colours survive into
  -- the purchase. The day a component column appears on a requirement row, the
  -- reasoning above has been abandoned and this line is what says so.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_requirements'
       and column_name  = 'component_id'
  ) then
    raise exception '0436: a requirement row must not carry a component — see 0423 and this migration''s header';
  end if;

  -- The opt-in half. A NOT NULL default here would make every existing line
  -- claim a construction it never had.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_item_components'
       and column_name  = 'component_id'
       and is_nullable  = 'YES'
  ) then
    raise exception '0436: component_id must be NOT NULL — a panel row with no panel is the line''s own ratio';
  end if;
end $assert$;
