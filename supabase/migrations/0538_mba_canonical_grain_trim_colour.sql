-- ============================================================================
-- Raagam ERP — 0538 `mba_canonical_grain()` was missing `trim_colour`
--
-- Reported by the client: saving a Material BOM line split by "Combination"
-- (the Combination sheet's own attribute, 0436) failed with
--   new row for relation "material_bom_amendment_items" violates check
--   constraint "chk_mba_item_grain_canonical"
--
-- `lib/orders/bom-explosion/exploder.ts` has six axes —
--   style_ref, colour, size, trim_colour, country, pack
-- — and `trim_colour` (the client's own word for it is "Combination", see
-- that file's own note on why the storage name deliberately differs) is a
-- REAL, STORED grain: `mba-master-screen.tsx`'s Combination sheet writes rows
-- whose `requirement_grain` names it directly, not through `requirement_basis`
-- (`BASIS_AXES` never produces it — only the Attribute picker's own axis
-- checkboxes do).
--
-- `mba_canonical_grain()` (0455) never learned about it. Both it and
-- `trim_colour` itself were introduced in the SAME commit, and the function's
-- known-axis list was written as five tokens —
--   array['style_ref', 'colour', 'size', 'country', 'pack']
-- — one short of `AXES`. Because the function FILTERS to known axes
-- (`where a = any(g)`), a grain carrying `trim_colour` does not error inside
-- the function — it comes back one element SHORTER than it went in, so
-- `requirement_grain = mba_canonical_grain(requirement_grain)` is false for
-- every such row, and `chk_mba_item_grain_canonical` rejects it. Every other
-- axis combination happened to omit `trim_colour` (five of the six legacy
-- `requirement_basis` values map to grains that never include it — see
-- `BASIS_AXES` in exploder.ts), which is the only reason this went unnoticed
-- until the Combination sheet was used.
--
-- THE FIX IS THE ARRAY LITERAL, NOT THE FUNCTION'S SHAPE. `create or replace`
-- keeps the same signature (`text[] -> text[]`), so the CHECK constraint and
-- every existing caller (`chk_mba_item_grain_canonical` here,
-- `material_bom_amendment_requirements`'s own CHECK from 0456) keep working
-- unchanged — only the vocabulary the function recognises grows by one, in
-- the exact slot `AXES` puts it in.
-- ============================================================================

create or replace function public.mba_canonical_grain(g text[])
returns text[]
language sql
immutable strict parallel safe
as $fn$
  select array(
    select a
      from unnest(array['style_ref', 'colour', 'size', 'trim_colour', 'country', 'pack']) as a
     where a = any(g)
  )
$fn$;

comment on function public.mba_canonical_grain(text[]) is
  'The canonical form of a Material BOM explosion grain: unknown axes and repeats dropped, survivors in canonical order. Mirrors canonicalAxes() in lib/orders/bom-explosion/exploder.ts. Used by chk_mba_item_grain_canonical so a grain has ONE spelling in the database. `trim_colour` (0538) was missing from this list since 0455 — the Combination sheet is the one caller that ever wrote it.';

-- NO FUNCTION IN `public` IS EXECUTABLE BY `anon` (AGENTS.md, "Function
-- grants"). `create or replace` on an unchanged signature preserves the
-- existing ACL, so this is a belt-and-braces re-assertion rather than a fix —
-- both grants, in one statement, same as 0455.
revoke all on function public.mba_canonical_grain(text[]) from public, anon;


-- ---------- assertions ------------------------------------------------------
--
-- Proves the fix rather than trusting the literal: a grain naming every axis
-- INCLUDING `trim_colour` must now round-trip unchanged, in `AXES` order, and
-- an unknown token must still be dropped (the function must not have quietly
-- become an identity pass-through).

do $assert$
begin
  if public.mba_canonical_grain(array['trim_colour', 'style_ref'])
     is distinct from array['style_ref', 'trim_colour']
  then
    raise exception '0538: trim_colour is still not recognised as a canonical axis';
  end if;

  if public.mba_canonical_grain(
       array['pack', 'country', 'trim_colour', 'size', 'colour', 'style_ref']
     ) is distinct from
     array['style_ref', 'colour', 'size', 'trim_colour', 'country', 'pack']
  then
    raise exception '0538: the full six-axis grain does not come back in AXES order';
  end if;

  if public.mba_canonical_grain(array['not_a_real_axis', 'colour'])
     is distinct from array['colour']
  then
    raise exception '0538: an unknown axis is no longer being dropped';
  end if;
end $assert$;
