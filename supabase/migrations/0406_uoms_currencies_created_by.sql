-- ============================================================================
-- 0404 — Created Date / Created User for the two masters 0383 could not reach
-- ============================================================================
-- AGENTS.md states the rule without qualification: "Every listing of records
-- shows who made the row and when." Two master screens have never been able to
-- obey it, and the reason was invisible from the UI code, which is exactly why
-- it took a client report to find (2026-08-11, Stock Units):
--
--   * `uoms`       -> Master Data ▸ Materials ▸ Stock Units
--   * `currencies` -> Master Data ▸ Currencies
--
-- Both were created by 0004 with no `created_at` at all. 0383 swept `created_by`
-- onto 106+ master tables but SKIPS any table with no `created_at` — by design,
-- and it names these two in its own header: "This drops `uoms`, `currencies` and
-- the join tables automatically." The reasoning was sound (a creator with no
-- creation date could never be displayed); what was missing is that nothing then
-- came back to give them the date.
--
-- Nothing in the application code is wrong. `listStockUnits()` selects `*`, wraps
-- in `withCreators()`, and the screen calls `withCreatedColumns()` — every link
-- the two audits check is present and correct. `withCreatedColumns` simply
-- self-hides when no row carries a `created_at` (`hasCreatedInfo`), a deliberate
-- feature so a service that does not select the column grows no column of
-- dashes. Against a table that has no such column at all, that feature turns
-- "the schema cannot answer this" into silence. Both checks pass; the columns
-- never appear. THE CHECKS READ THE SOURCE AND THE SOURCE WAS FINE.
--
-- ---------------------------------------------------------------------------
-- NO BACKFILL, and it is worth being explicit about what that costs
-- ---------------------------------------------------------------------------
-- `created_at` is added NULLABLE with a default for NEW rows only. Adding it as
-- `not null default now()` would stamp every existing row with the moment this
-- migration ran, which is not when those rows were created — 0383 rule 3:
-- "Inventing one would be a lie in an audit column."
--
-- The visible consequence, stated so it is not later reported as a bug: until
-- the first row is added to either table, `hasCreatedInfo` is still false for
-- every row and the two columns STILL do not render. They appear the moment one
-- row has a real date, and the pre-existing rows read "—" from then on. That is
-- the same behaviour every other table swept by 0383 already has.
-- ============================================================================

alter table public.uoms
  add column if not exists created_at timestamptz,
  add column if not exists created_by uuid references public.profiles(id);

alter table public.currencies
  add column if not exists created_at timestamptz,
  add column if not exists created_by uuid references public.profiles(id);

-- Defaults for rows created from here on. Set separately from ADD COLUMN so the
-- existing rows are not backfilled by the default (Postgres applies a DEFAULT
-- added in the same ADD COLUMN statement to every existing row).
alter table public.uoms
  alter column created_at set default now(),
  alter column created_by set default auth.uid();

alter table public.currencies
  alter column created_at set default now(),
  alter column created_by set default auth.uid();

-- `creator_names()` (0383 · 0385) is the SECURITY DEFINER resolver the UI calls;
-- it takes uuids and returns id + name, so it needs nothing per-table here.
-- No grants are added by this migration, and none should be: AGENTS.md,
-- "Function grants" — no function in `public` is executable by `anon`.

comment on column public.uoms.created_by is
  'Creator (profiles.id). Null on every row predating 0404 — not backfilled, by 0383 rule 3.';
comment on column public.currencies.created_by is
  'Creator (profiles.id). Null on every row predating 0404 — not backfilled, by 0383 rule 3.';
