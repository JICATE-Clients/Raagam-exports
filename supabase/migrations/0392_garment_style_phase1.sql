-- ============================================================================
-- Raagam ERP — 0392 Garment Style, phase 1
--
-- Client pass over the Style master (0124): drop the fields they do not use,
-- add the ones they do, and give the coordinate count a rule. Four schema
-- changes and one new code generator.
--
--
-- WHAT IS *NOT* HERE, DELIBERATELY
--
-- Seven header columns (style_for, tech_pack, received_date, receipt_mode,
-- department_id, contact_id, customer_reference) and two component columns
-- (trims, trims_category_id) leave the UI in this pass. They are NOT dropped.
-- The standing rule is to stop asking for a field while keeping its column and
-- its stored values — see doc/masters-open-questions.md on `user_defined`, and
-- lib/masters/process-types.ts on `commodity_id`. The half that actually stops
-- them being written is removing them from the Zod input, not from the table:
-- a field left in the schema with `.default(null)` writes NULL over the stored
-- value on every update. Dropping the columns is a separate, later decision.
--
-- Blast radius, measured before deciding: nothing outside app/(app)/orders/styles
-- and lib/orders/styles reads any of the nine. No report, no lib/data-io entity
-- (Style is not one), no view, no function, no FK. The five other consumers of
-- garment_styles hand-list their columns and none lists these. Amendments joins
-- styles by style_name TEXT (lib/orders/amendments/order-seed.ts:25-38), so no
-- join key is involved either way.
--
-- One consequence worth naming: `trims_category` is a config_lookups kind whose
-- ONLY consumer in the whole app is the column we are about to stop writing. Its
-- rows stay, unreachable, until someone decides the kind's fate.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Header: unit kind, and the size group a style was filled from
-- ----------------------------------------------------------------------------

alter table public.garment_styles
  -- Piece vs Set. Its OWN column rather than being read off `unit_id`, which
  -- points at the Stock Unit master: that master is seeded lowercase
  -- (nos, mtr, kg, set…), its codes are operator-editable, and it has no PIECE
  -- row at all — so a rule inferred from it breaks the day someone renames a
  -- unit. The UOM picker keeps its own job; this answers only the question the
  -- coordinate rule asks.
  --
  -- NULLABLE because every existing style predates it. The form marks the field
  -- `required`, so the next operator to open an old style must answer before
  -- saving (deliberate backfill), and the coordinate rule below stays silent
  -- while the value is null so old records are not retroactively invalid.
  add column if not exists unit_kind text
    check (unit_kind is null or unit_kind in ('piece', 'set')),

  -- The size group last used to FILL this style's sizes. Provenance, not
  -- authority: `garment_style_sizes` remains the source of truth, so editing a
  -- group later cannot silently restate what a closed style was made in. It
  -- exists so reopening a style can say "MENS TOP S-XXL" instead of making the
  -- operator infer it from four rows.
  add column if not exists size_group_id uuid references public.size_groups(id);


-- ----------------------------------------------------------------------------
-- 2. Components: the fabric
--
-- There is no fabric table in this app. A fabric is an `items` row whose
-- item_class_id points at config_lookups(kind='item_class', code='FABRIC') —
-- see lib/masters/material-types.ts `itemClassForm`. So the column is an items
-- FK, exactly as fabric_bom_components.item_id (0368) and
-- material_bom_fabrics.item_id already are. Scoping to the FABRIC class is the
-- caller's job, which is the established cascading-picker rule.
-- ----------------------------------------------------------------------------

alter table public.garment_style_components
  add column if not exists item_id uuid references public.items(id);

create index if not exists idx_gscomp_item on public.garment_style_components(item_id);


