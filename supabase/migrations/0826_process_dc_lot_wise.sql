-- 0826 · PROCESS DC SENDS EACH LINE FROM ITS OWN LOT — Knitting Hub Phase 2 (Yarn DC,
-- doc/process/knitting-plan.md, user 2026-11-11).
--
-- A knitter's yarn goes out in sealed bags from named lots, and one yarn is often sent from
-- two lots on one challan. `process_dc_dispatch` (0786) wrote its two ledger rows with NO
-- lot, leaving `stamp_stock_lot` (0790) to fill it in — and that trigger picks the FIRST DC
-- line carrying the same item, so the second lot's kilos were booked against the first lot:
-- one lot under-drawn, the other over-drawn, both wrong in Stock Statement and FIFO.
--
-- Two changes, everything else is 0786's body verbatim:
--   1. both ledger rows carry the line's own lot (`upper(trim(lot_no))`), so the stock at the
--      knitter is held in the same lot it left in — the receipt and the yarn return can
--      find it there;
--   2. a line that names a lot may not send more than that lot holds in that store and bin
--      (`stock_lot_balances`). A line with no lot keeps the old behaviour — the store-level
--      check in `apply_stock_movement` — so the Material BOM's "Send material out" (0788),
--      which names no lot, is unchanged.
--
-- The owner (RE / IWO) is still stamped by `stamp_stock_owner` (0802); value by
-- `stamp_stock_movement_defaults`.

create or replace function public.process_dc_dispatch(p_dc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  o record;
  l record;
  v_proc uuid;
  v_ordered numeric;
  v_sent numeric;
  v_n integer := 0;
  v_lot text;
  v_have numeric;
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
  if o.status not in ('issued', 'in_process', 'partially_received') then
    raise exception 'Process Order % is %, not open for dispatch — issue it first', coalesce(o.code, ''), o.status
      using errcode = 'P0001';
  end if;
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
    select sent_qty into v_ordered from public.process_order_lines
     where id = l.process_order_line_id and process_order_id = d.process_order_id;
    if v_ordered is null then
      raise exception '%: not a line of the Process Order', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;
    select coalesce(sum(x.sent_qty), 0) into v_sent
      from public.dc_line_items x
      join public.delivery_challans y on y.id = x.delivery_challan_id
     where x.process_order_line_id = l.process_order_line_id
       and y.id <> p_dc_id
       and y.status not in ('draft', 'cancelled');
    if l.sent_qty > v_ordered - v_sent + 0.0005 then
      raise exception '%: only % is left to send on the Process Order', coalesce(l.description, 'A line'), v_ordered - v_sent
        using errcode = 'P0001';
    end if;
    if l.from_store_id is null or not exists (
      select 1 from public.stores s where s.id = l.from_store_id and s.location_id = d.location_id and s.store_type not in ('transit', 'processing')) then
      raise exception '%: pick a store of this unit to send from', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;

    -- (1) + (2): the line's own lot, and no more than that lot holds where it is.
    v_lot := nullif(upper(btrim(coalesce(l.lot_no, ''))), '');
    if v_lot is not null then
      select coalesce(sum(b.quantity), 0) into v_have
        from public.stock_lot_balances b
       where b.store_id = l.from_store_id
         and b.bin_id is not distinct from l.bin_id
         and b.item_id = l.item_id
         and b.lot_no = v_lot;
      -- Earlier lines of this DC are already in the ledger (inserted above, same
      -- transaction), so the view nets them: two lines on one lot cannot overdraw it.
      if l.sent_qty > v_have + 0.0005 then
        raise exception '%: lot % holds only % here', coalesce(l.description, 'A line'), v_lot, round(v_have, 3)
          using errcode = 'P0001';
      end if;
    end if;

    insert into public.stock_ledger
      (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, location_id,
       reference_type, reference_id, note, lot_no)
    values
      (l.from_store_id, l.bin_id, l.item_id, 'transfer_out', l.sent_qty, v_proc, d.dc_date, d.location_id,
       'delivery_challan', p_dc_id, 'Sent for ' || coalesce(o.process_type, 'processing') || ' on ' || coalesce(d.code, ''), v_lot),
      (v_proc, null, l.item_id, 'transfer_in', l.sent_qty, l.from_store_id, d.dc_date, d.location_id,
       'delivery_challan', p_dc_id, 'At processor on ' || coalesce(d.code, ''), v_lot);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'A Process DC needs at least one line' using errcode = 'P0001';
  end if;

  update public.delivery_challans
     set status = 'issued', dispatched_at = now(), dispatched_by = auth.uid(), stock_posted_at = now()
   where id = p_dc_id;
  update public.process_orders set status = 'in_process' where id = o.id and status = 'issued';
end;
$$;

revoke all on function public.process_dc_dispatch(uuid) from public, anon;
grant execute on function public.process_dc_dispatch(uuid) to authenticated;
