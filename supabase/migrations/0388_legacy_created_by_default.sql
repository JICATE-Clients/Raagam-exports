-- ============================================================================
-- Raagam ERP — 0388  Created User: the four legacy `text` created_by columns
--                    record the person who creates a row
--
-- SYMPTOM (client 2026-08-04): "Created by is not working, it shows - values
-- only." On Materials that is true of EVERY row and always will be — items has
-- 36 rows and 0 of them carry a creator.
--
-- WHY. 0383 gave every master table
--     created_by uuid references profiles(id) default auth.uid()
-- and it works: `categories` is 25 rows, 25 filled, resolving to "Raagam Admin"
-- and "Roja" through creator_names(). But 0383 point 1 deliberately SKIPPED any
-- table that already had a `created_by` of any type, to protect the verbatim
-- legacy usernames 0290/0295/0299 imported ("SELVARAJ", "admin") — those are not
-- Supabase Auth accounts and must stay readable.
--
-- Four tables were skipped that way, and all four are `text` with NO DEFAULT:
--
--     items            36 rows,  0 filled   ← Materials, the reported screen
--     config_lookups   81 rows, 12 filled   ← the 12 are legacy usernames
--     processes         1 row,   0 filled
--     components        2 rows,  0 filled
--
-- So the protection was complete and the replacement was never added: nothing
-- the app creates in these four tables has ever recorded who created it. The
-- column is not broken — it was never being written.
--
-- THE FIX IS A DEFAULT, NOT A COLUMN. `auth.uid()::text` writes the uuid as
-- text into the column that is already there. Nothing downstream needs changing,
-- because the whole chain was built for a column that holds more than one kind
-- of thing (see lib/created-by.ts and components/ui/created-columns.tsx):
--
--   - `withCreators()` filters `created_by` through a UUID regex and sends only
--     the uuid-shaped ones to creator_names(), so the legacy usernames are never
--     sent and come back untouched;
--   - `creatorName()` prefers the resolved `created_by_name`, and REFUSES to
--     return anything uuid-shaped — so if a profile is ever missing, the cell
--     reads "—" rather than showing an operator 36 characters of hex.
--
-- A second column (`created_by_id uuid`) was the obvious alternative and is
-- worse: two columns meaning one thing, every service and the export descriptor
-- to teach, and the legacy names stranded in a column nothing reads.
--
-- NOT BACKFILLED, and this is 0383 point 3 restated rather than an oversight: a
-- row created before the column was written has no creator to name, and
-- inventing one is a lie in an audit column. It was checked for a truthful
-- source — `audit_log` holds 5 rows and 0 INSERTs, so there is nothing to
-- recover from. Those rows keep reading "—" for as long as they exist.
--
-- NOT `not null`, same as 0383 point 4: `auth.uid()` is null for a service-role
-- connection and for a data-io import, and a masters import that hard-fails is
-- worse than a blank column.
-- ============================================================================

alter table public.items           alter column created_by set default (auth.uid())::text;
alter table public.config_lookups  alter column created_by set default (auth.uid())::text;
alter table public.processes       alter column created_by set default (auth.uid())::text;
alter table public.components      alter column created_by set default (auth.uid())::text;

comment on column public.items.created_by is
  'Who created the row. TEXT because 0290/0295/0299 imported verbatim legacy '
  'usernames here ("SELVARAJ") that are not Auth accounts. Since 0388 new rows '
  'default to auth.uid()::text; lib/created-by.ts resolves the uuid-shaped ones '
  'through creator_names() and passes the legacy names through unchanged.';
