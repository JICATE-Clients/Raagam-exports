-- ============================================================================
-- Raagam ERP — 0394 Style Category comes from the Garment master
--
-- `garment_styles.style_category_id` pointed at `config_lookups` kind
-- 'style_category'. That kind has NEVER held a row, so the field on the Style
-- form was a dropdown over an empty list — which is why it read as a bare text
-- box (client 2026-08-10).
--
-- It now points at `public.categories`, the same master the Material child
-- classifies against, scoped by Item Class. A style named "MEN'S T-SHIRT" gets
-- its classification from the garment records rather than from a parallel list
-- nobody maintained.
--
-- WHY THE FK MUST MOVE AND NOT JUST THE PICKER. A uuid from `categories` is
-- shaped exactly like a uuid from `config_lookups`, so pointing the screen at
-- the new master while the constraint still names the old one compiles, renders
-- a correct-looking list, and then rejects EVERY save with a foreign-key
-- violation. That is the defect 0355 (state_id) and 0375 (payment_term) both
-- record; this is the same shape, caught before it shipped.
--
-- CLEAN BECAUSE THERE IS NOTHING TO MIGRATE, verified before writing this:
-- `config_lookups where kind='style_category'` is 0 rows and `garment_styles`
-- is 0 rows. No orphaned id can exist, so no backfill and no data loss. The
-- guard below asserts that rather than assuming it, because the statement would
-- otherwise fail confusingly on a database where that is not true.
--
-- The 'style_category' KIND IS LEFT DECLARED in the config_lookups CHECK
-- constraint. It is now unreferenced by any column — like `trims_category`
-- after 0392 — and removing it would mean re-listing every other kind in a new
-- constraint for no gain.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Refuse to run if this database is NOT in the clean state described above.
--
-- Repointing a live FK with rows behind it would orphan them silently: the drop
-- succeeds, the re-add fails, and the transaction rolls back — but on a
-- database where the values happened to be null the change would apply and
-- LOOK fine while the old lookup ids were unrecoverable. Better to stop.
-- ----------------------------------------------------------------------------

do $guard$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.garment_styles gs
   where gs.style_category_id is not null
     and not exists (select 1 from public.categories c where c.id = gs.style_category_id);

  if v_bad > 0 then
    raise exception
      '0394: % garment_styles rows hold a style_category_id that is not a category. '
      'Map them before repointing the FK — dropping it here would strand them.', v_bad;
  end if;
end $guard$;


-- ----------------------------------------------------------------------------
-- 2. Repoint the FK.
-- ----------------------------------------------------------------------------

alter table public.garment_styles
  drop constraint if exists garment_styles_style_category_id_fkey;

alter table public.garment_styles
  add constraint garment_styles_style_category_id_fkey
  foreign key (style_category_id) references public.categories(id);


-- ----------------------------------------------------------------------------
-- 3. The Item Class the operator chose.
--
-- STORED, NOT DERIVED. It is recoverable from `categories.item_class_id` only
-- once a category has been picked — so an operator who chooses an Item Class,
-- saves a draft and reopens it would find the field blank and the cascade
-- reset. It is a question the form asks, so it round-trips like any other.
--
-- Nullable: every style predating this has no answer, and the coordinate rule's
-- precedent (0392 `unit_kind`) is that a new question does not retroactively
-- invalidate old records.
-- ----------------------------------------------------------------------------

alter table public.garment_styles
  add column if not exists item_class_id uuid references public.config_lookups(id);

create index if not exists idx_garment_styles_item_class
  on public.garment_styles(item_class_id);


-- ----------------------------------------------------------------------------
-- 4. Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its stated goal —
-- 0383 and 0386 both applied cleanly and both left a function anon-callable.
-- ----------------------------------------------------------------------------

do $verify$
declare
  v_points_at text;
begin
  select tgt.relname into v_points_at
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class tgt on tgt.oid = con.confrelid
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
   where src.relname = 'garment_styles' and a.attname = 'style_category_id';

  if v_points_at is distinct from 'categories' then
    raise exception '0394: style_category_id still points at %, expected categories',
      coalesce(v_points_at, '<no FK at all>');
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'garment_styles'
       and column_name = 'item_class_id'
  ) then
    raise exception '0394: garment_styles.item_class_id was not added';
  end if;
end $verify$;
