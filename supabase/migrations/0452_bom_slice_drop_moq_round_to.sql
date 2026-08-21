-- =============================================================================
-- 0452 — and straight back out again
--
-- 0451 put `moq` and `round_to` on the slice override store on the client's
-- instruction that they were "also attribute based". Minutes later they
-- corrected it: MOQ and Round To are COMMON, and belong on the line's first
-- field row beside Category and Material. That is where they now sit.
--
-- ## DROPPED RATHER THAN LEFT DEAD
--
-- 0451's own header records why a per-row minimum is dangerous — it multiplies,
-- 0437's six-colour example — so leaving two unused columns standing, carrying
-- exactly that risk, is an invitation to wire them up later without reading the
-- reason they were never used. The PAIR of migrations is the record of the
-- decision; the columns are not.
--
-- The line keeps both, and `lineQuantity` still applies them ONCE to the line's
-- rolled-up total. Unchanged since 0437, and it is what the purchase ceiling
-- reads through `bomCeilingForOrder`.
--
-- Free: zero rows, and no code ever read the columns.
-- =============================================================================

alter table public.material_bom_amendment_item_slices
  drop constraint if exists chk_mba_slice_moq,
  drop constraint if exists chk_mba_slice_round_to;

alter table public.material_bom_amendment_item_slices
  drop column if exists moq,
  drop column if exists round_to;

do $assert$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_item_slices'
       and column_name in ('moq', 'round_to')
  ) then
    raise exception '0452: the per-row minimum or step survived the drop';
  end if;

  -- THE LINE STILL CARRIES BOTH, or the quantity chain has nowhere to read them
  -- and every Final Quantity silently loses its floor.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_items'
       and column_name = 'moq'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_items'
       and column_name = 'round_to'
  ) then
    raise exception '0452: the LINE lost moq or round_to — that is where they live';
  end if;
end $assert$;
