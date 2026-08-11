-- ============================================================================
-- Raagam ERP — 0397 Combos become a real mapping
--
-- A Combo is a COLOURWAY: "the Green combo", "the Navy combo". Within one, each
-- part of the garment carries its own colour — a Green combo can have a green
-- front body and a navy neck rib (client 2026-08-10). The tab's job is that
-- mapping, and it is what the Prices and Quantities tabs are then priced and
-- counted against.
--
-- `garment_order_amendment_combos` could express none of it. Three text columns
-- — `style_ref_no`, `style`, `article_no` — which are not even the combo: they
-- are the STYLE's identity, copied down from the Style(s) tab and read-only
-- there. Nothing named the colourway, nothing named a part, nothing held a
-- colour.
--
-- ---------------------------------------------------------------------------
-- THIS IS NOT A NEW MODEL. IT IS AN EXISTING ONE, MIRRORED.
--
-- 0329 already built the same thing on the ORDER side, and the shapes line up
-- column for column:
--
--   order_fabrics            combo · structure_name · composition · gsm ·
--                            gsm_tolerance · item_sub_type
--   order_fabric_components  coordinate · component · fabric_color ·
--                            fabric_print · specifications
--
-- A combo header carrying composition and GSM, with per-part rows carrying
-- colour and print. The amendment seeder ALREADY reads both tables — it mines
-- them for dyeings, prints and structures and discards the rest. So the source
-- data has been in hand the whole time; only the destination was missing.
--
-- The one column deliberately NOT mirrored is `specifications`: "the
-- Specification Detail columns are not currently used in their workflow"
-- (client 2026-08-10). Not adding a column is cheaper than adding one and
-- explaining later why it is always blank.
--
-- ---------------------------------------------------------------------------
-- WHY COLOUR POINTS AT THE MASTER AND NOT AT THE DYEING ROW.
--
-- The rule is that a combo's colours come EXCLUSIVELY from the Color/Print
-- tab's Yarn and Fabric Dyeing lists. The obvious encoding — an FK to
-- `garment_order_amendment_dyeings(id)` — cannot work here, and the reason is
-- one line in `actions.ts`:
--
--     -- Delete-all-then-reinsert each child grid wholesale.
--
-- Every save DELETES all of an amendment's dyeing rows and reinserts them with
-- fresh uuids. An FK to those ids would be nulled (or would block the delete)
-- on every save the operator made. A within-document reference cannot outlive a
-- document that is rewritten wholesale.
--
-- So the column points at `color_card_colors` — a master id, stable across
-- saves — and "must be one of the colours this amendment declared" is enforced
-- as a RULE in the Zod input rather than by the constraint. That is this
-- codebase's stated pattern for requiredness that is a property of the CASE
-- rather than of the column (`missingRequiredMaterialFields`), and it is
-- checked by a vector file rather than asserted in a comment.
--
-- `print_id` is the same argument, pointing at `config_lookups`.
--
-- ---------------------------------------------------------------------------
-- GSM SITS ON THE COMBO, NOT ON THE PART, because the rule that governs it does:
-- "Circular Knit → GSM compulsory; Woven or Flat Knit → optional". That keys on
-- the structure, and one combo is one structure + one composition. Putting GSM
-- on the part would ask the same question once per component and let the answers
-- disagree.
--
-- The constraint is NOT a CHECK: `structure_id` is a `config_lookups` uuid, so
-- SQL here cannot see whether it means Circular Knit without a join, and a
-- CHECK that silently stops matching when a lookup is renamed is worse than no
-- CHECK. The rule lives in one exported function the screen, the Save button and
-- the action all call.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The combo header gains what a colourway actually is.
--
-- All nullable and all additive: `garment_order_amendment_combos` holds rows
-- today (three-text-column ones), and a NOT NULL here would reject them.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_combos
  add column if not exists combo         text,
  add column if not exists structure_id  uuid references public.config_lookups(id),
  add column if not exists composition   text,
  add column if not exists gsm           numeric(10,2),
  add column if not exists gsm_tolerance numeric(6,2);

comment on column public.garment_order_amendment_combos.combo is
  'The colourway''s name — "GREEN", "NAVY". What the Prices and Quantities tabs '
  'count against. Mirrors order_fabrics.combo.';
comment on column public.garment_order_amendment_combos.gsm is
  'Compulsory when the structure is Circular Knit, optional for Woven and Flat '
  'Knit (client 2026-08-10). Enforced by comboProblems() in lib/orders/'
  'amendments/combo-rules.ts, not by a CHECK — see this migration''s header.';


