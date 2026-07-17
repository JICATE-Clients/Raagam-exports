-- ============================================================================
-- Raagam ERP — 0290 Master Data ▸ config_lookups: Created User (free text)
-- Legacy EDP2 lookup exports (e.g. "Counts - U2") show a "Created User"
-- column per row. Unlike `levies`/`categories` (0286/0289), config_lookups
-- is a shared generic table across ~50 lookup kinds and needs to carry
-- verbatim legacy usernames (e.g. "SELVARAJ", "admin") that do not
-- correspond to real Supabase Auth accounts — so this is plain `text`,
-- not a `profiles` FK.
-- ============================================================================

alter table public.config_lookups
  add column if not exists created_by text;
