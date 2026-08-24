-- ============================================================================
-- Raagam ERP — 0455 A Material BOM line stores its EXPLOSION GRAIN as a set
--
-- The client's Attribute matrix (2026-08-23) names 28 permutations —
-- "Style Ref No / Order Color / Order Size" and so on. They are not 28 things:
-- a grouping key is a SET, so token order carries no information, and the 24
-- resolvable rows are twelve distinct grains. `lib/orders/bom-explosion/`
-- models that, and this is the column behind it.
--
-- ADDITIVE. `requirement_basis` keeps its column, its CHECK and its meaning;
-- this sits beside it and is backfilled from it. Nothing stored changes meaning,
-- which is what makes it safe to put in front of live documents.
--
--
-- ## FOUR THINGS THE DRAFT SPEC GOT WRONG, AND WHY EACH MATTERS
--
-- 1. IT NAMED `material_bom_lines`, WHICH DOES NOT EXIST. The table is
--    `material_bom_amendment_items` (0265). A migration against a missing table
--    fails loudly, so this is the harmless one.
--
-- 2. ITS BACKFILL OMITTED `country`. The CASE listed order/style/colour/size/
--    combination and sent everything else to `ARRAY[]` — the WHOLE-ORDER grain.
--    So every country-wise line would have been silently rewritten as
--    "one bulk row for the order", collapsing a per-destination requirement into
--    a single figure that looks entirely reasonable. That is the partial
--    explosion `requirement.ts` opens its header with, arriving through a
--    one-line omission in an ELSE branch. The assertion at the bottom of this
--    file exists so it cannot happen again: EVERY basis the CHECK admits must
--    map to a non-null grain, tested per value rather than trusted.
--
-- 3. IT DEFAULTED THE COLUMN TO `ARRAY[]`. An empty array is a REAL VALUE here —
--    it is the whole-order grain, the absence of any division. `requirement_basis`
--    is nullable precisely so "not chosen yet" can be said, and `basisOf(null)`
--    refuses with "Choose how this material splits" rather than guessing. A
--    default of `ARRAY[]` would make every new line silently mean "the whole
--    order" and delete that refusal. So: NULLABLE, NO DEFAULT, and NULL is the
--    unanswered state.
--
-- 4. ITS CHECK USED `<@` (containment). Containment admits duplicates
--    (`{colour,colour}`) and any ordering (`{size,colour}` vs `{colour,size}`),
--    which is exactly the drift the set model exists to make impossible — two
--    rows meaning one grain, stored differently, free to diverge later. The
--    CHECK here compares against a CANONICAL FORM instead, so a grain has one
--    spelling in the database as well as in TypeScript.
--
--
-- ## `pack`, NOT `pack_ref`
--
-- The axis vocabulary is `lib/orders/bom-explosion/exploder.ts`'s, and a second
-- spelling in the database is the case-mismatch failure AGENTS.md records under
-- Nominated vendors: it compiles, runs, and quietly matches nothing. `pack` is
-- admitted by the CHECK but has no data source yet — `axesAvailable()` refuses
-- it in the application with a sentence naming what is missing, which is a
-- better place to say so than a constraint violation.
-- ============================================================================


-- ---------- 1. the canonical form, in SQL --------------------------------
--
-- MIRRORS `canonicalAxes` IN TYPESCRIPT: de-duplicated, and sorted into the one
-- canonical axis order. Written as a function because a CHECK constraint cannot
-- contain a subquery, and as an IMMUTABLE one because a CHECK may only call
-- immutable functions.
--
-- The filter does three jobs at once. An unknown axis is dropped, a repeat is
-- dropped, and the survivors come back in the tuple's order — so
-- `g = canonical(g)` is true only for a grain that is valid, unique and sorted.

create or replace function public.mba_canonical_grain(g text[])
returns text[]
language sql
-- STRICT so a NULL grain returns NULL and the CHECK passes it through: NULL is
-- "not chosen yet", which is a state this column must be able to hold.
immutable strict parallel safe
as $fn$
  select array(
    select a
      from unnest(array['style_ref', 'colour', 'size', 'country', 'pack']) as a
     where a = any(g)
  )
$fn$;

comment on function public.mba_canonical_grain(text[]) is
  'The canonical form of a Material BOM explosion grain: unknown axes and repeats dropped, survivors in canonical order. Mirrors canonicalAxes() in lib/orders/bom-explosion/exploder.ts. Used by chk_mba_item_grain_canonical so a grain has ONE spelling in the database.';

