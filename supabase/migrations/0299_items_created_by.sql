-- ============================================================================
-- Raagam ERP — 0299 Master Data ▸ Materials: Created User (free text)
-- The legacy "Materials - HO" report shows a "Created User" column per row.
-- Mirrors 0295 (components.created_by): plain `text`, not a `profiles` FK,
-- since legacy usernames don't correspond to real Supabase Auth accounts.
-- ============================================================================

alter table public.items
  add column if not exists created_by text;
