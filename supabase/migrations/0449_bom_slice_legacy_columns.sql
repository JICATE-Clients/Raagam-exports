-- =============================================================================
-- 0449 — The slice row becomes legacy's sub-row
--
-- Client, 2026-08-21, with the legacy screen beside ours (screenshots 2458 /
-- 2459): "our screen we right but field listing is wrong". The layout we
-- arrived at by following the Prices and Approval Qty tabs is correct; the
-- COLUMNS are not.
--
-- Legacy's nested grid carries Choose / Description / Size wise / Item Color /
-- Specification / Size-Spec / No of Items / No of Pcs. Ours carried the last two
-- and a derived total.
--
-- ## THE ONE THAT IS A BUG, NOT A FEATURE: `country_id`
--
-- Legacy's screen shows `Attribute = Country` with a SIZE-WISE TICK on each row.
-- The client has confirmed that model: the Attribute picks one axis and a row
-- splits ITSELF into sizes. So a country-wise line whose USA row is size-wise
-- produces a slice with NO combo and size = M — byte-identical to CH's M row.
--
--     sliceKey  = `${combo}:${size_id}`                    (slice-consumption.ts)
--     uq index  = (item_line_id, coalesce(combo), coalesce(size_id))   (0442)
--
-- Two destinations, one key. One typed figure would silently answer for the
-- other, on the number a purchase order is written from. The REQUIREMENT side
-- has keyed on `country_id` since 0444 — so this is not a new axis so much as
-- the override store catching up with the one beside it, which is exactly the
-- drift 0443 added a parity assertion to stop between the two CHECKs.
--
-- ## THIS CHANGES 0442's PREMISE, DELIBERATELY
--
-- 0442 built this as a SPARSE OVERRIDE STORE: "this table holds only the cells
-- an operator actually typed", and `writeChildren` skips any row with both
-- figures null. A row now also exists to carry a `chosen` untick, a `size_wise`
-- tick or a typed Specification — none of which is a figure.
--
-- What 0442 asserted still holds and is re-asserted below: both figures stay
-- NULLABLE, because NULL means INHERIT and a NOT NULL column cannot express it.
-- The skip test moves from "both figures null" to "nothing typed and every flag
-- at its default".
--
-- ## `chosen` DEFAULTS TRUE, AND THAT IS THE SAFE DIRECTION
--
-- An untick means "this destination buys none of this material", so the default
-- has to be the state that buys. A false default would silently zero every
-- existing plan.
--
-- Note what an untick must NOT become: a requirement row carrying a
-- `refusal_reason`. `bomCeilingForOrder` counts a refused row as `unanswered`
-- and `judgeLine` returns `unchecked` the moment that is non-zero — so ONE
-- deliberately excluded destination would switch the entire purchase-order
-- ceiling off. The excluded row is simply not emitted; the screen states the
-- count so the smaller total is never silent.
--
-- ## FREE
--
-- `material_bom_amendment_item_slices` holds ZERO rows (catalogue, 2026-08-21),
-- so every column is additive and the index rebuild rewrites nothing.
-- =============================================================================

alter table public.material_bom_amendment_item_slices
  add column if not exists country_id     uuid references public.countries(id),
  add column if not exists chosen         boolean not null default true,
  add column if not exists size_wise      boolean not null default false,
  add column if not exists item_color_id  uuid references public.config_lookups(id),
  add column if not exists specification  text,
  add column if not exists size_spec      text;

comment on column public.material_bom_amendment_item_slices.country_id is
  'The destination this override is for (0449). PART OF THE KEY: a country-wise '
  'line whose rows are size-wise produces slices with no combo, so USA-M and '
  'CH-M are otherwise identical. The requirement side has keyed on it since 0444.';

comment on column public.material_bom_amendment_item_slices.chosen is
  'Legacy''s "Choose" tick (0449). FALSE means this destination or colour buys '
  'none of this material and no requirement row is emitted for it. Defaults TRUE '
  'because the default has to be the state that buys.';

