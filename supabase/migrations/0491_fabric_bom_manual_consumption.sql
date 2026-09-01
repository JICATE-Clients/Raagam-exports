-- ============================================================================
-- Raagam ERP — 0491 Fabric BOM ▸ Manual (size-wise consumption)
--
-- The legacy "Prepare fabric BOM for Garment order" screen carries a **Manual**
-- tab headed "Manual Consumptions" (client screenshot 2586). It is a THREE-LEVEL
-- tree:
--
--   1. style      S No · StyleRefNo · StyleNo · ArticleNo
--   2. fabric     S No · Fabric · Type · Gsm · Type · Calculated · Measurement
--                 Unit · Assort Color wise · EndBit Loss % · Component Proc
--                 Loss % · [Components] · [Assort Color] · [Widths]
--   3. size       S No · Size · TableWidth · Width · Length · Length Tolerance ·
--                 Length · Calculated Wt · Cons Qty · Cons Wt · Conv. Item
--
-- and it is the MANUAL alternative to the measured route this app already has:
-- `seedConsumptionFor` (0460, lib/orders/cad/weights.ts) takes a CAD marker's
-- panel weight in grams and fills a Fabric BOM line's consumption from it. Where
-- there is no marker — a repeat style, a sample, a fabric CAD never laid — the
-- merchandiser works the consumption out by hand from the panel measurements.
-- That working is what this tab is, and what this migration stores.
--
--
-- ONLY LEVEL 3 IS NEW, AND ESTABLISHING THAT IS MOST OF THE DESIGN
--
-- Levels 1 and 2 are `order_fabric_bom_lines` (0426), which is already keyed on
-- exactly the four things legacy spreads over two levels — style, colourway,
-- structure, panel — and already carries the fabric, its type and its unit. Two
-- more of legacy's level-2 cells are ours under other names:
--
--   · "Assort Color wise"  is  `requirement_basis` ('colour' | 'colour_size').
--     One checkbox and one two-value column stating the same fact would be two
--     places for a BOM to disagree with itself about how it splits.
--   · "Gsm"                is  `garment_order_amendment_combo_structures.gsm`,
--     READ from the order. 0426's seed deliberately does not copy GSM onto the
--     line ("a copy on the BOM line is a second place for them to disagree with
--     the order, and the order is the one that is right"), and that call is not
--     reopened here — the Manual tab reads it through `getOrderFabricSeed`.
--
-- So the only genuinely new grain is the SIZE row, and it gets the only new
-- table.
--
--
-- TWO LEGACY COLUMNS ARE DELIBERATELY NOT BUILT
--
-- **"Component Proc Loss %"** is a process loss, and 0426 refuses one here in as
-- many words: `wastage_pct` "is the CUTTING room's buffer. NOT process loss —
-- that is step 4, and applying it here as well charges the same loss twice."
-- Knitting, dyeing, stentering and compacting losses are the Fabric Plan's
-- (step 4, 0427). A column here that multiplied would double-charge them; a
-- column here that did not would be a control the operator sets and nothing
-- reads — which is the failure this repo files under "stated but not enforced".
--
-- **"EndBit Loss %"** is the unusable tail of a roll, which is a CUTTING-room
-- loss and is therefore the buffer `wastage_pct` already is. A second cutting
-- percentage beside the first invites an operator to enter the same allowance
-- twice and multiplies it once.
--
-- Neither is lost information: both are percentages, and the one place each
-- belongs already exists. If the client asks for them by name, the answer is a
-- RENAME or a split of `wastage_pct` — not a third and fourth percentage on a
-- line that already multiplies one.
--
--
-- "Cons Wt" AND "Conv. Item" ARE ONE COLUMN HERE, FOR THE REASON 0426 GIVES
--
-- Legacy carries a quantity, a weight and a conversion item because its line has
-- no unit of its own. Ours does: `consumption_uom_id` says what
-- `order_fabric_bom_lines.consumption` is measured in, and `lib/uom/convert.ts`
-- converts. So one `cons_qty` per size, in the LINE's unit, is the whole of it —
-- and a second stored figure in a different unit is a rounding disagreement
-- waiting to be discovered by whichever screen reads the other one.
--
--
-- `consumption_mode` — WHICH FIGURE THE REQUIREMENT MULTIPLIES
--
-- Legacy's level-2 "Calculated" dropdown reads **Direct** in the screenshot, and
-- that is what it names: whether the consumption is taken directly or is
-- calculated from the size table beneath it. It is the switch that decides which
-- of two numbers is real, so it is a column and not a convention.
--
--   'direct'  the line's own `consumption` — today's behaviour, unchanged, and
--             the DEFAULT so that every one of the existing rows keeps meaning
--             exactly what it meant before this migration.
--   'manual'  the per-size `cons_qty` rows below.
--
-- **A 'manual' LINE MUST SPLIT BY COLOUR + SIZE.** Size-wise consumption states
-- a different figure per size, and a requirement that does not carry a size axis
-- has nowhere to put them — rolling them up to one average silently invents a
-- number nobody typed. The engine refuses that combination by name
-- (`fabricRequirementFor`, requirement.ts), the screen gates Save on it, and
-- both say the same sentence. No CHECK constraint enforces it here because the
-- two columns can be edited in either order and a constraint would refuse the
-- intermediate state an operator passes through.
--
--
-- WHY `size_id` IS NULLABLE ON A TABLE WHOSE WHOLE POINT IS THE SIZE
--
-- Every other cell in this module is nullable because a grid row is filled left
-- to right and a half-filled row is how an operator works. This one is nullable
-- for a sharper reason: the size rows are not typed at all — they are DERIVED
-- from the order's own approval quantities (`fabricSlices('colour_size', …)`),
-- so a row exists because the order has that size. A NOT NULL would turn "the
-- order was amended and a size went away" into a 23502 on the next save of a
-- document the operator did not change.
--
-- `nulls not distinct` on the unique index for the same reason it carries there
-- on `uq_occw_panel` (0460): under the default, an unnamed size could be stored
-- unlimited times, and two rows for one size are two consumptions of which the
-- requirement would silently take one.
--
--
-- THE MEASUREMENT COLUMNS ARE THE OPERATOR'S WORKING, AND ONE OF THEM COMPUTES
--
--   width, length, length_tolerance  the panel, in centimetres
--   table_width                      the roll / table width the panel is cut
--                                    from — the vocabulary declared by 0490's
--                                    `order_fabric_bom_dias`, so the Manual tab
--                                    picks from the same list the line's Dia
--                                    cell picks from rather than inventing a
--                                    second one
--
-- `lib/orders/fabric-bom/manual.ts` computes, from those and the order's GSM:
--
--   effective length = length + length_tolerance
--   calculated wt    = 2 x width x effective length x gsm / 10,000,000   (kg)
--
-- the x2 being front and back panel. **THE COMPUTED WEIGHT IS NOT STORED AND
-- DOES NOT DRIVE ANYTHING.** It is an offer: the operator reads it and types
-- `cons_qty`, which is the figure the requirement multiplies. That division is
-- deliberate and it is the same one 0426 draws between `consumption` and the
-- requirement rows — a derived figure that quietly became the purchase quantity
-- would make a formula this migration inferred from a screenshot into a
-- commitment nobody approved. Storing it would additionally make it a second
-- copy of the GSM, free to drift from the order the way every copy in this
-- module is documented as doing.
--
--
-- NO `location_id`, and no `created_by`. This is a grandchild of
-- `order_fabric_boms`, reached only through its parent, exactly as
-- `order_fabric_bom_requirements` and `order_fabric_bom_dias` are — see 0490's
-- header for the argument, which applies here unchanged.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The switch: which consumption figure this line's requirement multiplies.
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_lines
  add column if not exists consumption_mode text not null default 'direct';

do $mode$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_ofbl_consumption_mode'
      and conrelid = 'public.order_fabric_bom_lines'::regclass
  ) then
    alter table public.order_fabric_bom_lines
      add constraint chk_ofbl_consumption_mode
      check (consumption_mode in ('direct', 'manual'));
  end if;