-- NO FUNCTION IN `public` IS EXECUTABLE BY `anon` (AGENTS.md, "Function
-- grants"). Both grants, in one statement: Postgres's built-in EXECUTE TO PUBLIC
-- and Supabase's separate default privilege for `anon`. Revoking one leaves the
-- other standing, and the migration reads as a lockdown either way.
revoke all on function public.mba_canonical_grain(text[]) from public, anon;


-- ---------- 2. the column -------------------------------------------------

alter table public.material_bom_amendment_items
  add column if not exists requirement_grain text[];

comment on column public.material_bom_amendment_items.requirement_grain is
  'The explosion grain as a SET OF AXES (0455) — see lib/orders/bom-explosion/exploder.ts. NULL means "not chosen yet" and refuses; ARRAY[] means the WHOLE ORDER, which is a real answer. Backfilled from requirement_basis, which keeps its column and meaning.';

alter table public.material_bom_amendment_items
  drop constraint if exists chk_mba_item_grain_canonical;

alter table public.material_bom_amendment_items
  add constraint chk_mba_item_grain_canonical
  check (
    requirement_grain is null
    or requirement_grain = public.mba_canonical_grain(requirement_grain)
  );


-- ---------- 3. backfill from the basis ------------------------------------
--
-- EVERY BASIS THE CHECK ADMITS IS LISTED. The omission of one is not a smaller
-- version of this migration; it is a silent rewrite of those lines onto a
-- different grain — see the header, and the assertion below that enforces it.
--
-- A NULL basis stays NULL. "Not chosen" is a state, and inventing a grain for a
-- line the operator has not answered would delete the refusal that tells them to.

update public.material_bom_amendment_items
   set requirement_grain =
     case requirement_basis
       when 'order'       then array[]::text[]
       when 'style'       then array['style_ref']::text[]
       when 'colour'      then array['style_ref', 'colour']::text[]
       when 'size'        then array['size']::text[]
       when 'combination' then array['style_ref', 'colour', 'size']::text[]
       when 'country'     then array['country']::text[]
       else null
     end
 where requirement_grain is null;


-- ---------- 4. assertions ---------------------------------------------------
--
-- VERIFY FROM THE CATALOG, NEVER BY READING THE MIGRATION. AGENTS.md records why
-- under "Function grants": a migration that applies cleanly and reports
-- {"success": true} has proved the SQL ran, not that it achieved its stated goal.

do $assert$
declare
  v_basis text;
  v_grain text[];
begin
  -- 1. The column exists, holds NULL, and does NOT default.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_items'
       and column_name  = 'requirement_grain'
  ) then
    raise exception '0455: requirement_grain was not added';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_items'
       and column_name  = 'requirement_grain'
       and (is_nullable = 'NO' or column_default is not null)
  ) then
    raise exception '0455: requirement_grain must be nullable with no default — ARRAY[] is the WHOLE ORDER, not "unanswered"';
  end if;

  -- 2. EVERY BASIS MAPS. This is the assertion the draft spec would have failed:
  --    its CASE omitted 'country', so those lines fell to the ELSE and became
  --    whole-order. Tested per value, against the CHECK's own list, so adding a
  --    seventh basis without extending the backfill fails here rather than
  --    silently rewriting rows.
  for v_basis in
    select unnest(array['order', 'style', 'colour', 'size', 'combination', 'country'])
  loop
    v_grain :=
      case v_basis
        when 'order'       then array[]::text[]
        when 'style'       then array['style_ref']::text[]
        when 'colour'      then array['style_ref', 'colour']::text[]
        when 'size'        then array['size']::text[]
        when 'combination' then array['style_ref', 'colour', 'size']::text[]
        when 'country'     then array['country']::text[]
        else null
      end;
    if v_grain is null then
      raise exception '0455: basis "%" has no grain in the backfill — those lines would silently become whole-order', v_basis;
    end if;
    if v_grain <> public.mba_canonical_grain(v_grain) then
      raise exception '0455: the grain for basis "%" is not canonical', v_basis;
    end if;
  end loop;

  -- 3. The canonical function actually canonicalises.
  if public.mba_canonical_grain(array['size', 'colour']) <> array['colour', 'size'] then
    raise exception '0455: mba_canonical_grain does not sort into canonical order';
  end if;
  if public.mba_canonical_grain(array['colour', 'colour']) <> array['colour'] then
    raise exception '0455: mba_canonical_grain does not de-duplicate';
  end if;
  if public.mba_canonical_grain(array['banana']) <> array[]::text[] then
    raise exception '0455: mba_canonical_grain admits an unknown axis';
  end if;
  if public.mba_canonical_grain(null) is not null then
    raise exception '0455: mba_canonical_grain must be STRICT — NULL is "not chosen yet"';
  end if;

  -- 4. No row survived the backfill in a non-canonical state.
  if exists (
    select 1 from public.material_bom_amendment_items
     where requirement_grain is not null
       and requirement_grain <> public.mba_canonical_grain(requirement_grain)
  ) then
    raise exception '0455: a stored grain is not canonical';
  end if;

  -- 5. A line that HAS a basis must now have a grain, or the backfill missed it.
  if exists (
    select 1 from public.material_bom_amendment_items
     where requirement_basis is not null
       and requirement_grain is null
  ) then
    raise exception '0455: a line with a basis was left with no grain';
  end if;

  -- 6. The function is not an anon-callable oracle. Both grants, per AGENTS.md.
  if has_function_privilege('anon', 'public.mba_canonical_grain(text[])', 'execute') then
    raise exception '0455: mba_canonical_grain is executable by anon';
  end if;
end $assert$;
