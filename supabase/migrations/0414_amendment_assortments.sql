-- ============================================================================
-- Raagam ERP — 0414 Garment Order Amendment ▸ Quantities ▸ Assortments
--
-- The legacy Quantities grid's `Assort [Click]` opens a screen of its own
-- (operator screenshot 2026-08-12, 11:27) that says how a shipment is PACKED:
-- per combo, how many cartons, and the size ratio inside one carton.
--
--   Country CN   Pack ___   Assortment Type SC-AS   Style TS BA MC ATROSE OC
--   Qty 0        Delivery Dt 12-08-2026   Style Ref No 00088/2627/C  Ratio [Yes]
--   ( ) Single Style  ( ) Multiple Style               Ratio For [    ]
--
--     StyleRefNo │ Style │ Combo │ NoOf Cartons │ 10A │ xxs │ XS │ S │ M │ PcsPerPack
--
--                            Ratio Total  0        Total Qty  0
--     Master CTN Name ___  Inner CTN Name ___  Pack Description ___   [Update]
--
-- It was deferred on purpose and the deferral said how to close it — 0398's
-- header: "`Assort` opens a size breakdown and is deliberately NOT built here
-- (client 2026-08-11) — the 11 visible columns first", and the screen's own
-- comment: "the table and its Zod type carry no trace of it, so adding it later
-- is additive." This is that addition.
--
--
-- 1. NO ASSORTMENT HEADER TABLE — THE QUANTITY ROW *IS* THE HEADER
--
-- Every field in the overlay's top band is either already on
-- `garment_order_amendment_quantities` (Country, Style Ref No, Style No,
-- Assortment Type, Qty, Delivery Dt — all rendered read-only, carried in) or is
-- one-to-one with it. A separate header table would be a second row that can
-- only ever have exactly one match, plus a join to keep them in step.
--
-- Safe to widen: the table holds 0 rows, read from the catalog before this was
-- written.
--
-- THIS DOES NOT REVERSE THE 2026-08-10 REMOVAL of Master Carton / Inner Carton /
-- Pack Description. Those were withdrawn from the amendment HEADER, where they
-- were one answer for a whole order; legacy asks them per ASSORTMENT, which is
-- what a quantity row is. Same words, different scope — and the earlier removal
-- is what made room for this to be the right place.
--
--
-- 2. SIZES ARE ROWS, NOT SIXTEEN COLUMNS
--
-- The order side (0328) stores `size1_qty … size16_qty` on
-- `order_pack_ratio_lines` plus `order_pack_ratio_size_labels`, a per-pack-ratio
-- legend saying what position N means. Deliberately NOT mirrored, on three
-- grounds and the operator's own instruction (2026-08-12):
--
--   * That legend table has ZERO readers and ZERO writers in the codebase. The
--     one screen that touches pack ratios hardcodes eight labels and can reach
--     only `size1..size8`; positions 9-16 are unreachable from any UI. It is an
--     abandoned design, not a proven one.
--   * "Why 16" was never written down. 0328 is an early, terse migration whose
--     entire commentary on the model is "Size1-16 columns per combo/style".
--   * Every recent amendment child is row-per-item with a lookup FK — 0407
--     style sizes, 0413 approval combos. Importing the wide model would move
--     this table away from its own family for no gain.
--
-- The size a row names is `config_lookups` kind 'size' — the SAME rows 0407
-- already stores per order line, which is what lets the grid's columns be the
-- style's own sizes rather than a fixed sixteen.
--
--
-- 3. `pcs_per_pack` GETS NO COLUMN
--
-- It is the sum of the line's size cells — the pieces in one carton — so a
-- column for it would be a second source of truth for an addition. Same rule
-- `gsmRange` follows on the Combos overlay (0408), and the same reason Order
-- Unit is derived on the Style(s) tab. The rest of the arithmetic is derived
-- too (operator 2026-08-12): Line Qty = NoOf Cartons × Ratio Total, and
-- Total Qty = the sum of those.
--
-- `no_of_cartons` IS stored, because it is typed and derivable from nothing.
--
--
-- 4. `combo` IS TEXT, BY VALUE
--
-- Unchanged from 0407, 0411 and 0413: `writeChildren` deletes and reinserts
-- every child grid wholesale, so `garment_order_amendment_combos.id` is a new
-- uuid after each save and an FK to it would dangle. Nothing parses the string.
--
-- The LINE's parent is a real FK, and that is not a contradiction: a line hangs
-- off the quantity row by uuid because `writeAssortTree` inserts it inside the
-- same save, having just read the id back — exactly as `writeComboTree` does.
-- A cross-GRID reference is by value; a within-tree one is by id.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The quantity row gains the assortment's own header fields.
--
-- All nullable or defaulted: the table is empty today but a NOT NULL without a
-- default would reject the rows the screen writes for a quantity line that has
-- no assortment at all, which is the normal case.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_quantities
  add column if not exists pack                 text,
  add column if not exists is_ratio_wise_pack   boolean not null default false,
  add column if not exists ratio_for            text,
  add column if not exists is_single_style_pack boolean not null default false,
  add column if not exists master_carton_name   text,
  add column if not exists inner_carton_name    text,
  add column if not exists pack_description     text;

-- 0328's tuple, kept verbatim so the seeder is a copy rather than a
-- translation. Added separately from the column so a re-run cannot double it.
do $ratio_for$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.garment_order_amendment_quantities'::regclass
       and conname  = 'chk_goa_quantities_ratio_for'
  ) then
    alter table public.garment_order_amendment_quantities
      add constraint chk_goa_quantities_ratio_for
      check (ratio_for is null or ratio_for in ('master', 'inner'));
  end if;
end $ratio_for$;

