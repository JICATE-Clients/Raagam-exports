-- ============================================================================
-- Raagam ERP — 0409 A combo structure is a fabric CATEGORY, not a knit family
--
-- 0408 (minutes old) pointed
-- `garment_order_amendment_combo_structures.structure_id` at `config_lookups`
-- kind 'fabric_structure', reasoning that the Color/Print tab's own Structures
-- grid picks from that list and the same question should read from the same
-- place. The reasoning was fine; the premise was wrong, and the CATALOG says so:
--
--     config_lookups kind='fabric_structure'
--         circular = Circular Knit | flat_knit = Flat Knit | woven = Woven
--
--     categories  (39 rows)
--         … 1X1 LYCRA RIB | 2X2 RIB | SINGLE JERSEY …
--
-- The legacy screen's Structure column reads SINGLE JERSEY, 1X1 LYCRA RIB and
-- SINGLE JERSEY 1 (screenshots 2259 · 2260). Those are CATEGORIES. Circular
-- Knit is not a structure an operator would ever type there — it is the FAMILY
-- the structure belongs to, and `categories.fabric_structure_id` already holds
-- exactly that link (10 of the 39 categories carry one today).
--
-- So the two lists are not rivals and neither is redundant. They are two levels
-- of one fact, and this column wants the finer one.
--
--
-- THIS IS THE SAME ANSWER 0405 ALREADY GAVE ON THE STYLE MASTER, which is the
-- strongest argument for it: `garment_style_components.fabric_category_id` was
-- renamed FROM `structure_id` and repointed at `categories` for this exact
-- reason, and the component's Type is fetched from the picked category's
-- `fabric_structure_id`. A garment order naming its fabrics differently from
-- the style master those fabrics are defined on is the drift that FK mismatches
-- are made of — same column name, different target, compiles either way.
--
-- WHAT THIS BUYS BEYOND CORRECTNESS: the knit family becomes DERIVED rather
-- than asked. 0397 recorded the rule "Circular Knit → GSM compulsory; Woven or
-- Flat Knit → optional" and noted it could not be a CHECK because SQL cannot
-- see through the uuid. It still cannot — but now the screen resolves the
-- family through the picked category instead of putting a second question to
-- the operator that could disagree with the first.
--
-- Safe to repoint rather than migrate: the table was created minutes ago by
-- 0408 and holds 0 rows, so there is no value to translate and no row that
-- could fail the new constraint.
--
-- Kept as its own migration rather than folded into 0408: 0408 has already run,
-- and editing an applied migration changes nothing (the lesson 0400 records).
-- ============================================================================

alter table public.garment_order_amendment_combo_structures
  drop constraint if exists garment_order_amendment_combo_structures_structure_id_fkey;

alter table public.garment_order_amendment_combo_structures
  add constraint garment_order_amendment_combo_structures_structure_id_fkey
  foreign key (structure_id) references public.categories(id);

comment on column public.garment_order_amendment_combo_structures.structure_id is
  'The fabric CATEGORY — SINGLE JERSEY, 1X1 LYCRA RIB. Matches '
  'garment_style_components.fabric_category_id (0405). The knit family '
  '(Circular / Flat / Woven) is DERIVED through categories.fabric_structure_id, '
  'never asked a second time here — it is what makes GSM compulsory.';


-- ---------------------------------------------------------------------------
-- Read the result out of the catalog. `{"success": true}` means the SQL ran,
-- not that it achieved its goal.
--
-- Both halves are asserted, because a `drop constraint if exists` that matched
-- nothing followed by an `add` that silently landed on the old target is the
-- shape of failure this check exists for.
-- ---------------------------------------------------------------------------
do $verify$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid  = 'public.garment_order_amendment_combo_structures'::regclass
       and c.contype   = 'f'
       and c.confrelid = 'public.categories'::regclass
       and c.conkey    = array[(select attnum from pg_attribute
                                 where attrelid = 'public.garment_order_amendment_combo_structures'::regclass
                                   and attname  = 'structure_id')]
  ) then
    raise exception '0409: structure_id does not point at public.categories';
  end if;

  if exists (
    select 1 from pg_constraint c
     where c.conrelid  = 'public.garment_order_amendment_combo_structures'::regclass
       and c.contype   = 'f'
       and c.confrelid = 'public.config_lookups'::regclass
       and c.conkey    = array[(select attnum from pg_attribute
                                 where attrelid = 'public.garment_order_amendment_combo_structures'::regclass
                                   and attname  = 'structure_id')]
  ) then
    raise exception '0409: structure_id still ALSO points at config_lookups';
  end if;

  -- The derivation this repoint exists to enable must actually be reachable:
  -- a category has to be able to name its knit family, or the GSM rule has
  -- nothing to read and 0397''s rule quietly becomes unenforceable.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='categories'
       and column_name='fabric_structure_id'
  ) then
    raise exception '0409: categories.fabric_structure_id is gone — the knit family cannot be derived';
  end if;
end $verify$;
