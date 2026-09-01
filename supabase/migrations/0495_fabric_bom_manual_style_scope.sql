-- ============================================================================
-- Raagam ERP — 0495 Fabric BOM ▸ Manual — the STYLE level, and TableWidth
--
-- The client's field-by-field spec for the Manual tab (2026-09-01) adds a level
-- above the entry and settles what the calculated mode multiplies. Additive
-- only: 0494's three tables keep their shape, and every table involved still
-- holds ZERO rows (verified from the catalog before this ran), which is what
-- makes the one RENAME below free.
--
--
-- 1. THE STYLE LEVEL — `style_ref_no` ON THE ENTRY
--
-- Legacy 2586 is three levels deep and 0494 built the lower two:
--
--     style     S No · StyleRefNo · StyleNo · ArticleNo      <- this migration
--       fabric  structure · components · dia · loss %        <- 0494
--         size  dia · purchase width · grams                 <- 0494
--
-- The spec's "Header Section (Style Details)" is that first level, and 0494
-- collapsed it: its entries were UNSCOPED and applied to every style on the
-- order. On a single-style order the two are identical, which is exactly why the
-- omission was invisible.
--
-- BY VALUE, NEVER BY FK, like every style reference in this module
-- (`order_fabric_bom_lines.style_ref_no`, `order_cad_marker_layouts.style_ref_no`,
-- 0407 · 0421 · 0460). `garment_order_amendment_styles` is deleted and
-- reinserted on every save of the order, so its ids are rewritten and an FK
-- would dangle.
--
-- NULLABLE, AND NULL IS A VALUE: "every style on this order". That is the same
-- reading `order_fabric_bom_lines.style_ref_no` has carried since 0426, and it
-- is what every entry stored under 0494 already means — so this column arrives
-- without changing the meaning of a single existing row.
--
-- ## IT ALSO FIXES A RULE 0494 COULD ONLY APOLOGISE FOR
--
-- 0494's header records an unease about the "no duplicate component allocation"
-- rule: it could not be a `unique (bom_id, component_id)` constraint, because
-- "one BOM covers several styles, and FRONT BODY of a tee and FRONT BODY of a
-- polo are two panels wearing one master row". With the entry scoped to a style
-- that stops being an awkward exception and becomes the rule's natural grain —
-- a panel is used once PER STYLE. The enforcement stays in the dropdown for the
-- reason it always was (a constraint would refuse an intermediate state the
-- planner passes through), but it now refuses the right thing.
--
--
-- 2. `width` BECOMES `table_width`, AND THE DISTINCTION IS THE CLIENT'S
--
-- The spec separates two measurements that 0494 conflated under one word:
--
--     Width (Dia)   the fabric ROLL diameter or finished width — 60 dia, 52
--                   dia. A technical CONSTRAINT: it says the panels must
--                   physically fit across the roll. Already stored as `dia`,
--                   and already picked from the dias the BOM declares (0490).
--     TableWidth    the PANEL width of the cut component, as laid on the
--                   cutting table. Typed by the planner, and the figure the
--                   weight is computed from.
--
-- 0494 called the second one `width`, which reads as a synonym of the first.
-- Renamed rather than left alone: two columns whose names do not distinguish
-- them is how a later reader multiplies by the roll diameter and gets a plausible
-- number that is wrong by a factor of three.
--
-- FREE, BECAUSE THE TABLE IS EMPTY. A rename on a populated table would want a
-- copy-and-backfill; here the catalog says 0 rows, which is the same freedom
-- 0404 / 0408 / 0430 / 0434 all took and the reason this is one statement.
--
--
-- 3. `width_form` — OPEN WIDTH vs TUBULAR
--
-- The spec's "Open Width / Tubular (Assort Widths): specifies the physical state
-- of the fabric". A property of the ENTRY and not of a size: a fabric is knitted
-- tubular or slit open, and that does not change between an S and an XL.
--
-- TEXT WITH A CHECK, not an FK — two fixed answers the business does not add to
-- are a constraint, not a master. The same trade `calc_mode` beside it makes,
-- and `FABRIC_TYPE_OPTIONS` / `KNIT_TYPE_OPTIONS` before it.
--
-- NULLABLE, unlike `calc_mode`. A mode is always one of two things and the
-- planner is always doing one of them; the physical form is a fact about the
-- cloth that an entry may legitimately not have been told yet, and defaulting it
-- would put an unasked answer in front of the knitting programme.
--
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT ADD
--
-- The spec also lists `Calculated Length`, `Conv Tolerance` and `Tolerance
-- Length` as calculated-mode inputs. They are NOT here, on the client's own
-- instruction: "the exact conversion constants for this formula will be adjusted
-- and verified in a later discussion … leaving these length and weight
-- calculation columns for the very end of your sprint is the perfect approach."
-- Adding three numeric columns now would be three cells the planner can fill and
-- nothing reads — the "stated but not enforced" shape this repo files by name.
-- `length` and `length_tolerance` (0494) already carry the calculated mode, and
-- the formula constant lives in one place in `lib/orders/fabric-bom/manual.ts`
-- so the later adjustment is a one-line change rather than a migration.
--
-- Four more spec fields need NO storage at all and get none: GSM, Dia Type
-- (Circular / Flat / Woven), Assort-wise Colour and Component Unit are all
-- derivable from the order or from the dias this BOM already declares. Copying
-- them here would be a second place for them to disagree with their source —
-- the argument 0426 makes for the seed, 0490 for the palette and 0494 for the
-- entry's own fabric.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The style an entry is for. NULL = every style on the order.
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_manual_entries
  add column if not exists style_ref_no text;

