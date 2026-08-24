-- =============================================================================
-- 0463 — COMBINATION is its own axis on the slice row, and it is FREE TEXT
--
-- Client, 2026-08-24, with the legacy dialog beside ours:
--
--     "we need to redesign the combination screen just with the legacy ...
--      inside screen Combination Details inside only S No, Combination — these
--      fields only. That S No is automatic and Combination free text. After
--      give Done, in screen it will populate — how we list that Attribute
--      value, like that, Combination's five data field value also will be
--      added in that split."
--
-- So the popup collects NAMES ONLY (TOP, BOTTOM, NECK RIB), one per typed row,
-- and the line then splits one sub-row per name. The figures — Item Color,
-- Specification, No of Items, No of Pcs, Allowance — are filled in the split,
-- not in the popup.
--
--
-- ## THIS REVERSES THE 2026-08-24 RULING RECORDED IN bom-combination-sheet.tsx
--
-- That ruling ("keep ours, retire legacy's name list") stood for one day. Its
-- own header said restoring the name list "needs a new client decision, not a
-- tidy-up" — this migration IS that decision, arriving the same day. The
-- superseded reasoning stays in the file rather than being deleted, the way
-- 0431 kept 0402's: a later reader has to be able to see that the divergence
-- was considered and dropped, not overlooked.
--
-- One claim in that ruling was WRONG and is corrected here so it does not get
-- quoted forward: restoring the name list does NOT "silently un-read
-- colourSplits". Item Color rides on the split row (0449), so the trim-colour
-- grouping that feeds MOQ-per-cone-colour keeps its input — it simply reads
-- slices instead of components. What the ruling should have flagged is the
-- `combo` collision below.
--
--
-- ## WHY A NEW COLUMN AND NOT `combo`
--
-- `combo` is TAKEN, and it means something else. 0442 states it in the column
-- comment itself:
--
--     'The colourway BY NAME, as garment_order_amendment_price_details.combo
--      does it — a combo is a name on the Combos tab, not a lookup row.'
--
-- It is load-bearing as a JOIN KEY in three places: the screen narrows its
-- options to the ORDER's combos for that line's style; `colourOf` reads it as
-- the garment colour on a colour-wise line; and `compose.ts` matches assort
-- rows to a slice by combo through `comboKey`. A colourway is chosen from a
-- controlled list; a Combination is typed. Putting a typed TOP into a column
-- the composer joins on by name is how a match silently becomes zero rows —
-- the same drift AGENTS.md records under Nominated vendors, where two spellings
-- of one supply type compiled, ran, and matched nothing.
--
-- The client confirmed the two are SEPARATE axes (2026-08-24, on being asked
-- directly): TOP and BOTTOM are garment parts, not colourways. A garment can be
-- RED/WHITE colourway AND split TOP/BOTTOM, and both must survive on one row.
--
--
-- ## IT JOINS THE UNIQUE KEY, OR TWO PARTS COLLIDE AT ONE COLOURWAY
--
-- Same argument 0449 made for `country_id`, one axis along: without it, TOP and
-- BOTTOM under one colourway and size are byte-identical keys, and one typed
-- figure would silently answer for the other — on the number a purchase order
-- is written from. `coalesce(..., '')` because NULL here is a real value ("this
-- line has no combinations"), and two of those must collide.
--
-- Widening a unique index can only ever REMOVE collisions, so this is safe on
-- existing rows by construction. Both tables are empty today (verified from the
-- catalog, not assumed: 0 rows in item_slices and item_components), so there is
-- no backfill and nothing to lose.
--
--
-- ## `material_bom_amendment_item_components` (0436) IS NOT DROPPED HERE
--
-- Its only writer is the Combination sheet this change retires, and it holds no
-- rows — but dropping a table in the same migration that removes its last
-- consumer leaves no release in which to notice a mistake. It stops being
-- written in this change and is dropped in a later one, deliberately, rather
-- than being left as a second store nobody declared retired. AGENTS.md records
-- the cost of the alternative under Pack type vs Assortment Type: two stores,
-- alive at once, distinguished by wording only.
-- =============================================================================

alter table public.material_bom_amendment_item_slices
  add column if not exists combination text;

comment on column public.material_bom_amendment_item_slices.combination is
  'Legacy''s Combination: a garment part typed by hand in the Combination popup '
  '(TOP, BOTTOM, NECK RIB), one split row each. FREE TEXT and deliberately NOT '
  '`combo`, which is the colourway by name and is joined on by the composer '
  '(0463).';

-- `nulls not distinct` is expressed the way every key on this table expresses
-- it — coalesce to a sentinel — because a plain unique index treats two NULLs
-- as distinct and a line with no combinations would then admit duplicate rows.
drop index if exists public.uq_mba_slice_line_combo_size;
create unique index uq_mba_slice_line_combo_size
  on public.material_bom_amendment_item_slices (
    item_line_id,
    coalesce(combo, ''),
    coalesce(size_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(country_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(combination, '')
  );

do $assert$
declare
  v_idx text;
begin
  -- 1. The column landed. `add column if not exists` is silent when it does
  --    not, which is exactly how 0436 shipped an unapplied column that broke
  --    every insert while reading as applied.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_item_slices'
       and column_name  = 'combination'
  ) then
    raise exception '0463: slices.combination was not added';
  end if;

  -- 2. The key carries it, or TOP and BOTTOM collide under one colourway.
  select indexdef into v_idx from pg_indexes
   where schemaname = 'public' and indexname = 'uq_mba_slice_line_combo_size';
  if v_idx is null then
    raise exception '0463: uq_mba_slice_line_combo_size is missing — the drop ran and the create did not';
  end if;
  if position('combination' in v_idx) = 0 then
    raise exception '0463: the slice key does not include combination — TOP and BOTTOM would collide';
  end if;

  -- 3. 0449's and 0442's assertions, re-run rather than trusted. This migration
  --    rebuilds their index, so a mistake here silently un-does them.
  if position('country_id' in v_idx) = 0 then
    raise exception '0463: rebuilding the key dropped country_id — 0449 undone';
  end if;
  if position('size_id' in v_idx) = 0 then
    raise exception '0463: rebuilding the key dropped size_id — 0442 undone';
  end if;
end
$assert$;
