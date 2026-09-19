-- ============================================================================
-- Raagam ERP — 0581 IWO Fabric BOM: the order Fabric BOM, duplicated for the
-- Internal Work Order.
--
-- Client, 2026-09-18 (screenshots 2937 / 2938 / 2940, doc/order/internlwork
-- order.md): an IWO For = Yarn or Fabric gets the SAME Fabric BOM screen an
-- order has — Color/Print Details, Fabric Allocation, Fabric Consumption, Yarn
-- Process, Fabric Process — "totally duplicate it … don't disturb the screen".
-- The garment machinery is bypassed: no style, no colourway, no garment
-- component, no size; Req Wt (KGS) is typed.
--
-- ## WHY NOT ONE MORE ROW IN `order_fabric_boms`
--
-- Three reasons, each sufficient:
--   1. `order_fabric_boms.garment_order_id` is NOT NULL, UNIQUE, and a foreign
--      key to `garment_order_amendments` — the header cannot name an IWO.
--   2. Readers across the app treat those tables as ORDER demand with no filter:
--      the Budget (lib/orders/budget/service.ts) and `report_item_movements`
--      read every `order_fabric_bom_requirements` row. IWO rows there would
--      appear in order budgets and stock reports.
--   3. The client's instruction is that the order screen is not disturbed. A
--      shared table is a shared screen one migration later.
--
-- So every table below MIRRORS its `order_fabric_bom_*` twin — same column
-- names, same checks — minus the order grain (style_ref_no, combo on lines,
-- coordinate, component, sizes, manual entries, requirements). Same names on
-- purpose: the copied screen and actions keep reading the fields they read.
--
-- ## WHAT IS NEW, NOT MIRRORED
--
--   * `iwo_fabric_bom_palette` — the order screen's three name panels (Fabric
--     Colour, Yarn Colour, Roll form prints) write the ORDER's dyeings/prints.
--     An IWO has no order, so the names are the BOM's own.
--   * Lines carry `req_kgs` (the typed Req Wt), `gsm`, `finish_dia`, `stage_id`
--     — the SRS's Fabric Consumption columns — in place of the Manual tab's
--     size-by-size grams.
--   * Yarns carry `planned_kgs` and `buy_stage_id` for For = Yarn, where the
--     yarn is PICKED and weighed rather than derived from a fabric's blend.
--   * Yarn stages carry `rate_per_kg` — "Yarn Dyeing (Navy Blue @ Rs. 85/KG)".
--
-- ONE BOM PER IWO (unique iwo_id). No Entry No: the client confirmed the
-- legacy "Entry No: 5" was a sample; the BOM is known by its I.WO No.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Header
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_fabric_boms (
  id          uuid primary key default gen_random_uuid(),
  iwo_id      uuid not null unique references public.internal_work_orders(id) on delete cascade,
  bom_date    date not null default current_date,
  is_draft    boolean not null default false,
  remark      text,
  -- Stamped from the IWO by the guard below, never from the form: the BOM
  -- belongs to the unit that raised the work order.
  location_id uuid not null references public.locations(id),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_iwo_fabric_boms_updated on public.iwo_fabric_boms;
create trigger trg_iwo_fabric_boms_updated before update on public.iwo_fabric_boms
  for each row execute function public.set_updated_at();

create or replace function public.iwo_fabric_bom_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_for text;
  v_loc uuid;
begin
  select w.iwo_for, w.location_id into v_for, v_loc
    from public.internal_work_orders w
   where w.id = new.iwo_id;

  if v_for is null or v_for not in ('yarn', 'fabric') then
    raise exception
      'A Fabric BOM is raised only for an Internal Work Order For Yarn or Fabric (this one is For %).',
      coalesce(v_for, '(nothing)')
      using errcode = '23514';
  end if;

  new.location_id := v_loc;
  return new;
end;
$$;

comment on function public.iwo_fabric_bom_guard() is
  'IWO Fabric BOM header (0581): refuses an IWO that is not For yarn/fabric, and '
  'stamps location_id from the IWO so the BOM belongs to the unit that raised it.';

revoke all on function public.iwo_fabric_bom_guard() from public, anon;
grant execute on function public.iwo_fabric_bom_guard() to authenticated;

drop trigger if exists trg_iwo_fabric_bom_guard on public.iwo_fabric_boms;
create trigger trg_iwo_fabric_bom_guard
  before insert or update on public.iwo_fabric_boms
  for each row execute function public.iwo_fabric_bom_guard();


-- ---------------------------------------------------------------------------
-- 2. Color/Print Details — the three name panels and the dia panel
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_fabric_bom_palette (
  id         uuid primary key default gen_random_uuid(),
  bom_id     uuid not null references public.iwo_fabric_boms(id) on delete cascade,
  section    text not null check (section in ('fabric', 'yarn', 'print')),
  sno        int  not null default 0,
  name       text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
-- Names are stored in capitals (the schema transforms them), so a plain unique
-- index is the duplicate guard.
create unique index if not exists uq_iwo_fabric_bom_palette
  on public.iwo_fabric_bom_palette(bom_id, section, name);

create table if not exists public.iwo_fabric_bom_dias (
  id         uuid primary key default gen_random_uuid(),
  bom_id     uuid not null references public.iwo_fabric_boms(id) on delete cascade,
  sno        int  not null default 0,
  knit_type  text check (knit_type is null or knit_type in ('circular', 'flat_knit', 'woven')),
  dia        text check (dia is null or char_length(dia) <= 32),
  created_at timestamptz not null default now()
);
create index if not exists idx_iwo_fabric_bom_dias_bom on public.iwo_fabric_bom_dias(bom_id);


-- ---------------------------------------------------------------------------
-- 3. Fabric Allocation + Fabric Consumption — one row per fabric line
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_fabric_bom_lines (
  id            uuid primary key default gen_random_uuid(),
  bom_id        uuid not null references public.iwo_fabric_boms(id) on delete cascade,
  sno           int  not null default 0,
  structure_id  uuid references public.categories(id),
  item_id       uuid not null references public.items(id),
  -- A name from this BOM's Fabric Colour panel (text, as on the order line).
  color_name    text,
  fabric_form   text check (fabric_form is null or fabric_form in ('open', 'tubular')),
  mixing_uom_id uuid references public.uoms(id),
  no_of_colors  int  check (no_of_colors is null or no_of_colors between 1 and 99),
  -- Fabric Consumption (screenshot 2940): GSM, Finish Dia, Stage, Req Wt.
  gsm           numeric(8,2) check (gsm is null or gsm > 0),
  finish_dia    text check (finish_dia is null or char_length(finish_dia) <= 32),
  stage_id      uuid references public.config_lookups(id),   -- kind fabric_stage
  req_kgs       numeric(18,4) check (req_kgs is null or req_kgs > 0),
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_iwo_fabric_bom_lines_bom on public.iwo_fabric_bom_lines(bom_id);


-- ---------------------------------------------------------------------------
-- 4. Fabric Process — one route per fabric (item), no colourway / component
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_fabric_bom_processes (
  id          uuid primary key default gen_random_uuid(),
  bom_id      uuid not null references public.iwo_fabric_boms(id) on delete cascade,
  item_id     uuid not null references public.items(id),
  sno         int  not null default 0,
  stage_id    uuid references public.config_lookups(id),
  process_id  uuid references public.processes(id),
  loss_for_id uuid references public.config_lookups(id),
  loss_pct    numeric check (loss_pct is null or (loss_pct >= 0 and loss_pct < 100)),
  type_id     uuid references public.config_lookups(id),
  created_at  timestamptz not null default now(),
  unique (bom_id, item_id, sno)
);

create table if not exists public.iwo_fabric_bom_process_scope (
  id         uuid primary key default gen_random_uuid(),
  bom_id     uuid not null references public.iwo_fabric_boms(id) on delete cascade,
  item_id    uuid not null references public.items(id),
  source     text not null default 'yarn_knit'
               check (source in ('yarn_knit', 'greige_purchase', 'dyed_purchase')),
  created_at timestamptz not null default now(),
  unique (bom_id, item_id)
);


-- ---------------------------------------------------------------------------
-- 5. Yarn Process — the output: what yarn to buy, and through which stages
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_fabric_bom_yarns (
  id             uuid primary key default gen_random_uuid(),
  bom_id         uuid not null references public.iwo_fabric_boms(id) on delete cascade,
  sno            int  not null default 0,
  item_id        uuid not null references public.items(id),
  -- For = Yarn only: the yarn is picked and weighed, not derived from a blend.
  planned_kgs    numeric(18,4) check (planned_kgs is null or planned_kgs > 0),
  buy_stage_id   uuid references public.config_lookups(id),   -- kind yarn_stage
  -- Written by the SERVER, never the form — the order BOM's rule.
  purchase_qty   numeric,
  uom_id         uuid references public.uoms(id),
  refusal_reason text,
  created_at     timestamptz not null default now(),
  unique (bom_id, item_id),
  constraint chk_iwofby_answer_or_reason check ((purchase_qty is null) <> (refusal_reason is null))
);

create table if not exists public.iwo_fabric_bom_yarn_stages (
  id             uuid primary key default gen_random_uuid(),
  yarn_id        uuid not null references public.iwo_fabric_bom_yarns(id) on delete cascade,
  sno            int  not null default 0,
  stage_id       uuid references public.config_lookups(id),
  process_id     uuid references public.processes(id),
  loss_for_id    uuid references public.config_lookups(id),
  -- The order grid's "For" colour; on an IWO, a name from the Yarn Colour panel.
  combo          text,
  description    text,
  loss_pct       numeric check (loss_pct is null or (loss_pct >= 0 and loss_pct < 100)),
  rate_per_kg    numeric(14,4) check (rate_per_kg is null or rate_per_kg >= 0),
  process_qty    numeric,
  uom_id         uuid references public.uoms(id),
  refusal_reason text,
  created_at     timestamptz not null default now(),
  constraint chk_iwofbys_not_both check (process_qty is null or refusal_reason is null)
);
create index if not exists idx_iwo_fabric_bom_yarn_stages_yarn on public.iwo_fabric_bom_yarn_stages(yarn_id);


-- ---------------------------------------------------------------------------
-- 6. Yarn Dyed Details — keyed by the fabric (structure + item), by value
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_fabric_bom_yd_repeats (
  id           uuid primary key default gen_random_uuid(),
  bom_id       uuid not null references public.iwo_fabric_boms(id) on delete cascade,
  structure_id uuid not null,
  item_id      uuid not null,
  sno          int  not null default 0,
  yarn_item_id uuid references public.items(id),
  dye_type     text not null check (dye_type in ('dyed', 'grey')),
  color_name   text,
  uom_id       uuid references public.uoms(id),
  value        numeric,
  twisted_yarn text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create index if not exists idx_iwo_fabric_bom_yd_repeats_bom on public.iwo_fabric_bom_yd_repeats(bom_id);

create table if not exists public.iwo_fabric_bom_yd_combinations (
  id            uuid primary key default gen_random_uuid(),
  bom_id        uuid not null references public.iwo_fabric_boms(id) on delete cascade,
  structure_id  uuid not null,
  item_id       uuid not null,
  combo         text,
  yd_combo_name text,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);
create index if not exists idx_iwo_fabric_bom_yd_comb_bom on public.iwo_fabric_bom_yd_combinations(bom_id);

create table if not exists public.iwo_fabric_bom_yd_combination_colors (
  id              uuid primary key default gen_random_uuid(),
  combination_id  uuid not null references public.iwo_fabric_bom_yd_combinations(id) on delete cascade,
  sno             int  not null default 0,
  yarn_color      text,
  dyeing_loss_pct numeric not null default 0 check (dyeing_loss_pct >= 0 and dyeing_loss_pct < 100),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid()
);


-- ---------------------------------------------------------------------------
-- 7. Item-class guards — a fabric line names a FABRIC, a yarn row a YARN
-- ---------------------------------------------------------------------------
create or replace function public.iwo_fabric_bom_item_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_want  text := tg_argv[0];            -- zero-based: see 0577
  v_class text;
begin
  select upper(c.code) into v_class
    from public.items i
    join public.config_lookups c on c.id = i.item_class_id
   where i.id = new.item_id;

  if v_class is distinct from v_want then
    raise exception 'Item % is class %, which this row does not take (it needs %).',
      new.item_id, coalesce(v_class, '(none)'), v_want
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.iwo_fabric_bom_item_guard() is
  'IWO Fabric BOM (0581): refuses a row whose item is not of the class named by '
  'TG_ARGV[0] — FABRIC on lines, YARN on yarns.';

revoke all on function public.iwo_fabric_bom_item_guard() from public, anon;
grant execute on function public.iwo_fabric_bom_item_guard() to authenticated;

drop trigger if exists trg_iwo_fabric_bom_lines_item on public.iwo_fabric_bom_lines;
create trigger trg_iwo_fabric_bom_lines_item
  before insert or update on public.iwo_fabric_bom_lines
  for each row execute function public.iwo_fabric_bom_item_guard('FABRIC');

drop trigger if exists trg_iwo_fabric_bom_yarns_item on public.iwo_fabric_bom_yarns;
create trigger trg_iwo_fabric_bom_yarns_item
  before insert or update on public.iwo_fabric_bom_yarns
  for each row execute function public.iwo_fabric_bom_item_guard('YARN');


-- ---------------------------------------------------------------------------
-- 8. RLS — the order Fabric BOM's shape: header scoped to the current unit,
--    children by the 'orders' permission
-- ---------------------------------------------------------------------------
alter table public.iwo_fabric_boms enable row level security;

drop policy if exists iwo_fabric_boms_read on public.iwo_fabric_boms;
create policy iwo_fabric_boms_read on public.iwo_fabric_boms
  for select to authenticated
  using (public.has_permission('orders', 'view') and public.is_current_location(location_id));
drop policy if exists iwo_fabric_boms_insert on public.iwo_fabric_boms;
create policy iwo_fabric_boms_insert on public.iwo_fabric_boms
  for insert to authenticated
  with check (public.has_permission('orders', 'create') and public.is_current_location(location_id));
drop policy if exists iwo_fabric_boms_update on public.iwo_fabric_boms;
create policy iwo_fabric_boms_update on public.iwo_fabric_boms
  for update to authenticated
  using (public.has_permission('orders', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('orders', 'edit') and public.is_current_location(location_id));
drop policy if exists iwo_fabric_boms_delete on public.iwo_fabric_boms;
create policy iwo_fabric_boms_delete on public.iwo_fabric_boms
  for delete to authenticated
  using (public.has_permission('orders', 'delete') and public.is_current_location(location_id));

do $$
declare t text;
begin
  foreach t in array array[
    'iwo_fabric_bom_palette', 'iwo_fabric_bom_dias', 'iwo_fabric_bom_lines',
    'iwo_fabric_bom_processes', 'iwo_fabric_bom_process_scope',
    'iwo_fabric_bom_yarns', 'iwo_fabric_bom_yarn_stages',
    'iwo_fabric_bom_yd_repeats', 'iwo_fabric_bom_yd_combinations',
    'iwo_fabric_bom_yd_combination_colors'
  ] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 9. Assertions, from the catalog
-- ---------------------------------------------------------------------------
do $$
declare v_t text;
begin
  foreach v_t in array array[
    'iwo_fabric_boms', 'iwo_fabric_bom_palette', 'iwo_fabric_bom_dias',
    'iwo_fabric_bom_lines', 'iwo_fabric_bom_processes', 'iwo_fabric_bom_process_scope',
    'iwo_fabric_bom_yarns', 'iwo_fabric_bom_yarn_stages',
    'iwo_fabric_bom_yd_repeats', 'iwo_fabric_bom_yd_combinations',
    'iwo_fabric_bom_yd_combination_colors'
  ] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass) then
      raise exception '0581: RLS is off on %', v_t;
    end if;
  end loop;

  foreach v_t in array array[
    'public.iwo_fabric_bom_guard()', 'public.iwo_fabric_bom_item_guard()'
  ] loop
    if has_function_privilege('anon', v_t, 'EXECUTE') then
      raise exception '0581: % is executable by anon', v_t;
    end if;
  end loop;

  if (select count(*) from pg_trigger
       where tgfoid = 'public.iwo_fabric_bom_item_guard()'::regprocedure and not tgisinternal) <> 2 then
    raise exception '0581: the item guard is not on both lines and yarns';
  end if;
end $$;
