-- =============================================================================
-- 0356 — Customer ▸ Supplied Items points at the Category master
-- -----------------------------------------------------------------------------
-- The Supplied Items tab has two cards, "Sewing Accessories" and "Packaging
-- Accessories", each meant to list the CATEGORIES the customer free-issues in
-- that group — BUTTON, LABEL, SEWING THREAD, TAPE for sewing; POLY BAG, TAGS for
-- packing.
--
-- Both were reading `config_lookups` where kind = 'material_category', which
-- holds exactly two rows: "Sewing Accessory" and "Packing Accessory". Those are
-- the names of the two GROUPS, not categories within them. So both cards offered
-- the same two values, both wrong, and picking one stored a group name in a
-- category slot (client 2026-07-29, screenshot 2122).
--
-- The real categories live in `public.categories`, scoped by `item_class_id` —
-- the same master the Material screen picks from. This is the identical mistake
-- 0355 fixed for `state_id`: a column left pointing at config_lookups after the
-- thing it references grew a master of its own.
--
-- ONE row exists and it does not resolve in `categories` — it is the bogus
-- "Sewing Accessory" pick visible in that screenshot. It is set to NULL rather
-- than guessed at: there is no correct category to map "Sewing Accessory" onto,
-- because it never named one. The customer re-picks from the right list.
--
-- Scope note: six other `%category_id%` columns still reference config_lookups
-- and are CORRECT — employee category, shift category, style category, trims
-- category and annexure category are all genuine config-lookup kinds with no
-- master of their own. The only other suspect is
-- `material_bom_amendment_items.category_id`, which is flagged for review rather
-- than changed here.
-- =============================================================================

-- 1) Drop references that cannot survive the repoint. Reported, not silent.
do $$
declare orphans bigint;
begin
  select count(*) into orphans
    from public.customer_supplied_items s
   where s.category_id is not null
     and not exists (select 1 from public.categories c where c.id = s.category_id);

  if orphans > 0 then
    raise notice '0356: clearing % customer_supplied_items.category_id value(s) that named a config_lookups group rather than a category', orphans;
    update public.customer_supplied_items s
       set category_id = null
     where s.category_id is not null
       and not exists (select 1 from public.categories c where c.id = s.category_id);
  end if;
end $$;

-- 2) Repoint the constraint.
--    ON DELETE SET NULL preserved from the original: a supplied-item line is a
--    statement that the customer free-issues something, and it should survive
--    the category being retired rather than vanish with it. Deleting an in-use
--    category is already blocked at the application layer by the
--    deleteOrDeactivate guard (0344), so this is a backstop.
alter table public.customer_supplied_items
  drop constraint if exists customer_supplied_items_category_id_fkey;

alter table public.customer_supplied_items
  add constraint customer_supplied_items_category_id_fkey
  foreign key (category_id) references public.categories(id) on delete set null;

comment on column public.customer_supplied_items.category_id is
  'FK to public.categories (the Category master), NOT config_lookups — see 0356. '
  'Scoped in the UI by item class: SEW for the Sewing card, PACK for Packaging.';
