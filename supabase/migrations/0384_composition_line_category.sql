-- ============================================================================
-- Raagam ERP — 0384 Composition mixing lines name a YARN category, not free text
--
-- `composition_lines.description` was a free-text fibre name (0225). That made
-- COTTON, COTTAN and "COTTON." three different fibres to anything reading these
-- lines, and it became the LAST free-text fibre field in the app when the Yarn
-- Compositions master (the curated Cotton/Polyester/Viscose list) was withdrawn
-- on 2026-08-01. The line now picks a Category of the YARN item class.
--
-- The header stays FABRIC and is untouched: a composition belongs to a fabric,
-- its lines name the yarns inside it.
--
-- `description` SURVIVES, and this is the point of the design rather than an
-- oversight. It is the display fallback for every row entered before this
-- migration — those rows have no category to resolve — and the screen mirrors
-- the picked category's name into it on save, so the list summary, the search
-- text and normalizeLines() keep reading one column that is always populated.
--
-- No RLS work: 0225's policies are table-level and already cover a new column.
-- ============================================================================

alter table public.composition_lines
  add column if not exists category_id uuid references public.categories(id);

create index if not exists idx_composition_lines_category
  on public.composition_lines(category_id);

comment on column public.composition_lines.category_id is
  'Fibre/yarn named by this mixing line — a categories row under the YARN item class. Null on rows entered before 0384, which fall back to description.';

-- ---------------------------------------------------------------------------
-- Backfill the legacy rows that can be matched WITHOUT GUESSING: an exact
-- (trimmed, case-insensitive) name match against a YARN category. The category
-- name dup-guard means such a match cannot be ambiguous.
--
-- Everything else is left alone on purpose. Deciding which fibre "COT 60" meant
-- is a data decision, not a migration's call; those rows keep displaying their
-- text and pick up a category the next time someone edits the line.
--
-- Idempotent: `category_id is null` means a re-run is a no-op.
-- ---------------------------------------------------------------------------
update public.composition_lines l
   set category_id = c.id
  from public.categories c
  join public.config_lookups ic
    on ic.id = c.item_class_id
   and upper(ic.code) = 'YARN'
 where l.category_id is null
   and upper(trim(l.description)) = upper(trim(c.name));
