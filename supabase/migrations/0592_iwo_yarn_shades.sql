-- ============================================================================
-- Raagam ERP — 0592 IWO Fabric BOM: yarn SHADES, and one line per
-- (fabric, colour, dia).
--
-- Client audio, 2026-09-19 (summarised in the plan
-- ~/.claude/plans/humming-discovering-beacon.md, decided by the user):
--
--   * A Yarn IWO line at Stage = GREY is ONE weight — raw grey yarn, no colour
--     breakdown.
--   * At Stage = DYED it asks for the SHADES and a planned weight per shade,
--     and HOW the colour is got ("Colour by"):
--       - dyed_purchase — each shade is bought already dyed;
--       - yarn_dyeing   — the grey total (Σ shades) is bought once, then a
--                         Yarn Dyeing step per shade.
--
-- This REVERSES 0581's reading of `buy_stage_id` ("the state the yarn is
-- bought in", where a GREY yarn could still carry a dyeing step). Nothing read
-- that column but the save, and 0 IWO BOMs exist, so nothing is migrated.
--
-- ## WHY A TABLE, NOT 0581'S `iwo_fabric_bom_yd_*`
--
-- Those copy the ORDER's yarn-dyed model: a percentage SHARE of one fabric's
-- yarn per stripe repeat. A Yarn IWO has no fabric and no repeat — the planner
-- types KILOGRAMS per shade. A share table would need a fabric it does not
-- have; so the shade is a child of the yarn row, holding what was typed.
--
-- ## WHAT THE SERVER KEEPS IN STEP
--
-- On a DYED yarn `iwo_fabric_bom_yarns.planned_kgs` is written as Σ shades by
-- the save, so the Budget pull and the PO ceiling read ONE column whatever the
-- stage. `purchase_qty` on a shade is filled only for dyed_purchase (each
-- shade is its own purchase); for yarn_dyeing the purchase is the grey lot on
-- the yarn row, and the shade's weight reaches the Budget through its dyeing
-- step's `process_qty`.
--
-- ## YARN DYEING IS A DYEING PROCESS
--
-- A shade dyed "by Yarn Dyeing" must have a dyeing step, and the only fact that
-- says a process dyes is `processes.is_dyeing` (0557). It is maintained by
-- migration only since 0571 (the form no longer shows it), and live YARN
-- DYEING carried FALSE. Every existing reader of the flag walks FABRIC routes
-- (`for_fabric` processes), and YARN DYEING is `for_fabric = false`, so setting
-- it changes nothing already computed. A NEW yarn dyeing process needs the same
-- one-line update.
--
-- ## ONE FABRIC LINE PER (FABRIC, COLOUR, DIA)
--
-- The audio's "GREY consolidates the colourways into one line" and "multi-dia
-- allocation" are one statement: a line is identified by what it is made of,
-- in which colour, at which dia — two lines with all three equal are one plan
-- typed twice. The unique index is the guard; `lines.ts` says it first, naming
-- the rows.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. How a DYED yarn is coloured
-- ---------------------------------------------------------------------------
alter table public.iwo_fabric_bom_yarns
  add column if not exists colour_by text;

alter table public.iwo_fabric_bom_yarns
  drop constraint if exists chk_iwofby_colour_by;
alter table public.iwo_fabric_bom_yarns
  add constraint chk_iwofby_colour_by
  check (colour_by is null or colour_by in ('dyed_purchase', 'yarn_dyeing'));

comment on column public.iwo_fabric_bom_yarns.colour_by is
  'For = Yarn, Stage DYED only (0592): dyed_purchase = each shade bought dyed; '
  'yarn_dyeing = the grey total bought once, then a Yarn Dyeing step per shade. '
  'NULL on a GREY yarn and on every For = Fabric yarn.';


-- ---------------------------------------------------------------------------
-- 2. The shades
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_fabric_bom_yarn_shades (
  id           uuid primary key default gen_random_uuid(),
  yarn_id      uuid not null references public.iwo_fabric_bom_yarns(id) on delete cascade,
  sno          int  not null default 0,
  -- A name from the BOM's Yarn Colour panel; capitals, like the panel.
  color_name   text not null check (char_length(trim(color_name)) > 0),
  planned_kgs  numeric(18,4) not null check (planned_kgs > 0),
  -- Written by the SERVER (dyed_purchase only), never by the form.
  purchase_qty numeric check (purchase_qty is null or purchase_qty > 0),
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (yarn_id, color_name)
);
create index if not exists idx_iwo_fabric_bom_yarn_shades_yarn
  on public.iwo_fabric_bom_yarn_shades(yarn_id);

alter table public.iwo_fabric_bom_yarn_shades enable row level security;

drop policy if exists iwo_fabric_bom_yarn_shades_read on public.iwo_fabric_bom_yarn_shades;
drop policy if exists iwo_fabric_bom_yarn_shades_insert on public.iwo_fabric_bom_yarn_shades;
drop policy if exists iwo_fabric_bom_yarn_shades_update on public.iwo_fabric_bom_yarn_shades;
drop policy if exists iwo_fabric_bom_yarn_shades_delete on public.iwo_fabric_bom_yarn_shades;
-- The shape of every other iwo_fabric_bom_* child (0581 §8).
create policy iwo_fabric_bom_yarn_shades_read on public.iwo_fabric_bom_yarn_shades
  for select to authenticated using (public.has_permission('orders', 'view'));
create policy iwo_fabric_bom_yarn_shades_insert on public.iwo_fabric_bom_yarn_shades
  for insert to authenticated with check (public.has_permission('orders', 'create'));
create policy iwo_fabric_bom_yarn_shades_update on public.iwo_fabric_bom_yarn_shades
  for update to authenticated
  using (public.has_permission('orders', 'edit'))
  with check (public.has_permission('orders', 'edit'));
create policy iwo_fabric_bom_yarn_shades_delete on public.iwo_fabric_bom_yarn_shades
  for delete to authenticated using (public.has_permission('orders', 'delete'));


-- ---------------------------------------------------------------------------
-- 3. YARN DYEING dyes (see the header)
-- ---------------------------------------------------------------------------
update public.processes
   set is_dyeing = true
 where for_yarn
   and not coalesce(for_fabric, false)
   and upper(trim(name)) = 'YARN DYEING'
   and not coalesce(is_dyeing, false);


-- ---------------------------------------------------------------------------
-- 4. One fabric line per (fabric, colour, dia)
-- ---------------------------------------------------------------------------
create unique index if not exists uq_iwo_fabric_bom_lines_fabric_colour_dia
  on public.iwo_fabric_bom_lines (bom_id, item_id, coalesce(color_name, ''), coalesce(finish_dia, ''));


-- ---------------------------------------------------------------------------
-- 5. Assertions, from the catalog
-- ---------------------------------------------------------------------------
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.iwo_fabric_bom_yarn_shades'::regclass) then
    raise exception '0592: RLS is off on iwo_fabric_bom_yarn_shades';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'iwo_fabric_bom_yarn_shades') <> 4 then
    raise exception '0592: iwo_fabric_bom_yarn_shades does not carry its four policies';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'uq_iwo_fabric_bom_lines_fabric_colour_dia') then
    raise exception '0592: the (fabric, colour, dia) index is missing';
  end if;
end $$;