create index if not exists idx_ofbme_style
  on public.order_fabric_bom_manual_entries(bom_id, style_ref_no);

comment on column public.order_fabric_bom_manual_entries.style_ref_no is
  'Which style this weight entry is for; NULL = every style on the order. BY '
  'VALUE, never by FK — garment_order_amendment_styles is deleted and '
  'reinserted on every save of the order (0407 · 0421). It is also the grain the '
  '"no duplicate component allocation" rule wants: a panel is used once per '
  'STYLE, so FRONT BODY may appear on a tee and on a polo.';


-- ---------------------------------------------------------------------------
-- 2. The physical state of the cloth.
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_manual_entries
  add column if not exists width_form text;

do $wf$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_ofbme_width_form'
      and conrelid = 'public.order_fabric_bom_manual_entries'::regclass
  ) then
    alter table public.order_fabric_bom_manual_entries
      add constraint chk_ofbme_width_form
      check (width_form is null or width_form in ('open_width', 'tubular'));
  end if;
end $wf$;

comment on column public.order_fabric_bom_manual_entries.width_form is
  'open_width | tubular — the spec''s "Open Width / Tubular (Assort Widths)". A '
  'property of the ENTRY, not of a size: a fabric is knitted tubular or slit '
  'open, and that does not change between an S and an XL. Nullable, unlike '
  'calc_mode: an entry may legitimately not have been told yet.';


-- ---------------------------------------------------------------------------
-- 3. `width` -> `table_width`. See the header for why the two are not synonyms.
-- ---------------------------------------------------------------------------
do $tw$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_fabric_bom_manual_sizes'
      and column_name = 'width'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_fabric_bom_manual_sizes'
      and column_name = 'table_width'
  ) then
    alter table public.order_fabric_bom_manual_sizes
      rename column width to table_width;
  end if;
end $tw$;

comment on column public.order_fabric_bom_manual_sizes.table_width is
  'The PANEL width of the cut component, as laid on the cutting table — typed by '
  'the planner, and the figure the calculated weight multiplies. NOT `dia`, '
  'which is the fabric roll''s own diameter and is a constraint rather than an '
  'input. Renamed from `width` by 0495 because the two words did not '
  'distinguish them.';

comment on column public.order_fabric_bom_manual_sizes.dia is
  'The fabric roll diameter / finished width this size is knitted at — 60 dia, '
  '52 dia. A technical CONSTRAINT (the panels must fit across the roll), picked '
  'from the dias the BOM declares on Color/Print Details (0490). The weight is '
  'computed from `table_width`, never from this.';
