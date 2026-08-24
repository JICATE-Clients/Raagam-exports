-- =============================================================================
-- 0464 — The slice key carries the STYLE, or two styles share one figure
--
-- Found while building 0463's Combination column, in the grid it appears in.
-- This is a LIVE DEFECT, not a refinement, and it is the third instance of one
-- shape: an axis the requirement side keys on that the override store does not.
--
--
-- ## THE REPRODUCTION, RUN BEFORE THE FIX
--
-- `productionSlices` builds a style-basis row with `style_ref_no` set and combo,
-- size and country all NULL (requirement.ts, the `basis === "style"` branch). So
-- for every style on the line:
--
--     key(style A) = ":::"    key(style B) = ":::"    SAME KEY? true
--     B resolves to A's typed figure: 5
--
-- Type Items = 5 against style A and style B silently answers 5 as well. That is
-- the figure a purchase order is written from, and there is nothing on screen to
-- suggest the second row was never asked.
--
-- It is invisible on a single-style order, which is most of them — the two rows
-- have to exist before they can collide — so it has been latent since 0440 added
-- the style basis.
--
--
-- ## IT IS THE 0449 BUG, ONE AXIS OVER, AND 0449 SAID SO
--
-- 0449 added `country_id` to this key with the argument that "the requirement
-- side has keyed on `country_id` since 0444; leaving it out here is the two
-- stores disagreeing about what one row is". The same sentence is true of the
-- style, and could have been written then:
--
--     uq_mba_req_slice = (item_line_id, style_ref_no, combo, size_id,
--                         country_id, item_color_id)   NULLS NOT DISTINCT
--
-- The requirement key has held `style_ref_no` all along. The override store has
-- never had the column at all — so this is not a new axis, it is the second
-- store catching up with the one beside it, exactly as 0449 framed itself.
--
-- 0463 was the same shape a third time (a typed combination). Three in one
-- family is why `OVERRIDE_FIELDS` exists and is asserted as a SET in
-- `check-bom-slices.mts`: a whole-set comparison is the only thing that catches
-- a MISSING key, and a missing key is what all three of these were.
--
--
-- ## WHY THERE IS NO BACKFILL, AND WHY THIS IS THE MOMENT
--
-- `material_bom_amendment_item_slices` holds ZERO rows — verified from the
-- catalog, not assumed. So no stored override changes meaning and no figure
-- moves. Once the table has data this fix becomes a migration that has to decide
-- which style an existing ":::" row belonged to, and that question has no honest
-- answer: the row was written by an operator who was shown one grid and whose
-- figure was silently shared. Doing it now costs nothing; doing it later costs a
-- guess about somebody's purchase quantity.
--
-- `combination` is deliberately NOT added to the requirement key alongside this.
-- Parts SUM AWAY by colour on that side — 0436's "you do not buy sleeve-thread
-- and front-thread, you buy thread" — so `colourSplits` collapsing TOP and
-- BOTTOM of one colour into one rate is the intended behaviour, and a
-- combination column on the requirement table would defeat it.
--
--
-- ## TEXT, NOT AN FK, AND THAT MATCHES BOTH NEIGHBOURS
--
-- A style is a NAME here, the same choice `material_bom_amendment_requirements`
-- and `combo` both make (0442: "a combo is a name on the Combos tab, not a
-- lookup row"). Orders key styles by text throughout; a `style_id` FK would be
-- the wrong fix and AGENTS.md's amendment notes say so in as many words.
-- =============================================================================

alter table public.material_bom_amendment_item_slices
  add column if not exists style_ref_no text;

comment on column public.material_bom_amendment_item_slices.style_ref_no is
  'Which style this override is for. PART OF THE KEY (0464): a style-basis line '
  'produces rows whose only distinguishing axis is this, so without it every '
  'style on the line shared one typed figure. Text, as material_bom_amendment_'
  'requirements.style_ref_no and `combo` both are — a style is a name here.';

-- Appended rather than inserted in the requirement key's order: the POSITION of
-- a segment is arbitrary, the SET is not. What has to match `uq_mba_req_slice`
-- is which axes are present, and `check-bom-slices.mts` asserts that as a set.
drop index if exists public.uq_mba_slice_line_combo_size;
create unique index uq_mba_slice_line_combo_size
  on public.material_bom_amendment_item_slices (
    item_line_id,
    coalesce(combo, ''),
    coalesce(size_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(country_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(combination, ''),
    coalesce(style_ref_no, '')
  );

do $assert$
declare
  v_idx text;
  v_req text;
  ax    text;
begin
  -- 1. The column landed. `add column if not exists` is silent when it does not,
  --    which is how 0436 shipped an unapplied column that broke every insert
  --    while reading as applied.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_item_slices'
       and column_name  = 'style_ref_no'
  ) then
    raise exception '0464: slices.style_ref_no was not added';
  end if;

  select indexdef into v_idx from pg_indexes
   where schemaname = 'public' and indexname = 'uq_mba_slice_line_combo_size';
  if v_idx is null then
    raise exception '0464: uq_mba_slice_line_combo_size is missing — the drop ran and the create did not';
  end if;

  -- 2. THE PARITY THIS MIGRATION EXISTS FOR. Every axis the requirement key
  --    carries must be in the override key, checked against the LIVE index
  --    rather than against a list copied into this file — a hand-copied list
  --    goes stale the next time either side gains an axis, and going stale
  --    silently is the whole failure mode being fixed here.
  select indexdef into v_req from pg_indexes
   where schemaname = 'public' and indexname = 'uq_mba_req_slice';
  if v_req is null then
    raise exception '0464: uq_mba_req_slice is missing — cannot verify parity';
  end if;

  foreach ax in array array['style_ref_no', 'combo', 'size_id', 'country_id']
  loop
    if position(ax in v_req) > 0 and position(ax in v_idx) = 0 then
      raise exception '0464: % is in the requirement key but not the override key', ax;
    end if;
  end loop;

  -- 3. 0463's and 0449's parts, re-asserted rather than trusted: this migration
  --    rebuilds their index, so a mistake here silently un-does them.
  if position('combination' in v_idx) = 0 then
    raise exception '0464: rebuilding the key dropped combination — 0463 undone';
  end if;
end
$assert$;
