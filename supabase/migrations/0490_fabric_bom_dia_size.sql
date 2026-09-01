-- ============================================================================
-- Raagam ERP — 0490 Fabric BOM ▸ Color/Print Details ▸ Dia / Size / Width
--
-- The legacy "Prepare fabric BOM for Garment order" screen carries a
-- Color/Print Details tab of FOUR panels (client screenshot 2577): Yarn Dyeing,
-- Fabric Dyeing, Print (Roll Form Prints) and Dia / Size Width Details. The
-- client asked for that tab on our Fabric BOM screen, minus the legacy Style
-- Detail tree beside it ("in this screen in our application no need the style
-- details section", 2026-09-01).
--
--
-- THIS MIGRATION IS ONE PANEL OF THE FOUR, AND THAT IS THE WHOLE DESIGN
--
-- Three of the four are ALREADY DECLARED, on the garment order this BOM is
-- keyed to:
--
--   · Yarn Dyeing and Fabric Dyeing → `garment_order_amendment_dyeings`
--     (`section` = 'yarn' | 'fabric', with `dye_type` and `color_name`)
--   · Roll form prints             → `garment_order_amendment_prints`
--
-- `order_fabric_boms.garment_order_id` is NOT NULL and is the only mandatory
-- field the header has (0426: "a BOM with no order is not an incomplete record
-- — it is a document with no arithmetic"), so exactly one order's palette is
-- reachable from any BOM. Copying those three onto the BOM would be a SECOND
-- copy of a list the order already owns, free to drift from it — the failure
-- this repo has now recorded three times (the `created_by` sweep, the
-- cascade-filter sweep, and `lib/reports/catalog.ts`'s two hand-edited literals)
-- — and it is duplicate data entry, which this client complains about by name
-- ("should flow into this tab automatically to avoid duplicate data entry").
-- So the screen READS them and does not store them, and no table appears here
-- for them.
--
-- DIA IS THE ONE THE ORDER CANNOT ANSWER. Nothing on the garment order states a
-- knitting diameter or a woven width: the order describes the CLOTH (structure,
-- composition, GSM, solid/melange/yarn-dyed) and dia is a property of how that
-- cloth is MADE. Today the only dia in the system is
-- `order_fabric_bom_lines.dia`, hand-typed per line against no vocabulary at
-- all — which is why two lines of one fabric can read 60 and 30 with nothing to
-- say which is meant. This table is that vocabulary.
--
--
-- WHY A CHILD TABLE AND NOT A COLUMN ON THE HEADER
--
-- One BOM legitimately covers several dias: a body knitted at 60" open-width
-- and a rib at 30" tubular is one garment and one BOM. The legacy panel is a
-- GRID for that reason, and its screenshot shows a second row being added under
-- an existing Circular / 60.
--
--
-- `knit_type` IS TEXT WITH A CHECK, NOT AN FK TO `config_lookups`
--
-- The three answers are the `fabric_structure` lookup kind's own codes —
-- `circular` / `flat_knit` / `woven` — reused VERBATIM so that
-- `isCircularKnit()` in `lib/orders/amendments/combo-rules.ts` reads a stored
-- value here without a translation. Text rather than a uuid for the reason
-- `order_fabric_bom_lines.fabric_type` and `.requirement_basis` are both text
-- in 0426: this is a fixed three-value vocabulary, not a master someone
-- maintains, and an FK would let a deleted lookup row take a stored dia with it.
--
-- NULLABLE, LIKE EVERY OTHER CELL IN THIS MODULE. A half-filled grid row is how
-- an operator works; `dias` with nothing in them are dropped before insert
-- (`diaFilled` in actions.ts), which is the same rule `structureFilled` states
-- for the order's combo tree.
--
--
-- `dia` IS numeric(10,2), MATCHING THE TWO PLACES A WIDTH IS ALREADY STORED
--
-- `order_fabric_bom_lines.dia` (0426) and `order_cad_markers`' "Dia / Width
-- (வித்)" (0460) are both numeric, and this list is what the LINE's cell should
-- come to pick from — a text column here would make that comparison a string
-- match. It costs the ability to write "36 x 44"; a woven width that needs two
-- numbers is two rows, which is what the grid is for.
--
--
-- WHAT THIS DOES NOT DO YET, STATED SO THE COMMENTS ABOVE ARE NOT READ AS A
-- DESCRIPTION OF TODAY
--
-- `order_fabric_bom_lines.dia` is STILL A FREE NUMBER. This table declares the
-- vocabulary; wiring the line's cell to pick from it is a separate change and
-- was not asked for, so the line grid is untouched and an operator can still
-- type a dia no row here mentions. The table comment's "the vocabulary the
-- line-level dia is meant to pick from" states the intent behind the shape --
-- numeric rather than text, a grid rather than a header column -- not a
-- constraint that exists. Nothing enforces agreement between the two, and
-- nothing should until the client asks for the cell to change.
--
--
-- NO `location_id`, DELIBERATELY. `order_fabric_boms` carries it and its
-- policies narrow on `is_current_location()`; `order_fabric_bom_lines` and
-- `_requirements` carry neither and are reached only through that parent. This
-- table is a third child of the same parent and follows them exactly — adding a
-- location here would be a second answer to "which unit is this BOM" that
-- nothing keeps in step with the first.
-- ============================================================================

create table if not exists public.order_fabric_bom_dias (
  id          uuid primary key default gen_random_uuid(),
  bom_id      uuid not null references public.order_fabric_boms(id) on delete cascade,
  sno         integer not null default 0,
  knit_type   text check (knit_type in ('circular','flat_knit','woven')),
  dia         numeric(10,2),
  created_at  timestamptz not null default now()
);

create index if not exists idx_fabric_bom_dia_parent
  on public.order_fabric_bom_dias(bom_id);

comment on table public.order_fabric_bom_dias is
  'Fabric BOM ▸ Color/Print Details ▸ Dia / Size Width Details (0490). The '
  'knitting diameters and woven widths this BOM covers — the vocabulary the '
  'line-level `dia` is meant to pick from. The tab''s other three panels (yarn '
  'dyeing, fabric dyeing, roll form prints) are READ from the garment order '
  'and deliberately not copied here.';

comment on column public.order_fabric_bom_dias.knit_type is
  'circular | flat_knit | woven — the `fabric_structure` lookup kind''s own '
  'codes, reused verbatim so isCircularKnit() reads this value untranslated.';

comment on column public.order_fabric_bom_dias.dia is
  'Diameter for a circular knit, width for a flat knit or a woven. numeric to '
  'match order_fabric_bom_lines.dia and order_cad_markers.dia_width, which is '
  'what lets a line cite one of these rows rather than string-match it.';

-- ---------- RLS — the child shape, copied from 0426's own loop ---------------
do $rls$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_fabric_bom_dias'
  ) then
    create policy order_fabric_bom_dias_read on public.order_fabric_bom_dias
      for select to authenticated using (public.has_permission('orders','view'));
    create policy order_fabric_bom_dias_insert on public.order_fabric_bom_dias
      for insert to authenticated with check (public.has_permission('orders','create'));
    create policy order_fabric_bom_dias_update on public.order_fabric_bom_dias
      for update to authenticated using (public.has_permission('orders','edit'))
      with check (public.has_permission('orders','edit'));
    create policy order_fabric_bom_dias_delete on public.order_fabric_bom_dias
      for delete to authenticated using (public.has_permission('orders','delete'));
  end if;
end $rls$;

alter table public.order_fabric_bom_dias enable row level security;
