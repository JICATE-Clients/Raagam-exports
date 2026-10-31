-- 0788 · A DC RAISED FROM THE MATERIAL BOM CREATES ITS OWN PROCESS ORDER (user 2026-10-31:
-- "automatically create a Process Order in the background").
--
-- 0786 made a Process DC go out only against a Process Order. The Material BOM's "Send
-- material out" (createDcFromBom, 0446) still wrote a bare `issued` challan with no order,
-- no rate, no loss limit and NO STOCK MOVEMENT (post_dc_stock was never called from the
-- app). Asking the merchandiser to raise an order first would add a step the user ruled
-- out, so this function does it in the same transaction:
--
--   1. a Process Order, already ISSUED, to the rows' vendor: process type read off the
--      process names, the RE from the BOM, Allowed Loss % = the highest loss % on the rows,
--      one line per row (qty out, expected back = qty in, the rate the operator typed);
--   2. a DRAFT Process DC against it, each line tied to its order line and to its BOM row
--      (`mba_process_row_uid`, so the BOM's "already sent" guard still holds), sent from the
--      unit's Material store.
--
-- The caller then dispatches it (`process_dc_dispatch`), which moves the stock. If the store
-- does not hold the goods yet, the DC stays a DRAFT and is dispatched later on Stores ▸
-- Process DC — the order and the challan are never lost to a stock shortfall.
--
-- SECURITY DEFINER because the merchandiser raising it holds `materials_purchase`, not
-- `stores` (process orders' key); the permission is checked here deliberately.

create or replace function public.bom_process_dc_raise(
  p_amendment_id uuid,
  p_vendor_id uuid,
  p_dc_date date,
  p_row_uids uuid[],
  p_rates jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc uuid := public.current_location();
  v_mat uuid;
  v_so uuid;
  v_type text;
  v_types text[];
  v_loss numeric;
  v_po uuid;
  v_dc uuid;
  v_pol uuid;
  v_purpose text;
  r record;
  v_n integer := 0;
  v_rate numeric;
begin
  if not public.has_permission('materials_purchase', 'create') then
    raise exception 'You do not have permission to send material out' using errcode = '42501';
  end if;
  if v_loc is null then
    raise exception 'Pick your working unit in the top bar first' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_row_uids, 1), 0) = 0 then
    raise exception 'Nothing selected to send out' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.dc_line_items where mba_process_row_uid = any (p_row_uids)) then
    raise exception 'One of those lines already has a challan — reopen the BOM to see it' using errcode = 'P0001';
  end if;
  if (select count(*) from public.material_bom_amendment_processes
       where amendment_id = p_amendment_id and row_uid = any (p_row_uids)) <> array_length(p_row_uids, 1) then
    raise exception 'Some of those lines are no longer on the BOM — reopen it and try again' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.material_bom_amendment_processes
              where amendment_id = p_amendment_id and row_uid = any (p_row_uids)
                and (item_id is null or coalesce(qty_out, 0) <= 0 or vendor_id is distinct from p_vendor_id)) then
    raise exception 'Every line needs a material, a Qty Out and the same processor' using errcode = 'P0001';
  end if;

  select id into v_mat from public.stores
   where location_id = v_loc and store_type = 'material' and is_active order by code limit 1;
  if v_mat is null then
    raise exception 'This unit has no Material store to send from' using errcode = 'P0001';
  end if;
  select sales_order_id into v_so from public.material_bom_amendments where id = p_amendment_id;

  select array_agg(distinct
           case
             when lower(coalesce(p.name, '')) like '%dye%' then 'dyeing'
             when lower(coalesce(p.name, '')) like '%print%' then 'printing'
             when lower(coalesce(p.name, '')) like '%knit%' then 'knitting'
             when lower(coalesce(p.name, '')) like '%wash%' then 'washing'
             when lower(coalesce(p.name, '')) like '%embroid%' then 'embroidery'
             when lower(coalesce(p.name, '')) like '%finish%' or lower(coalesce(p.name, '')) like '%compact%' then 'finishing'
             else 'other'
           end),
         max(x.loss_pct),
         string_agg(distinct p.name, ' · ')
    into v_types, v_loss, v_purpose
    from public.material_bom_amendment_processes x
    left join public.processes p on p.id = x.process_id
   where x.amendment_id = p_amendment_id and x.row_uid = any (p_row_uids);
  v_type := case when array_length(v_types, 1) = 1 then v_types[1] else 'other' end;

  insert into public.process_orders
    (vendor_id, location_id, process_type, status, order_date, expected_date, sales_order_id, allowed_loss_pct,
     currency_code, total_amount, notes, created_by)
  values
    (p_vendor_id, v_loc, v_type, 'issued', p_dc_date, null, v_so,
     case when v_loss is not null and v_loss >= 0 and v_loss < 100 then v_loss end,
     'INR', 0, 'Raised automatically from the Material BOM (' || coalesce(v_purpose, 'job work') || ')', auth.uid())
  returning id into v_po;

  insert into public.delivery_challans
    (dc_kind, vendor_id, location_id, dc_date, purpose, status, process_order_id, process_type, created_by)
  values
    ('process', p_vendor_id, v_loc, p_dc_date, coalesce(v_purpose, 'Job work'), 'draft', v_po, v_type, auth.uid())
  returning id into v_dc;

  for r in
    select x.row_uid, x.item_id, x.qty_out, x.qty_in, x.description, i.name as item_name, p.name as process_name
      from public.material_bom_amendment_processes x
      left join public.items i on i.id = x.item_id
      left join public.processes p on p.id = x.process_id
     where x.amendment_id = p_amendment_id and x.row_uid = any (p_row_uids)
     order by x.sno
  loop
    v_rate := greatest(coalesce(nullif(p_rates->>(r.row_uid::text), '')::numeric, 0), 0);
    insert into public.process_order_lines
      (process_order_id, item_id, description, sent_qty, return_qty, received_qty, rate, amount, sort_order)
    values
      (v_po, r.item_id, coalesce(r.item_name, 'Material') || ' — ' || coalesce(r.process_name, 'Job work'),
       r.qty_out, r.qty_in, 0, v_rate, round(r.qty_out * v_rate, 2), v_n)
    returning id into v_pol;
    insert into public.dc_line_items
      (delivery_challan_id, item_id, description, sent_qty, returned_qty, sort_order, mba_amendment_id, mba_process_row_uid,
       process_order_line_id, from_store_id)
    values
      (v_dc, r.item_id, coalesce(r.item_name, 'Material') || ' — ' || coalesce(r.process_name, 'Job work'),
       r.qty_out, 0, v_n, p_amendment_id, r.row_uid, v_pol, v_mat);
    v_n := v_n + 1;
  end loop;

  update public.process_orders
     set total_amount = (select coalesce(sum(amount), 0) from public.process_order_lines where process_order_id = v_po)
   where id = v_po;
  return v_dc;
end;
$$;

revoke all on function public.bom_process_dc_raise(uuid, uuid, date, uuid[], jsonb) from public, anon;
grant execute on function public.bom_process_dc_raise(uuid, uuid, date, uuid[], jsonb) to authenticated;
