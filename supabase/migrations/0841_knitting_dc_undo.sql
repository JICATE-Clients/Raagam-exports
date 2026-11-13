-- 0841 · UNDO A SENT YARN DC — THE YARN GOES BACK TO ITS BIN (user 2026-11-13, screenshot 4149:
-- "return to the bin, that's all").
--
-- Deleting every Fabric Receipt / Yarn Return (0839) leaves a Knitting Order In Knitting, because
-- the yarn went out on the DC, not on a receipt — and nothing could take a dispatched DC back. So a
-- Knitting Order with yarn sent could be neither cancelled nor deleted.
--
-- knitting_dc_undo(dc) reverses process_dc_dispatch (0832) exactly:
--   stock → every ledger row the DC wrote is mirrored: the Processing store's transfer_in goes out
--           again, the sending store·bin·lot gets its transfer_out back as transfer_in. Same item,
--           rate, owner (RE / IWO). Ledger rows are never deleted (the balance tables are kept by
--           an INSERT trigger).
--   DC    → status 'cancelled' (kept for the history; the delete below removes it with its order).
--   order → each Knitting Order on the DC goes back to Issued when it has no other live DC and no
--           receipt, so it can be cancelled or deleted.
-- Refused, with the reason, while anything has happened to that yarn at the knitter: a fabric
-- receipt / yarn return / transfer to another order / write-off (knitting_receipt_yarns, or a
-- returned / shortage qty on a line), a Process Receipt / Delivery Return, or the Processing store
-- no longer holding it. Knitting DCs only — dyeing / washing keep 0787's receipt flow.
--
-- knitting_order_delete(order) is the KO delete, moved into SQL so it can take the order's
-- CANCELLED DCs with it (RLS on delivery_challans would refuse that from the app, silently).
-- A DC that still carries another order's lines is never deleted here — the order is refused.

create or replace function public.knitting_dc_undo(p_dc_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  r record;
  v_have numeric;
  v_orders uuid[];
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to undo a yarn DC' using errcode = '42501';
  end if;
  select * into d from public.delivery_challans where id = p_dc_id for update;
  if not found or d.dc_kind <> 'process' then
    raise exception 'Yarn DC not found' using errcode = 'P0002';
  end if;
  if not public.is_current_location(d.location_id) then
    raise exception 'A DC is undone in the unit that sent it — switch unit in the top bar' using errcode = '42501';
  end if;
  if d.status <> 'issued' then
    raise exception 'DC % is %: only a sent DC with nothing back yet can be undone', coalesce(d.code, ''), d.status
      using errcode = 'P0001';
  end if;
  if d.knit_transfer_from is not null then
    raise exception 'DC % moved yarn between two knitting orders at the knitter — it cannot be undone', coalesce(d.code, '')
      using errcode = 'P0001';
  end if;

  select array_agg(distinct pol.process_order_id) into v_orders
    from public.dc_line_items x join public.process_order_lines pol on pol.id = x.process_order_line_id
   where x.delivery_challan_id = p_dc_id;
  if v_orders is null or exists (select 1 from public.process_orders where id = any (v_orders) and process_type <> 'knitting') then
    raise exception 'Only a knitting yarn DC can be undone here' using errcode = 'P0001';
  end if;
  perform 1 from public.process_orders where id = any (v_orders) for update;
  if exists (select 1 from public.process_orders where id = any (v_orders)
              and (status not in ('in_process', 'partially_received') or coalesce(close_pending, false))) then
    raise exception 'A knitting order on DC % is closed, cancelled or waiting for the MD — its DC cannot be undone', coalesce(d.code, '')
      using errcode = 'P0001';
  end if;

  -- Anything that happened to this yarn at the knitter.
  if exists (select 1 from public.dc_line_items x where x.delivery_challan_id = p_dc_id
              and (coalesce(x.returned_qty, 0) > 0.0005 or coalesce(x.shortage_qty, 0) > 0.0005))
     or exists (select 1 from public.knitting_receipt_yarns y join public.dc_line_items x on x.id = y.dc_line_id
                 where x.delivery_challan_id = p_dc_id)
     or exists (select 1 from public.dc_receipt_lines y join public.dc_line_items x on x.id = y.dc_line_id
                 where x.delivery_challan_id = p_dc_id)
     or exists (select 1 from public.dc_return_lines y join public.dc_line_items x on x.id = y.dc_line_id
                 where x.delivery_challan_id = p_dc_id) then
    raise exception 'Yarn from DC % has been received, returned or moved at the knitter — delete those first', coalesce(d.code, '')
      using errcode = 'P0001';
  end if;

  -- 1. STOCK — mirror the DC's own rows. The Processing store's side first, checked before anything moves.
  for r in
    select store_id, bin_id, item_id, lot_no, location_id, garment_order_id, iwo_id, counterparty_store_id, max(rate) as rate,
           sum(case when movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then quantity else -quantity end) as q
      from public.stock_ledger
     where reference_type = 'delivery_challan' and reference_id = p_dc_id
     group by store_id, bin_id, item_id, lot_no, location_id, garment_order_id, iwo_id, counterparty_store_id
     order by 10 desc
  loop
    if r.q > 0.0005 then
      select coalesce(sum(case when movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then quantity else -quantity end), 0)
        into v_have
        from public.stock_ledger
       where store_id = r.store_id and item_id = r.item_id
         and bin_id is not distinct from r.bin_id and lot_no is not distinct from r.lot_no;
      if v_have < r.q - 0.0005 then
        raise exception 'The yarn from DC % is no longer all at the knitter (% kg left of %) — it cannot be undone',
          coalesce(d.code, ''), round(v_have, 3), round(r.q, 3) using errcode = 'P0001';
      end if;
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, rate, location_id,
         reference_type, reference_id, note, lot_no, garment_order_id, iwo_id)
      values
        (r.store_id, r.bin_id, r.item_id, 'transfer_out', r.q, r.counterparty_store_id, current_date, r.rate, r.location_id,
         'delivery_challan', p_dc_id, 'DC ' || coalesce(d.code, '') || ' undone — yarn back to the store', r.lot_no, r.garment_order_id, r.iwo_id);
    elsif r.q < -0.0005 then
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, rate, location_id,
         reference_type, reference_id, note, lot_no, garment_order_id, iwo_id)
      values
        (r.store_id, r.bin_id, r.item_id, 'transfer_in', -r.q, r.counterparty_store_id, current_date, r.rate, r.location_id,
         'delivery_challan', p_dc_id, 'DC ' || coalesce(d.code, '') || ' undone — back in its bin', r.lot_no, r.garment_order_id, r.iwo_id);
    end if;
  end loop;

  -- 2. THE DC.
  update public.delivery_challans set status = 'cancelled' where id = p_dc_id;

  -- 3. THE ORDERS — nothing else sent and nothing received means the yarn never went.
  update public.process_orders po
     set status = 'issued'
   where po.id = any (v_orders)
     and po.status in ('in_process', 'partially_received')
     and not exists (select 1 from public.knitting_receipts k where k.process_order_id = po.id)
     and not exists (select 1 from public.dc_line_items x
                       join public.delivery_challans y on y.id = x.delivery_challan_id
                       join public.process_order_lines pol on pol.id = x.process_order_line_id
                      where pol.process_order_id = po.id and y.status not in ('draft', 'cancelled'));