-- ----------------------------------------------------------------------------
-- 3. Components → processes (printing, embroidery, …)
--
-- Many per component, so a child of the component row rather than a column on
-- it: one part can need both printing and embroidery.
--
-- Points at the real `processes` master (0227), not the thin `process`
-- config_lookups kind — the same promotion 0228 made for components and 0370
-- states for vendor processes. `processes.for_components` is the boolean that
-- scopes the picker; there is no printing/embroidery discriminator on the
-- master, those are simply process NAMES in the 0294 legacy import
-- (EMBROIDERY, DIGITAL PRINTING, CHEST PRINTING, …).
--
-- `on delete cascade` is load-bearing here in a way it is not on the other
-- children: lib/orders/styles/actions.ts rewrites every child on every save, so
-- the parent component rows are deleted and recreated each time and these rows
-- must go with them.
-- ----------------------------------------------------------------------------

create table if not exists public.garment_style_component_processes (
  id           uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.garment_style_components(id) on delete cascade,
  sno          int not null default 0,
  process_id   uuid references public.processes(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_gscp_component on public.garment_style_component_processes(component_id);


-- ----------------------------------------------------------------------------
-- 4. The per-fiscal-year code counter
--
-- `STL-2627-81` = prefix, fiscal year (Apr 2026 – Mar 2027), running number
-- that RESETS each April. A sequence cannot reset per year, so the counter is a
-- table keyed by the year.
--
-- WHY THIS IS NOT SECURITY DEFINER. A sequence is not RLS-protected, which is
-- why the generic assign_code() can bump one as the calling role. A table is.
-- The tempting fix — mark the trigger function SECURITY DEFINER so it can write
-- here regardless — is the hole 0391 spends its header refusing. Instead the
-- policies below allow exactly the caller who is already inserting a style:
-- someone holding orders:create. The function stays SECURITY INVOKER.
--
-- SELECT is granted too because the counter is read back by `returning`.
-- No DELETE policy: losing a year's row would restart its numbering at 1 and
-- mint duplicate codes.
-- ----------------------------------------------------------------------------

create table if not exists public.garment_style_code_counters (
  fy      text primary key,
  last_no int not null default 0
);

alter table public.garment_style_code_counters enable row level security;

create policy garment_style_code_counters_read on public.garment_style_code_counters
  for select to authenticated using (public.has_permission('orders', 'view'));
create policy garment_style_code_counters_insert on public.garment_style_code_counters
  for insert to authenticated with check (public.has_permission('orders', 'create'));
create policy garment_style_code_counters_update on public.garment_style_code_counters
  for update to authenticated
  using (public.has_permission('orders', 'create'))
  with check (public.has_permission('orders', 'create'));


-- ----------------------------------------------------------------------------
-- 5. The generator
--
-- A DEDICATED trigger function, not a change to public.assign_code().
--
-- assign_code() is attached to ~116 tables. Teaching it about fiscal years
-- would restamp the code format of every document in the application, past
-- decisions included. 0017_fix_sales_order_number.sql set the precedent in so
-- many words: "we give it a dedicated BEFORE INSERT trigger function instead of
-- complicating the generic assign_code() that 18 other tables rely on".
--
-- THE YEAR COMES FROM style_date, NOT current_date. A style dated in March 2027
-- numbers into 2026-27 even if it is keyed in during April, which is how
-- document numbering is expected to behave. The consequence is real and
-- accepted: backdating consumes a number from that year's counter, so within a
-- year the serial order is entry order, not date order.
--
-- The `on conflict … do update … returning` is one atomic statement, so two
-- operators saving at once cannot be handed the same number.
--
-- An explicitly supplied code is still honoured and does NOT advance the
-- counter — same guard assign_code() has, and what makes a data import able to
-- carry its own legacy codes.
-- ----------------------------------------------------------------------------

create or replace function public.assign_garment_style_code()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_on       date;
  v_fy_start int;
  v_fy       text;
  v_next     int;
begin
  if new.code is not null and new.code <> '' then
    return new;
  end if;

  v_on := coalesce(new.style_date, current_date);

  -- Indian fiscal year: April–March. Anything before April belongs to the year
  -- that started the previous April.
  v_fy_start := case
    when extract(month from v_on) >= 4 then extract(year from v_on)
    else extract(year from v_on) - 1
  end;

  -- 2026 → '2627'. Two digits each, so the segment is always four characters.
  v_fy := to_char(v_fy_start % 100, 'FM00') || to_char((v_fy_start + 1) % 100, 'FM00');

  -- `as c` so the DO UPDATE can name the EXISTING row unambiguously. A
  -- schema-qualified reference is not accepted there, and bare `last_no` would
  -- be the column being assigned rather than its current value.
  insert into public.garment_style_code_counters as c (fy, last_no)
  values (v_fy, 1)
  on conflict (fy) do update
    set last_no = c.last_no + 1
  returning c.last_no into v_next;

  -- Unpadded: STL-2627-81, not STL-2627-0081 (client, 2026-08-10).
  new.code := 'STL-' || v_fy || '-' || v_next::text;
  return new;
end;
$$;

comment on function public.assign_garment_style_code() is
  'Garment style code STL-<fy><fy+1>-<n>, e.g. STL-2627-81. Fiscal year runs '
  'April-March and is taken from style_date; the running number resets each '
  'year. SECURITY INVOKER — the caller must hold orders:create, which is also '
  'what the counter table''s policies require.';

revoke all on function public.assign_garment_style_code() from public, anon;
grant execute on function public.assign_garment_style_code() to authenticated;

-- Swap the trigger. The old one called the shared assign_code('STL', …); the
-- sequence public.seq_garment_style is left in place rather than dropped, so
-- the existing STL-0001 … codes remain explicable and a rollback is a one-line
-- trigger swap back.
drop trigger if exists trg_garment_style_code on public.garment_styles;
create trigger trg_garment_style_code before insert on public.garment_styles
  for each row execute function public.assign_garment_style_code();


-- ----------------------------------------------------------------------------
-- 6. RLS for the new child table (reuses the 'orders' module — no new permission)
-- ----------------------------------------------------------------------------

do $$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_style_component_processes');
  execute 'alter table public.garment_style_component_processes enable row level security';
end $$;


-- ----------------------------------------------------------------------------
-- 7. Read the results back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its stated goal —
-- 0383 and 0386 both applied cleanly and both left a function anon-callable.
-- Same checks as scripts/check-anon-grants.sql, plus a live proof that the code
-- generator actually produces the shape the client asked for.
-- ----------------------------------------------------------------------------

do $$
declare
  v_fy text;
begin
  if has_function_privilege('anon', 'public.assign_garment_style_code()', 'EXECUTE') then
    raise exception '0392: assign_garment_style_code is executable by anon — the revoke did not take';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.garment_styles'::regclass
      and tgname  = 'trg_garment_style_code'
      and tgfoid  = 'public.assign_garment_style_code()'::regprocedure
  ) then
    raise exception '0392: garment_styles is still on the shared assign_code() trigger';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'garment_style_code_counters'
  ) then
    raise exception '0392: garment_style_code_counters has no policies — inserts would be denied for everyone';
  end if;

  -- Prove the fiscal-year arithmetic on the three dates that matter, rather
  -- than trusting it: the year boundary is the whole point of the format, and
  -- an off-by-one here mislabels every style for three months of the year.
  --   2026-08-10 → 2627   (mid-year)
  --   2027-03-31 → 2627   (last day of the FY)
  --   2027-04-01 → 2728   (first day of the next)
  foreach v_fy in array array['2026-08-10=2627', '2027-03-31=2627', '2027-04-01=2728'] loop
    declare
      d       date := split_part(v_fy, '=', 1)::date;
      want    text := split_part(v_fy, '=', 2);
      y       int;
      got     text;
    begin
      y := case when extract(month from d) >= 4
                then extract(year from d)
                else extract(year from d) - 1 end;
      got := to_char(y % 100, 'FM00') || to_char((y + 1) % 100, 'FM00');
      if got <> want then
        raise exception '0392: % builds fiscal year %, expected %', d, got, want;
      end if;
    end;
  end loop;
end $$;
