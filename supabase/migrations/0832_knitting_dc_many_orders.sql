-- 0832 · ONE YARN DC, SEVERAL KNITTING ORDERS (client 2026-11-11, record-1794389607184:
-- "allow combining multiple RE numbers onto a single outward Job Work DC; each RE number and
-- its yarn breakdown must display row-by-row").
--
-- A Knitting Order stays ONE RE (process_orders.sales_order_id), so every RE keeps its own
-- loss figure. What changes is the DC: its lines may belong to several Knitting Orders, as long
-- as they all go to the same knitter from the same unit. `delivery_challans.process_order_id`
-- stays — it is the order the DC was raised from — and every reader that needs "the DCs of an
-- order" now asks through the LINES (dc_line_items.process_order_line_id), never that column.
--
--   * Knitting only. A dyeing / washing DC is received by 0787's Process Receipt, which reads
--     one order per DC, so every other process keeps one order per DC (refused below).
--   * The stock owner is the LINE's order (its RE / IWO), stated explicitly on both ledger rows
--     — `stamp_stock_owner` would otherwise give every line the DC's first order.
--   * Each order on the DC moves Issued → In Knitting.
--   * Everything else is 0829's body (lot check, bin check, balance per line).

create or replace function public.process_dc_dispatch(p_dc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  o record;
  lo record;
  l record;
  v_proc uuid;
  v_ordered numeric;
  v_sent numeric;
  v_n integer := 0;
  v_lot text;
  v_have numeric;
  v_re uuid;
  v_iwo uuid;
  v_orders uuid[] := '{}';
begin
  select * into d from public.delivery_challans where id = p_dc_id for update;
  if not found or d.dc_kind <> 'process' then
    raise exception 'Process DC not found' using errcode = 'P0002';
  end if;
  if not (public.has_permission('stores', 'edit') or public.has_permission('materials_purchase', 'edit')) then
    raise exception 'You do not have permission to dispatch a Process DC' using errcode = '42501';
  end if;
  if not public.is_current_location(d.location_id) then
    raise exception 'A Process DC is dispatched by the unit it was raised in — switch unit in the top bar' using errcode = '42501';
  end if;
  if d.status <> 'draft' then
    raise exception 'This DC has already been dispatched' using errcode = 'P0001';
  end if;
  if d.process_order_id is null then
    raise exception 'A Process DC goes out against a Process Order — pick one' using errcode = 'P0001';
  end if;
  select * into o from public.process_orders where id = d.process_order_id for update;
  if o.vendor_id is distinct from d.vendor_id then
    raise exception 'The DC must go to the Process Order''s vendor' using errcode = 'P0001';
  end if;

  select id into v_proc from public.stores
   where location_id = d.location_id and store_type = 'processing' and is_active order by code limit 1;
  if v_proc is null then
    raise exception 'This unit has no Processing store — set one up under Stores first' using errcode = 'P0001';
  end if;

  for l in select * from public.dc_line_items where delivery_challan_id = p_dc_id order by sort_order loop
    if l.item_id is null or coalesce(l.sent_qty, 0) <= 0 then
      raise exception 'Every line needs an item and a qty' using errcode = 'P0001';
    end if;
    if l.process_order_line_id is null then
      raise exception '%: not a line of the Process Order', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;

    -- THE LINE'S OWN ORDER (0832).
    select po.* into lo
      from public.process_order_lines pol join public.process_orders po on po.id = pol.process_order_id
     where pol.id = l.process_order_line_id;
    if lo.id is null then
      raise exception '%: not a line of the Process Order', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;
    if lo.id <> o.id then
      if o.process_type <> 'knitting' or lo.process_type <> 'knitting' then
        raise exception '%: only Knitting Orders can share one DC — this line is on %', coalesce(l.description, 'A line'), coalesce(lo.code, 'another order')
          using errcode = 'P0001';
      end if;
      if lo.vendor_id is distinct from d.vendor_id or lo.location_id is distinct from d.location_id then
        raise exception '%: % goes to another knitter or unit — one DC goes to one knitter', coalesce(l.description, 'A line'), coalesce(lo.code, 'That order')
          using errcode = 'P0001';
      end if;
    end if;
    if not (lo.id = any (v_orders)) then
      perform 1 from public.process_orders where id = lo.id for update;
      if lo.status not in ('issued', 'in_process', 'partially_received') then
        raise exception 'Process Order % is %, not open for dispatch — issue it first', coalesce(lo.code, ''), lo.status
          using errcode = 'P0001';
      end if;
      if coalesce(lo.close_pending, false) then
        raise exception 'Knitting Order % is waiting for the MD to approve its close — nothing more can be sent', coalesce(lo.code, '')
          using errcode = 'P0001';
      end if;
      v_orders := v_orders || lo.id;
    end if;
    select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.stock_owner_for('process_order', lo.id, null) x;

    select sent_qty into v_ordered from public.process_order_lines where id = l.process_order_line_id;
    select coalesce(sum(x.sent_qty), 0) into v_sent
      from public.dc_line_items x
      join public.delivery_challans y on y.id = x.delivery_challan_id
     where x.process_order_line_id = l.process_order_line_id
       and y.id <> p_dc_id
       and y.status not in ('draft', 'cancelled');
    if l.sent_qty > v_ordered - v_sent + 0.0005 then
      raise exception '%: only % is left to send on %', coalesce(l.description, 'A line'), v_ordered - v_sent, coalesce(lo.code, 'the Process Order')
        using errcode = 'P0001';
    end if;
    if l.from_store_id is null or not exists (
      select 1 from public.stores s where s.id = l.from_store_id and s.location_id = d.location_id and s.store_type not in ('transit', 'processing')) then
      raise exception '%: pick a store of this unit to send from', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;

    v_lot := nullif(upper(btrim(coalesce(l.lot_no, ''))), '');
    if v_lot is not null then
      select coalesce(sum(b.quantity), 0) into v_have
        from public.stock_lot_balances b
       where b.store_id = l.from_store_id
         and b.bin_id is not distinct from l.bin_id
         and b.item_id = l.item_id
         and b.lot_no = v_lot;
      if l.sent_qty > v_have + 0.0005 then
        raise exception '%: lot % holds only % here', coalesce(l.description, 'A line'), v_lot, round(v_have, 3)
          using errcode = 'P0001';
      end if;
    elsif l.bin_id is not null then
      select coalesce(sum(b.quantity), 0) into v_have
        from public.stock_bin_balances b
       where b.store_id = l.from_store_id and b.bin_id = l.bin_id and b.item_id = l.item_id;
      if l.sent_qty > v_have + 0.0005 then
        raise exception '%: that bin holds only % here', coalesce(l.description, 'A line'), round(v_have, 3)
          using errcode = 'P0001';
      end if;
    end if;

    insert into public.stock_ledger
      (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, location_id,
       reference_type, reference_id, note, lot_no, garment_order_id, iwo_id)
    values
      (l.from_store_id, l.bin_id, l.item_id, 'transfer_out', l.sent_qty, v_proc, d.dc_date, d.location_id,
       'delivery_challan', p_dc_id, 'Sent for ' || coalesce(lo.process_type, 'processing') || ' on ' || coalesce(d.code, '')
         || case when lo.id <> o.id then ' (' || coalesce(lo.code, '') || ')' else '' end, v_lot, v_re, v_iwo),
      (v_proc, null, l.item_id, 'transfer_in', l.sent_qty, l.from_store_id, d.dc_date, d.location_id,
       'delivery_challan', p_dc_id, 'At processor on ' || coalesce(d.code, '')
         || case when lo.id <> o.id then ' (' || coalesce(lo.code, '') || ')' else '' end, v_lot, v_re, v_iwo);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'A Process DC needs at least one line' using errcode = 'P0001';
  end if;

  update public.delivery_challans
     set status = 'issued', dispatched_at = now(), dispatched_by = auth.uid(), stock_posted_at = now()
   where id = p_dc_id;
  update public.process_orders set status = 'in_process' where id = any (v_orders) and status = 'issued';
end;
$$;

revoke all on function public.process_dc_dispatch(uuid) from public, anon;
grant execute on function public.process_dc_dispatch(uuid) to authenticated;

-- The DCs of an order are the DCs carrying its LINES (a shared DC is refreshed by either order).
create or replace function public.knitting_refresh_dc_status(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.delivery_challans dc
     set status = case
           when not exists (select 1 from public.dc_line_items x where x.delivery_challan_id = dc.id
                             and coalesce(x.returned_qty, 0) + coalesce(x.shortage_qty, 0) < x.sent_qty - 0.0005)
           then 'closed' else 'partially_returned' end
   where dc.id in (select x.delivery_challan_id
                     from public.dc_line_items x
                     join public.process_order_lines pol on pol.id = x.process_order_line_id
                    where pol.process_order_id = p_order_id)
     and dc.status in ('issued', 'partially_returned')
     and exists (select 1 from public.dc_line_items x where x.delivery_challan_id = dc.id
                  and coalesce(x.returned_qty, 0) + coalesce(x.shortage_qty, 0) > 0);
$$;
revoke all on function public.knitting_refresh_dc_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 0830's balance / write-off / close, reading an order's DCs through its LINES (0832).
-- Bodies verbatim otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.knitting_order_balance(p_order_id uuid)
returns table (issued_kg numeric, balance_kg numeric, loss_pct numeric)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(x.sent_qty), 0),
         coalesce(sum(greatest(x.sent_qty - coalesce(x.returned_qty, 0) - coalesce(x.shortage_qty, 0), 0)), 0),
         case when coalesce(sum(x.sent_qty), 0) > 0
              then round(coalesce(sum(greatest(x.sent_qty - coalesce(x.returned_qty, 0) - coalesce(x.shortage_qty, 0), 0)), 0)
                         / sum(x.sent_qty) * 100, 3) end
    from public.dc_line_items x
    join public.delivery_challans d on d.id = x.delivery_challan_id
   where x.process_order_line_id in (select id from public.process_order_lines where process_order_id = p_order_id) and d.status not in ('draft', 'cancelled');
$$;
revoke all on function public.knitting_order_balance(uuid) from public, anon;
grant execute on function public.knitting_order_balance(uuid) to authenticated;

-- Writes off what is still at the knitter and closes. Internal: reached by an in-limit close
-- or by the MD's approve.
create or replace function public.knitting_close_write_off(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  l record;
  v_proc uuid;
  v_re uuid;
  v_iwo uuid;
  v_rem numeric;
  v_lot text;
begin
  select * into o from public.process_orders where id = p_order_id for update;
  select id into v_proc from public.stores
   where location_id = o.location_id and store_type = 'processing' and is_active order by code limit 1;
  select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.stock_owner_for('process_order', o.id, null) x;
  for l in
    select x.*, py.id as knit_yarn_id
      from public.dc_line_items x
      join public.delivery_challans d on d.id = x.delivery_challan_id
      left join public.process_order_knit_yarns py on py.process_order_line_id = x.process_order_line_id
     where x.process_order_line_id in (select id from public.process_order_lines where process_order_id = o.id) and d.status in ('issued', 'partially_returned')
     for update of x
  loop
    v_rem := round(l.sent_qty - coalesce(l.returned_qty, 0) - coalesce(l.shortage_qty, 0), 3);
    continue when v_rem <= 0.0005;
    v_lot := nullif(upper(btrim(coalesce(l.lot_no, ''))), '');
    update public.dc_line_items
       set shortage_qty = coalesce(shortage_qty, 0) + v_rem, shortage_reason = p_reason
     where id = l.id;
    insert into public.stock_ledger
      (store_id, bin_id, item_id, movement_type, quantity, txn_date, location_id, reference_type, reference_id,
       note, lot_no, garment_order_id, iwo_id)
    values (v_proc, null, l.item_id, 'adjust_out', v_rem, current_date, o.location_id, 'process_order', o.id,
            'Knitting loss written off at close of ' || coalesce(o.code, '') || ': ' || coalesce(p_reason, ''), v_lot, v_re, v_iwo);
    if l.knit_yarn_id is not null then
      insert into public.knitting_receipt_yarns (process_order_id, knit_yarn_id, yarn_item_id, dc_line_id, kind, qty_kg, lot_no, reason)
      values (o.id, l.knit_yarn_id, l.item_id, l.id, 'written_off', v_rem, v_lot, p_reason);
    end if;
  end loop;
  -- A DC shared with another order closes only when every one of its lines is accounted for.
  perform public.knitting_refresh_dc_status(o.id);
  update public.process_orders
     set status = 'closed', close_pending = false, close_reason = p_reason
   where id = o.id;
end;
$$;
revoke all on function public.knitting_close_write_off(uuid, text) from public, anon, authenticated;

-- Returns 'closed' (done now) or 'pending' (the app starts the MD's `knitting_close` run).
create or replace function public.knitting_order_close(p_order_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  b record;
  v_reason text := nullif(upper(btrim(coalesce(p_reason, ''))), '');
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to close a knitting order' using errcode = '42501';
  end if;
  select * into o from public.process_orders where id = p_order_id for update;
  if not found or o.process_type <> 'knitting' or not public.is_current_location(o.location_id) then
    raise exception 'Knitting order not found in your unit' using errcode = 'P0002';
  end if;
  if o.status not in ('in_process', 'partially_received') then
    raise exception 'Knitting order % is %, not open to close', coalesce(o.code, ''), o.status using errcode = 'P0001';
  end if;
  if o.close_pending then
    raise exception 'The close is already with the MD' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.delivery_challans d join public.dc_line_items x on x.delivery_challan_id = d.id
              where x.process_order_line_id in (select id from public.process_order_lines where process_order_id = o.id) and d.status = 'draft') then
    raise exception 'A yarn DC on this order is still a draft — dispatch or delete it first' using errcode = 'P0001';
  end if;
  select * into b from public.knitting_order_balance(o.id);
  if b.balance_kg > 0.0005 and v_reason is null then
    raise exception '% kg is still at the knitter — say why it is written off', round(b.balance_kg, 3) using errcode = 'P0001';
  end if;

  if b.balance_kg <= 0.0005 or (o.allowed_loss_pct is not null and coalesce(b.loss_pct, 0) <= o.allowed_loss_pct + 0.0005) then
    perform public.knitting_close_write_off(o.id, v_reason);
    return 'closed';
  end if;

  update public.process_orders
     set close_pending = true, close_reason = v_reason, close_loss_pct = b.loss_pct, close_remark = null
   where id = o.id;
  return 'pending';
end;
$$;
revoke all on function public.knitting_order_close(uuid, text) from public, anon;
grant execute on function public.knitting_order_close(uuid, text) to authenticated;