end;
$$;

revoke all on function public.knitting_dc_undo(uuid) from public, anon;
grant execute on function public.knitting_dc_undo(uuid) to authenticated;

comment on function public.knitting_dc_undo(uuid) is
  'Undo a sent knitting yarn DC (0841): stock mirrored back to the sending bin, DC cancelled, order back to Issued; refused once anything came back or moved at the knitter.';

-- ---------------------------------------------------------------------------
-- The Knitting Order delete (was in lib/production/knitting-actions.ts), now taking its cancelled DCs.
-- ---------------------------------------------------------------------------
create or replace function public.knitting_order_delete(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o record;
  v_dcs uuid[];
begin
  if not public.has_permission('stores', 'delete') then
    raise exception 'You do not have permission to delete a knitting order' using errcode = '42501';
  end if;
  select * into o from public.process_orders where id = p_order_id for update;
  if not found or o.process_type <> 'knitting' then
    raise exception 'Knitting order not found' using errcode = 'P0002';
  end if;
  if not public.is_current_location(o.location_id) then
    raise exception 'A knitting order is deleted in its own unit — switch unit in the top bar' using errcode = '42501';
  end if;
  if o.status not in ('draft', 'issued', 'cancelled') then
    raise exception '% has yarn at the knitter — undo its yarn DC first', coalesce(o.code, 'This order') using errcode = 'P0001';
  end if;

  select array_agg(distinct x.delivery_challan_id) into v_dcs
    from public.dc_line_items x join public.process_order_lines pol on pol.id = x.process_order_line_id
   where pol.process_order_id = o.id;
  if v_dcs is not null then
    if exists (select 1 from public.delivery_challans where id = any (v_dcs) and status not in ('draft', 'cancelled')) then
      raise exception 'A yarn DC is out against % — undo it first', coalesce(o.code, 'this order') using errcode = 'P0001';
    end if;
    if exists (select 1 from public.dc_line_items x
                where x.delivery_challan_id = any (v_dcs)
                  and (x.process_order_line_id is null
                       or x.process_order_line_id not in (select id from public.process_order_lines where process_order_id = o.id))) then
      raise exception 'A DC on % also carries another knitting order''s yarn — cancel this order instead', coalesce(o.code, 'this order')
        using errcode = 'P0001';
    end if;
    delete from public.delivery_challans where id = any (v_dcs);   -- lines cascade
  end if;

  delete from public.process_orders where id = o.id;   -- fabric and yarn lines cascade
  return o.code;
end;
$$;

revoke all on function public.knitting_order_delete(uuid) from public, anon;
grant execute on function public.knitting_order_delete(uuid) to authenticated;
