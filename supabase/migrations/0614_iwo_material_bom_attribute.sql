-- ============================================================================
-- Raagam ERP — 0614 IWO Material BOM ▸ ATTRIBUTE (the breakup of one line)
--
-- User 2026-09-21 (screenshot 2986, "why attribute field is not visible …
-- i need here now please add it too"). The IWO Material BOM was built as the
-- order Material BOM MINUS what only an order has (0584's header), and the
-- Attribute was one of those: on an order it EXPLODES a line by the order's
-- colourways, sizes, styles and countries. An IWO has no order, so there is
-- nothing to explode by — the planner types one Planned Qty per line.
--
-- WHAT AN IWO ATTRIBUTE MEANS, THEN: not an explosion but a BREAKUP the
-- planner types. A line is
--
--   item         one Planned Qty, as before (the default; every stored row);
--   colour       one row per colour   (Colour picked, Qty typed);
--   size         one row per size     (Size typed — an IWO has no size range);
--   colour_size  one row per (colour, size).
--
-- The line's `planned_qty` becomes Σ of its rows (the server writes it; the
-- screen shows it read-only), so everything downstream that reads the LINE —
-- `required_qty`, `purchase_qty`, the IWO Budget pull, the purchase gate
-- (`purchase-gate.ts`), the approval lock — is unchanged. The breakup is
-- detail under the line, never a second quantity beside it.
--
-- THE ORDER BOM'S SLICES TABLE IS NOT REUSED. Its rows are keyed by the
-- order's combo / size_id / country / style — foreign keys an IWO cannot fill.
-- This child is deliberately small: a colour (the same `fabric_color` lookup
-- the line's own Colour uses), a typed size, a quantity.
--
-- LOCKED WITH ITS BOM (0595). `refuse_when_iwo_budget_locked` names the path
-- a row takes to its IWO and REFUSES an unknown one, so the function is
-- re-declared with one more path rather than the child being left unlocked:
-- an approved budget's breakup must be as frozen as its line.
--
-- VERIFY FROM THE CATALOG:
--   select to_regclass('public.iwo_material_bom_item_slices');            -- not null
--   select relrowsecurity from pg_class
--    where oid = 'public.iwo_material_bom_item_slices'::regclass;         -- t
--   select tgname from pg_trigger
--    where tgrelid = 'public.iwo_material_bom_item_slices'::regclass;    -- trg_iwo_budget_lock
--   select column_name from information_schema.columns
--    where table_name = 'iwo_material_bom_items' and column_name = 'attribute';
-- ============================================================================

-- 1. The attribute on the line ------------------------------------------------
alter table public.iwo_material_bom_items
  add column if not exists attribute text not null default 'item';

alter table public.iwo_material_bom_items
  drop constraint if exists chk_iwomb_item_attribute;
alter table public.iwo_material_bom_items
  add constraint chk_iwomb_item_attribute
  check (attribute in ('item', 'colour', 'size', 'colour_size'));

comment on column public.iwo_material_bom_items.attribute is
  'How the line is broken up (0614): item = one Planned Qty; colour / size / colour_size = one typed row per colour and/or size in iwo_material_bom_item_slices, planned_qty = their sum.';

-- 2. The breakup rows ---------------------------------------------------------
create table if not exists public.iwo_material_bom_item_slices (
  id            uuid primary key default gen_random_uuid(),
  item_line_id  uuid not null references public.iwo_material_bom_items(id) on delete cascade,
  sno           int  not null default 0,
  item_color_id uuid references public.config_lookups(id),   -- kind fabric_color
  size          text,
  -- In the line's consumption unit, like the line's own planned_qty.
  planned_qty   numeric(18,4) not null check (planned_qty > 0),
  created_at    timestamptz not null default now(),
  constraint uq_iwomb_item_slice_sno unique (item_line_id, sno)
);
create index if not exists idx_iwomb_item_slices_line on public.iwo_material_bom_item_slices(item_line_id);

comment on table public.iwo_material_bom_item_slices is
  'IWO Material BOM ▸ a line''s typed breakup by colour and/or size (0614). Rows exist only where the line''s attribute is not ''item''; the line''s planned_qty is their sum.';

-- 3. RLS — the children's shape from 0584: by the orders permission ----------
alter table public.iwo_material_bom_item_slices enable row level security;

drop policy if exists iwo_material_bom_item_slices_read on public.iwo_material_bom_item_slices;
create policy iwo_material_bom_item_slices_read on public.iwo_material_bom_item_slices
  for select to authenticated using (public.has_permission('orders', 'view'));
drop policy if exists iwo_material_bom_item_slices_insert on public.iwo_material_bom_item_slices;
create policy iwo_material_bom_item_slices_insert on public.iwo_material_bom_item_slices
  for insert to authenticated with check (public.has_permission('orders', 'create'));
drop policy if exists iwo_material_bom_item_slices_update on public.iwo_material_bom_item_slices;
create policy iwo_material_bom_item_slices_update on public.iwo_material_bom_item_slices
  for update to authenticated
  using (public.has_permission('orders', 'edit'))
  with check (public.has_permission('orders', 'edit'));
drop policy if exists iwo_material_bom_item_slices_delete on public.iwo_material_bom_item_slices;
create policy iwo_material_bom_item_slices_delete on public.iwo_material_bom_item_slices
  for delete to authenticated using (public.has_permission('orders', 'delete'));

-- 4. The budget lock reaches the new child (0595, one more path) -------------
create or replace function public.refuse_when_iwo_budget_locked()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_path   text := tg_argv[0];            -- zero-based: see 0577
  v_rows   jsonb[];
  v_r      jsonb;
  v_iwo    uuid;
  v_status text;
begin
  -- Judge the row as it WAS and as it WILL BE: moving a child from an
  -- unlocked BOM into a locked one is as much an edit of the locked one.
  if tg_op <> 'INSERT' then v_rows := array_append(v_rows, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then v_rows := array_append(v_rows, to_jsonb(new)); end if;

  foreach v_r in array v_rows loop
    v_iwo := case v_path
      when 'iwo' then (v_r->>'iwo_id')::uuid
      when 'fabric_bom' then (select b.iwo_id from public.iwo_fabric_boms b where b.id = (v_r->>'bom_id')::uuid)
      when 'fabric_yarn' then (
        select b.iwo_id from public.iwo_fabric_bom_yarns y
          join public.iwo_fabric_boms b on b.id = y.bom_id
         where y.id = (v_r->>'yarn_id')::uuid)
      when 'fabric_yd' then (
        select b.iwo_id from public.iwo_fabric_bom_yd_combinations c
          join public.iwo_fabric_boms b on b.id = c.bom_id
         where c.id = (v_r->>'combination_id')::uuid)
      when 'material_bom' then (select b.iwo_id from public.iwo_material_boms b where b.id = (v_r->>'bom_id')::uuid)
      -- 0614: a line's breakup row, through its line to the BOM.
      when 'material_item' then (
        select b.iwo_id from public.iwo_material_bom_items i
          join public.iwo_material_boms b on b.id = i.bom_id
         where i.id = (v_r->>'item_line_id')::uuid)
      when 'budget_line' then (select b.iwo_id from public.iwo_budgets b where b.id = (v_r->>'budget_id')::uuid)
      else null
    end;
    if v_path not in ('iwo', 'fabric_bom', 'fabric_yarn', 'fabric_yd', 'material_bom', 'material_item', 'budget_line') then
      raise exception 'refuse_when_iwo_budget_locked: unknown path %', v_path;
    end if;
    -- A parent already gone (a cascade from an unlocked delete) locks nothing.
    continue when v_iwo is null;
    v_status := public.iwo_budget_lock_of(v_iwo);
    if v_status is not null then
      raise exception
        'This work order''s budget is % — its BOM and budget lines are locked. Reopen the budget to change them.',
        v_status
        using errcode = '55000';
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.refuse_when_iwo_budget_locked() from public, anon;

drop trigger if exists trg_iwo_budget_lock on public.iwo_material_bom_item_slices;
create trigger trg_iwo_budget_lock
  before insert or update or delete on public.iwo_material_bom_item_slices
  for each row execute function public.refuse_when_iwo_budget_locked('material_item');

-- 5. Assertions, from the catalog --------------------------------------------
do $$
begin
  if to_regclass('public.iwo_material_bom_item_slices') is null then
    raise exception '0614: iwo_material_bom_item_slices was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.iwo_material_bom_item_slices'::regclass) then
    raise exception '0614: RLS is off on iwo_material_bom_item_slices';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.iwo_material_bom_item_slices'::regclass and tgname = 'trg_iwo_budget_lock'
  ) then
    raise exception '0614: the budget lock trigger is missing on iwo_material_bom_item_slices';
  end if;
  if has_function_privilege('anon', 'public.refuse_when_iwo_budget_locked()', 'EXECUTE') then
    raise exception '0614: refuse_when_iwo_budget_locked() is executable by anon';
  end if;
end $$;
