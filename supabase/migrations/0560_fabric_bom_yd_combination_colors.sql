-- ============================================================================
-- Raagam ERP — 0560 Fabric BOM ▸ [Detail] ▸ Yarn Dyed Details ▸ Combinations
--                ▸ the per-combo Color breakdown
--
-- Legacy nests an expandable "Color ID | Yarn Color" grid under each
-- Combinations row (client screenshot, 2026-09-15) — Combo WHITE, YD Combo
-- Name "GREEN/RED", opened to show C01 GREEN / C02 RED. 0512 built the outer
-- Combinations row (`order_fabric_bom_yd_combinations`: Combo + YD Combo Name)
-- from screenshot 2615, which did not capture this nested state, so nothing
-- in that migration has anywhere to put it.
--
-- REFERENCE ONLY. This table is NOT a fourth input to `mixingDetailRows`/
-- `yarnPurchase`: the yarn colours and shares that drive the Mixing %/
-- purchase engine are `order_fabric_bom_yd_repeats`, unchanged. This just
-- records which colours a given YD Combo Name is made of.
--
-- `yarn_color` WAS FREE TEXT, "CONFIRMED WITH THE CLIENT" EARLIER THE SAME
-- DAY, AND THAT IS REVERSED (client transcript, 2026-09-15, later in the same
-- meeting — "the textboxes must be set to read-only so color names are
-- populated strictly from master lists/selections"). The column stays TEXT
-- (unlike `yd_combo_name`, which is still deliberately free — the knitting
-- floor's own name for a combination, not a stored colour): the UI now
-- offers only names from the order's own Yarn Colour palette
-- (`lib/orders/fabric-bom/palette.ts`), never an open textbox — see
-- `colourOptionsFor` in `components/orders/yarn-dyed-panels.tsx`. The later,
-- more specific instruction wins, the same rule AGENTS.md states for a
-- renamed menu label — a reader who finds the "confirmed free text" claim
-- quoted elsewhere is holding something this supersedes.
--
-- `id` IS NOT `combo_id` — it is a plain child of `order_fabric_bom_yd_
-- combinations.id`, deliberately UNLIKE its parent and grandparent's
-- addressing. The Repeats/Combinations tables hold the fabric group's
-- address BY VALUE (style_ref_no/structure_id/item_id) because
-- `updateFabricBom` deletes and reinserts every LINE by `bom_id`, which
-- would orphan or cascade-destroy a row keyed to a line id. Combinations
-- rows do not have that problem AT THIS DEPTH: `writeLines` already deletes
-- and reinserts every `order_fabric_bom_yd_combinations` row on every save
-- (by `bom_id`, same as its own siblings), so a plain FK to the freshly
-- reinserted parent's `id` is safe — the parent and child are written in the
-- same transaction, in that order, every time.
--
-- `Color ID` (C01, C02…) IS NOT A COLUMN. Confirmed with the client: it is
-- an auto-numbered label, not a picked or typed code, so it is DERIVED from
-- `sno` at render time (same "position, not stored code" choice `Combo N`
-- and every other `sno`-ordered grid in this file already makes) — never
-- stored as literal text.
-- ============================================================================

create table if not exists public.order_fabric_bom_yd_combination_colors (
  id             uuid primary key default gen_random_uuid(),
  combination_id uuid not null references public.order_fabric_bom_yd_combinations(id) on delete cascade,

  sno            integer not null default 1,

  -- Stored as text (the value, not a foreign key), but no longer FREE text —
  -- the UI restricts entry to the order's own Yarn Colour palette. See the
  -- reversal note above.
  yarn_color     text,

  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid()
);

comment on table public.order_fabric_bom_yd_combination_colors is
  'Fabric BOM [Detail] > Yarn Dyed Details > Combinations > nested Color '
  'breakdown (0560). Reference only — names which yarn colours make up one '
  'Combinations row''s YD Combo Name; the Mixing %/purchase engine reads '
  'order_fabric_bom_yd_repeats, never this table.';

create index if not exists order_fabric_bom_yd_combination_colors_combo_idx
  on public.order_fabric_bom_yd_combination_colors (combination_id);

-- ---------------------------------------------------------------------------
-- RLS — reach the grandparent BOM through the parent Combinations row, same
-- shape 0512 uses one level up.
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_yd_combination_colors enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'order_fabric_bom_yd_combination_colors'
      and policyname = 'yd_combination_colors_all_authenticated'
  ) then
    create policy yd_combination_colors_all_authenticated
      on public.order_fabric_bom_yd_combination_colors
      for all to authenticated
      using (
        exists (
          select 1 from public.order_fabric_bom_yd_combinations c
          where c.id = order_fabric_bom_yd_combination_colors.combination_id
        )
      )
      with check (
        exists (
          select 1 from public.order_fabric_bom_yd_combinations c
          where c.id = order_fabric_bom_yd_combination_colors.combination_id
        )
      );
  end if;
end $$;

-- No functions are added here, so there is no grant to revoke. Were one
-- added, AGENTS.md's rule applies in full: `revoke all on function ... from
-- public, anon` in ONE statement.
