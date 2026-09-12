-- ============================================================================
-- Raagam ERP — 0547 Master Data ▸ Associates ▸ Port: an `inactive` flag
--
-- The Port listing gains the Status switch every other Associates master now
-- carries (client 2026-09-11, the same instruction Country was changed under):
-- a switch in the STATUS column that writes straight through `setMasterActive`,
-- rather than a pill that only the editor could change. `ports` had no column
-- for it to write — 0234 created the table with short_name / name / country_id /
-- port_type and nothing else, and `ports` is named in AGENTS.md and in
-- `FLAGLESS_PICKERS` as one of the three flagless tables. This is what takes it
-- off that list.
--
-- `inactive`, not `blocked` and not `is_active`. 0299 renamed every Master Data
-- table to this spelling and `ports` was simply not in that list because it had
-- no column to rename; adding one of the other two spellings now would make this
-- the only Associates master the reader has to check.
--
-- `not null default false` — an existing port is one that is still in use. The
-- flag is read through `isInactive()`, which answers false for a missing value
-- anyway, but a nullable boolean here would mean `not inactive` is NULL rather
-- than true in any SQL that ever filters on it.
--
-- ONE QUERY IN THE APP WAS ALREADY ASKING FOR THIS COLUMN. `getPortRows()` in
-- `lib/orders/amendments/service.ts` selects `inactive` off `ports`, which
-- PostgREST answers with a 400 for an unknown column — and that call site reads
-- `data ?? []`, so the Amendment screen's Port picker has been silently empty
-- rather than erroring ("A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST"). That
-- select also names `code`, which `ports` does not have either; the column here
-- fixes one half and that file's own select fixes the other.
-- ============================================================================

alter table public.ports
  add column if not exists inactive boolean not null default false;

-- Every picker over this table now asks "which ports are still offered?", and
-- the listing filters on it too. Partial, because the answer is almost always
-- the active ones.
create index if not exists idx_ports_active on public.ports (country_id) where not inactive;
