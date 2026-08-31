-- ============================================================================
-- Raagam ERP — 0382 DROP the Master Data ▸ Materials children withdrawn by the
-- client, EXCEPT the three whose tables are still read elsewhere.
--
-- Client 2026-08-01: these masters are not applicable to the business process.
-- 30 cards are removed from the app (registry entry, screen, service, actions
-- and Zod types). 27 of them also lose their tables here. Three do not:
-- lab_test_standards (§3), brands and size_groups (§5) — their screens go, but
-- live code outside Master Data still selects them.
--
-- Follows 0381 (Warp Length Allowances), which removed the 30th card the same
-- way. Same shape, thirty times over.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS CHECKED BEFORE WRITING THIS
--
-- 1. Row counts. 41 tables, 12 rows total, every one a singleton test row:
--      brands 1 · colors 1 · packing_instructions 1 · packing_methods 1
--      (+1 packing_method_categories) · shade_groups 1 (+1 shades)
--      · size_groups 1 (+1 size_group_sizes) · style_levels 1 · style_names 1
--    Every other table was empty.
--
-- 2. Inbound foreign keys. Four surviving tables pointed into this set, and
--    **all four columns were 100% NULL**:
--      opportunities.brand_id          → brands           (0 of 2 rows set)
--      categories.size_group_id        → size_groups      (0 of 22 rows set)
--      style_catalogues.size_group_id  → size_groups      (0 of 0 rows set)
--      lab_tests.standard_id           → lab_test_standards (0 of 0 rows set)
--
--    This check was originally read as "nothing depends on any of it", and all
--    four columns were slated to be dropped. **That conclusion was wrong**, and
--    the reasoning is worth keeping: an empty column proves no DATA depends on
--    the table, and says nothing about whether CODE still selects it. Three of
--    these four tables are still read at runtime, so ALL FOUR columns stay and
--    three tables survive — see §3 (lab_test_standards) and §5 (brands,
--    size_groups). §2 now drops nothing.
--
-- 3. Functions. `resolve_item_rate()` reads yarn_purchase_rate_items as the
--    2nd of 3 rate fallbacks, and a BEFORE INSERT trigger on stock_ledger
--    calls it on every posting. Its body is a string literal, so Postgres
--    records no dependency and `drop table` would leave it to fail at the next
--    stock movement rather than here. §4 rewrites it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- §1 · The masters themselves.
--
-- Children first, then headers. `cascade` also takes each table's triggers,
-- indexes and RLS policies. Grouped as the screens grouped them.
-- ---------------------------------------------------------------------------

-- Parent/child pairs — the child is the master's own detail grid, and dies
-- with it (all were `on delete cascade` already).
--
-- size_groups / size_group_sizes are NOT here. See §5.
drop table if exists public.shades cascade;
drop table if exists public.shade_groups cascade;
drop table if exists public.packing_method_categories cascade;
drop table if exists public.packing_methods cascade;
drop table if exists public.garment_accepted_qty_level_details cascade;
drop table if exists public.garment_accepted_qty_levels cascade;
drop table if exists public.count_group_counts cascade;
drop table if exists public.count_groups cascade;
drop table if exists public.construction_counts cascade;
drop table if exists public.constructions cascade;
drop table if exists public.yarn_purchase_rate_items cascade;
drop table if exists public.yarn_purchase_rates cascade;
drop table if exists public.yarn_debit_rate_items cascade;
drop table if exists public.yarn_debit_rates cascade;
drop table if exists public.sizing_rate_yarns cascade;
drop table if exists public.sizing_rates cascade;
-- process_sequence_group_members references BOTH headers, so it goes first.
drop table if exists public.process_sequence_group_members cascade;
drop table if exists public.process_sequence_steps cascade;
drop table if exists public.process_sequence_groups cascade;
drop table if exists public.process_sequences cascade;

-- Flat masters.  (brands is NOT here — see §5.)
drop table if exists public.colors cascade;
drop table if exists public.style_names cascade;
drop table if exists public.style_levels cascade;
drop table if exists public.packing_instructions cascade;
drop table if exists public.product_sizes cascade;
drop table if exists public.style_stock_categories cascade;
drop table if exists public.special_instructions cascade;
drop table if exists public.production_sections cascade;
drop table if exists public.beams cascade;
drop table if exists public.beam_types cascade;
drop table if exists public.tyres cascade;
drop table if exists public.designs cascade;
drop table if exists public.domestic_product_designs cascade;
drop table if exists public.print_types cascade;
drop table if exists public.product_types cascade;
drop table if exists public.print_items cascade;
drop table if exists public.print_processes cascade;

-- Code sequences fed by the dropped tables' assign_code() triggers. Nothing
-- else reads them. `seq_color_card` (Orders ▸ Colour Cards), seq_packing_advice
-- and seq_packing_list (Logistics) have similar names and are NOT touched.
drop sequence if exists public.seq_garment_accepted_qty;
drop sequence if exists public.seq_sizing_rate;
drop sequence if exists public.seq_yarn_debit_rate;
drop sequence if exists public.seq_yarn_purchase_rate;

