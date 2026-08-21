-- =============================================================================
-- 0451 — The minimum and the step, briefly per attribute value
--
-- SUPERSEDED BY 0452 THE SAME MINUTE. Kept, because a round trip is the record of
-- a decision rather than a mistake to hide — and because the reason it came back
-- out is the most useful thing either file has to say.
--
-- The client asked for MOQ and Round To to be "also attribute based", alongside
-- Items, Pcs and Excess %. Shown what that does to a purchase, they moved them
-- straight back to the line's first field row.
--
-- ## WHY THESE TWO ARE NOT LIKE THE OTHER FIVE
--
-- Item Color, Specification, Size/Spec, Items, Pcs and Excess % are properties
-- of a SLICE — how much of the material that colourway or destination consumes,
-- and what it looks like. A minimum and a rounding step are properties of the
-- PURCHASE: facts about what may be bought of a material at all. Applying either
-- per row therefore buys it once per row.
--
-- 0437 settled this with the client on 2026-08-19 with the worked example: six
-- colour rows each floored at 500 buys 3,000, where one purchase of 500 covers
-- the lot. It is the same argument 0418 makes for keeping MOQ off
-- `material_bom_amendment_requirements`, and the reason 0437 ships a guard that
-- fails if either column ever appears there.
--
-- Free in both directions: the table held zero rows and no code ever read these.
-- =============================================================================

alter table public.material_bom_amendment_item_slices
  add column if not exists moq       numeric(14,3),
  add column if not exists round_to  numeric(14,3);

alter table public.material_bom_amendment_item_slices
  drop constraint if exists chk_mba_slice_moq;
alter table public.material_bom_amendment_item_slices
  add constraint chk_mba_slice_moq check (moq is null or moq >= 0);

alter table public.material_bom_amendment_item_slices
  drop constraint if exists chk_mba_slice_round_to;
alter table public.material_bom_amendment_item_slices
  add constraint chk_mba_slice_round_to check (round_to is null or round_to >= 0);

do $assert$
begin
  -- Nullable, because NULL is how "inherit the line's" is expressed.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_item_slices'
       and column_name in ('moq', 'round_to')
       and is_nullable = 'NO'
  ) then
    raise exception '0451: an override figure was made NOT NULL — "inherit the line" becomes unexpressible';
  end if;

  -- 0437's boundary is UNMOVED either way: a requirement row carries neither.
  -- The override store is a different table answering a different question.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_requirements'
       and column_name in ('moq', 'round_to', 'final_qty')
  ) then
    raise exception '0451: moq/round_to reached a requirement row — 0418 and 0437 both forbid it';
  end if;
end $assert$;
