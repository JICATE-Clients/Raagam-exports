-- ============================================================================
-- Raagam ERP — 0512 Fabric BOM ▸ [Detail] ▸ Yarn Dyed Details
--
-- The overlay legacy opens off a FabricAllocation row (client screenshot 2615,
-- 2026-09-02). Its title is "Yarn Dyed Details" and it holds three panels:
--
--     Repeats      S No | Yarn ⓘ | Type ▾ | Color | Uom | Value | Twisted Yarn
--     Mixing Det.  Yarn | Type | Color | Uom | Value | Calculated % | Mixing % |
--                  Twisted Yarn
--     Combinations Combo ⓘ | YD Combo Name
--
-- The client asked for all three "like same field order structure", with the
-- panels reached from a TOP TAB BAR (screenshot 2026-09-02 114300) so one
-- overlay shows one panel at a time instead of three stacked grids.
--
--
-- TWO TABLES FOR THREE PANELS. MIXING DETAILS IS DERIVED.
--
-- This is the same split 0493 made for Yarn Process and for the same reason: a
-- figure the system can compute is a figure that must not be stored beside its
-- own inputs, free to disagree with them. Read the legacy screenshot's own
-- numbers — one yarn, two colour repeats at 60 and 40:
--
--     Repeats:        20'S BCI COTTON  Dyed  Color 01  %  60.00
--                     20'S BCI COTTON  Dyed  Color 02  %  40.00
--                     20'S BCI COTTON  Grey  Grey      %   0.00
--     Mixing Details: 20'S BCI COTTON  Dyed  C01  %  60.00 | 60.00 | 60.00
--                     20'S BCI COTTON  Dyed  C02  %  40.00 | 40.00 | 40.00
--
-- Every Mixing Details cell is either copied from a repeat or computed from one:
--
--     Calculated % = this repeat's value / the yarn's total repeat value x 100
--     Mixing %     = Calculated % x the yarn's blend share of the fabric
--
-- With a single-yarn fabric the blend share is 100% and all three columns
-- coincide, which is exactly what the screenshot shows and is why that capture
-- alone cannot separate them. `mixingDetailRows()` in
-- lib/orders/fabric-bom/yarn-dyed.ts is the one implementation, and it ABSTAINS
-- (null Mixing %) where the blend share is unknown rather than assuming 100 —
-- 0493 already records that `blend_pct` is legitimately NULL for exactly the
-- fabrics this overlay serves, and a guessed share here is a wrong purchase
-- quantity that reads like a declared one.
--
-- THE `Grey` ROW AT 0.00 IS NOT A COLOUR AND IS NOT COUNTED. It declares the
-- undyed remainder of the yarn; including it in the denominator would dilute
-- every dyed repeat's Calculated %.
--
--
-- KEYED BY THE FABRIC GROUP'S ADDRESS, HELD BY VALUE — NOT BY `line_id`.
--
-- This is the decision that is expensive to undo, so it is stated here rather
-- than inferred from the DDL.
--
-- The [Detail] overlay is opened for a fabric GROUP, not for a line:
-- `fabricGroupKey` in lib/orders/fabric-bom/component-map.ts is
-- `style_ref_no · structure_id · item_id`, and a group is N lines — one per
-- colourway. So a repeat keyed to whichever line happened to be clicked would
-- belong to one colourway of a cloth whose yarn composition is the same in all
-- of them.
--
-- And `updateFabricBom` DELETES EVERY LINE BY `bom_id` AND RE-INSERTS. Anything
-- keyed to `line_id` with `on delete cascade` is therefore destroyed by an
-- ordinary Save from the Fabric Lines grid — that is
-- [[raagam-material-attribute-edit-orphans]], which cost 12 lines and 10 answers
-- unrecoverably, and the reason `order_fabric_bom_dias` (0490) already holds its
-- address by value too. These three columns are that address.
--
-- `style_ref_no` IS NULLABLE AND NULL MEANS "EVERY STYLE" — 0426's reading of
-- the column, unchanged here. `structure_id` and `item_id` are NOT NULL: a
-- yarn-dyed detail with no cloth to be about is not a document state.
--
--
-- NOTHING CONSTRAINS THESE ROWS TO A LIVE LINE, DELIBERATELY.
--
-- Same call 0490 made for dias: a line leaves the grid far more easily than the
-- rows citing it are found, and a repeat surviving a line's deletion is
-- recoverable where a cascaded delete is not. The screen renders what the
-- CURRENT groups address and leaves the rest alone.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Repeats — what the planner declares
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_yd_repeats (
  id            uuid primary key default gen_random_uuid(),
  bom_id        uuid not null references public.order_fabric_boms(id) on delete cascade,

  -- The fabric group's address (see the header). Held by value.
  style_ref_no  text,
  structure_id  uuid not null,
  item_id       uuid not null,

  sno           integer not null default 1,

  -- The yarn this repeat is about. A `material_mixings` component of `item_id`
  -- in every ordinary document, but NOT constrained to one: the composition can
  -- be edited on the Material master after the BOM is planned, and a repeat that
  -- vanished from the overlay because a master changed would be an answer lost
  -- with nothing said. The screen tags such a row instead.
  yarn_item_id  uuid references public.items(id),

  -- 'dyed' | 'grey'. Legacy's Type dropdown, verbatim in meaning: `grey` is the
  -- undyed remainder and carries no colour and no share.
  dye_type      text not null default 'dyed'
                check (dye_type in ('dyed', 'grey')),

  color_name    text,
  uom_id        uuid references public.uoms(id),
  value         numeric(12, 4),

  -- Legacy's `Twisted Yarn` column. Free text — it names a twisted yarn where
  -- the repeat uses one, and is blank on the great majority of rows.
  twisted_yarn  text,

  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);

