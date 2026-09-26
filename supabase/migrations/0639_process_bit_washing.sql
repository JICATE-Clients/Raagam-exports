-- ============================================================================
-- Raagam ERP — 0639 "Bit Washing" is the one name for the bit / bio wash
-- process (2026-09-25 spec §4; user: "rename both / merge").
--
-- The Process master held two rows for one process: BITWASH and BIO WASH.
--   · BITWASH  → renamed BIT WASHING (capitals: AGENTS.md "CAPITALS").
--   · BIO WASH → switched OFF (inactive), never deleted. AGENTS.md "Disabled
--     rows": an inactive row leaves every picker and search, and a record that
--     already holds it keeps it, greyed. On 2026-09-25 nothing referenced
--     either row (style processes, component processes, Fabric BOM processes,
--     budget lines, vendor processes all counted 0), so no record needs
--     re-pointing — the merge is a rename plus a switch-off.
--
-- Idempotent: keyed on the names, and skips the rename if BIT WASHING exists.
-- ============================================================================

update public.processes
   set name = 'BIT WASHING'
 where upper(btrim(name)) = 'BITWASH'
   and not exists (select 1 from public.processes where upper(btrim(name)) = 'BIT WASHING');

update public.processes
   set inactive = true
 where upper(btrim(name)) = 'BIO WASH'
   and inactive is distinct from true;
