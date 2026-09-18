-- 0569 — A MANUAL ENTRY'S PANEL IS A (COORDINATE, COMPONENT) PAIR, NOT A COMPONENT
--
-- Client 2026-09-17, Order #9: on a SET item — a style carrying both a TOP and a
-- BOTTOM coordinate — the sub-components (All Body, neck tape, zipper binding,
-- collar, bottom fabric) "were getting mixed or collapsed into a single
-- coordinate view" on Fabric BOM ▸ Manual.
--
-- ## THE COORDINATE WAS DROPPED THE MOMENT A PANEL LEFT THE DECLARATION
--
-- The order declares its panels correctly, keyed by the pair:
--
--     garment_order_amendment_style_components
--       (style_ref_no, coordinate_id, component_id, fabric_category_id)   -- 0457
--
-- So "ALL BODY under TOP" and "ALL BODY under BOTTOM" are two separate facts and
-- a Set item states both. `order_fabric_bom_manual_components` (0494) held only
-- `component_id`, so an entry could not record WHICH All Body its weight covers,
-- the picker listed the two declarations as one row, and the "no duplicate
-- component allocation" rule — keyed by component across the style — made
-- BOTTOM's panel unreachable once TOP's had been ticked.
--
-- THE LINES SIDE HAS ALWAYS CARRIED THE PAIR. `order_fabric_bom_lines` holds
-- `coordinate_id` beside `component_id` (0495), and `fabricBomLineInput`'s own
-- comment states the reason in as many words: "the Style master declares FRONT
-- BODY *of* PIECES, so the component alone does not identify a panel and a line
-- holding one without the other cannot say which of two identically-named parts
-- it means." Manual was the outlier. This aligns it.
--
-- ## NULL IS A REAL VALUE HERE AND MEANS "COORDINATE UNSTATED"
--
-- Every row stored before today has one, and the backfill below can only resolve
-- the unambiguous ones. So NULL keeps a meaning rather than being back-filled to
-- a guess: it is a claim on the component WHATEVER its coordinate, and
-- `panelTaken` (lib/orders/fabric-bom/manual.ts) reads it as colliding with
-- every coordinate of that component — in both directions, exactly as an
-- unscoped `style_ref_no` already collides with every style there. That is the
-- safe reading: the alternative lets a legacy row stop blocking a panel it is
-- already planning cloth for, and the garment is then bought twice.
--
-- ## THE BACKFILL FILLS ONLY WHAT THE ORDER ITSELF SETTLES
--
-- A component the style declares under exactly ONE coordinate has no ambiguity:
-- the stored row can only ever have meant that one, and filling it in is reading
-- the order rather than guessing. A component declared under TWO (the Set item
-- this migration exists for) is left NULL for the planner to answer, because the
-- data genuinely does not say which was meant and inventing one would plan cloth
-- for the wrong half of the garment.
--
-- An entry scoped to no style ("every style", 0495) matches no single style's
-- declaration, so it is left NULL too — deliberately conservative.

alter table public.order_fabric_bom_manual_components
  -- `items` of item class GAR (PIECES, TOP, BOTTOM) — the SAME target
  -- `garment_order_amendment_style_components.coordinate_id` and
  -- `order_fabric_bom_lines.coordinate_id` point at (0396 · 0457 · 0495), so an
  -- entry, a line and the declaration all name one coordinate by one id.
  add column if not exists coordinate_id uuid references public.items(id);

comment on column public.order_fabric_bom_manual_components.coordinate_id is
  'Which coordinate''s panel this is (0569) — `items` of class GAR, the same id the order''s own declaration uses. NULL means the coordinate was never stated (every row written before 0569, and any the backfill could not settle): read as a claim on the component under EVERY coordinate, never as "no coordinate".';

-- ONE PANEL ONCE PER ENTRY, now keyed by the pair. `coalesce` is load-bearing:
-- Postgres treats NULLs as distinct in a unique index, so a plain
-- (entry_id, component_id, coordinate_id) index would let the same
-- coordinate-less panel be stored twice — which is what the old index existed
-- to prevent. The all-zero uuid is a stand-in for "unstated" and is never a real
-- `items` id.
drop index if exists public.uq_ofbmc_entry_component;

create unique index if not exists uq_ofbmc_entry_panel
  on public.order_fabric_bom_manual_components (
    entry_id,
    component_id,
    coalesce(coordinate_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Read by the picker when it resolves which coordinates a component is declared
-- under; small table, but the join is per entry and per render.
create index if not exists idx_ofbmc_coordinate
  on public.order_fabric_bom_manual_components (coordinate_id);

with decl as (
  select
    sc.amendment_id,
    upper(btrim(coalesce(sc.style_ref_no, ''))) as style_key,
    sc.component_id,
    count(distinct sc.coordinate_id) as coords,
    min(sc.coordinate_id::text)::uuid  as only_coordinate
  from public.garment_order_amendment_style_components sc
  where sc.component_id is not null
    and sc.coordinate_id is not null
  group by 1, 2, 3
),
target as (
  select mc.id as mc_id, d.only_coordinate
  from public.order_fabric_bom_manual_components mc
  join public.order_fabric_bom_manual_entries e on e.id = mc.entry_id
  join public.order_fabric_boms               b on b.id = e.bom_id
  join decl d
    on  d.amendment_id = b.garment_order_id
    and d.component_id = mc.component_id
    -- The entry's own style, compared the way every reader of this document
    -- compares one: trimmed and case-folded (`styleKey`). An entry scoped to
    -- no style has key '' and matches no declaration, which is the intent.
    and d.style_key    = upper(btrim(coalesce(e.style_ref_no, '')))
  where mc.coordinate_id is null
    and d.coords = 1
)
update public.order_fabric_bom_manual_components mc
   set coordinate_id = t.only_coordinate
  from target t
 where t.mc_id = mc.id;
