-- ============================================================================
-- Raagam ERP — 0381 DROP Warp Length Allowances
--
-- Master Data ▸ Materials ▸ Warp Length Allowances is not required. The
-- sub-module is removed from the app (registry entry, screen, service, actions
-- and Zod types), so these two tables are now unreachable from any code path.
--
-- Safe to drop: both tables were empty at the time this was written
--   select count(*) from public.warp_length_allowances         -> 0
--   select count(*) from public.warp_length_allowance_details  -> 0
-- and nothing outside the pair references them — `allowance_id` is the only
-- FK, and it points back at the header.
--
-- Created by 0334_materials_phase2_grid_masters.sql (§6 + the RLS loop). Note
-- 0334 uses `create table if not exists`, so it stays replayable on a fresh
-- database; this migration simply un-does §6 afterwards.
-- ============================================================================

-- Children first. `cascade` also takes the triggers (trg_wla_code,
-- trg_wla_updated, trg_wla_detail_updated), the index idx_wla_details_parent
-- and the four RLS policies 0334 generated per table.
drop table if exists public.warp_length_allowance_details cascade;
drop table if exists public.warp_length_allowances cascade;

-- Fed trg_wla_code via assign_code('WLA', …). Nothing else reads it.
-- public.assign_code and public.set_updated_at are shared and stay.
drop sequence if exists public.seq_warp_length_allowance;