comment on table public.order_fabric_bom_yd_repeats is
  'Fabric BOM [Detail] > Yarn Dyed Details > Repeats (0512). One row per yarn '
  'colour repeat of one fabric group. Mixing Details is DERIVED from these.';

create index if not exists order_fabric_bom_yd_repeats_bom_idx
  on public.order_fabric_bom_yd_repeats (bom_id);

-- The group's own address, which is how the screen fetches a panel.
create index if not exists order_fabric_bom_yd_repeats_group_idx
  on public.order_fabric_bom_yd_repeats (bom_id, structure_id, item_id);

-- ---------------------------------------------------------------------------
-- Combinations — the colourway's yarn-dyed name
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_yd_combinations (
  id            uuid primary key default gen_random_uuid(),
  bom_id        uuid not null references public.order_fabric_boms(id) on delete cascade,

  style_ref_no  text,
  structure_id  uuid not null,
  item_id       uuid not null,

  -- The assort colourway, held BY NAME like every other `combo` on this
  -- document (0426) — the order keys its colourways by text, not by an FK, and
  -- a second spelling here would not resolve.
  combo         text,

  -- Legacy's `YD Combo Name`: what the yarn-dyed combination is called on the
  -- knitting floor, which is not always the assort colour's name.
  yd_combo_name text,

  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);

comment on table public.order_fabric_bom_yd_combinations is
  'Fabric BOM [Detail] > Yarn Dyed Details > Combinations (0512). Names the '
  'yarn-dyed combination for one colourway of one fabric group.';

create index if not exists order_fabric_bom_yd_combinations_bom_idx
  on public.order_fabric_bom_yd_combinations (bom_id);

create index if not exists order_fabric_bom_yd_combinations_group_idx
  on public.order_fabric_bom_yd_combinations (bom_id, structure_id, item_id);

-- ---------------------------------------------------------------------------
-- RLS — the same shape every child of `order_fabric_boms` already uses: reach
-- the parent, and the parent's own policies decide. There is no logged-out
-- surface in this app, so `authenticated` is the whole audience.
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_yd_repeats      enable row level security;
alter table public.order_fabric_bom_yd_combinations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'order_fabric_bom_yd_repeats'
      and policyname = 'yd_repeats_all_authenticated'
  ) then
    create policy yd_repeats_all_authenticated
      on public.order_fabric_bom_yd_repeats
      for all to authenticated
      using (
        exists (
          select 1 from public.order_fabric_boms b
          where b.id = order_fabric_bom_yd_repeats.bom_id
        )
      )
      with check (
        exists (
          select 1 from public.order_fabric_boms b
          where b.id = order_fabric_bom_yd_repeats.bom_id
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'order_fabric_bom_yd_combinations'
      and policyname = 'yd_combinations_all_authenticated'
  ) then
    create policy yd_combinations_all_authenticated
      on public.order_fabric_bom_yd_combinations
      for all to authenticated
      using (
        exists (
          select 1 from public.order_fabric_boms b
          where b.id = order_fabric_bom_yd_combinations.bom_id
        )
      )
      with check (
        exists (
          select 1 from public.order_fabric_boms b
          where b.id = order_fabric_bom_yd_combinations.bom_id
        )
      );
  end if;
end $$;

-- No functions are added here, so there is no grant to revoke. Were one added,
-- AGENTS.md's rule applies in full: `revoke all on function ... from public,
-- anon` in ONE statement — revoking from `public` alone leaves Supabase's own
-- direct `anon=X/owner` grant standing, which is how 0383 shipped an
-- unauthenticated name oracle.