-- ---------------------------------------------------------------------------
-- §2 · Columns on surviving tables that pointed into the dropped set.
--
-- `drop table ... cascade` in §1 already removed the FK constraints; these
-- statements remove the now-meaningless columns behind them.
--
-- Only ONE of the original three is dropped. `opportunities.brand_id` and both
-- `size_group_id` columns still point at tables §5 keeps, so their FKs are
-- intact and the columns are still live — see §5.
-- ---------------------------------------------------------------------------
-- (nothing to drop here; retained as a section marker — see §5)

-- ---------------------------------------------------------------------------
-- §3 · lab_test_standards is DELIBERATELY KEPT.
--
-- The Materials card was one of two owners: Purchase ▸ Lab (app/(app)/purchase/
-- lab) lists, creates and deletes standards through lib/purchase/extras-*, and
-- lab_tests.standard_id references them. Only the Materials-side duplicate
-- (card, screen, service and actions) is removed in code; the table and the
-- Purchase module stay exactly as they are.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- §4 · resolve_item_rate() loses its middle fallback.
--
-- 0351 gave it three tiers: (1) the last actual PO price, (2) the yarn purchase
-- rate master, (3) the item's budget rate. Tier 2's table is gone, so the chain
-- is now PO price → budget rate. Priority numbers keep 0351's values (1 and 3)
-- so the ordering reads the same and the gap says a tier was withdrawn.
--
-- This is not cosmetic: it is reached on every stock_ledger insert, and the body
-- is a string literal Postgres does not dependency-check. Left alone it would
-- fail at the next stock posting rather than here.
-- Signature, volatility, security and grants are unchanged.
--
-- The exact path, verified against live when this was applied (2026-08-01) —
-- an earlier draft of this note named a trigger `trg_stock_ledger_rate` that
-- does not exist:
--   stock_ledger BEFORE INSERT -> trg_stamp_stock_defaults
--     -> stamp_stock_movement_defaults() -> resolve_item_rate()
-- After applying, `resolve_item_rate` executes cleanly and no function or view
-- in the schema references any dropped table.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_item_rate(p_item_id uuid, p_as_of date default current_date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    (select 1 as priority, pli.unit_price as rate
     from public.po_line_items pli
     join public.purchase_orders po on po.id = pli.purchase_order_id
     where pli.item_id = p_item_id
       and po.status <> 'cancelled'
       and coalesce(po.order_date, po.created_at::date) <= p_as_of
       and pli.unit_price > 0
     order by coalesce(po.order_date, po.created_at::date) desc
     limit 1)
    union all
    (select 3, i.budget_rate
     from public.items i
     where i.id = p_item_id and coalesce(i.budget_rate, 0) > 0
     limit 1)
  )
  select rate from candidates order by priority limit 1;
$$;

revoke execute on function public.resolve_item_rate(uuid, date) from public, anon;
grant  execute on function public.resolve_item_rate(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- §5 · brands and size_groups are DELIBERATELY KEPT.
--
-- Their Materials cards go, their tables stay. Both were in the original drop
-- list on the strength of §"WHAT WAS CHECKED" item 2 — every inbound FK column
-- was 100% NULL. That check is correct and it is not enough: an empty column
-- says nothing about whether CODE still selects the table, and for these two it
-- does. Dropping them would have compiled, migrated, and then 500'd in
-- production.
--
--   brands       lib/sales/service.ts  getBrands() → .from("brands"), rendered
--                by app/(app)/sales/page.tsx and .../[opportunityId]/page.tsx.
--                Dropping it breaks the Sales list and every opportunity page.
--                `opportunities.brand_id` therefore also stays.
--
--   size_groups  TWO separate live readers, and neither is a visible field:
--                (a) materials/[entity]/page.tsx:164 still calls
--                    listSizeGroups() -> .from("size_groups") when opening the
--                    CATEGORIES master, one of the 22 children being kept.
--                    Drop the table and that page throws on load.
--                (b) `categories.size_group_id` is still in categoryInput's Zod
--                    schema and in the save payload (category-master-screen
--                    round-trips it), so dropping the COLUMN fails every
--                    category save.
--                `style_catalogues.size_group_id` is likewise still in the sales
--                catalogue schema. So the table, the child size_group_sizes and
--                all three columns stay.
--
--                Note what is NOT true: CategoryMasterScreen takes a
--                `sizeGroups` prop and never renders it — there is no size-group
--                picker on that screen any more. The value is carried, not
--                edited. Tidying that up (drop the prop, stop querying, stop
--                round-tripping the column) is the prerequisite for ever
--                dropping this table, and it is a separate piece of work.
--
-- Consequence to be aware of, and it is a product decision rather than a bug:
-- both lists are now READ-ONLY in the app. Sales can still pick a brand and
-- Categories can still pick a size group, but nothing can create a new one,
-- because the screen that used to do it is gone. If the client wants either
-- list maintainable again, the fix is a new home for that screen — not undoing
-- this migration.
--
-- Same shape as §3 (lab_test_standards): the code duplicate goes, the table and
-- its real owner stay.
-- ---------------------------------------------------------------------------