end $mode$;

comment on column public.order_fabric_bom_lines.consumption_mode is
  'direct | manual (0491). ''direct'' multiplies this line''s own `consumption`; '
  '''manual'' multiplies the per-size `cons_qty` on order_fabric_bom_line_sizes, '
  'and requires requirement_basis = ''colour_size'' — enforced by the engine and '
  'the screen rather than by a CHECK, because the two columns are edited in '
  'either order. DEFAULT ''direct'' so every pre-0491 row keeps its meaning.';


-- ---------------------------------------------------------------------------
-- 2. The size row — legacy's third level, and the only new grain.
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_line_sizes (
  id               uuid primary key default gen_random_uuid(),
  line_id          uuid not null
                     references public.order_fabric_bom_lines(id) on delete cascade,
  sno              integer not null default 0,

  -- The order's own size, from `config_lookups` — the SAME target
  -- `order_fabric_bom_requirements.size_id` (0426) points at, so a manual row
  -- and the requirement row it feeds name one size by one id. Nullable: see the
  -- header.
  size_id          uuid references public.config_lookups(id),

  -- The roll / table width the panel is cut from. numeric(10,2) to match
  -- `order_fabric_bom_lines.dia`, `order_fabric_bom_dias.dia` and
  -- `order_cad_marker_layouts.dia` — the four places a fabric width is stored in
  -- this schema, deliberately one type so a value can be compared rather than
  -- string-matched.
  table_width      numeric(10,2),

  -- The panel, in centimetres. Nullable like every cell in this module; a row
  -- with measurements and no cons_qty is an operator mid-calculation.
  width            numeric(10,2),
  length           numeric(10,2),
  length_tolerance numeric(10,2),

  -- THE FIGURE THE REQUIREMENT MULTIPLIES, in the LINE's `consumption_uom_id`.
  -- numeric(14,4) is `order_fabric_bom_lines.consumption`'s own type: this
  -- stands in for it on a 'manual' line, so a narrower type here would silently
  -- round a consumption that the direct route stores in full.
  cons_qty         numeric(14,4),

  created_at       timestamptz not null default now()
);

create index if not exists idx_ofbls_line
  on public.order_fabric_bom_line_sizes(line_id);

-- ONE ROW PER SIZE PER LINE. Two rows are two consumptions for one size, of
-- which the requirement would take one and report nothing about the other.
-- `nulls not distinct` (PG 15+; this database is 17.6) is what makes that true
-- of an unnamed size as well — see the header.
create unique index if not exists uq_ofbls_line_size
  on public.order_fabric_bom_line_sizes(line_id, size_id)
  nulls not distinct;

comment on table public.order_fabric_bom_line_sizes is
  'Fabric BOM ▸ Manual (0491) — the legacy Manual Consumptions tab''s third '
  'level: one row per size of one fabric line, carrying the panel measurements '
  'the merchandiser worked from and the consumption they arrived at. Read by '
  'the requirement engine only while the line''s consumption_mode is ''manual''.';

comment on column public.order_fabric_bom_line_sizes.table_width is
  'The roll / table width this panel is cut from — picked from the dias the BOM '
  'declares on Color/Print Details (order_fabric_bom_dias, 0490) rather than a '
  'second vocabulary of its own.';

comment on column public.order_fabric_bom_line_sizes.cons_qty is
  'Consumption for this size, in the LINE''s consumption_uom_id. The computed '
  'weight (2 x width x effective length x gsm / 1e7) is shown beside it and is '
  'deliberately NOT stored: it is an offer the operator accepts by typing here.';


-- ---------------------------------------------------------------------------
-- 3. RLS — the child shape, the same four policies every sibling carries.
-- ---------------------------------------------------------------------------
do $rls$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_fabric_bom_line_sizes'
  ) then
    create policy order_fabric_bom_line_sizes_read on public.order_fabric_bom_line_sizes
      for select to authenticated using (public.has_permission('orders','view'));
    create policy order_fabric_bom_line_sizes_insert on public.order_fabric_bom_line_sizes
      for insert to authenticated with check (public.has_permission('orders','create'));
    create policy order_fabric_bom_line_sizes_update on public.order_fabric_bom_line_sizes
      for update to authenticated using (public.has_permission('orders','edit'))
      with check (public.has_permission('orders','edit'));
    create policy order_fabric_bom_line_sizes_delete on public.order_fabric_bom_line_sizes
      for delete to authenticated using (public.has_permission('orders','delete'));
  end if;
end $rls$;

alter table public.order_fabric_bom_line_sizes enable row level security;
