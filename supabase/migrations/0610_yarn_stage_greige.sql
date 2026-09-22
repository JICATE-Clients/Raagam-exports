-- ============================================================================
-- Raagam ERP — 0610 Yarn Process ▸ Stage GREY → GREIGE (client 2026-09-21)
--
-- The fabric route's stage list already reads GREIGE (an operator renamed
-- `fabric_stage` grey → GREIGE on the master); the Yarn Process tab's own
-- stage list (`yarn_stage`, seeded GREY by 0493) was never changed, so one
-- screen showed GREIGE and the tab beside it GREY for the same state.
--
-- THE NAME ONLY. `code` stays 'grey': codes are what any rule may key on, and
-- nothing is gained by moving one. Matched on the seeded pair (code 'grey' AND
-- name 'GREY') so an operator who already renamed it to something else keeps
-- their word. Idempotent.
--
-- NOT the requirement report's "YARN PURCHASE (GREY)" heading — that copies
-- the legacy RP printout column-for-column and is a report label, not this
-- master's value.
-- ============================================================================

update public.config_lookups
   set name = 'GREIGE'
 where kind = 'yarn_stage'
   and lower(code) = 'grey'
   and upper(name) = 'GREY';