comment on column public.garment_order_amendment_quantities.is_ratio_wise_pack is
  'The overlay''s "Ratio" toggle. When true the line''s size cells are the ratio '
  'inside ONE carton and multiply by no_of_cartons; the screen states which '
  'reading is in force rather than leaving it to be inferred.';
comment on column public.garment_order_amendment_quantities.ratio_for is
  'Which carton the ratio is per — ''master'' or ''inner'' (0328''s tuple).';


-- ---------------------------------------------------------------------------
-- 2. One line per combo of one assortment.
-- ---------------------------------------------------------------------------
create table if not exists public.garment_order_amendment_assort_lines (
  id            uuid primary key default gen_random_uuid(),
  quantity_id   uuid not null
                  references public.garment_order_amendment_quantities(id) on delete cascade,
  sno           int  not null default 0,

  -- The colourway, BY VALUE — see the header.
  combo         text,
  no_of_cartons numeric(14,3) not null default 0,

  created_at    timestamptz not null default now()
);

create index if not exists idx_goa_assort_lines_qty
  on public.garment_order_amendment_assort_lines(quantity_id);


-- ---------------------------------------------------------------------------
-- 3. The per-size cell — one row per size, the whole point of §2 above.
-- ---------------------------------------------------------------------------
create table if not exists public.garment_order_amendment_assort_line_sizes (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null
               references public.garment_order_amendment_assort_lines(id) on delete cascade,

  -- `config_lookups` kind 'size' — the same rows `garment_order_amendment_style_sizes`
  -- (0407) names, which is what makes the grid's columns the STYLE's sizes.
  size_id    uuid references public.config_lookups(id),

  -- An explicit 0 is MEANINGFUL and must survive: "this carton has no XL" is a
  -- real statement about a ratio, and is not the same as never having been
  -- asked. The normalizer drops a row with no SIZE, never one with no quantity.
  qty        numeric(14,3) not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists idx_goa_assort_sizes_line
  on public.garment_order_amendment_assort_line_sizes(line_id);

-- A size named twice on one line says nothing the first row did not, and would
-- double-count into Ratio Total. The screen passes the sibling ids to the
-- column builder so a second cell is never offered; this is the backstop for
-- `lib/data-io`, which writes past the screen.
create unique index if not exists uq_goa_assort_sizes_size
  on public.garment_order_amendment_assort_line_sizes(line_id, size_id);


-- ---------------------------------------------------------------------------
-- 4. RLS — the `orders` module, the same four policies as every sibling.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_assort_lines      enable row level security;
alter table public.garment_order_amendment_assort_line_sizes enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array[
    'garment_order_amendment_assort_lines',
    'garment_order_amendment_assort_line_sizes'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
  end loop;
end $rls$;


-- ---------------------------------------------------------------------------
-- 5. Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable, and the
-- MCP socket silently swallowed two migrations whole on 2026-08-12.
--
-- THE CASCADE IS ASSERTED BY EXERCISING IT, two levels down, not by reading
-- `confdeltype`. What is worth knowing is that deleting a quantity row actually
-- takes its lines AND their size cells — a missing cascade on the second level
-- leaves orphaned numbers that nothing on screen can reach or correct.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_col        text;
  probe_amend  uuid;
  probe_qty    uuid;
  probe_line   uuid;
  probe_size   uuid;
  left_behind  int;
begin
  foreach v_col in array array['pack','is_ratio_wise_pack','ratio_for',
                               'is_single_style_pack','master_carton_name',
                               'inner_carton_name','pack_description'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='garment_order_amendment_quantities'
         and column_name = v_col
    ) then
      raise exception '0414: garment_order_amendment_quantities is missing %', v_col;
    end if;
  end loop;

  if (select count(*) from pg_policies
       where schemaname='public'
         and tablename in ('garment_order_amendment_assort_lines',
                           'garment_order_amendment_assort_line_sizes')) <> 8 then
    raise exception '0414: expected 8 policies across the two assortment tables';
  end if;

  -- `ratio_for` must actually refuse a value outside 0328's tuple. A column
  -- added without its CHECK looks identical from `information_schema.columns`.
  select id into probe_amend from public.garment_order_amendments limit 1;
  if probe_amend is null then
    return;  -- nothing to hang a probe off; skipped rather than faked
  end if;

  insert into public.garment_order_amendment_quantities (amendment_id, sno, ratio_for)
    values (probe_amend, 9414, 'master') returning id into probe_qty;
  begin
    update public.garment_order_amendment_quantities
       set ratio_for = '__not_a_carton' where id = probe_qty;
    delete from public.garment_order_amendment_quantities where id = probe_qty;
    raise exception '0414: ratio_for admitted a value outside (master, inner)';
  exception when check_violation then
    null;  -- expected
  end;

  -- The two-level cascade.
  select id into probe_size from public.config_lookups where kind = 'size' limit 1;
  insert into public.garment_order_amendment_assort_lines (quantity_id, sno, combo, no_of_cartons)
    values (probe_qty, 1, '__0414_probe', 10) returning id into probe_line;
  insert into public.garment_order_amendment_assort_line_sizes (line_id, size_id, qty)
    values (probe_line, probe_size, 3);

  delete from public.garment_order_amendment_quantities where id = probe_qty;

  select count(*) into left_behind
    from public.garment_order_amendment_assort_line_sizes where line_id = probe_line;
  if left_behind <> 0 then
    raise exception '0414: deleting a quantity row left % size cell(s) behind', left_behind;
  end if;
  if exists (select 1 from public.garment_order_amendment_assort_lines where id = probe_line) then
    raise exception '0414: deleting a quantity row left its assortment line behind';
  end if;
end $verify$;
