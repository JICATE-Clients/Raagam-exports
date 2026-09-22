-- ============================================================================
-- Raagam ERP — 0584 IWO Material BOM: the order Material BOM, duplicated for
-- an Internal Work Order For Accessories.
--
-- Client, 2026-09-19 (screenshot 2941, doc/order/internlwork order.md §5):
-- "selecting For = Accessories reuses the Material BOM UI component. Piece-level
-- consumption is overridden, allowing direct manual bulk entry." The order
-- Material BOM screen is NOT touched — this is its copy, as 0581 was the Fabric
-- BOM's.
--
-- ## WHY NOT ROWS IN `material_bom_amendments`
--
-- The same three reasons 0581 gives, checked against this family:
--   1. The header is keyed to a garment order (`garment_order_id`, the
--      per-order `amendment_no`, `has_order_access(sales_order_id)` RLS, the
--      0576 order-lock trigger) — none of which an IWO has.
--   2. Readers treat those tables as ORDER demand with no filter:
--      `report_item_movements` (every requirement is a planned fact), the
--      Accessories Requirement report, the Budget's coverage read, the order
--      screen's own BOM list and copy sheet. IWO rows would leak into all of them.
--   3. The client asked that the order screen not be disturbed.
--
-- ## WHAT THE COPY KEEPS, AND WHAT IT DROPS
--
-- Kept, same column names: category, material, Brand / Specs (`specification`),
-- colour (`item_color_id`), the two units and the pack (`uom_conversion_id`),
-- MOQ, Round To, the three switches (Advised = the order's TBA, send out for
-- processing, FOC) and the Processes grid (stage, process, loss %, vendor).
-- Dropped: the order explosion — slices, sizes, colourways, garment parts,
-- pieces per garment, wastage — because Planned Qty is TYPED (SRS §5).
--
-- ## THE ARITHMETIC IS THE ORDER MATERIAL BOM'S, NOT THE FABRIC ONE
--
-- Decided by the client 2026-09-19: an accessory's process loss MULTIPLIES
-- (Planned × (1 + loss%), `compoundLossFactor`), exactly as the order Material
-- BOM does — not the fabric/yarn DIVIDE rule. The two engines differ on
-- purpose. `required_qty` / `purchase_qty` are written by the SERVER.
--
-- ## ADVISED IS RECORDED, NOT YET ENFORCED
--
-- `is_advised` is the order BOM's TBA ("To be advised"). Purchase blocks a PO
-- for a TBA line on an ORDER BOM (`refuseUnsettledMaterials`), but a PO line
-- names a sales order and nothing names an IWO yet; that link is its own step.
--
-- No Processes Rate: prices stay on the Budget (client, 2026-09-19).
-- One BOM per IWO; no Entry No (known by its I.WO No, as 0581).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Header
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_material_boms (
  id          uuid primary key default gen_random_uuid(),
  iwo_id      uuid not null unique references public.internal_work_orders(id) on delete cascade,
  bom_date    date not null default current_date,
  is_draft    boolean not null default false,
  remark      text,
  -- Stamped from the IWO by the guard below, never from the form.
  location_id uuid not null references public.locations(id),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_iwo_material_boms_updated on public.iwo_material_boms;
create trigger trg_iwo_material_boms_updated before update on public.iwo_material_boms
  for each row execute function public.set_updated_at();

create or replace function public.iwo_material_bom_guard()
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

  if v_for is distinct from 'accessories' then
    raise exception
      'A Material BOM is raised only for an Internal Work Order For Accessories (this one is For %).',
      coalesce(v_for, '(nothing)')
      using errcode = '23514';
  end if;

  new.location_id := v_loc;
  return new;
end;
$$;

comment on function public.iwo_material_bom_guard() is
  'IWO Material BOM header (0584): refuses an IWO that is not For accessories, and '
  'stamps location_id from the IWO so the BOM belongs to the unit that raised it.';

revoke all on function public.iwo_material_bom_guard() from public, anon;
grant execute on function public.iwo_material_bom_guard() to authenticated;

drop trigger if exists trg_iwo_material_bom_guard on public.iwo_material_boms;
create trigger trg_iwo_material_bom_guard
  before insert or update on public.iwo_material_boms
  for each row execute function public.iwo_material_bom_guard();

-- ---------------------------------------------------------------------------
-- 2. Items — one row per accessory planned
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_material_bom_items (
  id                 uuid primary key default gen_random_uuid(),
  bom_id             uuid not null references public.iwo_material_boms(id) on delete cascade,
  sno                int  not null default 0,
  category_id        uuid references public.categories(id),
  item_id            uuid not null references public.items(id),
  -- "Brand / Specs" (screenshot 2941) — the order BOM's own `specification`.
  specification      text,
  item_color_id      uuid references public.config_lookups(id),   -- kind fabric_color
  consumption_uom_id uuid not null references public.uoms(id),
  purchase_uom_id    uuid references public.uoms(id),
  uom_conversion_id  uuid references public.material_uom_conversions(id),
  -- Typed, in the CONSUMPTION unit — the order BOM's calculated need, replaced.
  planned_qty        numeric(18,4) not null check (planned_qty > 0),
  moq                numeric(18,4) check (moq is null or moq >= 0),
  round_to           numeric(18,4) check (round_to is null or round_to > 0),
  -- The order BOM's TBA — "To be advised": spec or buyer approval pending.
  is_advised         boolean not null default false,
  send_out           boolean not null default false,
  is_foc             boolean not null default false,
  -- Written by the SERVER: Planned × (1 + loss%) in the consumption unit, and
  -- that converted to the purchase pack with MOQ and Round To applied.
  required_qty       numeric,
  purchase_qty       numeric,
  refusal_reason     text,
  created_at         timestamptz not null default now(),
  constraint chk_iwomb_item_answer_or_reason check ((purchase_qty is null) <> (refusal_reason is null))
);
create index if not exists idx_iwo_material_bom_items_bom on public.iwo_material_bom_items(bom_id);

-- ---------------------------------------------------------------------------
-- 3. Processes — where a material is sent, and what it loses there
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_material_bom_processes (
  id          uuid primary key default gen_random_uuid(),
  bom_id      uuid not null references public.iwo_material_boms(id) on delete cascade,
  sno         int  not null default 0,
  item_id     uuid not null references public.items(id),
  -- GREIGE / DYED — the order BOM's `PROCESS_STAGE_OPTIONS`, spelled the same.
  stage       text check (stage is null or stage in ('GREIGE', 'DYED')),
  process_id  uuid not null references public.processes(id),
  loss_pct    numeric check (loss_pct is null or (loss_pct >= 0 and loss_pct < 100)),
  -- `master_vendors`, never the purchase-side `public.vendors` (AGENTS.md).
  vendor_id   uuid references public.master_vendors(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_iwo_material_bom_processes_bom on public.iwo_material_bom_processes(bom_id);

-- ---------------------------------------------------------------------------
-- 4. Item guard — a Material BOM line names a Sewing or Packing accessory
-- ---------------------------------------------------------------------------
create or replace function public.iwo_material_bom_item_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_class text;
begin
  select upper(c.code) into v_class
    from public.items i
    join public.config_lookups c on c.id = i.item_class_id
   where i.id = new.item_id;

  if v_class is null or v_class not in ('SEW', 'PACK') then
    raise exception 'Item % is class %, which an accessory line does not take (it needs SEW or PACK).',
      new.item_id, coalesce(v_class, '(none)')
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.iwo_material_bom_item_guard() is
  'IWO Material BOM (0584): refuses a line or process row whose item is not a '
  'Sewing or Packing accessory — the classes ACCESSORY_CLASS_CODES names.';

revoke all on function public.iwo_material_bom_item_guard() from public, anon;
grant execute on function public.iwo_material_bom_item_guard() to authenticated;

drop trigger if exists trg_iwo_material_bom_items_item on public.iwo_material_bom_items;
create trigger trg_iwo_material_bom_items_item
  before insert or update on public.iwo_material_bom_items
  for each row execute function public.iwo_material_bom_item_guard();

drop trigger if exists trg_iwo_material_bom_processes_item on public.iwo_material_bom_processes;
create trigger trg_iwo_material_bom_processes_item
  before insert or update on public.iwo_material_bom_processes
  for each row execute function public.iwo_material_bom_item_guard();

-- ---------------------------------------------------------------------------
-- 5. The For lock learns about the Material BOM (0582's rule, extended)
-- ---------------------------------------------------------------------------
create or replace function public.iwo_for_lock()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.iwo_for is distinct from old.iwo_for then
    if exists (select 1 from public.iwo_fabric_boms b where b.iwo_id = old.id) then
      raise exception
        'This work order already has a Fabric BOM, so its For cannot change. Delete the Fabric BOM first (IWO Fabric BOM).'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.iwo_material_boms b where b.iwo_id = old.id) then
      raise exception
        'This work order already has a Material BOM, so its For cannot change. Delete the Material BOM first (IWO Material BOM).'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.iwo_accessory_items a where a.iwo_id = old.id) then
      raise exception
        'This work order still has accessory lines, so its For cannot change. Clear them first.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.iwo_for_lock() from public, anon;
grant execute on function public.iwo_for_lock() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS — 0581's shape: header scoped to the current unit, children by the
--    'orders' permission
-- ---------------------------------------------------------------------------
alter table public.iwo_material_boms enable row level security;

drop policy if exists iwo_material_boms_read on public.iwo_material_boms;
create policy iwo_material_boms_read on public.iwo_material_boms
  for select to authenticated
  using (public.has_permission('orders', 'view') and public.is_current_location(location_id));
drop policy if exists iwo_material_boms_insert on public.iwo_material_boms;
create policy iwo_material_boms_insert on public.iwo_material_boms
  for insert to authenticated
  with check (public.has_permission('orders', 'create') and public.is_current_location(location_id));
drop policy if exists iwo_material_boms_update on public.iwo_material_boms;
create policy iwo_material_boms_update on public.iwo_material_boms
  for update to authenticated
  using (public.has_permission('orders', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('orders', 'edit') and public.is_current_location(location_id));
drop policy if exists iwo_material_boms_delete on public.iwo_material_boms;
create policy iwo_material_boms_delete on public.iwo_material_boms
  for delete to authenticated
  using (public.has_permission('orders', 'delete') and public.is_current_location(location_id));

do $$
declare t text;
begin
  foreach t in array array['iwo_material_bom_items', 'iwo_material_bom_processes'] loop
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
-- 7. Assertions, from the catalog
-- ---------------------------------------------------------------------------
do $$
declare v_t text;
begin
  foreach v_t in array array['iwo_material_boms', 'iwo_material_bom_items', 'iwo_material_bom_processes'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass) then
      raise exception '0584: RLS is off on %', v_t;
    end if;
  end loop;
  foreach v_t in array array[
    'public.iwo_material_bom_guard()', 'public.iwo_material_bom_item_guard()', 'public.iwo_for_lock()'
  ] loop
    if has_function_privilege('anon', v_t, 'EXECUTE') then
      raise exception '0584: % is executable by anon', v_t;
    end if;
  end loop;
  if (select count(*) from pg_trigger
       where tgfoid = 'public.iwo_material_bom_item_guard()'::regprocedure and not tgisinternal) <> 2 then
    raise exception '0584: the item guard is not on both items and processes';
  end if;
end $$;
