-- ============================================================================
-- Raagam ERP — 0314 Remove hsn_details → config_lookups sync trigger
--
-- All pickers that previously read from config_lookups WHERE kind='hsn_code'
-- now read directly from the hsn_details table (via hsnDetailsAsLookups
-- adapter). The sync trigger added in 0306 is no longer needed.
-- ============================================================================

drop trigger if exists trg_hsn_details_sync on public.hsn_details;
drop function if exists public.sync_hsn_detail_to_config_lookups();
