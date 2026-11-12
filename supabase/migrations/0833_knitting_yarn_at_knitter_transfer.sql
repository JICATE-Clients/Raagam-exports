-- 0833 · YARN ALREADY AT THE KNITTER, PUT ON ANOTHER KNITTING ORDER (client 2026-11-11,
-- record-1794389607184: "differentiate factory-issued yarn and yarn already residing at the
-- knitter's premises (e.g. elastane stored at the vendor); allocate vendor-held stock directly
-- to a Knitting Program without generating a fresh outward transport DC").
--
-- Read as OUR yarn left at the knitter on an earlier Knitting Order (user 2026-11-11, the
-- recommended reading). The yarn the knitter BOUGHT is a purchase, not this.
--
-- `knitting_transfer_at_knitter(from yarn row, to yarn row, kg)`:
--   * Same knitter, same unit, same yarn; the source order has yarn out, the target is issued.
--   * The kg comes off the SOURCE order's DC lines, oldest first (`knitting_take_from_dc`), and is
--     recorded there as kind 'transferred' — so the source's analysis does not read it as loss.
--   * The TARGET gets a PAPER DC: an issued Process DC with `knit_transfer_from` set, no vehicle,
--     no goods moved. Its lines are the target's yarn lines, so the target's +1-bag cap (D2), its
--     receipts (fabric kg × blend drawn oldest-DC-first) and its close all work unchanged.
--   * Stock stays in the Processing store; only its OWNER changes — out under the source's RE,
--     in under the target's, lot kept.

alter table public.delivery_challans
  add column if not exists knit_transfer_from uuid references public.process_orders(id);
comment on column public.delivery_challans.knit_transfer_from is
  'Set on a paper DC: yarn already at the knitter moved from this Knitting Order (0833). No goods left the unit.';

alter table public.knitting_receipt_yarns drop constraint if exists knitting_receipt_yarns_kind_check;
alter table public.knitting_receipt_yarns
  add constraint knitting_receipt_yarns_kind_check check (kind in ('used', 'returned', 'written_off', 'transferred'));
alter table public.knitting_receipt_yarns
  add column if not exists transfer_dc_id uuid references public.delivery_challans(id);

create or replace function public.knitting_transfer_at_knitter(p_from_yarn uuid, p_to_yarn uuid, p_kg numeric, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  fy record;
  ty record;
  fo record;
  tor record;
  c record;
  v_kg numeric := round(coalesce(p_kg, 0), 3);
  v_proc uuid;
  v_dc uuid;
  v_dc_code text;
  v_sent numeric;
  v_cap numeric;
  v_fre uuid;
  v_fiwo uuid;
  v_tre uuid;
  v_tiwo uuid;
  v_n integer := 0;
  v_note text := nullif(upper(btrim(coalesce(p_note, ''))), '');
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to move yarn between knitting orders' using errcode = '42501';
  end if;
  if v_kg <= 0 then
    raise exception 'Enter the kg to move' using errcode = 'P0001';
  end if;

  select py.*, pf.process_order_id, i.name as yarn_name into fy
    from public.process_order_knit_yarns py
    join public.process_order_knit_fabrics pf on pf.id = py.knit_fabric_id
    join public.items i on i.id = py.yarn_item_id
   where py.id = p_from_yarn;
  select py.*, pf.process_order_id, i.name as yarn_name into ty
    from public.process_order_knit_yarns py
    join public.process_order_knit_fabrics pf on pf.id = py.knit_fabric_id
    join public.items i on i.id = py.yarn_item_id
   where py.id = p_to_yarn;
  if fy.id is null or ty.id is null then
    raise exception 'Yarn line not found' using errcode = 'P0002';
  end if;
  if fy.process_order_id = ty.process_order_id then
    raise exception 'Pick a different Knitting Order to move the yarn to' using errcode = 'P0001';
  end if;
  if fy.yarn_item_id <> ty.yarn_item_id then
    raise exception '% cannot be put on a line for %', fy.yarn_name, ty.yarn_name using errcode = 'P0001';
  end if;

  -- lock both orders in id order, so two moves the other way cannot deadlock
  perform 1 from public.process_orders where id in (fy.process_order_id, ty.process_order_id) order by id for update;
  select * into fo from public.process_orders where id = fy.process_order_id;
  select * into tor from public.process_orders where id = ty.process_order_id;
  if fo.process_type <> 'knitting' or tor.process_type <> 'knitting' then
    raise exception 'Only Knitting Orders' using errcode = 'P0001';
  end if;
  if fo.vendor_id is distinct from tor.vendor_id then
    raise exception 'The yarn is at the knitter of %, and % is with another knitter', coalesce(fo.code, ''), coalesce(tor.code, '')
      using errcode = 'P0001';
  end if;
  if fo.location_id is distinct from tor.location_id or not public.is_current_location(tor.location_id) then
    raise exception 'Both Knitting Orders must be of the unit you are working in' using errcode = '42501';
  end if;
  if fo.status not in ('in_process', 'partially_received') or fo.close_pending then
    raise exception '% has no yarn at the knitter to move (it is %)', coalesce(fo.code, ''), fo.status using errcode = 'P0001';
  end if;
  if tor.status not in ('issued', 'in_process', 'partially_received') or tor.close_pending then
    raise exception '% is %, not open for yarn — issue it first', coalesce(tor.code, ''), tor.status using errcode = 'P0001';
  end if;

  -- D2: the target's cap is its order line, exactly as for a real DC.
  select sent_qty into v_cap from public.process_order_lines where id = ty.process_order_line_id;
  select coalesce(sum(x.sent_qty), 0) into v_sent
    from public.dc_line_items x join public.delivery_challans d on d.id = x.delivery_challan_id
   where x.process_order_line_id = ty.process_order_line_id and d.status not in ('draft', 'cancelled');
  if v_kg > coalesce(v_cap, 0) - v_sent + 0.0005 then
    raise exception '% on %: only % kg is left to send', ty.yarn_name, coalesce(tor.code, ''), round(greatest(coalesce(v_cap, 0) - v_sent, 0), 3)
      using errcode = 'P0001';
  end if;

  select id into v_proc from public.stores
   where location_id = tor.location_id and store_type = 'processing' and is_active order by code limit 1;
  if v_proc is null then
    raise exception 'This unit has no Processing store' using errcode = 'P0001';
  end if;
  select x.garment_order_id, x.iwo_id into v_fre, v_fiwo from public.stock_owner_for('process_order', fo.id, null) x;
  select x.garment_order_id, x.iwo_id into v_tre, v_tiwo from public.stock_owner_for('process_order', tor.id, null) x;

  insert into public.delivery_challans
    (dc_kind, vendor_id, location_id, dc_date, status, process_order_id, process_type, purpose, notes,
     knit_transfer_from, dispatched_at, dispatched_by, stock_posted_at)
  values
    ('process', tor.vendor_id, tor.location_id, current_date, 'issued', tor.id, 'knitting',
     'Yarn already at the knitter — moved from ' || coalesce(fo.code, ''), v_note,
     fo.id, now(), auth.uid(), now())
  returning id, code into v_dc, v_dc_code;

  for c in select * from public.knitting_take_from_dc(fy.process_order_line_id, v_kg, fy.yarn_name || ' at the knitter on ' || coalesce(fo.code, '')) loop
    v_n := v_n + 1;
    insert into public.dc_line_items
      (delivery_challan_id, item_id, description, sent_qty, returned_qty, from_store_id, lot_no, process_order_line_id, sort_order)
    values (v_dc, ty.yarn_item_id, ty.yarn_name, c.qty, 0, v_proc, c.lot_no, ty.process_order_line_id, v_n);
    insert into public.stock_ledger
      (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, location_id,
       reference_type, reference_id, note, lot_no, garment_order_id, iwo_id)
    values
      (v_proc, null, ty.yarn_item_id, 'transfer_out', c.qty, v_proc, current_date, tor.location_id, 'delivery_challan', v_dc,
       'At the knitter: moved from ' || coalesce(fo.code, '') || ' to ' || coalesce(tor.code, '') || ' on ' || coalesce(v_dc_code, ''), c.lot_no, v_fre, v_fiwo),
      (v_proc, null, ty.yarn_item_id, 'transfer_in', c.qty, v_proc, current_date, tor.location_id, 'delivery_challan', v_dc,
       'At the knitter: moved from ' || coalesce(fo.code, '') || ' to ' || coalesce(tor.code, '') || ' on ' || coalesce(v_dc_code, ''), c.lot_no, v_tre, v_tiwo);
    insert into public.knitting_receipt_yarns
      (process_order_id, knit_yarn_id, yarn_item_id, dc_line_id, kind, qty_kg, lot_no, reason, transfer_dc_id)
    values (fo.id, fy.id, fy.yarn_item_id, c.dc_line_id, 'transferred', c.qty, c.lot_no,
            coalesce(v_note, 'MOVED TO ' || coalesce(tor.code, '')), v_dc);
  end loop;

  perform public.knitting_refresh_dc_status(fo.id);
  update public.process_orders set status = 'in_process' where id = tor.id and status = 'issued';
  return v_dc;
end;
$$;
revoke all on function public.knitting_transfer_at_knitter(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.knitting_transfer_at_knitter(uuid, uuid, numeric, text) to authenticated;
