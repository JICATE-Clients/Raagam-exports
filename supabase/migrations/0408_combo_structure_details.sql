-- ============================================================================
-- Raagam ERP — 0408 Combos ▸ Structure Details
--
-- Legacy screenshots 2259 · 2260 · 2261 (client 2026-08-12). The Combos tab's
-- combo row carries a **Detail** button, and it opens a screen of its own:
--
--   Structure Details ─ Style Ref No · Style No · Style Desc · Combo · Combo Desc
--     S No │ Structure       │ Type        │ Composition │ Gsm │ Tol │ Gsm Range │ Fabric Type
--       1  │ SINGLE JERSEY   │ Main Fabric │ 100% BCI CO…│ 200 │  5  │ 195 - 205 │ Solid
--       └─ S No │ Coordinate │ Component   │ Fabric Color │ Fabric │ Print │ Other │ Processed as Trim
--            1  │ PIECES     │ FRONT BODY… │ WHITE        │        │       │       │
--       2  │ 1X1 LYCRA RIB   │ Main Fabric │  95% BCI COT│ 240 │  5  │ 235 - 245 │ Solid
--       3  │ SINGLE JERSEY 1 │ Main Fabric │ 100% BCI CO…│ 180 │  5  │ 175 - 185 │ Solid
--
--
-- WHAT THIS CORRECTS IN 0397, AND WHY IT IS A CORRECTION RATHER THAN A FREEZE
--
-- 0397 built this concept from a written spec and recorded the assumption in
-- its own header:
--
--     "GSM sits on the combo, not on the part … one combo is one structure +
--      one composition."
--
-- The screenshot disproves it. ONE combo (WHITE) carries THREE structures —
-- Single Jersey at 200 gsm for the body, 1x1 Lycra Rib at 240 for the ribs,
-- Single Jersey 1 at 180 — which is simply what a t-shirt is. So:
--
--   * `structure_id` / `composition` / `gsm` / `gsm_tolerance` were on the
--     COMBO, which can hold one set of answers. They move to a per-structure
--     child, where the screen asks them once per row.
--   * `garment_order_amendment_combo_components` hung off `combo_id`. The
--     screen hangs a component off a STRUCTURE — "the front body, in this
--     combo, IS single jersey" — so its parent is repointed.
--
-- The usual treatment for a withdrawn column here is to FREEZE it (leave the
-- column and its rows untouched, drop it from the Zod input). That convention
-- exists to protect STORED VALUES, and there are none: the Combos tab has never
-- had a UI for any of this, and the catalog was read before this migration was
-- written —
--
--     garment_order_amendment_combos            0 rows
--     garment_order_amendment_combo_components  0 rows
--     …combos with any of the four 0397 columns set: 0
--
-- Zero rows is nothing to protect, and a frozen column that never held a value
-- is a column that can only ever mislead the next reader. Dropped, deliberately.
--
--
-- THE COLUMNS ARE NOT INVENTED — 0329 ALREADY MODELS THIS EXACTLY
--
-- `order_fabrics` / `order_fabric_components` on the ORDER side match the
-- overlay column for column, which is the strongest evidence available that
-- this reading of the screenshot is right:
--
--   order_fabrics            structure_name · fabric_type ('main'|'trims_fabric')
--                            · composition · gsm · gsm_tolerance
--                            · item_sub_type ('solid'|'melange'|'yarn_dyed')
--                            · other_details        [keyed style_ref_no+style_no+COMBO]
--   order_fabric_components  coordinate · component · fabric_color · fabric_name
--                            · fabric_print · specifications · other_details
--                            · processed_as_trim
--
-- `order_fabrics` being keyed on the combo is also the second, independent
-- confirmation that structures are PER COMBO rather than per style.
--
--
-- "TYPE" HERE IS NOT "TYPE" ON THE STYLE MASTER. Same word, different question.
--   * Here  — `fabric_type`, Main Fabric vs Trims Fabric (0329's check).
--   * Style — `garment_style_components.comp_type`, derived from the fabric
--             category's `fabric_structure_id` (0405).
-- Type has been wrong three ways on the Style screen already; conflating the
-- two would be the fourth, from a different direction.
--
--
-- GSM RANGE IS DERIVED AND HAS NO COLUMN. 200 ± 5 is 195 - 205, on every row of
-- the screenshot. Storing it would be a second source of truth for a subtraction
-- — the same rule Order Unit follows on the Style(s) tab, where the value is
-- resolved on every read precisely so the two can never drift.
--
--
-- COMPOSITION BECOMES AN FK, WHICH 0397's TEXT WAS NOT. The legacy cell carries
-- a red ⓘ, and the icon-field rule (AGENTS.md, STANDING) is that every one of
-- those is a searchable dropdown over a master. `public.compositions` (0225) is
-- that master and has been all along. The ORDER side stores text because it was
-- never constrained to the masters; the amendment side has used FKs for its
-- dyeings, prints and structures since 0128, and this stays consistent with the
-- document it belongs to rather than with the one it seeds from.
--
--
-- FABRIC COLOUR IS TEXT, AND THAT IS 0403 CATCHING UP WITH 0397. 0397 pointed
-- `color_id` at `color_card_colors` and argued the point at length. 0403 then
-- withdrew Colour Cards as a screen — "it was the app's only colour data, so
-- this cell is free text now" — and made the Color/Print tab's own colour a
-- `color_name text` for exactly that reason. A dropdown over a master nobody
-- can maintain is a dropdown that is always empty, so this follows the tab it
-- must agree with. 0397's rule survives unchanged and is still a RULE rather
-- than a constraint: a component's colour should be one the Color/Print tab
-- declared, offered by the screen and never enforced into a dead end.
--
-- `specifications` is still NOT mirrored — "the Specification Detail columns are
-- not currently used in their workflow" (client 2026-08-10), and the column is
-- empty in the screenshot too. Not adding it stays cheaper than adding it and
-- explaining later why it is always blank.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The combo header keeps only what a COMBO is.
--
-- `combo` (the colourway's name) stays. `combo_description` is new — the legacy
-- grid is `S No · Combo · ComboDescription · Detail`, and the overlay's header
-- shows both.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_combos
  add column if not exists combo_description text;

-- The four that belong to a structure, not to a colourway. See the header for
-- the catalog read that makes this a drop rather than a freeze.
alter table public.garment_order_amendment_combos
  drop column if exists structure_id,
  drop column if exists composition,
  drop column if exists gsm,
  drop column if exists gsm_tolerance;


-- ---------------------------------------------------------------------------
-- 2. The structures of one combo — the outer grid of the Detail overlay.
-- ---------------------------------------------------------------------------
create table if not exists public.garment_order_amendment_combo_structures (
  id             uuid primary key default gen_random_uuid(),
  combo_id       uuid not null
                   references public.garment_order_amendment_combos(id) on delete cascade,
  sno            int not null default 0,

  -- "Structure". `config_lookups` kind 'fabric_structure' — the SAME list the
  -- Color/Print tab's own Structures grid picks from, because it is the same
  -- question asked on the same document. (The Style master spells Structure as
  -- a `categories` row since 0405; that disagreement is real, predates this,
  -- and is not resolved by a migration about the Combos tab.)
  structure_id   uuid references public.config_lookups(id),

  -- "Type" — Main Fabric / Trims Fabric. 0329's vocabulary and 0329's check.
  -- NOT the Style master's `comp_type`; see the header.
  fabric_type    text check (fabric_type is null or fabric_type in ('main','trims_fabric')),

  -- "Composition" — an FK now, not 0397's text. `compositions` is 0225's master.
  composition_id uuid references public.compositions(id),

  gsm            numeric(10,2),
  gsm_tolerance  numeric(6,2),
  -- Gsm Range is DERIVED (gsm ± tolerance) and deliberately has no column.

  -- "Fabric Type" — Solid / Melange / Yarn Dyed. `order_fabrics.item_sub_type`,
  -- same name kept so the seeder is a copy rather than a translation. It is
  -- also what the Color/Print tab already counts to explain why a melange or
  -- yarn-dyed fabric needs no dyeing row (`FabricTypeCounts`).
  item_sub_type  text check (item_sub_type is null or item_sub_type in ('solid','melange','yarn_dyed')),

  other_details  text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_goacs_combo
  on public.garment_order_amendment_combo_structures(combo_id);

comment on table public.garment_order_amendment_combo_structures is
  'One fabric structure within a combo. MANY per combo — a tee is single jersey '
  'in the body and 1x1 rib at the collar, both in the same colourway. Corrects '
  '0397, which put these columns on the combo header on the stated assumption '
  'that one combo is one structure.';


-- ---------------------------------------------------------------------------
-- 3. The parts made of that structure — the nested grid of the overlay.
--
-- Repointed from `combo_id` to `structure_id`. `coordinate_id` -> `items` and
-- `component_id` -> `components` are 0397's and stay exactly as they are: 0396
-- moved those two off the `config_lookups` kinds that shadowed them, and
-- pointing them back would reintroduce the defect it exists to remove.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_combo_components
  drop column if exists combo_id,
  drop column if exists color_id;

alter table public.garment_order_amendment_combo_components
  add column if not exists structure_id      uuid
    references public.garment_order_amendment_combo_structures(id) on delete cascade,
  -- "Fabric Color" — text, following 0403. See the header.
  add column if not exists color_name        text,
  -- "Fabric" — the fabric's own name. `order_fabric_components.fabric_name`.
  add column if not exists fabric_name       text,
  add column if not exists other_details     text,
  add column if not exists processed_as_trim boolean not null default false;

-- The table is empty (catalog-verified, see the header), so a NOT NULL parent
-- is free here and is worth having: a component with no structure has nothing
-- to render under, and the cascade is what makes deleting a structure take its
-- parts with it.
alter table public.garment_order_amendment_combo_components
  alter column structure_id set not null;

drop index if exists public.idx_goacc_combo;
create index if not exists idx_goacc_structure
  on public.garment_order_amendment_combo_components(structure_id);

comment on table public.garment_order_amendment_combo_components is
  'One garment part within one structure of one combo — "the front body, in the '
  'WHITE combo, is single jersey, in white". `color_name` is TEXT (0403 '
  'withdrew Colour Cards); "must be a colour the Color/Print tab declared" is a '
  'RULE the screen offers, not a constraint, so an order with no dyeing row yet '
  'is guided rather than blocked.';


-- ---------------------------------------------------------------------------
-- 4. RLS — the `orders` module, the same four policies as every sibling.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_combo_structures enable row level security;

do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_combo_structures');
end $rls$;


-- ---------------------------------------------------------------------------
-- 5. Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_col text;
begin
  -- 5a. The four per-structure columns really did LEAVE the combo header. A
  -- migration that adds the new table and forgets the drop leaves two places
  -- to write a GSM and no error anywhere.
  foreach v_col in array array['structure_id','composition','gsm','gsm_tolerance'] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='garment_order_amendment_combos'
         and column_name = v_col
    ) then
      raise exception '0408: garment_order_amendment_combos still carries %', v_col;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='garment_order_amendment_combos'
       and column_name='combo_description'
  ) then
    raise exception '0408: combo_description was not added';
  end if;

  -- 5b. The structures table exists with all eight of its own columns.
  foreach v_col in array array['combo_id','sno','structure_id','fabric_type',
                               'composition_id','gsm','gsm_tolerance','item_sub_type'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='garment_order_amendment_combo_structures'
         and column_name = v_col
    ) then
      raise exception '0408: garment_order_amendment_combo_structures is missing %', v_col;
    end if;
  end loop;

  if (select count(*) from pg_policies
       where schemaname='public' and tablename='garment_order_amendment_combo_structures') <> 4 then
    raise exception '0408: expected 4 policies on garment_order_amendment_combo_structures';
  end if;

  -- 5c. Composition points at the MASTER, not at config_lookups. Getting this
  -- wrong compiles, lists nothing and saves fine — the exact failure 0394/0396
  -- record, and the reason it is asserted rather than trusted.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.garment_order_amendment_combo_structures'::regclass
       and c.contype  = 'f'
       and c.confrelid = 'public.compositions'::regclass
  ) then
    raise exception '0408: composition_id does not point at public.compositions (0225)';
  end if;

  -- 5d. A component now hangs off a STRUCTURE, and `combo_id` is gone. This is
  -- the whole point of the migration, so it is the assertion that matters most.
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='garment_order_amendment_combo_components'
       and column_name='combo_id'
  ) then
    raise exception '0408: combo_components still hangs off combo_id';
  end if;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.garment_order_amendment_combo_components'::regclass
       and c.contype  = 'f'
       and c.confrelid = 'public.garment_order_amendment_combo_structures'::regclass
  ) then
    raise exception '0408: combo_components does not cascade from a structure';
  end if;

  -- 5e. The cascade is asserted BY EXERCISING IT, not by reading `confdeltype`:
  -- what is worth knowing is that deleting a structure actually takes its parts.
  -- Skipped rather than faked when there is no amendment to hang a probe off.
  declare
    probe_amend uuid;
    probe_combo uuid;
    probe_struct uuid;
    left_behind int;
  begin
    select id into probe_amend from public.garment_order_amendments limit 1;
    if probe_amend is not null then
      insert into public.garment_order_amendment_combos (amendment_id, sno, combo)
        values (probe_amend, 9001, '__0408_probe') returning id into probe_combo;
      insert into public.garment_order_amendment_combo_structures (combo_id, sno)
        values (probe_combo, 1) returning id into probe_struct;
      insert into public.garment_order_amendment_combo_components (structure_id, sno)
        values (probe_struct, 1);

      delete from public.garment_order_amendment_combos where id = probe_combo;

      select count(*) into left_behind
        from public.garment_order_amendment_combo_components where structure_id = probe_struct;
      if left_behind <> 0 then
        raise exception '0408: deleting a combo left % component row(s) behind', left_behind;
      end if;
      if exists (select 1 from public.garment_order_amendment_combo_structures
                  where id = probe_struct) then
        raise exception '0408: deleting a combo left its structure behind';
      end if;
    end if;
  end;
end $verify$;
