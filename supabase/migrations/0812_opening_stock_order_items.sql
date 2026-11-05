-- 0812 — Opening Stock: an order's lines hold only that order's planned items (2026-11-05).
--
-- Plan: doc/stores/opening-stock-order-items-plan.md. With Group Type = RE / IWO / SWO the
-- screen's Item list is the order's requirement plan (`po_requirement_lines`, the source Raise
-- PO and Stock Transfer read); General keeps the whole item master. This is the database half,
-- so a stale tab, a second window or a direct RPC is refused the same way the screen is.
--
-- A TRIGGER ON THE LINES, NOT A RE-CREATED opening_stock_save. Every line reaches the table
-- through that function's insert, so a BEFORE INSERT/UPDATE trigger sees all of them without
-- copying 0801's body — re-creating a function from an old copy is how a peer session's edits
-- get erased (memory: stock owner / 0802).
--
-- `po_requirement_lines` is SECURITY DEFINER and already limits itself to orders the caller can
-- see, so the trigger can stay INVOKER. An order with NO plan refuses every line — the screen
-- says "build its BOM, or enter this stock as General", and the guard must agree with it.
-- Posted documents are unaffected: their lines are never re-inserted.

create or replace function public.opening_stock_line_in_plan()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  d record;
  v_order uuid;
  v_label text;
  v_item text;
begin
  select o.group_kind, o.garment_order_id, o.iwo_id into d
    from public.opening_stocks o where o.id = new.opening_stock_id;
  if not found or coalesce(d.group_kind, 'general') = 'general' then
    return new;
  end if;
  v_order := case when d.group_kind = 're' then d.garment_order_id else d.iwo_id end;
  if v_order is null then
    raise exception 'Pick the order the opening stock is held for';
  end if;

  if exists (
    select 1 from public.po_requirement_lines(array[v_order]) l
     where l.source_id = v_order and l.item_id = new.item_id
  ) then
    return new;
  end if;

  select coalesce(so.order_number, ga.code) into v_label
    from public.garment_order_amendments ga
    left join public.sales_orders so on so.id = ga.sales_order_id
   where ga.id = v_order;
  if v_label is null then
    select w.code into v_label from public.internal_work_orders w where w.id = v_order;
  end if;
  select i.name into v_item from public.items i where i.id = new.item_id;

  raise exception 'Line %: % is not in %''s requirement plan — pick a planned item, or enter this stock as General',
    coalesce(new.sort_order, 0) + 1, coalesce(v_item, 'this item'), coalesce(v_label, 'the order');
end;
$$;
revoke all on function public.opening_stock_line_in_plan() from public, anon;

drop trigger if exists trg_opening_stock_line_in_plan on public.opening_stock_lines;
create trigger trg_opening_stock_line_in_plan
  before insert or update of item_id, opening_stock_id on public.opening_stock_lines
  for each row execute function public.opening_stock_line_in_plan();
