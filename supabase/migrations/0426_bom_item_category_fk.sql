-- =============================================================================
-- 0426 — Material BOM ▸ Items ▸ Category points at the Category master
-- -----------------------------------------------------------------------------
-- THIS CLOSES THE REMAINDER 0356 NAMED. That migration fixed Customer ▸ Supplied
-- Items, which had the identical bug, and ended:
--
--   "The only other suspect is `material_bom_amendment_items.category_id`, which
--    is flagged for review rather than changed here."
--
-- The client reported it on 2026-08-17 (screenshot 2314): the Category cell on a
-- BOM line offered exactly two values, "Sewing Accessory" and "Packing
-- Accessory". Those are the names of the two item-class GROUPS, not the
-- categories inside them — BUTTON, LABEL, SEWING THREAD, TAPE for sewing; POLY
-- BAG, TAGS for packing. Picking one stored a group name in a category slot.
--
-- The cause is one line in 0265:
--
--   category_id uuid references public.config_lookups(id),  -- "Category"
--
-- `config_lookups` where kind = 'material_category' holds exactly those two
-- rows. This is the same mistake 0355 fixed for `state_id` and 0356 for supplied
-- items: a column left pointing at config_lookups after the thing it references
-- grew a master of its own.
--
-- ## WHY THE REPOINT IS THE FEATURE, NOT THE TIDY-UP
--
-- `items.category_id` has referenced `public.categories` since 0226. So the BOM
-- line and the material it names BOTH have a Category, and they have simply been
-- pointing at different tables — which is why the Category cell could never
-- narrow the Material picker beside it to anything finer than the item class
-- (`materialsForCategory` in lib/orders/material-bom-amendment/material-options.ts
-- mapped the lookup CODE onto a class as a workaround). After this the two are
-- comparable and the cascade AGENTS.md asks for is expressible for the first
-- time.
--
-- ## NON-RESOLVING VALUES ARE NULLED, NOT MAPPED
--
-- Any stored `category_id` that does not resolve in `categories` is one of the
-- two group rows. There is no correct category to map "Sewing Accessory" onto,
-- because it never named one — a guess would invent data in a column a purchase
-- requirement is planned from. Reported with a notice so the count is known and
-- the operator can re-pick, exactly as 0356 did.
-- =============================================================================

-- 1) Drop references that cannot survive the repoint. Reported, not silent.
do $$
declare orphans bigint;
begin
  select count(*) into orphans
    from public.material_bom_amendment_items i
   where i.category_id is not null
     and not exists (select 1 from public.categories c where c.id = i.category_id);

  if orphans > 0 then
    raise notice '0426: clearing % material_bom_amendment_items.category_id value(s) that named a config_lookups group rather than a category — those lines must be re-picked', orphans;
    update public.material_bom_amendment_items i
       set category_id = null
     where i.category_id is not null
       and not exists (select 1 from public.categories c where c.id = i.category_id);
  else
    raise notice '0426: no material_bom_amendment_items.category_id values needed clearing';
  end if;
end $$;

-- 2) Repoint the constraint.
--    ON DELETE SET NULL preserved from 0265: a BOM line is a statement that this
--    order needs a material, and it must survive its category being retired
--    rather than vanish with it — losing the line would silently shrink a
--    requirement a purchase order is checked against. Deleting an in-use
--    category is already blocked at the application layer by the
--    deleteOrDeactivate guard (0344), so this is a backstop.
alter table public.material_bom_amendment_items
  drop constraint if exists material_bom_amendment_items_category_id_fkey;

alter table public.material_bom_amendment_items
  add constraint material_bom_amendment_items_category_id_fkey
  foreign key (category_id) references public.categories(id) on delete set null;

comment on column public.material_bom_amendment_items.category_id is
  'FK to public.categories (the Category master), NOT config_lookups — see 0426, '
  'which closes the remainder 0356 flagged. Offered in the UI as the categories of '
  'the SEW and PACK item classes together, and compared against items.category_id '
  '(0226) to narrow the Material picker on the same row.';

-- 3) VERIFY FROM THE CATALOG, not from the migration having run.
--    AGENTS.md records that {"success": true} means the SQL ran, not that it
--    achieved its stated goal — 0386 asserted its own success and shipped a
--    no-op. So this reads pg_constraint back.
do $$
declare target regclass;
begin
  select confrelid::regclass into target
    from pg_constraint
   where conrelid = 'public.material_bom_amendment_items'::regclass
     and conname  = 'material_bom_amendment_items_category_id_fkey';

  if target is null then
    raise exception '0426: material_bom_amendment_items_category_id_fkey is missing';
  end if;

  if target <> 'public.categories'::regclass then
    raise exception '0426: category_id still references % — the repoint did not take', target;
  end if;

  -- The whole point of the change: a BOM line's category and a material's
  -- category must now be the same kind of thing, or the cascade is still a lie.
  -- Found by COLUMN rather than by constraint name — 0226 added it inline, so
  -- the name is Postgres's own and a rename would make a name lookup report a
  -- missing FK that is actually present.
  if not exists (
    select 1
      from pg_constraint con
      join pg_attribute a
        on a.attrelid = con.conrelid
       and a.attnum   = con.conkey[1]
     where con.conrelid  = 'public.items'::regclass
       and con.contype   = 'f'
       and array_length(con.conkey, 1) = 1
       and a.attname     = 'category_id'
       and con.confrelid = 'public.categories'::regclass
  ) then
    raise exception '0426: items.category_id does not reference public.categories — the two sides are not comparable';
  end if;

  raise notice '0426: category_id repointed to public.categories, and items.category_id agrees';
end $$;
