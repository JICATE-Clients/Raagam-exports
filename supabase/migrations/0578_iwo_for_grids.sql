-- ============================================================================
-- Raagam ERP — 0578 Internal Work Order: the header slims down, the lines
-- become real items, and the grid takes its shape from `For`.
--
-- Client, 2026-09-18, legacy screenshots 2936 (the IWO header), 2937 (its BOM
-- with For = Yarn) and 2938 (For = Fabric). An IWO is advance procurement
-- before any buyer order exists — "a Dummy Order" (doc/order/update.md §1.1) —
-- so the garment machinery of an order BOM (styles, colourways, front/back body
-- panels, consumption formulas) is bypassed outright: the operator names an item
-- from its master and types the weight.
--
-- LIVE STATE WHEN WRITTEN: 0 internal_work_orders, 0 iwo_lines. Nothing to
-- migrate, which is the only reason columns are DROPPED here rather than left
-- to rot beside their replacements.
--
-- ## 1. THE HEADER LOSES FIVE FIELDS
--
-- Type (Order Related / Non-Order Related), Item Class, Owner Of the Trial and
-- Customer — removed by the client; an IWO is by definition not an order, and
-- `For` below replaces Item Class. `style_id` goes too: the Style master left
-- the menu on 2026-08-25 and every order now names its style by TEXT
-- (`garment_order_amendment_styles.style_ref_no`), so an IWO that still pointed
-- at `garment_styles` was the one screen out of step. `title`, `instructions`
-- and the free-text `reference` were 0024's order-authorisation fields and no
-- screen has written them since 0125; Reference is now the RE No PICKER, stored
-- in the `sales_order_id` column 0024 already had.
--
-- ## 2. THE NUMBER IS UNIT FIRST — U2/IWO/2627/0005
--
-- 0559 composed IWO/U2/2627/0001 from doc/order/update.md §1.2's pattern. The
-- client's own legacy screen (2936, 2938) prints U2/IWO/2627/0005, the same
-- unit-first order the RE No already uses (HO/RE/26-27/0011). The legacy screen
-- is the document the operators read every day, so it wins over the spec's
-- example; the FY segment stays `2627` (operator, 2026-09-12). Only the
-- composer changes — the counter, the trigger and the per-(unit, year) reset
-- are 0559's, untouched.
--
-- ## 3. ONE LINE TABLE PER `For`, NOT ONE WIDE TABLE
--
-- The three grids share almost no columns: a yarn has a stage and a weight, a
-- fabric adds colour, print, GSM and dia, an accessory has a size, a unit and a
-- count. One table would be mostly NULLs with the real rule ("a fabric line has
-- no size") living nowhere. Separate tables let each column be NOT NULL exactly
-- where its kind needs it.
--
-- All three kinds have an optional process grid (2937, 2938, 2941): a yarn's
-- dyeing shades with their KGS and rate, a fabric's steps with their loss %, an
-- accessory's processing with its vendor and rate. Each kind's rows hang off
-- ITS line with ON DELETE CASCADE. The save rewrites lines and their process
-- rows together in one action, so the cascade only ever removes rows that are
-- about to be re-inserted — not the set-null-orphan shape Material Attributes
-- paid for.
--
-- ## 4. THE DATABASE REFUSES A LINE OF THE WRONG KIND
--
-- `iwo_line_guard` checks two things on every insert/update: the header's `For`
-- is this table's kind, and the item's class is one this kind accepts (YARN;
-- FABRIC; SEW or PACK — `ACCESSORY_CLASS_CODES` in material-types.ts). The
-- screen narrows its pickers the same way; this is what holds when something
-- other than the screen writes. TG_ARGV IS ZERO-BASED — 0576 used [1] and made
-- 44 triggers no-ops (0577).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Header
-- ---------------------------------------------------------------------------
alter table public.internal_work_orders
  drop column if exists iwo_type,
  drop column if exists item_class_id,
  drop column if exists owner_of_trial_id,
  drop column if exists customer_id,
  drop column if exists style_id,
  drop column if exists title,
  drop column if exists instructions,
  drop column if exists reference,
  add column if not exists style_ref_no text;

alter table public.internal_work_orders
  alter column iwo_for set not null,
  drop constraint if exists internal_work_orders_iwo_for_check,
  add constraint internal_work_orders_iwo_for_check
    check (iwo_for in ('yarn', 'fabric', 'accessories'));

comment on column public.internal_work_orders.iwo_for is
  'What this IWO procures: yarn | fabric | accessories (0578). Decides which '
  'line table holds its lines; iwo_line_guard refuses a line of another kind.';
comment on column public.internal_work_orders.sales_order_id is
  'Reference (RE No) — optional link to a buyer order, since an IWO is usually '
  'raised before one exists (0578 reused 0024''s column).';
comment on column public.internal_work_orders.style_ref_no is
  'Target style, as TEXT — the way every order names its style since 2026-08-25.';


-- ---------------------------------------------------------------------------
-- 2. The number, unit first
-- ---------------------------------------------------------------------------
create or replace function public.iwo_no_format(
  p_location_code text,
  p_fy            text,
  p_next          int
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_location_code || '/IWO/' || p_fy || '/'
      || lpad(p_next::text, greatest(4, length(p_next::text)), '0');
$$;

comment on function public.iwo_no_format(text, text, int) is
  'Composes an IWO number: U2 + 2627 + 5 -> U2/IWO/2627/0005, the legacy '
  'screen''s own spelling (0578; 0559 had IWO/U2/...). The 4-digit pad is a '
  'FLOOR, not a width — bare lpad() would truncate 12345 to 1234.';

revoke all on function public.iwo_no_format(text, text, int) from public, anon;
grant execute on function public.iwo_no_format(text, text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Lines — the free-text placeholder goes, one table per kind replaces it
-- ---------------------------------------------------------------------------
drop table if exists public.iwo_lines;

create table if not exists public.iwo_yarn_items (
  id          uuid primary key default gen_random_uuid(),
  iwo_id      uuid not null references public.internal_work_orders(id) on delete cascade,
  sno         int  not null default 0,
  item_id     uuid not null references public.items(id),
  -- config_lookups kind `yarn_stage` — GREY / DYED (0504).
  stage_id    uuid not null references public.config_lookups(id),
  planned_kgs numeric(18,4) not null check (planned_kgs > 0),
  created_at  timestamptz not null default now()
);
create index if not exists idx_iwo_yarn_items_iwo on public.iwo_yarn_items(iwo_id);

create table if not exists public.iwo_yarn_process_details (
  id           uuid primary key default gen_random_uuid(),
  yarn_item_id uuid not null references public.iwo_yarn_items(id) on delete cascade,
  sno          int  not null default 0,
  process_id   uuid not null references public.processes(id),
  -- config_lookups kind `fabric_color` — the one colour master (0415).
  shade_id     uuid references public.config_lookups(id),
  qty_kgs      numeric(18,4) not null check (qty_kgs > 0),
  rate_per_kg  numeric(14,4) check (rate_per_kg >= 0),
  created_at   timestamptz not null default now()
);
create index if not exists idx_iwo_yarn_proc_line on public.iwo_yarn_process_details(yarn_item_id);

create table if not exists public.iwo_fabric_items (
  id          uuid primary key default gen_random_uuid(),
  iwo_id      uuid not null references public.internal_work_orders(id) on delete cascade,
  sno         int  not null default 0,
  -- The fabric carries its structure (`items.category_id`), so none is stored.
  item_id     uuid not null references public.items(id),
  -- config_lookups kind `fabric_stage` — GREIGE / DYED / WASH / PRINT.
  stage_id    uuid not null references public.config_lookups(id),
  color_id    uuid references public.config_lookups(id),   -- kind fabric_color
  print_id    uuid references public.config_lookups(id),   -- kind roll_form_print
  gsm         numeric(8,2) check (gsm > 0),
  -- Legacy "Form / Tube" (screenshot 2940) — the same two values, spelled the
  -- same way, as order_fabric_bom_lines.fabric_form (0495).
  fabric_form text check (fabric_form is null or fabric_form in ('open', 'tubular')),
  dia         text,
  planned_kgs numeric(18,4) not null check (planned_kgs > 0),
  created_at  timestamptz not null default now()
);
create index if not exists idx_iwo_fabric_items_iwo on public.iwo_fabric_items(iwo_id);

create table if not exists public.iwo_fabric_process_details (
  id             uuid primary key default gen_random_uuid(),
  fabric_item_id uuid not null references public.iwo_fabric_items(id) on delete cascade,
  sno            int  not null default 0,
  process_id     uuid not null references public.processes(id),
  -- A fraction of the step's OWN OUTPUT: input = output / (1 - loss/100),
  -- compounded — `comboUplift`'s rule (doc/order/update.md §1.3).
  loss_pct       numeric(6,3) not null default 0 check (loss_pct >= 0 and loss_pct < 100),
  rate_per_kg    numeric(14,4) check (rate_per_kg >= 0),
  created_at     timestamptz not null default now()
);
create index if not exists idx_iwo_fabric_proc_line on public.iwo_fabric_process_details(fabric_item_id);

create table if not exists public.iwo_accessory_items (
  id          uuid primary key default gen_random_uuid(),
  iwo_id      uuid not null references public.internal_work_orders(id) on delete cascade,
  sno         int  not null default 0,
  item_id     uuid not null references public.items(id),
  -- Legacy "Brand / Specs" (screenshot 2941) — trim quality, ply, material.
  specs       text,
  color_id    uuid references public.config_lookups(id),   -- kind fabric_color
  size_id     uuid references public.config_lookups(id),   -- kind size
  uom_id      uuid not null references public.uoms(id),
  planned_qty numeric(18,4) not null check (planned_qty > 0),
  -- "Advised?" (screenshot 2941): the item's specification or buyer approval
  -- is still pending. RECORDED, NOT YET ENFORCED — the client's rule is that
  -- no PO may be raised against an advised line, and no purchase screen reads
  -- IWO lines today. This flag is what that check will read when one does.
  is_advised  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_iwo_accessory_items_iwo on public.iwo_accessory_items(iwo_id);

create table if not exists public.iwo_accessory_process_details (
  id                uuid primary key default gen_random_uuid(),
  accessory_item_id uuid not null references public.iwo_accessory_items(id) on delete cascade,
  sno               int  not null default 0,
  process_id        uuid not null references public.processes(id),
  -- `master_vendors`, never the purchase-side `public.vendors` (AGENTS.md,
  -- Nominated vendors: 0376–0380 — a picker hands back a master id).
  vendor_id         uuid references public.master_vendors(id),
  rate_per_unit     numeric(14,4) check (rate_per_unit >= 0),
  created_at        timestamptz not null default now()
);
create index if not exists idx_iwo_acc_proc_line on public.iwo_accessory_process_details(accessory_item_id);


-- ---------------------------------------------------------------------------
-- 4. The guard — right header, right item class
-- ---------------------------------------------------------------------------
create or replace function public.iwo_line_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_kind  text := tg_argv[0];            -- zero-based: see 0577
  v_for   text;
  v_class text;
begin
  select w.iwo_for into v_for
    from public.internal_work_orders w
   where w.id = new.iwo_id;

  if v_for is distinct from v_kind then
    raise exception
      'This Internal Work Order is For %, so it cannot hold a % line.',
      coalesce(v_for, '(nothing)'), v_kind
      using errcode = '23514';
  end if;

  select upper(c.code) into v_class
    from public.items i
    join public.config_lookups c on c.id = i.item_class_id
   where i.id = new.item_id;

  if not (
       (v_kind = 'yarn'        and v_class = 'YARN')
    or (v_kind = 'fabric'      and v_class = 'FABRIC')
    or (v_kind = 'accessories' and v_class in ('SEW', 'PACK'))
  ) then
    raise exception
      'Item % is class %, which a % line does not take.',
      new.item_id, coalesce(v_class, '(none)'), v_kind
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.iwo_line_guard() is
  'Refuses an IWO line whose header is For another kind, or whose item is the '
  'wrong class (0578). TG_ARGV[0] names the table''s kind.';

revoke all on function public.iwo_line_guard() from public, anon;
grant execute on function public.iwo_line_guard() to authenticated;

drop trigger if exists trg_iwo_yarn_items_guard on public.iwo_yarn_items;
create trigger trg_iwo_yarn_items_guard
  before insert or update on public.iwo_yarn_items
  for each row execute function public.iwo_line_guard('yarn');

drop trigger if exists trg_iwo_fabric_items_guard on public.iwo_fabric_items;
create trigger trg_iwo_fabric_items_guard
  before insert or update on public.iwo_fabric_items
  for each row execute function public.iwo_line_guard('fabric');

drop trigger if exists trg_iwo_accessory_items_guard on public.iwo_accessory_items;
create trigger trg_iwo_accessory_items_guard
  before insert or update on public.iwo_accessory_items
  for each row execute function public.iwo_line_guard('accessories');


-- ---------------------------------------------------------------------------
-- 5. RLS — the existing 'orders' permission, same shape as 0024
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'iwo_yarn_items', 'iwo_yarn_process_details',
    'iwo_fabric_items', 'iwo_fabric_process_details',
    'iwo_accessory_items', 'iwo_accessory_process_details'
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
-- 6. Assertions — verified from the catalog, not assumed from the SQL above
-- ---------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  if public.iwo_no_format('U2', '2627', 5) <> 'U2/IWO/2627/0005' then
    raise exception '0578: format(U2,2627,5) = %, expected U2/IWO/2627/0005',
      public.iwo_no_format('U2', '2627', 5);
  end if;
  if public.iwo_no_format('U2', '2627', 12345) <> 'U2/IWO/2627/12345' then
    raise exception '0578: the pad truncated a 5-digit serial';
  end if;

  foreach v_t in array array[
    'public.iwo_no_format(text, text, int)',
    'public.iwo_line_guard()'
  ] loop
    if has_function_privilege('anon', v_t, 'EXECUTE') then
      raise exception '0578: % is executable by anon', v_t;
    end if;
  end loop;

  foreach v_t in array array[
    'iwo_yarn_items', 'iwo_yarn_process_details',
    'iwo_fabric_items', 'iwo_fabric_process_details',
    'iwo_accessory_items', 'iwo_accessory_process_details'
  ] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass) then
      raise exception '0578: RLS is off on %', v_t;
    end if;
  end loop;

  -- The guard must actually be wired with its kind, not merely exist.
  if (select count(*) from pg_trigger
       where tgfoid = 'public.iwo_line_guard()'::regprocedure and not tgisinternal) <> 3 then
    raise exception '0578: iwo_line_guard is not on all three line tables';
  end if;

  if to_regclass('public.iwo_lines') is not null then
    raise exception '0578: iwo_lines still exists';
  end if;
end $$;
