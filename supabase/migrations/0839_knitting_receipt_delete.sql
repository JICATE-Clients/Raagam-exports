-- 0839 · DELETE A FABRIC RECEIPT / YARN RETURN (user 2026-11-13, screenshot 4136: "add delete
-- option … Fabric Receipts, Yarn Returns — add it for the child").
--
-- A posted knitting receipt has already moved stock, so a delete UNDOES knitting_receipt_post
-- (0830 → 0837) rather than dropping rows. The balance table is kept by an INSERT trigger
-- (apply_stock_movement), so ledger rows are never deleted — the GRN edit's shape (0792):
--   stock  → per store·bin·item·lot, the receipt's NET rows are mirrored: what came IN
--            (fabric into a store, returned yarn back on the shelf) goes out as adjust_out;
--            what went OUT (yarn used / returned from the Processing store) comes back as
--            adjust_in — the yarn is at the knitter again.
--   DC     → each yarn row's kg is taken back off its DC line's returned_qty, and the DC's
--            status recomputed (issued / partially_returned / closed).
--   order  → back to in_process when no receipt is left.
--   bill   → the draft payable the fabric raised goes.
-- Refused, with the reason, when that cannot be undone cleanly: the order is closed or
-- cancelled, the bill is no longer a draft, or stock from the receipt has already been
-- issued / moved (that lot in that store·bin would go below zero).
-- Party Stock moves posted with a Yarn Return are their own paper DCs and are NOT undone here.

create or replace function public.knitting_receipt_delete(p_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  k  record;
  o  record;
  r  record;
  v_have numeric;
begin
  if not public.has_permission('stores', 'delete') then
    raise exception 'You do not have permission to delete a knitting receipt' using errcode = '42501';
  end if;
  select * into k from public.knitting_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'Receipt not found' using errcode = 'P0002';
  end if;
  select * into o from public.process_orders where id = k.process_order_id for update;
  if not public.is_current_location(k.location_id) then
    raise exception 'A receipt is deleted in the unit that posted it — switch unit in the top bar' using errcode = '42501';
  end if;
  if o.status not in ('in_process', 'partially_received') then
    raise exception 'Knitting order % is %: its receipts can no longer be deleted', coalesce(o.code, ''), o.status
      using errcode = 'P0001';
  end if;
  if k.payable_id is not null and exists (select 1 from public.payables where id = k.payable_id and status <> 'draft') then
    raise exception 'The knitter''s bill for % is no longer a draft in Payables — it cannot be deleted', coalesce(k.code, 'this receipt')
      using errcode = 'P0001';
  end if;

  -- 1. STOCK — mirror the receipt's net rows, store·bin·item·lot.
  for r in
    select store_id, bin_id, item_id, lot_no, location_id, garment_order_id, iwo_id, max(rate) as rate,
           sum(case when movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then quantity else -quantity end) as q
      from public.stock_ledger
     where reference_type = 'knitting_receipt' and reference_id = p_receipt_id
     group by store_id, bin_id, item_id, lot_no, location_id, garment_order_id, iwo_id
     order by 9 desc   -- q: the stock to take back out first, checked before anything else moves
  loop
    if r.q > 0.0005 then
      select coalesce(sum(case when movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then quantity else -quantity end), 0)
        into v_have
        from public.stock_ledger
       where store_id = r.store_id and item_id = r.item_id
         and bin_id is not distinct from r.bin_id and lot_no is not distinct from r.lot_no;
      if v_have < r.q - 0.0005 then
        raise exception 'Lot % from % has already been issued or moved (% kg left of %) — it cannot be deleted',
          coalesce(r.lot_no, '—'), coalesce(k.code, 'this receipt'), round(v_have, 3), round(r.q, 3) using errcode = 'P0001';
      end if;
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id,
         note, lot_no, garment_order_id, iwo_id)
      values
        (r.store_id, r.bin_id, r.item_id, 'adjust_out', r.q, current_date, r.rate, r.location_id, 'knitting_receipt', p_receipt_id,
         'Receipt ' || coalesce(k.code, '') || ' deleted', r.lot_no, r.garment_order_id, r.iwo_id);
    elsif r.q < -0.0005 then
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id,
         note, lot_no, garment_order_id, iwo_id)
      values
        (r.store_id, r.bin_id, r.item_id, 'adjust_in', -r.q, current_date, r.rate, r.location_id, 'knitting_receipt', p_receipt_id,
         'Receipt ' || coalesce(k.code, '') || ' deleted — yarn back at the knitter', r.lot_no, r.garment_order_id, r.iwo_id);
    end if;
  end loop;

  -- 2. THE DC LINES — the kg is at the knitter again.
  for r in select dc_line_id, sum(qty_kg) as q from public.knitting_receipt_yarns where receipt_id = p_receipt_id group by 1 loop
    update public.dc_line_items set returned_qty = greatest(coalesce(returned_qty, 0) - r.q, 0) where id = r.dc_line_id;
  end loop;
  update public.delivery_challans dc
     set status = case
           when not exists (select 1 from public.dc_line_items x where x.delivery_challan_id = dc.id
                             and coalesce(x.returned_qty, 0) + coalesce(x.shortage_qty, 0) > 0.0005) then 'issued'
           when not exists (select 1 from public.dc_line_items x where x.delivery_challan_id = dc.id
                             and coalesce(x.returned_qty, 0) + coalesce(x.shortage_qty, 0) < x.sent_qty - 0.0005) then 'closed'
           else 'partially_returned' end
   where dc.id in (select x.delivery_challan_id from public.dc_line_items x
                    join public.knitting_receipt_yarns y on y.dc_line_id = x.id where y.receipt_id = p_receipt_id)
     and dc.status in ('issued', 'partially_returned', 'closed');

  -- 3. THE DOCUMENT AND ITS DRAFT BILL (lines cascade).
  delete from public.knitting_receipts where id = p_receipt_id;
  if k.payable_id is not null then
    delete from public.payables where id = k.payable_id;
  end if;

  -- 4. THE ORDER — no receipt left means nothing has come back yet.
  if not exists (select 1 from public.knitting_receipts where process_order_id = o.id) then
    update public.process_orders set status = 'in_process' where id = o.id and status = 'partially_received';
  end if;
end;
$$;

revoke all on function public.knitting_receipt_delete(uuid) from public, anon;
grant execute on function public.knitting_receipt_delete(uuid) to authenticated;

comment on function public.knitting_receipt_delete(uuid) is
  'Delete a Fabric Receipt / Yarn Return (0839): reverses knitting_receipt_post — stock mirrored, DC returned_qty taken back, draft bill dropped; refused once its stock moved on, its bill left draft, or the order closed.';
