-- ============================================================================
-- Raagam ERP — 0295 Master Data ▸ Materials ▸ Components: Created User (free text)
-- The legacy EDP2 "Components - U2" report shows a "Created User" column per
-- row. Mirrors 0290 (config_lookups.created_by): plain `text`, not a
-- `profiles` FK, since legacy usernames (e.g. "SAKTHI", "raju", "admin")
-- don't correspond to real Supabase Auth accounts.
-- ============================================================================

alter table public.components
  add column if not exists created_by text;
