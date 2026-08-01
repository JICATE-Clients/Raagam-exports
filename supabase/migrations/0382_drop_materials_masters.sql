-- ============================================================================
-- Raagam ERP — 0382 DROP 29 Master Data ▸ Materials children
--
-- Client 2026-08-01: these masters are not applicable to the business process.
-- The sub-modules are removed from the app (registry entry, screen, service,
-- actions and Zod types), so the tables below are unreachable from any code
-- path once this migration lands.
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
--    **all four columns were 100% NULL** — nothing real depends on any of it:
--      opportunities.brand_id          → brands           (0 of 2 rows set)
--      categories.size_group_id        → size_groups      (0 of 22 rows set)
--      style_catalogues.size_group_id  → size_groups      (0 of 0 rows set)
--      lab_tests.standard_id           → lab_test_standards (0 of 0 rows set)
--    The first three columns are dropped in §2 below. The fourth is NOT — see
--    the lab_test_standards note in §3.
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
drop table if exists public.size_group_sizes cascade;
drop table if exists public.size_groups cascade;
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

-- Flat masters.
drop table if exists public.colors cascade;
drop table if exists public.brands cascade;
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
-- statements remove the now-meaningless columns behind them. All three were
-- entirely NULL, so no data is lost — but the columns must go, or the Zod
-- schemas and screens keep a field with nothing to fill it.
-- ---------------------------------------------------------------------------
alter table public.opportunities     drop column if exists brand_id;
alter table public.categories        drop column if exists size_group_id;
alter table public.style_catalogues  drop column if exists size_group_id;

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
-- This is not cosmetic: trg_stock_ledger_rate calls it BEFORE INSERT on every
-- stock_ledger row, and the body is a string literal Postgres does not
-- dependency-check. Left alone it would fail at the next stock posting.
-- Signature, volatility, security and grants are unchanged.
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
