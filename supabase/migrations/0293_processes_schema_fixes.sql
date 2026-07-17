-- ============================================================================
-- Raagam ERP — 0293 Master Data ▸ Materials ▸ Processes: schema fixes
-- Legacy "Processes - U2" export has three columns Processes can't represent
-- yet:
--   • Created User — legacy free-text usernames (admin, PRABHU, m.prabhu)
--     that aren't real Supabase profiles, same situation config_lookups hit
--     in 0290 — same fix here (plain text, not a profiles FK).
--   • ProcessName_SlNo — a per-row numeric field with no home anywhere in
--     the app; added verbatim as `sl_no`, no interpretation attempted.
--   • Commodity ShortName — processes.commodity_id still points at the
--     stale config_lookups(kind='commodity') snapshot (1 old row) instead
--     of the real `commodities` table added later in 0230, the same
--     stale-snapshot-vs-real-master bug already fixed for Item Class this
--     session. Both `processes` and `commodities` are empty (0 rows) as of
--     this migration, so repointing is zero-risk — no data to backfill.
-- ============================================================================

alter table public.processes
  add column if not exists created_by text,
  add column if not exists sl_no integer not null default 9;

alter table public.processes drop constraint if exists processes_commodity_id_fkey;
alter table public.processes
  add constraint processes_commodity_id_fkey
    foreign key (commodity_id) references public.commodities(id) on delete set null;
