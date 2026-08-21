-- 0442 — A MATERIAL BOM LINE CAN CONSUME A DIFFERENT AMOUNT PER SLICE
--
-- Client, 2026-08-20/21, pointing at the Prices tab three times (screenshots
-- 2427 · 2428): the Attribute should explode the line the way Price Type
-- explodes a price. Pick Size-wise and a grid appears UNDER the line listing one
-- row per size of this order; pick Color-wise Size-wise and it grows a Colour
-- column. One material, one grid inside it.
--
-- The line has one `no_of_items` / `per_pieces` pair, so a Size-wise line spends
-- the same thread on an XS and a XXL. That is wrong for exactly the materials
-- the axis exists for.
--
-- ## AN OVERRIDE STORE, NOT A ROW LIST
--
-- The ROWS are not stored here. They come from `productionSlices()`, which the
-- Requirement section already computes per line — this table holds only the
-- cells an operator actually typed.
--
--   * a missing row, or a NULL figure, means "use the line's own" (client's
--     choice: the line's boxes stay typeable and act as the default);
--   * the grid always mirrors the order's CURRENT slices (client's other
--     choice), so an override whose slice has gone is simply not rendered and is
--     dropped on the next save.
--
-- Both columns are therefore NULLABLE, and that is the whole design: NULL is
-- "inherit", not "zero". Storing the full grid instead would need reconciliation
-- every time the order's colours or sizes changed.
--
-- ## THE KEY IS (COMBO, SIZE), MATCHING `price_details`
--
-- `combo` is TEXT because a colourway is a NAME on the Combos tab — the same
-- choice `garment_order_amendment_price_details.combo` makes, and the same one
-- `ProductionSlice.combo` carries. `size_id` is a lookup, again matching
-- `price_details.size_id`, because a size IS a `config_lookups` row that
-- Quantities and Approval Qty already key on.
--
-- A basis with no colour axis stores NULL there, and one with no size axis
-- stores NULL in `size_id` — which is why the unique index below has to
-- COALESCE both: plain NULLs never collide, so without the sentinels a line
-- could hold the same override twice.
--
-- ## `garment_size_id` IS DROPPED (0441, one day old, zero rows)
--
-- 0441 put a garment size on the LINE while the shape was still being worked
-- out. Under the override model the line applies to EVERY slice and the size
-- belongs to the override, so that column can never be filled by anything. It
-- is removed rather than left dormant: an unused column on a table this central
-- is a question every later reader has to answer again.
--
-- Catalog-checked before writing this: `material_bom_amendment_items` holds 0
-- rows and `garment_size_id` 0 non-nulls, so the drop is free.

create table if not exists public.material_bom_amendment_item_slices (
  id            uuid primary key default gen_random_uuid(),
  item_line_id  uuid not null
                references public.material_bom_amendment_items(id) on delete cascade,
  sno           int  not null default 0,
  -- The colourway, as the Combos tab names it. NULL on a basis with no colour.
  combo         text,
  -- The garment size. NULL on a basis with no size axis.
  size_id       uuid references public.config_lookups(id),
  -- BOTH NULLABLE, AND NULL MEANS "USE THE LINE'S". Never defaulted: a default
  -- would make "not answered" indistinguishable from "answered with that".
  no_of_items   numeric(14,3),
  per_pieces    numeric(14,3),
  created_at    timestamptz not null default now(),
  -- Guarded on NULL first, so "inherit" is not mistaken for an illegal value.
  -- `> 0` on pieces is 0418's rule for the line, applied to the override.
  constraint chk_mba_slice_per_pieces check (per_pieces is null or per_pieces > 0),
  constraint chk_mba_slice_no_of_items check (no_of_items is null or no_of_items >= 0)
);

-- ONE OVERRIDE PER SLICE. The COALESCE sentinels are load-bearing: a NULL never
-- equals a NULL in an index, so without them a line could carry the same
-- order-wise override any number of times.
create unique index if not exists uq_mba_slice_line_combo_size
  on public.material_bom_amendment_item_slices (
    item_line_id,
    coalesce(combo, ''),
    coalesce(size_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists idx_mba_slice_line
  on public.material_bom_amendment_item_slices(item_line_id);

comment on table public.material_bom_amendment_item_slices is
  'Per-slice consumption OVERRIDES for a Material BOM line (0442). The rows a '
  'line explodes into come from productionSlices(); this holds only what an '
  'operator typed. A missing row or a NULL figure means "use the line''s own".';
comment on column public.material_bom_amendment_item_slices.no_of_items is
  'NULL = inherit the line''s. Never defaulted (0442).';
comment on column public.material_bom_amendment_item_slices.combo is
  'The colourway BY NAME, as garment_order_amendment_price_details.combo does '
  'it — a combo is a name on the Combos tab, not a lookup row (0442).';

-- 0441's column, one day old and never filled. See the header.
alter table public.material_bom_amendment_items
  drop column if exists garment_size_id;

-- ---------------------------------------------------------------------------
-- RLS — the 0265 block, verbatim, as every child of this document uses.
-- ---------------------------------------------------------------------------
do $rls$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'material_bom_amendment_item_slices'
  ) then
    execute $f$
      create policy material_bom_amendment_item_slices_read on public.material_bom_amendment_item_slices
        for select to authenticated using (public.has_permission('orders','view'));
      create policy material_bom_amendment_item_slices_insert on public.material_bom_amendment_item_slices
        for insert to authenticated with check (public.has_permission('orders','create'));
      create policy material_bom_amendment_item_slices_update on public.material_bom_amendment_item_slices
        for update to authenticated using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy material_bom_amendment_item_slices_delete on public.material_bom_amendment_item_slices
        for delete to authenticated using (public.has_permission('orders','delete'));
    $f$;
  end if;
end $rls$;

alter table public.material_bom_amendment_item_slices enable row level security;

-- ---------------------------------------------------------------------------
-- ASSERTIONS — read the CATALOG, never this file. A migration that applied
-- cleanly and achieved nothing is the failure 0386/0387 record.
-- ---------------------------------------------------------------------------
do $assert$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'material_bom_amendment_item_slices'
  ) then
    raise exception '0442: the slice table was not created';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'material_bom_amendment_items'
       and column_name = 'garment_size_id'
  ) then
    raise exception '0442: garment_size_id survived the drop';
  end if;

  -- NULLABLE IS THE POINT — a NOT NULL here would destroy "inherit".
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'material_bom_amendment_item_slices'
       and column_name in ('no_of_items', 'per_pieces')
       and is_nullable = 'NO'
  ) then
    raise exception '0442: an override figure is NOT NULL — "inherit" is unexpressible';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'uq_mba_slice_line_combo_size'
  ) then
    raise exception '0442: the one-override-per-slice index is missing';
  end if;
end $assert$;