-- ---------------------------------------------------------------------------
-- 2. The mapping itself: one row per part of the garment, per combo.
--
-- `coordinate_id` -> `items` and `component_id` -> `components` follow 0396,
-- which repointed exactly these two off the `config_lookups` kinds that shadowed
-- them ("A COORDINATE IS A GARMENT ... The data was right; the FK was pointed at
-- a parallel list nobody maintained"). Pointing them at the empty kinds again
-- here would reintroduce the defect 0396 exists to remove.
--
-- The order side stores all four as TEXT, because it was never constrained to
-- the masters. The amendment side has always used FKs for its dyeings, prints
-- and structures; this stays consistent with the document it belongs to rather
-- than with the one it seeds from. Resolving text to a master id is the seeder's
-- job and it already does it for three other tabs.
-- ---------------------------------------------------------------------------
create table if not exists public.garment_order_amendment_combo_components (
  id            uuid primary key default gen_random_uuid(),
  combo_id      uuid not null
                  references public.garment_order_amendment_combos(id) on delete cascade,
  sno           int not null default 0,
  -- which part of the garment
  coordinate_id uuid references public.items(id),
  component_id  uuid references public.components(id),
  -- what it is made of, for THIS combo
  color_id      uuid references public.color_card_colors(id),
  print_id      uuid references public.config_lookups(id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_goacc_combo
  on public.garment_order_amendment_combo_components(combo_id);

comment on table public.garment_order_amendment_combo_components is
  'One garment part''s colour and print within a combo. `color_id` and '
  '`print_id` name MASTER rows, not the amendment''s own dyeing/print rows, '
  'because those are deleted and reinserted on every save — "exclusively from '
  'the Color/Print tab" is enforced as a rule, not as a constraint.';


-- ---------------------------------------------------------------------------
-- 3. RLS — the `orders` module, same four policies as every sibling child table.
-- ---------------------------------------------------------------------------
alter table public.garment_order_amendment_combo_components enable row level security;

do $$
begin
  execute format($f$
    create policy %1$s_read   on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_combo_components');
end $$;


-- ---------------------------------------------------------------------------
-- 4. Read the result out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its stated goal —
-- 0383 and 0386 both applied cleanly and both left a function anon-callable.
-- ---------------------------------------------------------------------------
do $$
declare
  v_col text;
begin
  -- 4a. The header actually gained all five columns.
  foreach v_col in array array['combo','structure_id','composition','gsm','gsm_tolerance'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'garment_order_amendment_combos'
        and column_name  = v_col
    ) then
      raise exception '0397: garment_order_amendment_combos is missing %', v_col;
    end if;
  end loop;

  -- 4b. Every one of them is NULLABLE. A NOT NULL would reject the rows the
  -- table already holds, and would do it at the operator's next save rather
  -- than here.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'garment_order_amendment_combos'
      and column_name in ('combo','structure_id','composition','gsm','gsm_tolerance')
      and is_nullable  = 'NO'
  ) then
    raise exception '0397: a new combos column is NOT NULL — existing rows cannot satisfy it';
  end if;

  -- 4c. The mapping table points at the masters 0396 established, NOT at the
  -- config_lookups kinds it moved away from. Getting this wrong compiles, lists
  -- nothing, and saves fine — the exact failure 0394/0396 record.
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.garment_order_amendment_combo_components'::regclass
      and c.contype  = 'f'
      and c.confrelid = 'public.items'::regclass
  ) then
    raise exception '0397: coordinate_id does not point at public.items (see 0396)';
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.garment_order_amendment_combo_components'::regclass
      and c.contype  = 'f'
      and c.confrelid = 'public.components'::regclass
  ) then
    raise exception '0397: component_id does not point at public.components (see 0396)';
  end if;

  -- 4d. Colour points at the MASTER, not at the amendment's own dyeing rows.
  -- An FK to those would be broken by the delete-all-reinsert save on the very
  -- first edit — see this migration's header.
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid  = 'public.garment_order_amendment_combo_components'::regclass
      and c.contype   = 'f'
      and c.confrelid = 'public.color_card_colors'::regclass
  ) then
    raise exception '0397: color_id does not point at public.color_card_colors';
  end if;
  if exists (
    select 1 from pg_constraint c
    where c.conrelid  = 'public.garment_order_amendment_combo_components'::regclass
      and c.contype   = 'f'
      and c.confrelid = 'public.garment_order_amendment_dyeings'::regclass
  ) then
    raise exception '0397: a component references a DYEING ROW — those ids are recreated on every save';
  end if;

  -- 4e. A policy-less RLS table denies everyone, which would reject every save
  -- with a message about permissions rather than about the real cause.
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename  = 'garment_order_amendment_combo_components') <> 4 then
    raise exception '0397: expected 4 policies on the combo components table';
  end if;

  -- 4f. The parent link cascades. A combo deleted on the screen must not leave
  -- its part rows behind — `writeChildren` deletes combos wholesale on save.
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid   = 'public.garment_order_amendment_combo_components'::regclass
      and c.contype    = 'f'
      and c.confrelid  = 'public.garment_order_amendment_combos'::regclass
      and c.confdeltype = 'c'
  ) then
    raise exception '0397: combo_id is not ON DELETE CASCADE — a wholesale combo rewrite would orphan its parts';
  end if;
end $$;