comment on column public.material_bom_amendment_item_slices.size_wise is
  'Legacy''s "Size wise" tick (0449). Splits THIS row into the sizes of its '
  '(style, combo). Replaces the old requirement_basis values ''size'' and '
  '''combination'': Colour + tick IS combination, Order + tick IS size-wise. '
  'Belongs to the PARENT row, never to a size child.';

comment on column public.material_bom_amendment_item_slices.item_color_id is
  'The trim colour for THIS row, overriding the line''s own (0449). Same '
  'config_lookups kind ''fabric_color'' the line and the garment both use, so '
  '"match the thread to the fabric" stays a comparison (0415/0419).';

comment on column public.material_bom_amendment_item_slices.specification is
  'Free CAPS text for this row, overriding the line''s (0449). Descriptive — it '
  'does not change required_qty, which is why it gets no requirement column.';

comment on column public.material_bom_amendment_item_slices.size_spec is
  'The MATERIAL''s size for this row (50MM X 20MM, 24 LIGNE) — NOT the garment '
  'size, which is `size_id` (0449, mirroring the line''s own `size`, 0419).';

-- THE KEY GAINS ITS THIRD AXIS. Same COALESCE-sentinel treatment 0442 used, for
-- the same reason: a null is a real value here ("this basis has no such axis")
-- and two nulls must collide, which a plain unique index would not make them do.
drop index if exists public.uq_mba_slice_line_combo_size;
create unique index uq_mba_slice_line_combo_size
  on public.material_bom_amendment_item_slices (
    item_line_id,
    coalesce(combo, ''),
    coalesce(size_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(country_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

do $assert$
declare
  v_idx text;
  v_a   uuid;
  v_b   uuid;
begin
  -- 1. The index carries the destination, or two countries collide at one size.
  select indexdef into v_idx from pg_indexes
   where schemaname = 'public' and indexname = 'uq_mba_slice_line_combo_size';
  if v_idx is null then
    raise exception '0449: uq_mba_slice_line_combo_size is missing — the drop ran and the create did not';
  end if;
  if position('country_id' in v_idx) = 0 then
    raise exception '0449: the slice key does not include country_id — USA-M and CH-M would collide';
  end if;

  -- 2. 0442's assertion, re-run: an override figure must stay NULLABLE, because
  --    NULL is how "inherit the line's figure" is expressed at all.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'material_bom_amendment_item_slices'
       and column_name in ('no_of_items', 'per_pieces')
       and is_nullable = 'NO'
  ) then
    raise exception '0449: an override figure was made NOT NULL — "inherit" becomes unexpressible';
  end if;

  -- 3. The two flags are NOT nullable and default the safe way round. A nullable
  --    `chosen` would give three states for a yes/no question.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'material_bom_amendment_item_slices'
       and column_name = 'chosen' and is_nullable = 'NO' and column_default like '%true%'
  ) then
    raise exception '0449: chosen must be NOT NULL defaulting true — the default has to be the state that buys';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'material_bom_amendment_item_slices'
       and column_name = 'size_wise' and is_nullable = 'NO' and column_default like '%false%'
  ) then
    raise exception '0449: size_wise must be NOT NULL defaulting false';
  end if;

  -- 4. PROVE the collision is closed rather than reading it off the definition.
  --    Two destinations, one size, no combo — both must insert.
  select id into v_a from public.countries limit 1;
  select id into v_b from public.countries offset 1 limit 1;
  if v_a is not null and v_b is not null and v_a <> v_b then
    begin
      insert into public.material_bom_amendment_item_slices
        (item_line_id, sno, combo, size_id, country_id, no_of_items)
      values (gen_random_uuid(), 1, null, null, v_a, 1);
      raise exception '0449: the probe inserted — it should have been refused by a FK';
    exception
      when unique_violation then
        raise exception '0449: two destinations still collide — the index did not take';
      when others then null;   -- the FK refused first, which is correct
    end;
  end if;
end $assert$;
